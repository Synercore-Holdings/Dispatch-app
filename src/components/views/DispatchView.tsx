// src/components/views/DispatchView.tsx
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Truck, Briefcase, Plus, X, Save, ChevronLeft, ChevronRight, AlertTriangle, Bell, PackageCheck, FileCheck2 } from "lucide-react";

import { useDispatch } from "../../context/DispatchContext";
import { useNotification } from "../../context/NotificationContext";
import { useAuth } from "../../context/AuthContext";
import { filterJobs, sortJobs } from "../../utils/helpers";

import { FilterBar } from "../FilterBar";
import { SortBar } from "../SortBar";
import { JobCard } from "../JobCard";
import { DriverCard } from "../DriverCard";
import { JobDetailsModal } from "../JobDetailsModal";
import { TransporterDetailsModal } from "../TransporterDetailsModal";
import { AddDriverModal } from "../AddDriverModal";
import { WarehouseSelector } from "../WarehouseSelector";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { Button } from "../ui/Button";
import { africaExportsAPI } from "../../services/api";

import type { Job, Driver, JobPriority, JobStatus } from "../../types";
import type { AfricaExportShipment } from "../../services/api";

type DispatchTab = "open" | "assigned" | "in-transit" | "delivered" | "dispatched-week";

interface DispatchViewProps {
  onOpenAlerts?: () => void;
  initialTab?: DispatchTab;
  initialRef?: string;
}

const MANUAL_ORDER_PREFILL_KEY = "dispatch_manual_order_prefill";

export const DispatchView: React.FC<DispatchViewProps> = ({ onOpenAlerts, initialTab, initialRef }) => {
  const { jobs, drivers, updateJobs, updateDriver, addDriver, refreshData, filters, sortOptions } = useDispatch();
  const { showSuccess, showError, showWarning, confirm } = useNotification();
  const { isViewer } = useAuth();

  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [selectedTransporter, setSelectedTransporter] = useState<Driver | null>(null);
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showAddJob, setShowAddJob] = useState(false);
  const [selectedAlertDate, setSelectedAlertDate] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DispatchTab>(initialTab || "open");
  const [showPickedOnly, setShowPickedOnly] = useState(false);
  const [showOutstandingCoaOnly, setShowOutstandingCoaOnly] = useState(false);
  const [serviceFilter, setServiceFilter] = useState<"delivery" | "collection" | null>(null);
  const [newJob, setNewJob] = useState({
    ref: "",
    customer: "",
    pickup: "K58 Warehouse",
    dropoff: "TBD",
    warehouse: "",
    serviceType: "delivery" as "collection" | "delivery",
    priority: "normal" as JobPriority,
    pallets: undefined as number | undefined,
    outstandingQty: undefined as number | undefined,
    eta: "",
    notes: "",
  });

  useEffect(() => {
    if (!initialTab) return;
    setActiveTab(initialTab);
    setShowPickedOnly(false);
    setShowOutstandingCoaOnly(false);
    setServiceFilter(null);
    setCurrentPage(1);
  }, [initialTab]);

  useEffect(() => {
    const raw = localStorage.getItem(MANUAL_ORDER_PREFILL_KEY);
    if (!raw) return;
    try {
      const prefill = JSON.parse(raw) as Partial<typeof newJob>;
      setNewJob((current) => ({
        ...current,
        ref: prefill.ref || current.ref,
        customer: prefill.customer || current.customer,
        eta: prefill.eta || current.eta,
        notes: prefill.notes || current.notes,
      }));
      setShowAddJob(true);
      setActiveTab("open");
    } catch (error) {
      console.warn("Failed to read manual order prefill", error);
    } finally {
      localStorage.removeItem(MANUAL_ORDER_PREFILL_KEY);
    }
  }, []);

  useEffect(() => {
    if (!initialRef) return;
    const matchingJobs = jobs.filter((job) => job.ref === initialRef && (job.jobType === "order" || job.jobType === undefined));
    if (matchingJobs.length === 0) return;
    const primary = matchingJobs.find((job) => job.status === "delivered") || matchingJobs[0];
    setSelectedJob(primary);
    if (primary.status === "delivered") setActiveTab("delivered");
    else if (primary.status === "en-route") setActiveTab("in-transit");
    else if (primary.status === "assigned") setActiveTab("assigned");
    else setActiveTab("open");
    setShowPickedOnly(false);
    setShowOutstandingCoaOnly(false);
    setServiceFilter(null);
    setCurrentPage(1);
  }, [initialRef, jobs]);

  const isThisWeek = (dateString: string | undefined) => {
    if (!dateString) return false;
    const now = new Date();
    const startOfWeek = new Date(now);
    const dayOfWeek = startOfWeek.getDay() || 7;
    startOfWeek.setDate(now.getDate() - dayOfWeek + 1);
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const date = new Date(dateString);
    return !Number.isNaN(date.getTime()) && date >= startOfWeek && date < endOfWeek;
  };

  const getDispatchDate = (job: Job) => {
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

  // Filter to show only customer order jobs, deduplicated by ASO ref,
  // and only orders due within the selected ETA range when a range is selected.
  // When a search query is active, the ETA range is bypassed so users can find any order.
  const orderJobs = useMemo(() => {
    const allOrders = jobs.filter((job) => job.jobType === "order" || job.jobType === undefined);
    const statusRank: Record<JobStatus, number> = {
      "en-route": 6,
      assigned: 5,
      exception: 4,
      pending: 3,
      delivered: 2,
      returned: 1,
      cancelled: 0,
    };

    // Deduplicate by ref (ASO number) - keep the first occurrence per ref
    // and aggregate data from duplicate line items
    const refMap = new Map<string, Job>();
    allOrders.forEach((job) => {
      const existing = refMap.get(job.ref);
      if (!existing) {
        refMap.set(job.ref, { ...job });
      } else {
        const nextPrimary = statusRank[job.status] > statusRank[existing.status] ? job : existing;
        if (nextPrimary !== existing) {
          refMap.set(job.ref, {
            ...job,
            pallets: existing.pallets,
            outstandingQty: existing.outstandingQty,
            eta: existing.eta,
          });
        }
        const merged = refMap.get(job.ref)!;
        // Merge: keep earliest ETA and order-level pallets, sum line-item qty.
        if (job.eta && (!merged.eta || job.eta < merged.eta)) {
          merged.eta = job.eta;
        }
        if (job.pallets) {
          merged.pallets = Math.max(merged.pallets || 0, job.pallets);
        }
        if (job.outstandingQty) {
          merged.outstandingQty = (merged.outstandingQty || 0) + job.outstandingQty;
        }
      }
    });

    // Bypass the ETA window entirely when searching — users expect to find any
    // matching order regardless of date.
    if (filters.searchQuery && filters.searchQuery.trim()) {
      return Array.from(refMap.values());
    }

    // "all" skips the window too
    const range = filters.etaRange || "5weeks";
    if (range === "all") {
      return Array.from(refMap.values());
    }

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfRange = new Date(startOfWeek);
    if (range === "3months") {
      endOfRange.setMonth(endOfRange.getMonth() + 3);
    } else if (range === "6months") {
      endOfRange.setMonth(endOfRange.getMonth() + 6);
    } else {
      endOfRange.setDate(endOfRange.getDate() + 5 * 7); // 5 weeks (current + 4)
    }
    endOfRange.setHours(23, 59, 59, 999);

    return Array.from(refMap.values()).filter((job) => {
      // Always show jobs without ETA (so they don't disappear)
      if (!job.eta) return true;
      const etaDate = new Date(job.eta);
      return etaDate >= startOfWeek && etaDate <= endOfRange;
    });
  }, [jobs, filters.searchQuery, filters.etaRange]);

  const filteredAndSortedJobs = useMemo(() => {
    const filtered = filterJobs(orderJobs, filters);
    const sorted = sortJobs(filtered, sortOptions);

    // Apply tab filter
    return sorted.filter((job) => {
      const isPendingOrAssigned = job.status === "pending" || job.status === "assigned" || job.status === "exception";

      // When "Orders Picked" card is active, show only picked orders that are pending/assigned
      if (showPickedOnly) {
        return !!job.orderPicked && isPendingOrAssigned;
      }

      // When "Outstanding COA" card is active, show picked orders missing COA
      if (showOutstandingCoaOnly) {
        return !!job.orderPicked && !job.coaAvailable && isPendingOrAssigned;
      }

      // When service type filter is active
      if (serviceFilter === "delivery") {
        return job.serviceType === "delivery" || !job.serviceType;
      }
      if (serviceFilter === "collection") {
        return job.serviceType === "collection";
      }

      switch (activeTab) {
        case "open":
          return job.status === "pending" || job.status === "exception";
        case "assigned":
          return job.status === "assigned";
        case "in-transit":
          return job.status === "en-route";
        case "delivered":
          return job.status === "delivered" || job.status === "returned" || job.status === "cancelled";
        case "dispatched-week":
          return (job.status === "en-route" || job.status === "delivered") && isThisWeek(getDispatchDate(job));
        default:
          return true;
      }
    });
  }, [orderJobs, filters, sortOptions, activeTab, showPickedOnly, showOutstandingCoaOnly, serviceFilter]);

  // Tab counts (unfiltered by search/filters, so tabs always show totals)
  const tabCounts = useMemo(() => ({
    open: orderJobs.filter((j) => j.status === "pending" || j.status === "exception").length,
    assigned: orderJobs.filter((j) => j.status === "assigned").length,
    inTransit: orderJobs.filter((j) => j.status === "en-route").length,
    delivered: orderJobs.filter((j) => j.status === "delivered" || j.status === "returned" || j.status === "cancelled").length,
    dispatchedWeek: orderJobs.filter((j) => (j.status === "en-route" || j.status === "delivered") && isThisWeek(getDispatchDate(j))).length,
  }), [orderJobs]);

  const stats = useMemo(() => {
    return {
      total: orderJobs.length,
      pending: orderJobs.filter((j) => j.status === "pending").length,
      inRoute: orderJobs.filter((j) => j.status === "en-route").length,
      delivered: orderJobs.filter((j) => j.status === "delivered").length,
      exceptions: orderJobs.filter((j) => j.status === "exception").length,
      alertCount: (() => {
        const now = new Date(); now.setHours(0, 0, 0, 0);
        const refSeen = new Set<string>();
        let count = 0;
        // Use ALL jobs (not date-filtered orderJobs) so overdue orders aren't missed.
        // One ref counts at most once even if it trips multiple alert conditions.
        jobs.filter((j) => j.jobType === "order" || j.jobType === undefined).forEach((j) => {
          if (refSeen.has(j.ref)) return;
          refSeen.add(j.ref);
          const notDone = j.status !== "delivered" && j.status !== "returned" && j.status !== "cancelled";
          let isAlert = j.status === "exception";
          if (!isAlert && j.eta && notDone) {
            const eta = new Date(j.eta); eta.setHours(0, 0, 0, 0);
            if (eta < now) isAlert = true;
          }
          if (!isAlert && j.etd && notDone && j.status !== "en-route") {
            const etd = new Date(j.etd); etd.setHours(0, 0, 0, 0);
            if (Math.floor((etd.getTime() - now.getTime()) / 86400000) <= 1) isAlert = true;
          }
          if (!isAlert && (j.priority === "urgent" || j.priority === "high") && j.status === "pending") {
            isAlert = true;
          }
          if (isAlert) count++;
        });
        return count;
      })(),
      picked: orderJobs.filter((j) => j.orderPicked && (j.status === "pending" || j.status === "assigned" || j.status === "exception")).length,
      outstandingCoa: orderJobs.filter((j) => j.orderPicked && !j.coaAvailable && (j.status === "pending" || j.status === "assigned" || j.status === "exception")).length,
      delivery: orderJobs.filter((j) => j.serviceType === "delivery" || !j.serviceType).length,
      collection: orderJobs.filter((j) => j.serviceType === "collection").length,
    };
  }, [orderJobs, jobs]);

  const dispatchedWeekSummary = useMemo(() => {
    return jobs.reduce(
      (summary, job) => {
        if (job.jobType !== "order" && job.jobType !== undefined) return summary;
        if ((job.status === "en-route" || job.status === "delivered") && isThisWeek(getDispatchDate(job))) {
          summary.pallets += job.pallets || 0;
          summary.qty += job.outstandingQty || 0;
        }
        return summary;
      },
      { pallets: 0, qty: 0 },
    );
  }, [jobs]);

  // Compute assigned pallets per driver by order ref. Pallets are order-level,
  // so five line items on one pallet must not count as five pallets.
  const palletsByDriver = useMemo(() => {
    const loadsByDriverRef: Record<string, Record<string, number>> = {};
    jobs.forEach((job) => {
      if (job.driverId && job.status !== "delivered" && job.status !== "returned" && job.status !== "cancelled") {
        const ref = job.ref || job.id;
        if (!loadsByDriverRef[job.driverId]) loadsByDriverRef[job.driverId] = {};
        loadsByDriverRef[job.driverId][ref] = Math.max(loadsByDriverRef[job.driverId][ref] || 0, job.pallets || 0);
      }
    });
    return Object.fromEntries(
      Object.entries(loadsByDriverRef).map(([driverId, byRef]) => [
        driverId,
        Object.values(byRef).reduce((sum, pallets) => sum + pallets, 0),
      ])
    );
  }, [jobs]);

  // Pagination
  const ITEMS_PER_PAGE = 20;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(filteredAndSortedJobs.length / ITEMS_PER_PAGE);
  const paginatedJobs = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAndSortedJobs.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAndSortedJobs, currentPage]);

  // Reset to page 1 when filters change
  const prevFilterKey = useMemo(() => JSON.stringify(filters), [filters]);
  useEffect(() => { setCurrentPage(1); }, [prevFilterKey]);

  // Alert: dates with 5+ distinct pending (non-delivered, non-IBT) orders due — current month + next 2 months only.
  // Counts distinct order refs, not order lines — multiple lines on the same ref count once.
  const busyDateAlerts = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfRange = new Date(now.getFullYear(), now.getMonth() + 3, 0); // end of month+2

    const dateRefs: { [date: string]: Set<string> } = {};
    jobs.forEach((job) => {
      if (!job.eta) return;
      if (job.jobType === "ibt") return;
      if (job.status === "delivered" || job.status === "returned" || job.status === "cancelled") return;
      const dateKey = job.eta.split("T")[0];
      // Parse as local midnight, not UTC — `new Date("YYYY-MM-DD")` is UTC and
      // can shift the day west of UTC (e.g. May 1 entries get excluded on May 1 in PST).
      const etaDate = new Date(`${dateKey}T00:00:00`);
      if (etaDate < startOfMonth || etaDate > endOfRange) return;
      if (!dateRefs[dateKey]) dateRefs[dateKey] = new Set();
      dateRefs[dateKey].add(job.ref || job.id);
    });
    return Object.entries(dateRefs)
      .filter(([, refs]) => refs.size >= 5)
      .map(([date, refs]) => ({ date, total: refs.size }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [jobs]);

  // Pending orders due on selected alert date, grouped by order ref (one row per order, lines aggregated).
  const alertDateOrders = useMemo(() => {
    if (!selectedAlertDate) return [];
    const matching = jobs.filter((job) => {
      if (!job.eta) return false;
      if (job.jobType === "ibt") return false;
      if (job.status === "delivered" || job.status === "returned" || job.status === "cancelled") return false;
      return job.eta.split("T")[0] === selectedAlertDate;
    });
    const groups = new Map<string, { ref: string; primary: Job; lineCount: number; totalPallets: number; hasPalletData: boolean }>();
    matching.forEach((job) => {
      const key = job.ref || job.id;
      const existing = groups.get(key);
      if (existing) {
        existing.lineCount += 1;
        existing.totalPallets = Math.max(existing.totalPallets, job.pallets ?? 0);
        if (job.pallets != null) existing.hasPalletData = true;
      } else {
        groups.set(key, {
          ref: key,
          primary: job,
          lineCount: 1,
          totalPallets: job.pallets ?? 0,
          hasPalletData: job.pallets != null,
        });
      }
    });
    return Array.from(groups.values()).sort((a, b) => a.ref.localeCompare(b.ref));
  }, [jobs, selectedAlertDate]);

  const alertDateLineCount = useMemo(
    () => alertDateOrders.reduce((sum, o) => sum + o.lineCount, 0),
    [alertDateOrders],
  );

  // Get unique warehouses from all jobs
  const warehouses = useMemo(() => {
    const warehouseSet = new Set<string>();
    jobs.forEach((job) => {
      if (job.warehouse) {
        warehouseSet.add(job.warehouse);
      }
    });
    return Array.from(warehouseSet).sort();
  }, [jobs]);

  const handleDragStart = (event: DragStartEvent) => {
    const job = orderJobs.find((j) => j.id === event.active.id);
    setActiveJob(job || null);
  };

  const assignJobToDriver = async (job: Job, driver: Driver) => {
    const jobPallets = job.pallets || 0;
    const currentLoad = palletsByDriver[driver.id] || 0;
    const newLoad = currentLoad + jobPallets;
    const capacity = driver.capacity || 0;

    if (capacity > 0 && newLoad > capacity) {
      const proceed = await confirm({
        title: "Capacity Warning",
        message: `${driver.name}: ${currentLoad} + ${jobPallets} = ${newLoad} pallets (capacity: ${capacity}). Exceeds by ${newLoad - capacity} pallets. Assign anyway?`,
        type: "warning",
        confirmText: "Assign Anyway",
      });
      if (!proceed) return;
    }

    // Assign ALL line items sharing this ASO ref to the transporter — single request.
    const allLineItemIds = jobs.filter((j) => j.ref === job.ref).map((j) => j.id);
    await updateJobs(allLineItemIds, { driverId: driver.id, status: "assigned" });
    showSuccess(`${job.ref} assigned to ${driver.name}`);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const driver = drivers.find((d) => d.id === over.id);
      const job = orderJobs.find((j) => j.id === active.id);
      if (driver && job) {
        assignJobToDriver(job, driver);
      }
    }

    setActiveJob(null);
  };

  const handleJobSelect = (job: Job) => setSelectedJob(job);

  const handleTransporterEdit = (transporter: Driver) => {
    setSelectedTransporter(transporter);
  };

  const handleTransporterSave = (id: string, updates: Partial<Driver>) => {
    updateDriver(id, updates);
  };

  const handleAddDriver = async (driverData: Omit<Driver, "id" | "assignedJobs">) => {
    const { driversAPI } = await import("../../services/api");
    const newDriver = await driversAPI.create({
      ...driverData,
      assignedJobs: 0,
    });
    addDriver(newDriver);
  };

  const getDriverName = (driverId?: string) => {
    if (!driverId) return undefined;
    return drivers.find((d) => d.id === driverId)?.name;
  };

  const getAfricaExportStatus = (status: JobStatus): AfricaExportShipment["status"] => {
    if (status === "en-route") return "in-transit";
    if (status === "delivered") return "delivered";
    if (status === "assigned") return "assigned";
    return "pending";
  };

  const getAfricaTransportMode = (job: Job) => {
    if (job.transportService === "airfreight" || job.truckSize === "airline") return "Air";
    if (job.transportService === "seafreight" || job.truckSize === "vessel") return "Sea";
    return "Road";
  };

  const moveOrderToAfricaExports = async (job: Job) => {
    const lineItems = jobs.filter((item) => item.ref === job.ref);
    const itemsToMove = lineItems.length > 0 ? lineItems : [job];
    const proceed = await confirm({
      title: "Move to Africa Exports",
      message: `Move ${job.ref} from Order Management to Africa Export Shipments? It will be removed from the local order queue and created in Africa Exports.`,
      type: "warning",
      confirmText: "Move Shipment",
    });
    if (!proceed) return;

    try {
      const productDescriptions = itemsToMove
        .map((item) => item.notes)
        .filter(Boolean)
        .slice(0, 8)
        .join("; ");
      const totalQty = itemsToMove.reduce((sum, item) => sum + (item.outstandingQty || 0), 0);
      const orderPallets = Math.max(...itemsToMove.map((item) => item.pallets || 0), 0);
      const now = new Date().toISOString();
      const shipment: AfricaExportShipment = {
        ref: job.ref,
        customer: job.customer,
        destinationCountry: "",
        hsCode: "",
        productType: productDescriptions || job.notes || "",
        incoterm: "FCA",
        transportMode: getAfricaTransportMode(job),
        preferenceScheme: "To confirm",
        destinationAgent: "",
        etd: job.etd || "",
        eta: job.eta || "",
        customsBufferDays: 2,
        quantity: totalQty,
        pallets: orderPallets,
        status: getAfricaExportStatus(job.status),
        lastCheckedAt: "",
        notes: [
          `Pickup: ${job.pickup || "TBD"}`,
          `Dropoff: ${job.dropoff || "TBD"}`,
          totalQty > 0 ? `Outstanding qty: ${totalQty}` : "",
          job.eta ? `ETA: ${job.eta}` : "",
        ].filter(Boolean).join("\n"),
        documents: {
          coa: itemsToMove.every((item) => item.coaAvailable),
        },
        documentDetails: {},
        productLines: itemsToMove.map((item, index) => ({
          id: `line-${Date.now()}-${index}`,
          product: item.notes || "",
          hsCode: "",
          quantity: item.outstandingQty || 0,
          pallets: item.pallets || 0,
          batch: "",
          notes: item.notes || "",
        })),
        history: [{
          id: `history-${Date.now()}`,
          at: now,
          action: "Moved from Order Management",
          detail: `${itemsToMove.length} line item${itemsToMove.length === 1 ? "" : "s"} moved into Africa Exports`,
        }],
        archived: false,
      };

      await africaExportsAPI.bulkUpsert([shipment]);
      await updateJobs(itemsToMove.map((item) => item.id), {
        jobType: "africa-export",
        internalNotes: `${job.internalNotes ? `${job.internalNotes}\n` : ""}Moved to Africa Export Shipments on ${now.slice(0, 10)}.`,
      });
      showSuccess(`${job.ref} moved to Africa Export Shipments`);
    } catch (error) {
      console.error("Error moving order to Africa exports:", error);
      showError("Failed to move order to Africa Exports");
    }
  };

  const handleAddJob = async () => {
    if (!newJob.ref || !newJob.customer) {
      showWarning("Reference and Customer are required");
      return;
    }

    try {
      const { jobsAPI } = await import("../../services/api");
      await jobsAPI.create({
        ref: newJob.ref,
        customer: newJob.customer,
        pickup: newJob.pickup || "K58 Warehouse",
        dropoff: newJob.dropoff || "TBD",
        warehouse: newJob.warehouse,
        priority: newJob.priority,
        status: "pending" as JobStatus,
        pallets: newJob.pallets,
        outstandingQty: newJob.outstandingQty,
        eta: newJob.eta || undefined,
        notes: newJob.notes,
        jobType: "order",
      });

      await refreshData();
      setShowAddJob(false);
      setNewJob({
        ref: "",
        customer: "",
        pickup: "K58 Warehouse",
        dropoff: "TBD",
        warehouse: "",
        serviceType: "delivery",
        priority: "normal",
        pallets: undefined,
        outstandingQty: undefined,
        eta: "",
        notes: "",
      });
    } catch (error) {
      console.error("Error creating job:", error);
      showError("Failed to create job");
    }
  };

  const [showMoreFilters, setShowMoreFilters] = useState(false);

  return (
    <div className="space-y-3">
      {/* Header — compact */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Order Management</h1>
          <p className="text-sm text-gray-500">Manage jobs, assign transporters, and track deliveries</p>
        </div>
        {onOpenAlerts && (
          <button
            onClick={onOpenAlerts}
            className="relative flex items-center gap-1.5 px-4 py-2.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium"
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

      {/* Stats Strip — primary metrics */}
      <div className="flex gap-1.5 flex-wrap">
        {([
          { label: "Total", value: stats.total, color: "text-gray-900", dotColor: "bg-gray-400", action: () => { setShowPickedOnly(false); setShowOutstandingCoaOnly(false); setServiceFilter(null); setActiveTab("open" as const); } },
          { label: "Pending", value: stats.pending, color: "text-yellow-600", dotColor: "bg-yellow-500", action: () => { setShowPickedOnly(false); setShowOutstandingCoaOnly(false); setServiceFilter(null); setActiveTab("open" as const); } },
          { label: "En Route", value: stats.inRoute, color: "text-blue-600", dotColor: "bg-blue-500", action: () => { setShowPickedOnly(false); setShowOutstandingCoaOnly(false); setServiceFilter(null); setActiveTab("in-transit" as const); } },
          { label: "Delivered", value: stats.delivered, color: "text-green-600", dotColor: "bg-green-500", action: () => { setShowPickedOnly(false); setShowOutstandingCoaOnly(false); setServiceFilter(null); setActiveTab("delivered" as const); } },
          { label: "Exceptions", value: stats.exceptions, color: "text-red-600", dotColor: "bg-red-500", action: () => { setShowPickedOnly(false); setShowOutstandingCoaOnly(false); setServiceFilter(null); setActiveTab("open" as const); } },
        ] as const).map((stat) => (
          <button
            key={stat.label}
            onClick={() => { stat.action(); setCurrentPage(1); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 transition-all"
          >
            <div className={`w-1.5 h-1.5 rounded-full ${stat.dotColor}`} />
            <div className={`text-sm font-bold leading-tight ${stat.color}`}>{stat.value}</div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{stat.label}</div>
          </button>
        ))}

        <div className="w-px bg-gray-200 mx-0.5 self-stretch" />

        {/* Service type filters */}
        <button
          onClick={() => { setShowPickedOnly(false); setShowOutstandingCoaOnly(false); setServiceFilter(serviceFilter === "delivery" ? null : "delivery"); setCurrentPage(1); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-all ${
            serviceFilter === "delivery" ? "border-gray-900 bg-gray-900 text-white shadow-sm" : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
          }`}
        >
          <div className={`text-sm font-bold ${serviceFilter === "delivery" ? "text-white" : "text-resilinc-primary"}`}>{stats.delivery}</div>
          <div className={`text-[10px] uppercase tracking-wider font-medium ${serviceFilter === "delivery" ? "text-gray-300" : "text-gray-400"}`}>Delivery</div>
        </button>
        <button
          onClick={() => { setShowPickedOnly(false); setShowOutstandingCoaOnly(false); setServiceFilter(serviceFilter === "collection" ? null : "collection"); setCurrentPage(1); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-all ${
            serviceFilter === "collection" ? "border-gray-900 bg-gray-900 text-white shadow-sm" : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
          }`}
        >
          <div className={`text-sm font-bold ${serviceFilter === "collection" ? "text-white" : "text-purple-600"}`}>{stats.collection}</div>
          <div className={`text-[10px] uppercase tracking-wider font-medium ${serviceFilter === "collection" ? "text-gray-300" : "text-gray-400"}`}>Collection</div>
        </button>

        <div className="w-px bg-gray-200 mx-0.5 self-stretch" />

        {/* Workflow indicators */}
        <button
          onClick={() => { setShowOutstandingCoaOnly(false); setServiceFilter(null); setShowPickedOnly(!showPickedOnly); setCurrentPage(1); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-all ${
            showPickedOnly ? "border-gray-900 bg-gray-900 text-white shadow-sm" : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
          }`}
        >
          <PackageCheck className={`w-3.5 h-3.5 ${showPickedOnly ? "text-white" : "text-purple-500"}`} />
          <div className={`text-sm font-bold ${showPickedOnly ? "text-white" : "text-purple-600"}`}>{stats.picked}</div>
          <div className={`text-[10px] uppercase tracking-wider font-medium ${showPickedOnly ? "text-gray-300" : "text-gray-400"}`}>Picked</div>
        </button>
        <button
          onClick={() => { setShowPickedOnly(false); setServiceFilter(null); setShowOutstandingCoaOnly(!showOutstandingCoaOnly); setCurrentPage(1); }}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-all ${
            showOutstandingCoaOnly ? "border-gray-900 bg-gray-900 text-white shadow-sm" : stats.outstandingCoa > 0 ? "border-amber-200 bg-amber-50 hover:border-amber-300" : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
          }`}
        >
          <FileCheck2 className={`w-3.5 h-3.5 ${showOutstandingCoaOnly ? "text-white" : "text-amber-500"}`} />
          <div className={`text-sm font-bold ${showOutstandingCoaOnly ? "text-white" : "text-amber-600"}`}>{stats.outstandingCoa}</div>
          <div className={`text-[10px] uppercase tracking-wider font-medium ${showOutstandingCoaOnly ? "text-gray-300" : "text-gray-400"}`}>COA</div>
        </button>
      </div>

      {/* Order Tabs */}
      <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 p-1.5">
        {([
          { key: "open" as const, label: "Open Orders", count: tabCounts.open, color: "text-yellow-600", dotColor: "bg-yellow-500" },
          { key: "assigned" as const, label: "Assigned", count: tabCounts.assigned, color: "text-blue-600", dotColor: "bg-blue-500" },
          { key: "in-transit" as const, label: "In Transit", count: tabCounts.inTransit, color: "text-indigo-600", dotColor: "bg-indigo-500" },
          { key: "delivered" as const, label: "Delivered / Closed", count: tabCounts.delivered, color: "text-green-600", dotColor: "bg-green-500" },
          { key: "dispatched-week" as const, label: "This Week", count: tabCounts.dispatchedWeek, color: "text-purple-600", dotColor: "bg-purple-500" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveTab(tab.key); setCurrentPage(1); }}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? "bg-gray-900 text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${activeTab === tab.key ? "bg-white" : tab.dotColor}`} />
            {tab.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === tab.key ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Busy Date Alerts — compact inline */}
      {busyDateAlerts.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1 text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="text-xs font-semibold">High Volume:</span>
          </div>
          {busyDateAlerts.map((alert) => (
            <button
              key={alert.date}
              onClick={() => setSelectedAlertDate(alert.date)}
              className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 hover:bg-amber-100 rounded-md text-[11px] cursor-pointer transition-colors border border-amber-200 hover:border-amber-300"
            >
              <span className="font-semibold text-amber-900">{alert.date}</span>
              <span className="text-amber-600">{alert.total}</span>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <WarehouseSelector />
          <FilterBar showMore={showMoreFilters} />
        </div>
        <div className="flex items-center gap-2">
          <SortBar />
          <button onClick={() => setShowMoreFilters(!showMoreFilters)} className="text-[10px] text-resilinc-primary hover:text-resilinc-primary-dark font-medium px-2 py-1 rounded hover:bg-green-50 transition-colors whitespace-nowrap">{showMoreFilters ? "Less" : "More"}</button>
        </div>
      </div>

      {/* Main Content Grid */}
      <DndContext
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid gap-6 lg:grid-cols-3 items-start">
          {/* Jobs List */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-5 w-5 text-gray-600" />
                      <CardTitle>
                        {activeTab === "open" ? "Open Orders" : activeTab === "assigned" ? "Assigned Orders" : activeTab === "in-transit" ? "In Transit" : activeTab === "dispatched-week" ? `Dispatched This Week (${filteredAndSortedJobs.length} orders, ${dispatchedWeekSummary.pallets} pallets, ${dispatchedWeekSummary.qty} qty)` : `Delivered Orders (${filteredAndSortedJobs.length})`}
                        {activeTab !== "dispatched-week" && activeTab !== "delivered" && ` (${filteredAndSortedJobs.length})`}
                      </CardTitle>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {activeTab === "open" ? "Drag jobs to transporters to assign" :
                       activeTab === "assigned" ? "Orders assigned to transporters, awaiting dispatch" :
                       activeTab === "in-transit" ? "Orders currently en route to destination" :
                       activeTab === "dispatched-week" ? "Current week orders that are delivered or on route" :
                       "Completed and closed orders"}
                    </p>
                  </div>
                  {!isViewer && (
                    <Button
                      size="sm"
                      className="gap-2 bg-green-600 hover:bg-green-700"
                      onClick={() => setShowAddJob(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Add Job
                    </Button>
                  )}
                </div>
              </CardHeader>

              <CardContent>
                <SortableContext
                  items={paginatedJobs.map((j) => j.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {filteredAndSortedJobs.length === 0 ? (
                      <div className="py-12 text-center text-gray-500">
                        No jobs found matching your filters
                      </div>
                    ) : (
                      paginatedJobs.map((job) => (
                          <JobCard
                            key={job.id}
                            job={job}
                            onSelect={() => handleJobSelect(job)}
                            showDispatchDate={activeTab === "dispatched-week"}
                            onMoveToAfricaExports={moveOrderToAfricaExports}
                          />
                      ))
                    )}
                  </div>
                </SortableContext>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                    <span className="text-sm text-gray-500">
                      Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredAndSortedJobs.length)} of {filteredAndSortedJobs.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={currentPage === 1}
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="w-4 h-4" />
                        Previous
                      </Button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                              currentPage === page
                                ? "bg-resilinc-primary text-white"
                                : "text-gray-600 hover:bg-gray-100"
                            }`}
                          >
                            {page}
                          </button>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={currentPage === totalPages}
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      >
                        Next
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Transporters List - sticky so it stays visible while scrolling jobs */}
          <div className="lg:col-span-1 lg:sticky lg:top-8" style={{ maxHeight: "calc(100vh - 4rem)", overflowY: "auto" }}>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Truck className="h-5 w-5 text-gray-600" />
                      <CardTitle>Transporters ({drivers.length})</CardTitle>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">Drop jobs here to assign</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => setShowAddDriver(true)}
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </div>
              </CardHeader>

              <CardContent>
                <div className="space-y-2">
                  {drivers.length === 0 ? (
                    <div className="py-12 text-center text-gray-500">No transporters available</div>
                  ) : (
                    drivers.map((driver) => (
                      <DriverCard
                        key={driver.id}
                        driver={driver}
                        onEdit={handleTransporterEdit}
                        assignedPallets={palletsByDriver[driver.id] || 0}
                      />
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Drag Overlay */}
        <DragOverlay>
          {activeJob ? (
            <div className="rounded-card border bg-white p-3 shadow-lg opacity-90">
              <p className="font-medium">{activeJob.ref}</p>
              <p className="text-xs text-gray-500">{activeJob.customer}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Date Drill-Down Modal */}
      {selectedAlertDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedAlertDate(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-amber-50">
              <div>
                <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  Orders Due: {selectedAlertDate}
                </h2>
                <p className="text-sm text-gray-600 mt-0.5">
                  {alertDateOrders.length} {alertDateOrders.length === 1 ? "order" : "orders"}
                  {alertDateLineCount !== alertDateOrders.length && ` (${alertDateLineCount} lines)`}
                  {" "}due on this date
                </p>
              </div>
              <button
                onClick={() => setSelectedAlertDate(null)}
                className="p-2 hover:bg-amber-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(85vh-80px)]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <tr>
                    <th className="text-left p-3 font-semibold text-gray-700">Reference</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Type</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Lines</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Customer</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Status</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Route</th>
                    <th className="text-right p-3 font-semibold text-gray-700">Pallets</th>
                    <th className="text-left p-3 font-semibold text-gray-700">Transporter</th>
                  </tr>
                </thead>
                <tbody>
                  {alertDateOrders.map(({ ref, primary, lineCount, totalPallets, hasPalletData }) => (
                    <tr
                      key={ref}
                      className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                      onClick={() => { setSelectedAlertDate(null); setSelectedJob(primary); }}
                    >
                      <td className="p-3 font-medium">
                        <span className="text-resilinc-primary hover:text-resilinc-primary-dark hover:underline">{ref}</span>
                      </td>
                      <td className="p-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          primary.jobType === "ibt" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                        }`}>
                          {primary.jobType === "ibt" ? "IBT" : "ORDER"}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                          {lineCount} {lineCount === 1 ? "line" : "lines"}
                        </span>
                      </td>
                      <td className="p-3 text-gray-700">{primary.customer}</td>
                      <td className="p-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          primary.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                          primary.status === "assigned" ? "bg-blue-100 text-blue-700" :
                          primary.status === "en-route" ? "bg-indigo-100 text-indigo-700" :
                          primary.status === "delivered" ? "bg-green-100 text-green-700" :
                          primary.status === "returned" ? "bg-amber-100 text-amber-700" :
                          primary.status === "exception" ? "bg-red-100 text-red-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>
                          {primary.status}
                        </span>
                      </td>
                      <td className="p-3 text-gray-700 text-xs">{primary.pickup} → {primary.dropoff}</td>
                      <td className="p-3 text-right font-medium">{hasPalletData ? totalPallets : "—"}</td>
                      <td className="p-3 text-gray-700">
                        {primary.driverId ? drivers.find((d) => d.id === primary.driverId)?.name : "Unassigned"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Job Details Modal */}
      {selectedJob && (
        <JobDetailsModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onSelectLineItem={(lineItem) => setSelectedJob(lineItem)}
          driverName={getDriverName(selectedJob.driverId)}
        />
      )}

      {/* Transporter Details Modal */}
      {selectedTransporter && (
        <TransporterDetailsModal
          transporter={selectedTransporter}
          onClose={() => setSelectedTransporter(null)}
          onSave={handleTransporterSave}
        />
      )}

      {/* Add Driver Modal */}
      {showAddDriver && (
        <AddDriverModal
          onClose={() => setShowAddDriver(false)}
          onSave={handleAddDriver}
        />
      )}

      {/* Add Job Modal */}
      {showAddJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Add Job Manually</h2>
                <button
                  onClick={() => setShowAddJob(false)}
                  className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Reference */}
                <div>
                  <label htmlFor="job-ref" className="block text-sm font-medium text-gray-700 mb-2">
                    Reference / Order No <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="job-ref"
                    type="text"
                    value={newJob.ref}
                    onChange={(e) => setNewJob({ ...newJob, ref: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="SO-0001"
                    required
                  />
                </div>

                {/* Customer */}
                <div>
                  <label htmlFor="job-customer" className="block text-sm font-medium text-gray-700 mb-2">
                    Customer Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="job-customer"
                    type="text"
                    value={newJob.customer}
                    onChange={(e) => setNewJob({ ...newJob, customer: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="Customer Name"
                    required
                  />
                </div>

                {/* Warehouse */}
                <div>
                  <label htmlFor="job-warehouse" className="block text-sm font-medium text-gray-700 mb-2">
                    Warehouse / Pickup
                  </label>
                  <select
                    id="job-warehouse"
                    value={newJob.warehouse}
                    onChange={(e) => setNewJob({ ...newJob, warehouse: e.target.value, pickup: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                  >
                    <option value="">Select Warehouse</option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse} value={warehouse}>
                        {warehouse}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Service Type */}
                <div>
                  <label htmlFor="job-service-type" className="block text-sm font-medium text-gray-700 mb-2">
                    Service Type
                  </label>
                  <select
                    id="job-service-type"
                    value={newJob.serviceType}
                    onChange={(e) => setNewJob({ ...newJob, serviceType: e.target.value as "collection" | "delivery" })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                  >
                    <option value="delivery">Delivery</option>
                    <option value="collection">Collection</option>
                  </select>
                </div>

                {/* Dropoff */}
                <div>
                  <label htmlFor="job-dropoff" className="block text-sm font-medium text-gray-700 mb-2">
                    Dropoff / Delivery Address
                  </label>
                  <input
                    id="job-dropoff"
                    type="text"
                    value={newJob.dropoff}
                    onChange={(e) => setNewJob({ ...newJob, dropoff: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="Delivery address"
                  />
                </div>

                {/* Priority */}
                <div>
                  <label htmlFor="job-priority" className="block text-sm font-medium text-gray-700 mb-2">
                    Priority
                  </label>
                  <select
                    id="job-priority"
                    value={newJob.priority}
                    onChange={(e) => setNewJob({ ...newJob, priority: e.target.value as JobPriority })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </div>

                {/* ETA */}
                <div>
                  <label htmlFor="job-eta" className="block text-sm font-medium text-gray-700 mb-2">
                    Delivery Date (ETA)
                  </label>
                  <input
                    id="job-eta"
                    type="date"
                    value={newJob.eta}
                    onChange={(e) => setNewJob({ ...newJob, eta: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                  />
                </div>

                {/* Pallets */}
                <div>
                  <label htmlFor="job-pallets" className="block text-sm font-medium text-gray-700 mb-2">
                    Pallets
                  </label>
                  <input
                    id="job-pallets"
                    type="number"
                    value={newJob.pallets || ""}
                    onChange={(e) => setNewJob({ ...newJob, pallets: e.target.value ? parseInt(e.target.value) : undefined })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="0"
                    min="0"
                  />
                </div>

                {/* Outstanding Qty */}
                <div>
                  <label htmlFor="job-qty" className="block text-sm font-medium text-gray-700 mb-2">
                    Outstanding Qty
                  </label>
                  <input
                    id="job-qty"
                    type="number"
                    value={newJob.outstandingQty || ""}
                    onChange={(e) => setNewJob({ ...newJob, outstandingQty: e.target.value ? parseInt(e.target.value) : undefined })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="0"
                    min="0"
                  />
                </div>

                {/* Notes - Full Width */}
                <div className="col-span-2">
                  <label htmlFor="job-notes" className="block text-sm font-medium text-gray-700 mb-2">
                    Notes / Description
                  </label>
                  <textarea
                    id="job-notes"
                    value={newJob.notes}
                    onChange={(e) => setNewJob({ ...newJob, notes: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="Additional notes or item description"
                    rows={3}
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 mt-6">
                <Button onClick={handleAddJob} className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700">
                  <Save className="w-4 h-4" />
                  Add Job
                </Button>
                <Button
                  type="button"
                  onClick={() => setShowAddJob(false)}
                  className="flex-1 bg-gray-200 text-gray-800 hover:bg-gray-300"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
