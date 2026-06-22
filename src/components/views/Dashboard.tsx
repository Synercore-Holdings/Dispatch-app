import React, { useEffect, useMemo, useState } from "react";
import {
  Package,
  Truck,
  Archive,
  AlertTriangle,
  ClipboardList,
  Clock,
  Globe2,
  TrendingUp,
  Minus,
  Bell,
} from "lucide-react";
import { GlobalSearch } from "../GlobalSearch";
import { JobDetailsModal } from "../JobDetailsModal";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useDispatch } from "../../context/DispatchContext";
import { useAuth } from "../../context/AuthContext";
import { africaExportsAPI } from "../../services/api";
import { calculateETD, calculateRevisedETD } from "../../utils/deliveryDates";
import { formatNumber } from "../../utils/format";

const AFRICA_EXPORTS_KEY = "dispatch_africa_export_shipments_v2";

interface DashboardAfricaExport {
  ref: string;
  customer: string;
  destinationCountry: string;
  status: "pending" | "assigned" | "in-transit" | "delivered" | "cancelled";
  pallets: number;
  eta: string;
  lastCheckedAt?: string;
  documents?: Record<string, boolean>;
  dispatchApprovedAt?: string;
  archived?: boolean;
}

const DASHBOARD_AFRICA_REQUIRED_DOCUMENT_IDS = [
  "commercial-invoice",
  "packing-list",
  "sad-500",
  "transport-document",
  "hs-code",
  "exporter-code",
  "proof-export",
  "coa",
  "tds",
  "sds",
  "allergen",
  "non-gmo",
  "food-grade",
  "shelf-life",
  "batch-traceability",
];

// Helper to get week number
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

interface DashboardProps {
  onOpenAlerts?: () => void;
  onNavigate?: (page: string, tab?: string, ref?: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onOpenAlerts, onNavigate }) => {
  const { jobs, drivers } = useDispatch();
  const { user } = useAuth();
  const [selectedSearchJobId, setSelectedSearchJobId] = useState<string | null>(null);

  const [africaExports, setAfricaExports] = useState<DashboardAfricaExport[]>(() => {
    try {
      const raw = localStorage.getItem(AFRICA_EXPORTS_KEY);
      return raw ? JSON.parse(raw) as DashboardAfricaExport[] : [];
    } catch (error) {
      console.warn("Failed to load Africa export dashboard data", error);
      return [];
    }
  });

  useEffect(() => {
    let cancelled = false;
    africaExportsAPI.getAll()
      .then((shipments) => {
        if (cancelled) return;
        setAfricaExports(shipments);
        localStorage.setItem(AFRICA_EXPORTS_KEY, JSON.stringify(shipments));
      })
      .catch((error) => {
        console.warn("Failed to load Africa export dashboard data from database", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter to order jobs only
  const orderJobs = useMemo(() => {
    return jobs.filter((j) => j.jobType === "order" || j.jobType === undefined);
  }, [jobs]);

  // Stats - count unique order refs (ASO numbers), not individual line items
  const stats = useMemo(() => {
    // Helper: count unique refs matching a filter
    const uniqueRefs = (filter?: (j: typeof orderJobs[0]) => boolean) => {
      const refs = new Set<string>();
      orderJobs.forEach((j) => {
        if (!filter || filter(j)) refs.add(j.ref);
      });
      return refs.size;
    };

    const total = uniqueRefs();
    const pending = uniqueRefs((j) => j.status === "pending");
    const assigned = uniqueRefs((j) => j.status === "assigned");
    const inTransit = uniqueRefs((j) => j.status === "en-route");
    const delivered = uniqueRefs((j) => j.status === "delivered");
    const returned = uniqueRefs((j) => j.status === "returned");
    const exceptions = uniqueRefs((j) => j.status === "exception");
    const cancelled = uniqueRefs((j) => j.status === "cancelled");
    const availableDrivers = drivers.filter((d) => d.status === "available").length;
    const busyDrivers = drivers.filter((d) => d.status === "busy").length;

    // Count orders with ETD this week
    const now = new Date();
    const startOfWeek = new Date(now);
    const dayOfWeek = startOfWeek.getDay() || 7;
    startOfWeek.setDate(now.getDate() - dayOfWeek + 1);
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const isThisWeek = (dateString: string | undefined) => {
      if (!dateString) return false;
      const date = new Date(dateString);
      return !Number.isNaN(date.getTime()) && date >= startOfWeek && date < endOfWeek;
    };

    const getDispatchDate = (job: typeof orderJobs[0]) => {
      if (job.status !== "en-route" && job.status !== "delivered") return undefined;
      if (job.status === "delivered" && !job.dispatchedAt) {
        return job.actualDeliveryAt;
      }
      if (job.status === "delivered" && job.dispatchedAt && job.actualDeliveryAt) {
        const dispatchTime = new Date(job.dispatchedAt).getTime();
        const deliveryTime = new Date(job.actualDeliveryAt).getTime();
        if (!Number.isNaN(dispatchTime) && !Number.isNaN(deliveryTime) && dispatchTime > deliveryTime) {
          return job.actualDeliveryAt;
        }
      }
      return job.dispatchedAt;
    };

    const departuresThisWeek = new Set<string>();
    const deliveredMissingDispatchThisWeek = new Set<string>();
    orderJobs.forEach((j) => {
      const plannedDepartureDate = j.etd || calculateETD(j.eta, j.transportService);
      const canStillDepart = j.status !== "delivered" && j.status !== "returned" && j.status !== "cancelled";
      if (canStillDepart && isThisWeek(plannedDepartureDate)) {
        departuresThisWeek.add(j.ref);
      }

      if (j.status === "delivered" && !j.dispatchedAt && isThisWeek(j.actualDeliveryAt)) {
        deliveredMissingDispatchThisWeek.add(j.ref);
      }
    });

    const movedLineItemsThisWeek = orderJobs.filter((job) => isThisWeek(getDispatchDate(job)));
    const movedRefsThisWeek = new Set(movedLineItemsThisWeek.map((job) => job.ref));
    const ordersDispatchedThisWeek = movedRefsThisWeek.size;
    const palletsDispatchedThisWeek = movedLineItemsThisWeek.reduce((sum, job) => sum + (job.pallets || 0), 0);
    const qtyDispatchedThisWeek = movedLineItemsThisWeek.reduce((sum, job) => sum + (job.outstandingQty || 0), 0);
    const palletsDispatchedThisYear = orderJobs.reduce((sum, job) => {
      const palletDate = getDispatchDate(job);
      if (!palletDate) return sum;
      const dispatchDate = new Date(palletDate);
      if (Number.isNaN(dispatchDate.getTime()) || dispatchDate.getFullYear() !== now.getFullYear()) return sum;
      return sum + (job.pallets || 0);
    }, 0);
    const avgPalletsDispatchedPerWeekThisYear = palletsDispatchedThisYear / Math.max(1, getWeekNumber(now));

    // Alert count: use ALL jobs (not date-filtered) so overdue orders aren't missed
    let alertCount = 0;
    const alertRefMap = new Map<string, typeof jobs>();
    jobs.filter((j) => j.jobType === "order" || j.jobType === undefined).forEach((j) => {
      const group = alertRefMap.get(j.ref) || [];
      group.push(j);
      alertRefMap.set(j.ref, group);
    });
    alertRefMap.forEach((group) => {
      const hasException = group.some((j) => j.status === "exception");
      const openLines = group.filter((j) => j.status !== "delivered" && j.status !== "returned" && j.status !== "cancelled");
      const latestEtd = openLines
        .map((j) => calculateRevisedETD(j) || j.etd)
        .filter((value): value is string => !!value && !Number.isNaN(new Date(value).getTime()))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
      const latestEta = openLines
        .map((j) => j.eta)
        .filter((value): value is string => !!value && !Number.isNaN(new Date(value).getTime()))
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
      const overdueDate = new Date(latestEtd || latestEta || "");
      if (hasException) alertCount++;
      if (!hasException && openLines.length > 0 && !Number.isNaN(overdueDate.getTime())) {
        overdueDate.setHours(0, 0, 0, 0);
        if (overdueDate < now) alertCount++;
      }
      if (!hasException && latestEtd && openLines.some((j) => j.status !== "en-route")) {
        const etd = new Date(latestEtd); etd.setHours(0, 0, 0, 0);
        if (Math.floor((etd.getTime() - now.getTime()) / 86400000) <= 1) alertCount++;
      }
      if (group.some((j) => (j.priority === "urgent" || j.priority === "high") && j.status === "pending")) alertCount++;
    });

    // High volume date achievements: current month only
    // Dates with 5+ orders where 95%+ are delivered or picked
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const dateCounts: Record<string, { total: number; completed: number }> = {};
    jobs.filter((j) => j.jobType === "order" || j.jobType === undefined).forEach((j) => {
      if (!j.eta) return;
      const dateKey = j.eta.split("T")[0];
      const etaDate = new Date(dateKey);
      // Only current month
      if (etaDate < startOfMonth || etaDate > endOfMonth) return;
      if (!dateCounts[dateKey]) dateCounts[dateKey] = { total: 0, completed: 0 };
      dateCounts[dateKey].total++;
      if (j.status === "delivered" || j.status === "returned" || j.orderPicked) dateCounts[dateKey].completed++;
    });
    const highVolumeWins = Object.entries(dateCounts)
      .filter(([, c]) => c.total >= 5 && c.completed / c.total >= 0.95)
      .map(([date, c]) => ({ date, total: c.total, completed: c.completed, pct: Math.round((c.completed / c.total) * 100) }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3);

    return {
      total,
      pending,
      assigned,
      inTransit,
      delivered,
      returned,
      exceptions,
      cancelled,
      availableDrivers,
      busyDrivers,
      departuresThisWeek: departuresThisWeek.size,
      ordersDispatchedThisWeek,
      palletsDispatchedThisWeek,
      avgPalletsDispatchedPerWeekThisYear,
      qtyDispatchedThisWeek,
      qtyOrdersDispatchedThisWeek: ordersDispatchedThisWeek,
      deliveredMissingDispatchCount: deliveredMissingDispatchThisWeek.size,
      alertCount,
      highVolumeWins,
    };
  }, [orderJobs, jobs, drivers]);

  // Weekly trend data
  const weeklyData = useMemo(() => {
    const weeks: Record<string, { week: string; created: number; delivered: number; pending: number }> = {};
    const now = new Date();
    // Last 8 weeks only
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const weekNum = getWeekNumber(d);
      const key = `W${weekNum}`;
      weeks[key] = { week: key, created: 0, delivered: 0, pending: 0 };
    }
    // Count unique orders per week by status
    const seenCreated = new Set<string>();
    const seenDelivered = new Set<string>();
    const seenPending = new Set<string>();
    orderJobs.forEach((job) => {
      const weekNum = getWeekNumber(new Date(job.createdAt));
      const key = `W${weekNum}`;
      if (!(key in weeks)) return;
      const refKey = `${job.ref}-${key}`;
      if (!seenCreated.has(refKey)) { seenCreated.add(refKey); weeks[key].created++; }
      if (job.status === "delivered" && !seenDelivered.has(refKey)) { seenDelivered.add(refKey); weeks[key].delivered++; }
      if ((job.status === "pending" || job.status === "assigned") && !seenPending.has(refKey)) { seenPending.add(refKey); weeks[key].pending++; }
    });
    return Object.values(weeks);
  }, [orderJobs]);

  // Status distribution
  const statusDistribution = useMemo(() => {
    return [
      { name: "Pending", value: stats.pending, color: "#F59E0B" },
      { name: "In Transit", value: stats.inTransit, color: "#3B82F6" },
      { name: "Delivered", value: stats.delivered, color: "#10B981" },
      { name: "Returned", value: stats.returned, color: "#F59E0B" },
      { name: "Exceptions", value: stats.exceptions, color: "#EF4444" },
    ].filter((item) => item.value > 0);
  }, [stats]);

  // By warehouse
  const warehouseData = useMemo(() => {
    const wh: { [key: string]: Set<string> } = {};
    orderJobs.forEach((job) => {
      if (!job.warehouse) return; // Skip orders with no warehouse
      if (!wh[job.warehouse]) wh[job.warehouse] = new Set();
      wh[job.warehouse].add(job.ref);
    });
    return Object.entries(wh)
      .map(([name, refs]) => ({ name, count: refs.size }))
      .sort((a, b) => b.count - a.count);
  }, [orderJobs]);

  // Top customers - count unique order references (ASO numbers), not line items
  const topCustomers = useMemo(() => {
    const customerOrders: { [customer: string]: Set<string> } = {};
    orderJobs.forEach((job) => {
      if (job.customer && job.ref) {
        if (!customerOrders[job.customer]) {
          customerOrders[job.customer] = new Set();
        }
        customerOrders[job.customer].add(job.ref);
      }
    });
    return Object.entries(customerOrders)
      .map(([name, refs]) => ({ name, count: refs.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [orderJobs]);

  const africaExportStats = useMemo(() => {
    const activeAfricaExports = africaExports.filter((shipment) => !shipment.archived && shipment.status !== "cancelled");
    const open = activeAfricaExports.filter((shipment) => shipment.status !== "delivered").length;
    const assigned = activeAfricaExports.filter((shipment) => shipment.status === "assigned" || shipment.status === "in-transit").length;
    const delivered = activeAfricaExports.filter((shipment) => shipment.status === "delivered").length;
    const pallets = activeAfricaExports.reduce((sum, shipment) => sum + (Number(shipment.pallets) || 0), 0);
    const atRisk = activeAfricaExports.filter((shipment) => {
      if (shipment.status === "delivered" || shipment.status === "cancelled") return false;
      const missingDocs = DASHBOARD_AFRICA_REQUIRED_DOCUMENT_IDS.some((id) => !shipment.documents?.[id]);
      return missingDocs || !shipment.lastCheckedAt;
    }).length;
    const approved = activeAfricaExports.filter((shipment) => Boolean(shipment.dispatchApprovedAt)).length;
    const pendingApproval = activeAfricaExports.filter((shipment) => shipment.status !== "delivered" && shipment.status !== "cancelled" && !shipment.dispatchApprovedAt).length;
    return {
      total: activeAfricaExports.length,
      open,
      assigned,
      delivered,
      pallets,
      atRisk,
      approved,
      pendingApproval,
    };
  }, [africaExports]);

  const africaDestinationData = useMemo(() => {
    const byCountry: Record<string, { name: string; shipments: number; pallets: number }> = {};
    africaExports.filter((shipment) => !shipment.archived && shipment.status !== "cancelled").forEach((shipment) => {
      const name = shipment.destinationCountry || "To confirm";
      if (!byCountry[name]) byCountry[name] = { name, shipments: 0, pallets: 0 };
      byCountry[name].shipments += 1;
      byCountry[name].pallets += Number(shipment.pallets) || 0;
    });
    return Object.values(byCountry)
      .sort((a, b) => b.shipments - a.shipments)
      .slice(0, 6);
  }, [africaExports]);

  const selectedSearchJob = useMemo(
    () => selectedSearchJobId ? jobs.find((job) => job.id === selectedSearchJobId) || null : null,
    [jobs, selectedSearchJobId],
  );
  const selectedSearchJobDriver = useMemo(
    () => selectedSearchJob?.driverId ? drivers.find((driver) => driver.id === selectedSearchJob.driverId)?.name : undefined,
    [drivers, selectedSearchJob],
  );

  const statCards = [
    {
      icon: Package, value: stats.total, label: "TOTAL JOBS",
      change: stats.total > 0 ? `${stats.total} active` : "No jobs", changeType: "neutral" as const, sublabel: stats.total > 120 ? "Heavy Load" : stats.total > 0 ? "Active Load" : "Clear Deck",
      borderColor: "border-l-blue-500", iconBg: "bg-blue-50", iconColor: "text-blue-500", nav: "clipboard", tab: "open",
    },
    {
      icon: Truck, value: stats.inTransit, label: "IN TRANSIT",
      change: `${stats.busyDrivers} drivers busy`, changeType: "neutral" as const, sublabel: stats.inTransit > 0 ? "On the Road" : "Quiet Roads",
      borderColor: "border-l-red-500", iconBg: "bg-red-50", iconColor: "text-red-500", nav: "clipboard", tab: "in-transit",
    },
    {
      icon: Archive, value: stats.delivered, label: "DELIVERED",
      change: stats.returned > 0 ? `${stats.returned} returned` : `${stats.delivered} completed`, changeType: "up" as const, sublabel: "Completed",
      borderColor: "border-l-green-500", iconBg: "bg-green-50", iconColor: "text-green-500", nav: "clock", tab: undefined,
    },
    {
      icon: ClipboardList, value: stats.pending, label: "PENDING",
      change: `${stats.assigned} assigned`, changeType: "neutral" as const, sublabel: stats.pending > 40 ? "Backlog Building" : stats.pending > 0 ? "Under Control" : "Clear Deck",
      borderColor: "border-l-amber-500", iconBg: "bg-amber-50", iconColor: "text-amber-500", nav: "clipboard", tab: "open",
    },
    {
      icon: Clock, value: stats.departuresThisWeek, label: "PLANNED DEPARTURES",
      change: "ETD this week",
      changeType: stats.departuresThisWeek > 0 ? "up" as const : "neutral" as const,
      sublabel: stats.departuresThisWeek > 5 ? "Busy Week" : stats.departuresThisWeek > 0 ? "On Schedule" : "Quiet Week",
      borderColor: "border-l-purple-500", iconBg: "bg-purple-50", iconColor: "text-purple-500", nav: "calendar", tab: undefined,
    },
    {
      icon: Package, value: stats.palletsDispatchedThisWeek, label: "PALLETS DISPATCHED",
      change: `Avg ${stats.avgPalletsDispatchedPerWeekThisYear.toFixed(1)}/wk this year`,
      changeType: stats.palletsDispatchedThisWeek > 0 ? "up" as const : "neutral" as const, sublabel: stats.palletsDispatchedThisWeek > 20 ? "Pallets Flew" : stats.palletsDispatchedThisWeek > 0 ? "Solid Shift" : "Quiet Floor",
      borderColor: "border-l-indigo-500", iconBg: "bg-indigo-50", iconColor: "text-indigo-500", nav: "clipboard", tab: "dispatched-week",
    },
    {
      icon: Archive, value: formatNumber(stats.qtyDispatchedThisWeek), label: "QTY DISPATCHED",
      change: `${stats.qtyOrdersDispatchedThisWeek} orders dispatched`,
      changeType: stats.qtyDispatchedThisWeek > 0 ? "up" as const : "neutral" as const, sublabel: stats.qtyDispatchedThisWeek > 1000 ? "Big Push" : stats.qtyDispatchedThisWeek > 0 ? "Qty Cleared" : "Nothing Moved",
      borderColor: "border-l-cyan-500", iconBg: "bg-cyan-50", iconColor: "text-cyan-500", nav: "clipboard", tab: "dispatched-week",
    },
    {
      icon: Globe2, value: africaExportStats.total, label: "AFRICA EXPORTS",
      change: `${africaExportStats.assigned} assigned`,
      changeType: africaExportStats.total > 0 ? "up" as const : "neutral" as const,
      sublabel: africaExportStats.open > 0 ? `${africaExportStats.open} Open` : "No Open Exports",
      borderColor: "border-l-emerald-500", iconBg: "bg-emerald-50", iconColor: "text-emerald-500", nav: "africa-exports", tab: undefined,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">PTA Dispatch</h1>
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-blue-100 text-blue-700 text-xs font-bold">
            Week {getWeekNumber(new Date())}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {/* Global Search */}
          <GlobalSearch
            onSelectJob={(jobId) => setSelectedSearchJobId(jobId)}
            onSelectAfricaExport={(ref) => onNavigate?.("africa-exports", undefined, ref)}
          />

          {/* User */}
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>
              Logged in as: <strong className="text-gray-900">{user?.username}</strong>
            </span>
          </div>

          {/* Alerts */}
          {onOpenAlerts && (
            <button
              onClick={onOpenAlerts}
              className="relative flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium"
            >
              <Bell className="w-4 h-4" />
              Alerts
              {stats.alertCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {stats.alertCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-resilinc-primary rounded-full transition-all duration-1000"
          style={{
            width: `${stats.total > 0 ? (stats.delivered / stats.total) * 100 : 0}%`,
          }}
        />
      </div>

      {/* Live Status Strip — simplified */}
      <div className="bg-gray-900 rounded-xl px-5 py-2.5 flex items-center gap-3 text-xs">
        <span className="text-gray-300">
          {stats.pending > 0 ? `${stats.pending} pending` : "All processed"} • {stats.inTransit} in transit • {stats.availableDrivers} drivers available
        </span>
        {stats.highVolumeWins.length > 0 && (
          <>
            <span className="w-px h-4 bg-gray-700" />
            <span className="text-emerald-400">
              {stats.highVolumeWins.map((w) => `${w.date}: ${w.pct}%`).join(" • ")}
            </span>
          </>
        )}
        {stats.deliveredMissingDispatchCount > 0 && (
          <>
            <span className="w-px h-4 bg-gray-700" />
            <span className="text-amber-300">
              {stats.deliveredMissingDispatchCount} delivered orders missing dispatch timestamp
            </span>
          </>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {statCards.map((card, idx) => (
          <div
            key={idx}
            className={`bg-white rounded-lg border border-gray-200 border-l-[3px] ${card.borderColor} px-4 py-3 hover:shadow-md transition-all cursor-pointer active:scale-[0.97] relative`}
            onClick={() => onNavigate?.(card.nav, card.tab)}
          >
            <div className={`absolute top-3 right-3 w-7 h-7 rounded-lg ${card.iconBg} flex items-center justify-center`}>
              <card.icon className={`w-3.5 h-3.5 ${card.iconColor}`} />
            </div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{card.value}</div>
            <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mt-0.5">
              {card.label}
            </div>
            <div className="flex items-center gap-1 mt-1.5">
              {card.changeType === "up" && <TrendingUp className="w-3 h-3 text-green-500" />}
              {card.changeType === "neutral" && <Minus className="w-3 h-3 text-gray-400" />}
              <span className={`text-[10px] ${
                card.changeType === "up" ? "text-green-600" : "text-gray-500"
              }`}>
                {card.change}
              </span>
            </div>
            {card.sublabel && (
              <span className={`inline-block mt-1 text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                card.sublabel === "Needs Attention" ? "text-orange-700 bg-orange-50" :
                card.sublabel === "Completed" ? "text-green-700 bg-green-50" :
                card.sublabel === "Active" ? "text-blue-700 bg-blue-50" :
                card.sublabel === "Busy Week" ? "text-purple-700 bg-purple-50" :
                "text-gray-600 bg-gray-50"
              }`}>
                {card.sublabel}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Africa Export Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Africa Exports</h3>
              <p className="text-sm text-gray-500">Independent export queue</p>
            </div>
            <Globe2 className="h-7 w-7 text-emerald-600" />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => onNavigate?.("africa-exports", "pending-approval")} className="rounded-lg bg-amber-50 p-3 text-left transition hover:shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Pending Approval</p>
              <p className="mt-1 text-2xl font-bold text-amber-900">{africaExportStats.pendingApproval}</p>
            </button>
            <button type="button" onClick={() => onNavigate?.("africa-exports", "approved")} className="rounded-lg bg-emerald-50 p-3 text-left transition hover:shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Approved</p>
              <p className="mt-1 text-2xl font-bold text-emerald-900">{africaExportStats.approved}</p>
            </button>
            <button type="button" onClick={() => onNavigate?.("africa-exports", "risks")} className="rounded-lg bg-red-50 p-3 text-left transition hover:shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">At Risk</p>
              <p className="mt-1 text-2xl font-bold text-red-900">{africaExportStats.atRisk}</p>
            </button>
            <button type="button" onClick={() => onNavigate?.("africa-exports", "all")} className="rounded-lg bg-blue-50 p-3 text-left transition hover:shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Assigned / Transit</p>
              <p className="mt-1 text-2xl font-bold text-blue-900">{africaExportStats.assigned}</p>
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-gray-900">Africa Export Destinations</h3>
            <span className="text-sm text-gray-500">By shipment count</span>
          </div>
          <div className="h-64 mt-2">
            {africaDestinationData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={africaDestinationData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#9CA3AF" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9CA3AF" allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #E5E7EB" }} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="shipments" fill="#10B981" name="Shipments" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="pallets" fill="#F59E0B" name="Pallets" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-gray-400">
                No Africa export data yet
              </div>
            )}
          </div>
        </div>
      </div>

      {/* High Volume Dates — current month + 2 months, orders + IBT */}
      {(() => {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfRange = new Date(now.getFullYear(), now.getMonth() + 3, 0);
        const dateCounts: Record<string, { orders: number; ibts: number }> = {};
        jobs.forEach((j) => {
          if (!j.eta) return;
          const dateKey = j.eta.split("T")[0];
          const d = new Date(dateKey);
          if (d < startOfMonth || d > endOfRange) return;
          if (!dateCounts[dateKey]) dateCounts[dateKey] = { orders: 0, ibts: 0 };
          if (j.jobType === "ibt") dateCounts[dateKey].ibts++;
          else dateCounts[dateKey].orders++;
        });
        const alerts = Object.entries(dateCounts)
          .filter(([, c]) => c.orders + c.ibts >= 5)
          .map(([date, c]) => ({ date, total: c.orders + c.ibts, orders: c.orders, ibts: c.ibts }))
          .sort((a, b) => a.date.localeCompare(b.date));

        if (alerts.length === 0) return null;
        return (
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <div className="flex items-center gap-1.5 text-amber-700">
              <AlertTriangle className="w-4 h-4" />
              <span className="font-semibold text-xs">High Volume:</span>
            </div>
            {alerts.map((a) => (
              <span key={a.date} className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 rounded-lg text-xs border border-amber-200">
                <span className="font-semibold text-amber-900">{a.date}</span>
                <span className="text-amber-600">{a.total} ({a.orders} orders, {a.ibts} IBT)</span>
              </span>
            ))}
          </div>
        );
      })()}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Weekly Trend — bar chart with created/delivered/pending */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-gray-900">Weekly Trend</h3>
            <span className="text-sm text-gray-500">Last 8 weeks</span>
          </div>
          <div className="h-64 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="#9CA3AF" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9CA3AF" allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: "8px", border: "1px solid #E5E7EB" }} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar dataKey="created" fill="#3B82F6" name="Created" radius={[3, 3, 0, 0]} />
                <Bar dataKey="delivered" fill="#10B981" name="Delivered" radius={[3, 3, 0, 0]} />
                <Bar dataKey="pending" fill="#F59E0B" name="Pending" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Overview — horizontal bars */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Status Overview</h3>
          </div>
          {statusDistribution.length > 0 ? (
            <div className="space-y-3">
              {statusDistribution.map((item, idx) => {
                const pct = stats.total > 0 ? Math.round((item.value / stats.total) * 100) : 0;
                return (
                  <div key={idx}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-sm text-gray-700">{item.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-gray-900">{item.value}</span>
                        <span className="text-xs text-gray-400">{pct}%</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: item.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-gray-400 text-sm">No data</div>
          )}
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Warehouse */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-lg font-semibold text-gray-900">By Warehouse</h3>
            <span className="text-sm text-gray-500">{warehouseData.length} locations</span>
          </div>
          {warehouseData.length > 0 ? (
            <div className="space-y-3">
              {warehouseData.map((wh, idx) => {
                const maxCount = warehouseData[0]?.count || 1;
                const pct = (wh.count / maxCount) * 100;
                return (
                  <div key={idx}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700 uppercase">
                        {wh.name}
                      </span>
                      <span className="text-sm text-gray-500">{wh.count}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-6 overflow-hidden">
                      <div
                        className="h-full bg-resilinc-primary rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-gray-400 text-sm">
              No warehouse data
            </div>
          )}
        </div>

        {/* Top Customers */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Top Customers</h3>
            <span className="text-sm text-gray-500">By order volume</span>
          </div>
          {topCustomers.length > 0 ? (
            <div className="space-y-3">
              {topCustomers.map((customer, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold ${
                        idx === 0
                          ? "bg-red-500"
                          : idx === 1
                          ? "bg-orange-500"
                          : idx === 2
                          ? "bg-yellow-500"
                          : "bg-gray-400"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span className="text-sm font-medium text-gray-700">{customer.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">{customer.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center text-gray-400 text-sm">
              No customer data
            </div>
          )}
        </div>
      </div>

      {selectedSearchJob && (
        <JobDetailsModal
          job={selectedSearchJob}
          onClose={() => setSelectedSearchJobId(null)}
          driverName={selectedSearchJobDriver}
        />
      )}
    </div>
  );
};
