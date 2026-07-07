// src/components/views/AdvancedAnalytics.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { TrendingUp, Package, Truck, Calendar, BarChart3, PieChart as PieChartIcon, FileSpreadsheet, FileText, Globe2 } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useDispatch } from "../../context/DispatchContext";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { JobDetailsModal } from "../JobDetailsModal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { africaExportsAPI } from "../../services/api";
import * as XLSX from "../../lib/spreadsheet";
import { formatDate, formatDateTime } from "../../utils/format";
import type { Job } from "../../types";

type TimeRange = "7d" | "30d" | "90d" | "current-month" | "previous-month" | "all";
type KpiDrilldownKey = "total" | "delivered" | "exceptions";

const AFRICA_EXPORTS_KEY = "dispatch_africa_export_shipments_v2";

interface AfricaExportShipment {
  ref: string;
  customer: string;
  destinationCountry: string;
  hsCode: string;
  productType: string;
  incoterm: string;
  transportMode: string;
  preferenceScheme: string;
  destinationAgent: string;
  eta: string;
  pallets: number;
  status: "pending" | "assigned" | "in-transit" | "delivered" | "cancelled";
  lastCheckedAt: string;
  notes: string;
  documents: Record<string, boolean>;
  archived?: boolean;
}

const COLORS = {
  primary: "#0EA5E9",
  secondary: "#8B5CF6",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
  info: "#06B6D4",
  purple: "#A855F7",
  pink: "#EC4899",
};


export const AdvancedAnalytics: React.FC = () => {
  const { jobs, drivers, updateJobs } = useDispatch();
  const [timeRange, setTimeRange] = useState<TimeRange>("7d");
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("all");
  const [palletDrafts, setPalletDrafts] = useState<Record<string, string>>({});
  const [savingPalletRef, setSavingPalletRef] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedTransporterId, setSelectedTransporterId] = useState<string | null>(null);
  const [activeKpiDrilldown, setActiveKpiDrilldown] = useState<KpiDrilldownKey | null>(null);
  const drilldownRef = useRef<HTMLDivElement | null>(null);
  const transporterMetricsRef = useRef<HTMLDivElement | null>(null);
  const missingPalletsRef = useRef<HTMLDivElement | null>(null);

  const [africaExports, setAfricaExports] = useState<AfricaExportShipment[]>(() => {
    try {
      const raw = localStorage.getItem(AFRICA_EXPORTS_KEY);
      return raw ? JSON.parse(raw) as AfricaExportShipment[] : [];
    } catch (error) {
      console.warn("Failed to load Africa export analytics data", error);
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
        console.warn("Failed to load Africa export analytics data from database", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const getTimeRangeLabel = (range: TimeRange) => {
    const now = new Date();
    if (range === "7d") return "Last 7 days";
    if (range === "30d") return "Last 30 days";
    if (range === "90d") return "Last 90 days";
    if (range === "current-month") {
      return `Current month (${now.toLocaleDateString("en-GB", { month: "long", year: "numeric" })})`;
    }
    if (range === "previous-month") {
      const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return `Previous month (${previousMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" })})`;
    }
    return "All time";
  };

  const getTimeRangeBounds = (range: TimeRange) => {
    const now = new Date();
    if (range === "7d") return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: null };
    if (range === "30d") return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: null };
    if (range === "90d") return { start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), end: null };
    if (range === "current-month") {
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
      };
    }
    if (range === "previous-month") {
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
      };
    }
    return { start: null, end: null };
  };

  // Get unique warehouses
  const warehouses = useMemo(() => {
    const uniqueWarehouses = new Set<string>();
    jobs.forEach((job) => {
      if (job.warehouse) uniqueWarehouses.add(job.warehouse);
    });
    return Array.from(uniqueWarehouses).sort();
  }, [jobs]);

  // Filter jobs by time range
  const scopedOrderJobs = useMemo(() => {
    const { start, end } = getTimeRangeBounds(timeRange);

    // Filter by customer orders only (exclude IBT)
    let filtered = jobs.filter((j) => j.jobType === "order" || j.jobType === undefined);

    if (start || end) {
      filtered = filtered.filter((job) => {
        const jobDate = new Date(job.createdAt);
        if (start && jobDate < start) return false;
        if (end && jobDate > end) return false;
        return true;
      });
    }

    if (selectedWarehouse !== "all") {
      filtered = filtered.filter((job) => job.warehouse === selectedWarehouse);
    }

    // Deduplicate by ref — 1 order = 1 ASO number
    return filtered;
  }, [jobs, timeRange, selectedWarehouse]);

  const filteredJobs = useMemo(() => {
    const refMap = new Map<string, typeof scopedOrderJobs[0]>();
    scopedOrderJobs.forEach((job) => {
      const existing = refMap.get(job.ref);
      if (!existing) {
        refMap.set(job.ref, { ...job });
      } else {
        // Pallets are order-level on imports, so duplicate line items should not multiply load.
        if (job.pallets) existing.pallets = Math.max(existing.pallets || 0, job.pallets);
        if (job.outstandingQty) existing.outstandingQty = (existing.outstandingQty || 0) + job.outstandingQty;
      }
    });

    return Array.from(refMap.values());
  }, [scopedOrderJobs]);

  const reportPeriodLabel = getTimeRangeLabel(timeRange);
  const pulledAtLabel = formatDateTime(new Date());

  const scopedAfricaExports = useMemo(() => {
    const { start, end } = getTimeRangeBounds(timeRange);

    return africaExports.filter((shipment) => {
      if (shipment.archived) return false;
      const shipmentDateValue = shipment.eta || shipment.lastCheckedAt;
      if (!shipmentDateValue || (!start && !end)) return true;

      const shipmentDate = new Date(shipmentDateValue);
      if (Number.isNaN(shipmentDate.getTime())) return true;
      if (start && shipmentDate < start) return false;
      if (end && shipmentDate > end) return false;
      return true;
    });
  }, [africaExports, timeRange]);

  // 1. Transporter Performance Metrics
  const transporterMetrics = useMemo(() => {
    const metrics: Record<
      string,
      {
        driverId: string;
        name: string;
        totalJobs: number;
        completedJobs: number;
        inProgress: number;
        palletsLoaded: number;
        capacity: number;
        peakDayPallets: number;
        peakDayDate: string;
        peakUtilization: number;
      }
    > = {};

    drivers.forEach((driver) => {
      metrics[driver.id] = {
        driverId: driver.id,
        name: driver.name,
        totalJobs: 0,
        completedJobs: 0,
        inProgress: 0,
        palletsLoaded: 0,
        capacity: driver.capacity,
        peakDayPallets: 0,
        peakDayDate: "",
        peakUtilization: 0,
      };
    });

    // Track pallets per driver per ETD date for capacity planning
    const dailyLoad: Record<string, Record<string, number>> = {}; // driverId -> { date -> pallets }

    filteredJobs.forEach((job) => {
      if (job.driverId && metrics[job.driverId]) {
        metrics[job.driverId].totalJobs++;
        if (job.status === "delivered") {
          metrics[job.driverId].completedJobs++;
        }
        if (job.status === "en-route" || job.status === "assigned") {
          metrics[job.driverId].inProgress++;
        }
        if (job.pallets) {
          metrics[job.driverId].palletsLoaded += job.pallets;

          // Track daily load by ETD date (or ETA if no ETD)
          const dateKey = (job.etd || job.eta || job.createdAt).split("T")[0];
          if (!dailyLoad[job.driverId]) dailyLoad[job.driverId] = {};
          dailyLoad[job.driverId][dateKey] = (dailyLoad[job.driverId][dateKey] || 0) + job.pallets;
        }
      }
    });

    // Calculate peak day utilization per transporter
    Object.entries(dailyLoad).forEach(([driverId, dates]) => {
      if (!metrics[driverId]) return;
      let peakPallets = 0;
      let peakDate = "";
      Object.entries(dates).forEach(([date, pallets]) => {
        if (pallets > peakPallets) {
          peakPallets = pallets;
          peakDate = date;
        }
      });
      metrics[driverId].peakDayPallets = peakPallets;
      metrics[driverId].peakDayDate = peakDate;
      if (metrics[driverId].capacity > 0) {
        metrics[driverId].peakUtilization = Math.round((peakPallets / metrics[driverId].capacity) * 100);
      }
    });

    return Object.values(metrics).filter((m) => m.totalJobs > 0);
  }, [filteredJobs, drivers]);

  const missingPalletAssignments = useMemo(() => {
    const grouped = new Map<
      string,
      {
        ref: string;
        customer: string;
        driverName: string;
        status: string;
        eta?: string;
        etd?: string;
        ids: string[];
        lineItems: number;
        maxPallets: number;
      }
    >();

    scopedOrderJobs.forEach((job) => {
      if (!job.driverId) return;
      const key = `${job.ref}::${job.driverId}`;
      const pallets = job.pallets && job.pallets > 0 ? job.pallets : 0;
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, {
          ref: job.ref,
          customer: job.customer,
          driverName: drivers.find((driver) => driver.id === job.driverId)?.name || "Unknown",
          status: job.status,
          eta: job.eta,
          etd: job.etd,
          ids: [job.id],
          lineItems: 1,
          maxPallets: pallets,
        });
      } else {
        existing.ids.push(job.id);
        existing.lineItems += 1;
        existing.maxPallets = Math.max(existing.maxPallets, pallets);
        if (!existing.etd && job.etd) existing.etd = job.etd;
        if (!existing.eta && job.eta) existing.eta = job.eta;
      }
    });

    return Array.from(grouped.values())
      .filter((item) => item.maxPallets <= 0)
      .sort((a, b) => (a.etd || a.eta || "").localeCompare(b.etd || b.eta || ""));
  }, [scopedOrderJobs, drivers]);

  const saveMissingPalletQty = async (ref: string, ids: string[]) => {
    const value = Number(palletDrafts[ref]);
    if (!Number.isFinite(value) || value <= 0) return;

    setSavingPalletRef(ref);
    try {
      await updateJobs(ids, { pallets: Math.round(value) });
      setPalletDrafts((prev) => {
        const next = { ...prev };
        delete next[ref];
        return next;
      });
    } finally {
      setSavingPalletRef(null);
    }
  };

  const openMissingPalletOrder = (ids: string[]) => {
    const job = scopedOrderJobs.find((item) => ids.includes(item.id));
    if (job) setSelectedJob(job);
  };

  const selectedTransporterJobs = useMemo(() => {
    if (!selectedTransporterId) return [];
    const grouped = new Map<string, Job>();
    scopedOrderJobs
      .filter((job) => job.driverId === selectedTransporterId)
      .forEach((job) => {
        const existing = grouped.get(job.ref);
        if (!existing) {
          grouped.set(job.ref, { ...job });
          return;
        }
        if (job.pallets) existing.pallets = Math.max(existing.pallets || 0, job.pallets);
        if (job.outstandingQty) existing.outstandingQty = (existing.outstandingQty || 0) + job.outstandingQty;
        if (job.status === "delivered") existing.status = "delivered";
        if (job.actualDeliveryAt && !existing.actualDeliveryAt) existing.actualDeliveryAt = job.actualDeliveryAt;
      });

    return Array.from(grouped.values())
      .sort((a, b) => (a.etd || a.eta || a.createdAt).localeCompare(b.etd || b.eta || b.createdAt));
  }, [scopedOrderJobs, selectedTransporterId]);

  const selectedTransporterName = selectedTransporterId
    ? drivers.find((driver) => driver.id === selectedTransporterId)?.name || "Unknown"
    : "";

  const transporterMetricRows = useMemo(() => {
    return transporterMetrics.map((metric) => ({
      Transporter: metric.name,
      Orders: metric.totalJobs,
      Delivered: metric.completedJobs,
      "In Transit": metric.inProgress,
      "Total Pallets": metric.palletsLoaded,
      "Daily Capacity": `${metric.capacity} plt/day`,
      "Peak Day Pallets": metric.peakDayPallets,
      "Peak Day Date": metric.peakDayDate ? formatDate(metric.peakDayDate) : "-",
      "Peak Utilization": `${metric.peakUtilization}%`,
      "Capacity Status": metric.peakUtilization > 100 ? "Over capacity" : metric.peakUtilization >= 80 ? "High utilization" : "Within capacity",
    }));
  }, [transporterMetrics]);

  const exportTransporterMetricsExcel = async () => {
    const metadata = XLSX.utils.aoa_to_sheet([
      ["Detailed Transporter Metrics"],
      ["Report Period", reportPeriodLabel],
      ["Pulled At", pulledAtLabel],
      ["Warehouse", selectedWarehouse === "all" ? "All Warehouses" : selectedWarehouse],
      ["Records", transporterMetrics.length],
    ]);
    const metricsSheet = XLSX.utils.json_to_sheet(transporterMetricRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, metadata, "Report Info");
    XLSX.utils.book_append_sheet(workbook, metricsSheet, "Transporter Metrics");
    const fileDate = new Date().toISOString().split("T")[0];
    await XLSX.writeFile(workbook, `detailed-transporter-metrics-${timeRange}-${fileDate}.xlsx`);
  };

  const exportTransporterMetricsPdf = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const generatedDate = formatDate(new Date());
    const chartData = transporterMetrics
      .slice()
      .sort((a, b) => b.totalJobs - a.totalJobs)
      .slice(0, 8);

    const drawChartCard = (
      title: string,
      subtitle: string,
      x: number,
      y: number,
      width: number,
      height: number,
      series: { label: string; color: [number, number, number]; getValue: (metric: typeof transporterMetrics[number]) => number }[],
    ) => {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, width, height, 2, 2, "F");
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.25);
      doc.roundedRect(x, y, width, height, 2, 2, "S");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text(title, x + 4, y + 6);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(100, 116, 139);
      doc.text(subtitle, x + 4, y + 10.5);

      const legendX = x + width - 48;
      series.forEach((item, index) => {
        const lx = legendX + index * 16;
        doc.setFillColor(item.color[0], item.color[1], item.color[2]);
        doc.rect(lx, y + 4, 2.5, 2.5, "F");
        doc.setTextColor(71, 85, 105);
        doc.setFontSize(5.5);
        doc.text(item.label, lx + 3.5, y + 6.2);
      });

      if (chartData.length === 0) {
        doc.setTextColor(148, 163, 184);
        doc.setFontSize(8);
        doc.text("No transporter data for this period", x + width / 2, y + height / 2, { align: "center" });
        return;
      }

      const labelWidth = 34;
      const chartX = x + labelWidth + 5;
      const chartW = width - labelWidth - 12;
      const topY = y + 17;
      const rowHeight = (height - 23) / chartData.length;
      const maxValue = Math.max(1, ...chartData.flatMap((metric) => series.map((item) => item.getValue(metric))));

      chartData.forEach((metric, metricIndex) => {
        const rowY = topY + metricIndex * rowHeight;
        const label = metric.name.length > 20 ? `${metric.name.slice(0, 19)}...` : metric.name;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6);
        doc.setTextColor(51, 65, 85);
        doc.text(label, x + 4, rowY + 3.2);

        const barHeight = Math.min(2.2, Math.max(1.5, (rowHeight - 1.5) / series.length));
        series.forEach((item, seriesIndex) => {
          const value = item.getValue(metric);
          const barY = rowY + seriesIndex * (barHeight + 0.6);
          const barWidth = (value / maxValue) * chartW;
          doc.setFillColor(241, 245, 249);
          doc.roundedRect(chartX, barY, chartW, barHeight, 0.8, 0.8, "F");
          doc.setFillColor(item.color[0], item.color[1], item.color[2]);
          doc.roundedRect(chartX, barY, Math.max(barWidth, value > 0 ? 1 : 0), barHeight, 0.8, 0.8, "F");
          doc.setFontSize(5.5);
          doc.setTextColor(71, 85, 105);
          doc.text(String(value), chartX + Math.min(chartW - 2, Math.max(barWidth + 1.5, 3)), barY + barHeight);
        });
      });
    };

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 24, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Detailed Transporter Metrics", 14, 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);
    doc.text(`Period: ${reportPeriodLabel}`, 14, 17);
    doc.text(`Pulled at: ${pulledAtLabel}`, pageWidth - 14, 10, { align: "right" });
    doc.text(`Warehouse: ${selectedWarehouse === "all" ? "All Warehouses" : selectedWarehouse}`, pageWidth - 14, 17, { align: "right" });

    drawChartCard(
      "Transporter Workload",
      "Delivered, active work, and pallet load",
      14,
      30,
      (pageWidth - 34) / 2,
      70,
      [
        { label: "Del", color: [16, 185, 129], getValue: (metric) => metric.completedJobs },
        { label: "Act", color: [245, 158, 11], getValue: (metric) => metric.inProgress },
        { label: "Plt", color: [14, 165, 233], getValue: (metric) => metric.palletsLoaded },
      ],
    );

    drawChartCard(
      "Capacity Planning",
      "Peak day pallet load vs daily capacity",
      20 + (pageWidth - 34) / 2,
      30,
      (pageWidth - 34) / 2,
      70,
      [
        { label: "Peak", color: [245, 158, 11], getValue: (metric) => metric.peakDayPallets },
        { label: "Cap", color: [14, 165, 233], getValue: (metric) => metric.capacity },
      ],
    );

    autoTable(doc, {
      startY: 106,
      head: [["Transporter", "Orders", "Delivered", "In Transit", "Total Pallets", "Daily Capacity", "Peak Day", "Peak Utilization", "Status"]],
      body: transporterMetrics.map((metric) => [
        metric.name,
        String(metric.totalJobs),
        String(metric.completedJobs),
        String(metric.inProgress),
        String(metric.palletsLoaded),
        `${metric.capacity} plt/day`,
        metric.peakDayDate ? `${metric.peakDayPallets} plt (${formatDate(metric.peakDayDate)})` : "-",
        `${metric.peakUtilization}%`,
        metric.peakUtilization > 100 ? "Over capacity" : metric.peakUtilization >= 80 ? "High utilization" : "Within capacity",
      ]),
      theme: "grid",
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
      bodyStyles: { fontSize: 7, textColor: [30, 41, 59] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { lineColor: [226, 232, 240], lineWidth: 0.15, overflow: "linebreak" },
      columnStyles: {
        0: { cellWidth: 48 },
        1: { halign: "center" },
        2: { halign: "center" },
        3: { halign: "center" },
        4: { halign: "center" },
        5: { halign: "center" },
        7: { halign: "center" },
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 7) {
          const value = Number.parseInt(String(data.cell.raw), 10);
          data.cell.styles.fontStyle = "bold";
          if (value > 100) data.cell.styles.textColor = [220, 38, 38];
          else if (value >= 80) data.cell.styles.textColor = [217, 119, 6];
          else data.cell.styles.textColor = [22, 163, 74];
        }
      },
      didDrawPage: () => {
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setDrawColor(226, 232, 240);
        doc.line(14, pageHeight - 10, pageWidth - 14, pageHeight - 10);
        doc.setTextColor(148, 163, 184);
        doc.setFontSize(6.5);
        doc.text("K58 Dispatch", 14, pageHeight - 5);
        doc.text(`Generated ${generatedDate}`, pageWidth / 2, pageHeight - 5, { align: "center" });
        doc.text(`Page ${(doc as any).internal.getCurrentPageInfo().pageNumber}`, pageWidth - 14, pageHeight - 5, { align: "right" });
      },
    });

    const fileDate = new Date().toISOString().split("T")[0];
    doc.save(`detailed-transporter-metrics-${timeRange}-${fileDate}.pdf`);
  };

  // 2. (Removed — Jobs by Status donut replaced with trend chart)


  // 4. Jobs Frequency Timeline (Daily) — already deduplicated via filteredJobs
  const africaExportKpis = useMemo(() => {
    const total = scopedAfricaExports.length;
    const delivered = scopedAfricaExports.filter((shipment) => shipment.status === "delivered").length;
    const assigned = scopedAfricaExports.filter((shipment) => shipment.status === "assigned" || shipment.status === "in-transit").length;
    const pending = scopedAfricaExports.filter((shipment) => shipment.status === "pending").length;
    const pallets = scopedAfricaExports.reduce((sum, shipment) => sum + (Number(shipment.pallets) || 0), 0);
    const missingAgentChecks = scopedAfricaExports.filter((shipment) => !shipment.lastCheckedAt).length;
    const deliveredRate = total > 0 ? Math.round((delivered / total) * 100) : 0;

    return { total, delivered, assigned, pending, pallets, missingAgentChecks, deliveredRate };
  }, [scopedAfricaExports]);

  const africaDestinationAnalytics = useMemo(() => {
    const destinationMap = new Map<string, { country: string; shipments: number; pallets: number; delivered: number }>();

    scopedAfricaExports.forEach((shipment) => {
      const country = shipment.destinationCountry || "To confirm";
      const existing = destinationMap.get(country) || { country, shipments: 0, pallets: 0, delivered: 0 };
      existing.shipments += 1;
      existing.pallets += Number(shipment.pallets) || 0;
      if (shipment.status === "delivered") existing.delivered += 1;
      destinationMap.set(country, existing);
    });

    return Array.from(destinationMap.values()).sort((a, b) => b.shipments - a.shipments);
  }, [scopedAfricaExports]);

  const africaStatusAnalytics = useMemo(() => {
    const labels: Record<AfricaExportShipment["status"], string> = {
      pending: "Pending",
      assigned: "Assigned",
      "in-transit": "In Transit",
      delivered: "Delivered",
      cancelled: "Cancelled",
    };

    return (Object.keys(labels) as AfricaExportShipment["status"][]).map((status) => ({
      status: labels[status],
      shipments: scopedAfricaExports.filter((shipment) => shipment.status === status).length,
      pallets: scopedAfricaExports
        .filter((shipment) => shipment.status === status)
        .reduce((sum, shipment) => sum + (Number(shipment.pallets) || 0), 0),
    }));
  }, [scopedAfricaExports]);

  const africaExportTimeline = useMemo(() => {
    const timeline: Record<string, { date: string; exports: number; delivered: number }> = {};

    scopedAfricaExports.forEach((shipment) => {
      const dateKey = (shipment.eta || shipment.lastCheckedAt || "").split("T")[0];
      if (!dateKey) return;
      if (!timeline[dateKey]) timeline[dateKey] = { date: dateKey, exports: 0, delivered: 0 };
      timeline[dateKey].exports += 1;
      if (shipment.status === "delivered") timeline[dateKey].delivered += 1;
    });

    return Object.values(timeline).sort((a, b) => a.date.localeCompare(b.date));
  }, [scopedAfricaExports]);

  const africaDocumentRiskRows = useMemo(() => {
    return scopedAfricaExports
      .map((shipment) => {
        const documentValues = Object.values(shipment.documents || {});
        const documentTotal = documentValues.length;
        const documentsComplete = documentValues.filter(Boolean).length;
        const readiness = documentTotal > 0 ? Math.round((documentsComplete / documentTotal) * 100) : 0;
        return {
          ...shipment,
          documentsComplete,
          documentTotal,
          readiness,
        };
      })
      .filter((shipment) => shipment.readiness < 100 || !shipment.lastCheckedAt)
      .sort((a, b) => a.readiness - b.readiness || (a.eta || "").localeCompare(b.eta || ""));
  }, [scopedAfricaExports]);

  const africaExportRows = useMemo(() => {
    return scopedAfricaExports.map((shipment) => {
      const documentValues = Object.values(shipment.documents || {});
      const documentsComplete = documentValues.filter(Boolean).length;
      const documentTotal = documentValues.length;
      const readiness = documentTotal > 0 ? Math.round((documentsComplete / documentTotal) * 100) : 0;

      return {
        Reference: shipment.ref,
        "Africa Client": shipment.customer,
        "Destination Country": shipment.destinationCountry || "To confirm",
        Status: shipment.status,
        "HS Code": shipment.hsCode || "To confirm",
        "Product Type": shipment.productType || "To confirm",
        Incoterm: shipment.incoterm,
        "Transport Mode": shipment.transportMode,
        Pallets: shipment.pallets || 0,
        ETA: shipment.eta || "N/A",
        "Origin Preference": shipment.preferenceScheme,
        "Destination Agent": shipment.destinationAgent || "To confirm",
        "Agent Check": shipment.lastCheckedAt || "Not done",
        "Document Readiness": `${readiness}%`,
        Notes: shipment.notes || "",
      };
    });
  }, [scopedAfricaExports]);

  const exportAfricaAnalyticsExcel = async () => {
    const metadata = XLSX.utils.aoa_to_sheet([
      ["Africa Export Analytics"],
      ["Report Period", reportPeriodLabel],
      ["Pulled At", pulledAtLabel],
      ["Shipments", africaExportKpis.total],
      ["Delivered Rate", `${africaExportKpis.deliveredRate}%`],
      ["Pallets", africaExportKpis.pallets],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, metadata, "Report Info");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(africaExportRows), "Africa Exports");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(africaDestinationAnalytics), "Destinations");
    const fileDate = new Date().toISOString().split("T")[0];
    await XLSX.writeFile(workbook, `africa-export-analytics-${timeRange}-${fileDate}.xlsx`);
  };

  const exportAfricaAnalyticsPdf = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const generatedDate = formatDate(new Date());

    doc.setFillColor(6, 95, 70);
    doc.rect(0, 0, pageWidth, 24, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text("Africa Export Analytics", 14, 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(209, 250, 229);
    doc.text(`Period: ${reportPeriodLabel}`, 14, 17);
    doc.text(`Pulled at: ${pulledAtLabel}`, pageWidth - 14, 10, { align: "right" });

    autoTable(doc, {
      startY: 32,
      head: [["Metric", "Value"]],
      body: [
        ["Shipments", String(africaExportKpis.total)],
        ["Assigned / In Transit", String(africaExportKpis.assigned)],
        ["Delivered", String(africaExportKpis.delivered)],
        ["Delivered Rate", `${africaExportKpis.deliveredRate}%`],
        ["Total Pallets", String(africaExportKpis.pallets)],
        ["No Agent Check", String(africaExportKpis.missingAgentChecks)],
      ],
      theme: "grid",
      headStyles: { fillColor: [6, 95, 70], textColor: [255, 255, 255], fontStyle: "bold" },
      margin: { left: 14, right: pageWidth - 110 },
    });

    autoTable(doc, {
      startY: 32,
      head: [["Destination", "Shipments", "Pallets", "Delivered"]],
      body: africaDestinationAnalytics.map((row) => [row.country, String(row.shipments), String(row.pallets), String(row.delivered)]),
      theme: "grid",
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: "bold" },
      margin: { left: 118, right: 14 },
    });

    autoTable(doc, {
      startY: 104,
      head: [["Reference", "Africa Client", "Country", "Status", "HS Code", "Incoterm", "Pallets", "Agent Check", "Doc Readiness"]],
      body: africaExportRows.map((row) => [
        row.Reference,
        row["Africa Client"],
        row["Destination Country"],
        row.Status,
        row["HS Code"],
        row.Incoterm,
        String(row.Pallets),
        row["Agent Check"],
        row["Document Readiness"],
      ]),
      theme: "grid",
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
      bodyStyles: { fontSize: 7, textColor: [30, 41, 59] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { lineColor: [226, 232, 240], lineWidth: 0.15, overflow: "linebreak" },
      margin: { left: 14, right: 14 },
      didDrawPage: () => {
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setTextColor(148, 163, 184);
        doc.setFontSize(6.5);
        doc.text("K58 Dispatch", 14, pageHeight - 5);
        doc.text(`Generated ${generatedDate}`, pageWidth / 2, pageHeight - 5, { align: "center" });
        doc.text(`Page ${(doc as any).internal.getCurrentPageInfo().pageNumber}`, pageWidth - 14, pageHeight - 5, { align: "right" });
      },
    });

    const fileDate = new Date().toISOString().split("T")[0];
    doc.save(`africa-export-analytics-${timeRange}-${fileDate}.pdf`);
  };

  const jobsTimeline = useMemo(() => {
    const timeline: Record<string, { date: string; created: number; delivered: number }> = {};

    filteredJobs.forEach((job) => {
      const createdDate = new Date(job.createdAt).toISOString().split("T")[0];
      if (!timeline[createdDate]) {
        timeline[createdDate] = { date: createdDate, created: 0, delivered: 0 };
      }
      timeline[createdDate].created++;

      if (job.status === "delivered" && job.actualDeliveryAt) {
        const deliveredDate = new Date(job.actualDeliveryAt).toISOString().split("T")[0];
        if (!timeline[deliveredDate]) {
          timeline[deliveredDate] = { date: deliveredDate, created: 0, delivered: 0 };
        }
        timeline[deliveredDate].delivered++;
      }
    });

    return Object.values(timeline).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredJobs]);

  // 5. Warehouse Distribution
  const warehouseDistribution = useMemo(() => {
    const distribution: Record<string, number> = {};

    filteredJobs.forEach((job) => {
      const warehouse = job.warehouse || "Unknown";
      distribution[warehouse] = (distribution[warehouse] || 0) + 1;
    });

    return Object.entries(distribution).map(([warehouse, count]) => ({
      warehouse,
      count,
    }));
  }, [filteredJobs]);

  // 6. Items Picked This Week (daily breakdown using ALL jobs, not deduplicated)
  // Picking Required vs Actually Picked per ETD/ETA date this week
  const itemsPickedThisWeek = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
    startOfWeek.setHours(0, 0, 0, 0);

    const days: { day: string; required: number; picked: number }[] = [];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const orderJobs = jobs.filter((j) => j.jobType === "order" || j.jobType === undefined);

    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      let required = 0;
      let picked = 0;
      orderJobs.forEach((j) => {
        const jobDate = (j.etd || j.eta || "").split("T")[0];
        if (jobDate === dateKey && j.status !== "cancelled") {
          required++;
          if (j.orderPicked) picked++;
        }
      });

      days.push({ day: `${dayNames[i]} ${d.getDate()}`, required, picked });
    }
    return days;
  }, [jobs]);



  // Key Performance Indicators
  const kpis = useMemo(() => {
    const totalJobs = filteredJobs.length;
    const deliveredJobs = filteredJobs.filter((j) => j.status === "delivered").length;
    const exceptionsCount = filteredJobs.filter((j) => j.status === "exception").length;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueJobs = filteredJobs.filter((j) => (
      j.eta &&
      j.status !== "delivered" &&
      j.status !== "cancelled" &&
      j.status !== "exception" &&
      new Date(j.eta) < today
    )).length;
    const deliveryRateBase = deliveredJobs + overdueJobs;
    const deliveryRate = deliveryRateBase > 0 ? Math.round((deliveredJobs / deliveryRateBase) * 100) : 0;
    const exceptionRate = totalJobs > 0 ? Math.round((exceptionsCount / totalJobs) * 100) : 0;

    return {
      totalJobs,
      deliveredJobs,
      deliveryRate,
      overdueJobs,
      exceptionsCount,
      exceptionRate,
      activeTransporters: drivers.filter((d) => d.status !== "offline").length,
      missingPalletQty: missingPalletAssignments.length,
    };
  }, [filteredJobs, drivers, missingPalletAssignments]);

  const drilldownJobs = useMemo(() => {
    if (activeKpiDrilldown === "delivered") {
      return filteredJobs.filter((job) => job.status === "delivered");
    }
    if (activeKpiDrilldown === "exceptions") {
      return filteredJobs.filter((job) => job.status === "exception");
    }
    if (activeKpiDrilldown === "total") return filteredJobs;
    return [];
  }, [activeKpiDrilldown, filteredJobs]);

  const drilldownTitle =
    activeKpiDrilldown === "delivered" ? "Delivered Orders" :
    activeKpiDrilldown === "exceptions" ? "Exception Orders" :
    activeKpiDrilldown === "total" ? "All Orders" :
    "";

  const scrollToRef = (ref: React.RefObject<HTMLDivElement>) => {
    window.setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  const openJobDrilldown = (key: KpiDrilldownKey) => {
    setActiveKpiDrilldown(key);
    scrollToRef(drilldownRef);
  };

  return (
    <div className="space-y-4">
      {/* Header — compact with filters inline */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500">
            Performance insights • {kpis.totalJobs} jobs • {reportPeriodLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedWarehouse} onChange={(e) => setSelectedWarehouse(e.target.value)} className="w-auto text-sm">
            <option value="all">All Warehouses</option>
            {warehouses.map((wh) => <option key={wh} value={wh}>{wh}</option>)}
          </Select>
          <Select value={timeRange} onChange={(e) => setTimeRange(e.target.value as TimeRange)} className="w-auto text-sm">
            <option value="7d">7 Days</option>
            <option value="30d">30 Days</option>
            <option value="90d">90 Days</option>
            <option value="current-month">Current Month</option>
            <option value="previous-month">Previous Month</option>
            <option value="all">All Time</option>
          </Select>
        </div>
      </div>

      {/* KPI Strip — tighter, stronger hierarchy */}
      <div className="grid gap-3 grid-cols-3 lg:grid-cols-7">
        {([
          { icon: Package, label: "Total Jobs", value: String(kpis.totalJobs), color: "text-gray-900", iconColor: "text-resilinc-primary", bg: "bg-green-50", onClick: () => openJobDrilldown("total"), disabled: kpis.totalJobs === 0 },
          { icon: TrendingUp, label: "Delivered", value: String(kpis.deliveredJobs), color: "text-green-600", iconColor: "text-green-600", bg: "bg-green-50", onClick: () => openJobDrilldown("delivered"), disabled: kpis.deliveredJobs === 0 },
          { icon: BarChart3, label: "Due Delivery Rate", value: `${kpis.deliveryRate}%`, color: "text-green-600", iconColor: "text-green-600", bg: "bg-green-50" },
          { icon: Calendar, label: "Exceptions", value: String(kpis.exceptionsCount), color: "text-red-600", iconColor: "text-red-600", bg: "bg-red-50", onClick: () => openJobDrilldown("exceptions"), disabled: kpis.exceptionsCount === 0 },
          { icon: PieChartIcon, label: "Exception Rate", value: `${kpis.exceptionRate}%`, color: "text-amber-600", iconColor: "text-amber-600", bg: "bg-amber-50" },
          { icon: Truck, label: "Transporters", value: String(kpis.activeTransporters), color: "text-gray-900", iconColor: "text-gray-600", bg: "bg-gray-100", onClick: () => scrollToRef(transporterMetricsRef), disabled: transporterMetrics.length === 0 },
          { icon: Package, label: "Missing Pallets", value: String(kpis.missingPalletQty), color: kpis.missingPalletQty > 0 ? "text-red-600" : "text-gray-900", iconColor: kpis.missingPalletQty > 0 ? "text-red-600" : "text-gray-600", bg: kpis.missingPalletQty > 0 ? "bg-red-50" : "bg-gray-100", onClick: () => scrollToRef(missingPalletsRef), disabled: kpis.missingPalletQty === 0 },
        ] as const).map((kpi) => {
          const Icon = kpi.icon;
          const content = (
              <div className="flex items-center gap-2.5">
                <div className={`rounded-lg p-1.5 ${kpi.bg}`}>
                  <Icon className={`h-4 w-4 ${kpi.iconColor}`} />
                </div>
                <div>
                  <div className={`text-xl font-bold leading-tight ${kpi.color}`}>{kpi.value}</div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{kpi.label}</div>
                </div>
              </div>
          );

          if ("onClick" in kpi && !kpi.disabled) {
            return (
              <button
                key={kpi.label}
                type="button"
                onClick={kpi.onClick}
                className="rounded-card border border-gray-200 bg-white p-3 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-resilinc-primary focus-visible:ring-offset-2"
                title={`View ${kpi.label.toLowerCase()}`}
              >
                {content}
              </button>
            );
          }

          return (
            <Card key={kpi.label} className="p-3">
              {content}
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Globe2 className="h-5 w-5 text-emerald-600" />
                Africa Export Analytics
              </CardTitle>
              <p className="text-xs text-gray-400 mt-0.5">
                Independent Africa export shipments for {reportPeriodLabel}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={exportAfricaAnalyticsPdf}
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={scopedAfricaExports.length === 0}
              >
                <FileText className="h-4 w-4" />
                PDF
              </Button>
              <Button
                onClick={exportAfricaAnalyticsExcel}
                size="sm"
                className="gap-2"
                disabled={scopedAfricaExports.length === 0}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Excel
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-6">
            {[
              { label: "Exports", value: africaExportKpis.total, color: "text-emerald-700", bg: "bg-emerald-50" },
              { label: "Assigned / Transit", value: africaExportKpis.assigned, color: "text-blue-700", bg: "bg-blue-50" },
              { label: "Pending", value: africaExportKpis.pending, color: "text-amber-700", bg: "bg-amber-50" },
              { label: "Delivered", value: africaExportKpis.delivered, color: "text-green-700", bg: "bg-green-50" },
              { label: "Pallets", value: africaExportKpis.pallets, color: "text-gray-900", bg: "bg-gray-100" },
              { label: "No Agent Check", value: africaExportKpis.missingAgentChecks, color: africaExportKpis.missingAgentChecks > 0 ? "text-red-700" : "text-gray-900", bg: africaExportKpis.missingAgentChecks > 0 ? "bg-red-50" : "bg-gray-100" },
            ].map((item) => (
              <div key={item.label} className={`${item.bg} rounded-lg p-3`}>
                <div className={`text-xl font-bold ${item.color}`}>{item.value}</div>
                <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2">
                <h3 className="text-sm font-semibold text-gray-900">Destination Volume</h3>
                <p className="text-xs text-gray-400">Shipments and pallets by Africa country</p>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={africaDestinationAnalytics} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis dataKey="country" type="category" tick={{ fontSize: 10 }} width={118} />
                  <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #E5E7EB", borderRadius: "8px" }} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="shipments" fill={COLORS.success} name="Shipments" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="pallets" fill={COLORS.warning} name="Pallets" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2">
                <h3 className="text-sm font-semibold text-gray-900">Export Status Trend</h3>
                <p className="text-xs text-gray-400">ETA/check-date trend for exports and delivered shipments</p>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={africaExportTimeline}>
                  <defs>
                    <linearGradient id="colorAfricaExports" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={COLORS.success} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorAfricaDelivered" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #E5E7EB", borderRadius: "8px" }} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Area type="monotone" dataKey="exports" stroke={COLORS.success} fillOpacity={1} fill="url(#colorAfricaExports)" name="Exports" />
                  <Area type="monotone" dataKey="delivered" stroke={COLORS.primary} fillOpacity={1} fill="url(#colorAfricaDelivered)" name="Delivered" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2">
                <h3 className="text-sm font-semibold text-gray-900">Status Load</h3>
                <p className="text-xs text-gray-400">Shipment count and pallet load by export status</p>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={africaStatusAnalytics}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #E5E7EB", borderRadius: "8px" }} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="shipments" fill={COLORS.success} name="Shipments" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="pallets" fill={COLORS.primary} name="Pallets" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2">
                <h3 className="text-sm font-semibold text-gray-900">Document & Agent Checks</h3>
                <p className="text-xs text-gray-400">Exports still needing document completion or destination agent confirmation</p>
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Reference</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Country</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-700">Agent Check</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-700">Docs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {africaDocumentRiskRows.slice(0, 8).map((shipment) => (
                      <tr key={shipment.ref} className="border-b border-gray-100">
                        <td className="px-3 py-2 font-medium text-resilinc-primary">{shipment.ref}</td>
                        <td className="px-3 py-2 text-gray-700">{shipment.destinationCountry || "To confirm"}</td>
                        <td className="px-3 py-2 text-gray-700">{shipment.lastCheckedAt || "Not done"}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{shipment.readiness}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {africaDocumentRiskRows.length === 0 && (
                  <div className="py-8 text-center text-sm text-gray-400">No document or agent check gaps for this period.</div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {activeKpiDrilldown && (
        <div ref={drilldownRef}>
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>{drilldownTitle}</CardTitle>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {drilldownJobs.length} orders for {reportPeriodLabel}
                    {selectedWarehouse !== "all" ? ` â€¢ ${selectedWarehouse}` : ""}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setActiveKpiDrilldown(null)}>
                  Close
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Reference</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Customer</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Transporter</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Date</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700">Pallets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldownJobs.map((job) => (
                      <tr key={job.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedJob(job)}
                            className="font-medium text-resilinc-primary hover:text-resilinc-primary-dark hover:underline"
                            title="View order details"
                          >
                            {job.ref}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{job.customer}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            job.status === "delivered" ? "bg-green-50 text-green-700" :
                            job.status === "exception" ? "bg-red-50 text-red-700" :
                            job.status === "pending" ? "bg-amber-50 text-amber-700" :
                            "bg-blue-50 text-blue-700"
                          }`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {job.driverId ? drivers.find((driver) => driver.id === job.driverId)?.name || "Unknown" : "Unassigned"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{formatDate(job.etd || job.eta || job.createdAt)}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{job.pallets ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {drilldownJobs.length === 0 && (
                  <div className="py-10 text-center text-sm text-gray-400">
                    No orders found for this KPI in the selected filter.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Row 1: Hero Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Transporter Workload & Delivery */}
        <Card>
          <CardHeader>
            <CardTitle>Transporter Workload</CardTitle>
            <p className="text-xs text-gray-400 mt-0.5">Delivered vs assigned/en-route + pallet load per transporter</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={transporterMetrics}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #E5E7EB", borderRadius: "8px" }} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar dataKey="completedJobs" fill={COLORS.success} name="Delivered" radius={[3, 3, 0, 0]} />
                <Bar dataKey="inProgress" fill={COLORS.warning} name="Assigned / En Route" radius={[3, 3, 0, 0]} />
                <Bar dataKey="palletsLoaded" fill={COLORS.primary} name="Pallets" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Job Status Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Job Status Trend</CardTitle>
            <p className="text-xs text-gray-400 mt-0.5">Daily jobs created vs delivered</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={jobsTimeline}>
                <defs>
                  <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorDelivered" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.8} />
                    <stop offset="95%" stopColor={COLORS.success} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #E5E7EB", borderRadius: "8px" }} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Area type="monotone" dataKey="created" stroke={COLORS.primary} fillOpacity={1} fill="url(#colorCreated)" name="Created" />
                <Area type="monotone" dataKey="delivered" stroke={COLORS.success} fillOpacity={1} fill="url(#colorDelivered)" name="Delivered" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Supporting Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Picking Progress This Week */}
        <Card>
          <CardHeader>
            <CardTitle>Picking Progress This Week</CardTitle>
            <p className="text-xs text-gray-400 mt-0.5">Picking required vs actually picked per ETD/ETA date</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={itemsPickedThisWeek}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #E5E7EB", borderRadius: "8px" }} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Bar dataKey="required" fill="#94A3B8" name="Required" radius={[3, 3, 0, 0]} />
                <Bar dataKey="picked" fill={COLORS.success} name="Picked" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Warehouse Volume — bar chart instead of donut */}
        <Card>
          <CardHeader>
            <CardTitle>Warehouse Volume</CardTitle>
            <p className="text-xs text-gray-400 mt-0.5">Orders per warehouse location</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={warehouseDistribution} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="warehouse" type="category" tick={{ fontSize: 10 }} width={120} />
                <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #E5E7EB", borderRadius: "8px" }} />
                <Bar dataKey="count" fill={COLORS.primary} name="Orders" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Exceptions & Bottlenecks */}
      <Card>
        <CardHeader>
          <CardTitle>Exceptions & Bottlenecks</CardTitle>
          <p className="text-xs text-gray-400 mt-0.5">Orders that need attention right now</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-6">
            {(() => {
              const now = new Date(); now.setHours(0, 0, 0, 0);
              const overdue = filteredJobs.filter(j => j.eta && j.status !== "delivered" && j.status !== "cancelled" && new Date(j.eta) < now).length;
              const unassigned = filteredJobs.filter(j => !j.driverId && j.status === "pending").length;
              const missingCoa = filteredJobs.filter(j => j.orderPicked && !j.coaAvailable && j.status !== "delivered" && j.status !== "cancelled").length;
              const noTransporter = filteredJobs.filter(j => !j.transporterBooked && j.status !== "delivered" && j.status !== "cancelled" && j.status !== "pending").length;
              const overCapacity = transporterMetrics.filter(m => m.peakUtilization > 100).length;
              const missingPallets = missingPalletAssignments.length;
              return [
                { label: "Overdue Orders", value: overdue, color: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
                { label: "Unassigned Orders", value: unassigned, color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200" },
                { label: "Missing COA", value: missingCoa, color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
                { label: "No Transporter Booked", value: noTransporter, color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-200" },
                { label: "Over Capacity", value: overCapacity, color: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
                { label: "Missing Pallets", value: missingPallets, color: "text-red-600", bg: "bg-red-50", border: "border-red-200" },
              ].map((item) => (
                <div key={item.label} className={`${item.bg} ${item.border} border rounded-xl p-4 text-center`}>
                  <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
                  <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mt-1">{item.label}</div>
                </div>
              ));
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Missing Pallet Qty Fixes */}
      {missingPalletAssignments.length > 0 && (
        <div ref={missingPalletsRef}>
        <Card>
          <CardHeader>
            <CardTitle>Assigned Orders Missing Pallet Qty</CardTitle>
            <p className="text-xs text-gray-400 mt-0.5">
              Transporter is assigned, but no pallet quantity is captured for the order
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Reference</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Customer</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Transporter</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Date</th>
                    <th className="px-4 py-3 text-center font-semibold text-gray-700">Line Items</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700">Pallet Qty</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {missingPalletAssignments.map((item) => {
                    const draft = palletDrafts[item.ref] || "";
                    const canSave = Number(draft) > 0 && savingPalletRef !== item.ref;
                    return (
                      <tr key={`${item.ref}-${item.driverName}`} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => openMissingPalletOrder(item.ids)}
                            className="font-medium text-resilinc-primary hover:text-resilinc-primary-dark hover:underline"
                            title="View order details"
                          >
                            {item.ref}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{item.customer}</td>
                        <td className="px-4 py-3 text-gray-700">{item.driverName}</td>
                        <td className="px-4 py-3 text-gray-700">{formatDate(item.etd || item.eta)}</td>
                        <td className="px-4 py-3 text-center text-gray-700">{item.lineItems}</td>
                        <td className="px-4 py-3">
                          <Input
                            type="number"
                            min="1"
                            step="1"
                            value={draft}
                            onChange={(event) => setPalletDrafts((prev) => ({ ...prev, [item.ref]: event.target.value }))}
                            className="ml-auto h-9 w-24 text-right text-sm"
                            placeholder="0"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            onClick={() => saveMissingPalletQty(item.ref, item.ids)}
                            disabled={!canSave}
                          >
                            {savingPalletRef === item.ref ? "Saving" : "Save"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        </div>
      )}

      {/* Row 4: Capacity Planning */}
      <Card>
        <CardHeader>
          <CardTitle>Capacity Planning</CardTitle>
          <p className="text-xs text-gray-400 mt-0.5">Peak day pallet load vs daily capacity per transporter</p>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={transporterMetrics}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #E5E7EB", borderRadius: "8px" }} formatter={(value: number) => [`${value} plt`]} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              <Bar dataKey="peakDayPallets" fill={COLORS.warning} name="Peak Day Load" radius={[3, 3, 0, 0]} />
              <Bar dataKey="capacity" fill={COLORS.primary} name="Daily Capacity" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detailed Transporter Table */}
      <div ref={transporterMetricsRef}>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Detailed Transporter Metrics</CardTitle>
              <p className="text-xs text-gray-400 mt-0.5">
                Performance and daily capacity utilization by transporter • {reportPeriodLabel} • Pulled at {pulledAtLabel}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={exportTransporterMetricsPdf}
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={transporterMetrics.length === 0}
              >
                <FileText className="h-4 w-4" />
                PDF
              </Button>
              <Button
                onClick={exportTransporterMetricsExcel}
                size="sm"
                className="gap-2"
                disabled={transporterMetrics.length === 0}
              >
                <FileSpreadsheet className="h-4 w-4" />
                Excel
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Transporter</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Orders</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Delivered</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">In Transit</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Total Pallets</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Daily Capacity</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Peak Day</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Peak Utilization</th>
                </tr>
              </thead>
              <tbody>
                {transporterMetrics.map((metric) => (
                  <tr key={metric.driverId} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedTransporterId(metric.driverId)}
                        className="font-medium text-resilinc-primary hover:text-resilinc-primary-dark hover:underline"
                        title="View transporter jobs for this filter"
                      >
                        {metric.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700">{metric.totalJobs}</td>
                    <td className="px-4 py-3 text-center text-green-600 font-semibold">{metric.completedJobs}</td>
                    <td className="px-4 py-3 text-center text-blue-600">{metric.inProgress}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{metric.palletsLoaded}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{metric.capacity} plt/day</td>
                    <td className="px-4 py-3 text-center">
                      {metric.peakDayDate ? (
                        <div>
                          <span className="font-medium text-gray-900">{metric.peakDayPallets} plt</span>
                          <span className="text-[10px] text-gray-400 block">{metric.peakDayDate}</span>
                        </div>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-bold ${
                        metric.peakUtilization > 100 ? "text-red-600" :
                        metric.peakUtilization >= 80 ? "text-amber-600" :
                        "text-green-600"
                      }`}>
                        {metric.peakUtilization}%
                      </span>
                      {metric.peakUtilization > 100 && (
                        <span className="text-[10px] text-red-500 block">Over capacity</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      </div>

      {selectedTransporterId && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>{selectedTransporterName} Jobs</CardTitle>
                <p className="text-xs text-gray-400 mt-0.5">
                  {selectedTransporterJobs.length} orders for {reportPeriodLabel}
                  {selectedWarehouse !== "all" ? ` • ${selectedWarehouse}` : ""}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSelectedTransporterId(null)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Reference</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Customer</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Date</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-700">Pallets</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-700">Warehouse</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTransporterJobs.map((job) => (
                    <tr key={job.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedJob(job)}
                          className="font-medium text-resilinc-primary hover:text-resilinc-primary-dark hover:underline"
                          title="View order details"
                        >
                          {job.ref}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{job.customer}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          job.status === "delivered" ? "bg-green-50 text-green-700" :
                          job.status === "exception" ? "bg-red-50 text-red-700" :
                          job.status === "pending" ? "bg-amber-50 text-amber-700" :
                          "bg-blue-50 text-blue-700"
                        }`}>
                          {job.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(job.etd || job.eta || job.createdAt)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{job.pallets ?? "-"}</td>
                      <td className="px-4 py-3 text-gray-700">{job.warehouse || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {selectedTransporterJobs.length === 0 && (
                <div className="py-10 text-center text-sm text-gray-400">
                  No jobs found for this transporter in the selected filter.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedJob && (
        <JobDetailsModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onSelectLineItem={(lineItem) => setSelectedJob(lineItem)}
          driverName={selectedJob.driverId ? drivers.find((driver) => driver.id === selectedJob.driverId)?.name : undefined}
        />
      )}
    </div>
  );
};
