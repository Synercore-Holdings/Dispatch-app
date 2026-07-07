// src/components/views/HistoryView.tsx
import React, { useMemo, useState } from "react";
import { Clock, Search, Download, Calendar as CalendarIcon, CheckCircle2, XCircle, FileText, Package, RotateCcw } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useDispatch } from "../../context/DispatchContext";
import { TRUCK_SIZES, Job } from "../../types";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { Input } from "../ui/Input";
import { JobDetailsModal } from "../JobDetailsModal";
import * as XLSX from "../../lib/spreadsheet";
import { formatDate as formatDisplayDate, formatDateTime, formatNumber } from "../../utils/format";

type HistoryFilter = "all" | "delivered" | "returned" | "cancelled";

// Helper: get ISO week number
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getHistoryDate(job: Job): Date {
  return new Date(job.status === "returned" ? job.returnedAt || job.updatedAt : job.actualDeliveryAt || job.updatedAt);
}

export const HistoryView: React.FC = () => {
  const { jobs, drivers } = useDispatch();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<HistoryFilter>("all");
  const [selectedTransporter, setSelectedTransporter] = useState<string>("all");
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>("all");
  const [selectedWeek, setSelectedWeek] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("30d");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  // Get unique warehouses
  const warehouses = useMemo(() => {
    const uniqueWarehouses = new Set<string>();
    jobs.forEach((job) => {
      if (job.warehouse) uniqueWarehouses.add(job.warehouse);
    });
    return Array.from(uniqueWarehouses).sort();
  }, [jobs]);

  // Get available weeks from completed jobs
  const availableWeeks = useMemo(() => {
    const weekSet = new Map<string, string>(); // value -> label
    jobs
      .filter((j) => j.status === "delivered" || j.status === "returned" || j.status === "cancelled")
      .forEach((job) => {
        const date = getHistoryDate(job);
        const weekNum = getWeekNumber(date);
        const year = date.getFullYear();
        const value = `${year}-W${String(weekNum).padStart(2, "0")}`;
        const label = `Week ${weekNum}, ${year}`;
        weekSet.set(value, label);
      });
    return Array.from(weekSet.entries())
      .sort((a, b) => b[0].localeCompare(a[0])) // newest first
      .map(([value, label]) => ({ value, label }));
  }, [jobs]);

  // Filter completed/cancelled jobs
  const completedJobs = useMemo(() => {
    let filtered = jobs.filter(
      (job) => job.status === "delivered" || job.status === "returned" || job.status === "cancelled"
    );

    // Status filter
    if (statusFilter === "delivered") {
      filtered = filtered.filter((job) => job.status === "delivered");
    } else if (statusFilter === "returned") {
      filtered = filtered.filter((job) => job.status === "returned");
    } else if (statusFilter === "cancelled") {
      filtered = filtered.filter((job) => job.status === "cancelled");
    }

    // Transporter filter
    if (selectedTransporter !== "all") {
      filtered = filtered.filter((job) => job.driverId === selectedTransporter);
    }

    // Warehouse filter
    if (selectedWarehouse !== "all") {
      filtered = filtered.filter((job) => job.warehouse === selectedWarehouse);
    }

    // Week filter
    if (selectedWeek !== "all") {
      filtered = filtered.filter((job) => {
        const date = getHistoryDate(job);
        const weekNum = getWeekNumber(date);
        const year = date.getFullYear();
        const jobWeek = `${year}-W${String(weekNum).padStart(2, "0")}`;
        return jobWeek === selectedWeek;
      });
    }

    // Date filter (only when week filter is not active)
    if (selectedWeek === "all") {
      const now = new Date();
      if (dateFilter === "custom" && startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        filtered = filtered.filter((job) => {
          const completedDate = getHistoryDate(job);
          return completedDate >= start && completedDate <= end;
        });
      } else if (dateFilter !== "all") {
        let daysBack = 0;
        if (dateFilter === "7d") daysBack = 7;
        else if (dateFilter === "30d") daysBack = 30;
        else if (dateFilter === "90d") daysBack = 90;

        if (daysBack > 0) {
          const cutoffDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
          filtered = filtered.filter((job) => {
            const completedDate = getHistoryDate(job);
            return completedDate >= cutoffDate;
          });
        }
      }
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((job) => {
        const searchableText = [
          job.ref,
          job.customer,
          job.pickup,
          job.dropoff,
          job.warehouse || "",
          job.notes || "",
        ]
          .join(" ")
          .toLowerCase();
        return searchableText.includes(query);
      });
    }

    // Deduplicate by ref — keep first occurrence, aggregate pallets/qty
    const refMap = new Map<string, typeof filtered[0]>();
    filtered.forEach((job) => {
      const existing = refMap.get(job.ref);
      if (!existing) {
        refMap.set(job.ref, { ...job });
      } else {
        // Pallets are order-level; quantity is line-level.
        if (job.pallets) existing.pallets = Math.max(existing.pallets || 0, job.pallets);
        if (job.outstandingQty) existing.outstandingQty = (existing.outstandingQty || 0) + job.outstandingQty;
        // Keep the most recent notes if current one is empty
        if (job.notes && !existing.notes) existing.notes = job.notes;
      }
    });
    const deduped = Array.from(refMap.values());

    // Sort by completion date (most recent first)
    return deduped.sort((a, b) => {
      const dateA = getHistoryDate(a).getTime();
      const dateB = getHistoryDate(b).getTime();
      return dateB - dateA;
    });
  }, [
    jobs,
    statusFilter,
    selectedTransporter,
    selectedWarehouse,
    selectedWeek,
    dateFilter,
    startDate,
    endDate,
    searchQuery,
  ]);

  // Calculate statistics
  const stats = useMemo(() => {
    const delivered = completedJobs.filter((j) => j.status === "delivered").length;
    const returned = completedJobs.filter((j) => j.status === "returned").length;
    const cancelled = completedJobs.filter((j) => j.status === "cancelled").length;
    const total = completedJobs.length;
    const successRate = total > 0 ? Math.round((delivered / total) * 100) : 0;

    const totalPallets = completedJobs.reduce((sum, job) => sum + (job.pallets || 0), 0);

    // Qty picked: count of line items with orderPicked checked (picked from warehouse)
    const qtyPicked = completedJobs.filter((j) => j.orderPicked).length;

    const deliveredWithDates = completedJobs.filter(
      (j) => j.status === "delivered" && j.actualDeliveryAt
    );
    let avgDeliveryTime = 0;
    if (deliveredWithDates.length > 0) {
      const totalHours = deliveredWithDates.reduce((sum, job) => {
        const created = new Date(job.createdAt).getTime();
        const deliveredAt = new Date(job.actualDeliveryAt!).getTime();
        return sum + (deliveredAt - created) / (1000 * 60 * 60);
      }, 0);
      avgDeliveryTime = Math.round(totalHours / deliveredWithDates.length);
    }

    return {
      total,
      delivered,
      returned,
      cancelled,
      successRate,
      totalPallets,
      qtyPicked,
      avgDeliveryTime,
    };
  }, [completedJobs]);

  const getTruckSizeLabel = (size?: string) => {
    if (!size) return "—";
    return TRUCK_SIZES.find((ts) => ts.value === size)?.label || size;
  };

  // Export to Excel
  const exportToExcel = async () => {
    const data = completedJobs.map((job) => {
      const completedDate = getHistoryDate(job);
      return {
        Reference: job.ref,
        Customer: job.customer,
        Status: job.status,
        Priority: job.priority,
        Pickup: job.pickup,
        Dropoff: job.dropoff,
        Warehouse: job.warehouse || "N/A",
        Transporter: job.driverId
          ? drivers.find((d) => d.id === job.driverId)?.name || "Unknown"
          : "Unassigned",
        "Transport Type": getTruckSizeLabel(job.truckSize),
        Pallets: job.pallets || 0,
        "Outstanding Qty": job.outstandingQty || 0,
        "Line Items": job.notes || "",
        "Week Number": `W${getWeekNumber(completedDate)}`,
        "Created Date": formatDateTime(job.createdAt),
        "Completed Date": formatDateTime(completedDate),
        ETA: job.eta || "N/A",
        "Returned Date": job.returnedAt || "",
        "Return Reason": job.returnReason || "",
        "Returned Pallets": job.returnedPallets ?? "",
        "Return Notes": job.returnNotes || "",
      };
    });

    const weekSuffix = selectedWeek !== "all" ? `-${selectedWeek}` : "";
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "History");
    await XLSX.writeFile(workbook, `job-history${weekSuffix}-${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // Export to PDF
  const exportToPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw = doc.internal.pageSize.getWidth();
    const weekLabel = selectedWeek !== "all"
      ? availableWeeks.find((w) => w.value === selectedWeek)?.label || selectedWeek
      : "All Weeks";
    const reportDate = formatDisplayDate(new Date());

    // --- Header bar ---
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pw, 24, "F");
    // Thin accent line below header (subtle)
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 24, pw, 0.4, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("K58 Dispatch", 14, 10);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(148, 163, 184);
    doc.text("Job History Report", 14, 17);

    // Right side metadata
    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225);
    doc.text(`Period: ${weekLabel}`, pw - 14, 10, { align: "right" });
    doc.text(`Generated: ${reportDate}`, pw - 14, 16, { align: "right" });

    // --- KPI Cards ---
    const cardY = 28;
    const cardH = 15;
    const gap = 4;
    const cardW = (pw - 28 - gap * 7) / 8;
    const cards: { label: string; value: string; color: number[] }[] = [
      { label: "Total Jobs", value: String(stats.total), color: [15, 23, 42] },
      { label: "Delivered", value: String(stats.delivered), color: [22, 163, 74] },
      { label: "Returned", value: String(stats.returned), color: [217, 119, 6] },
      { label: "Cancelled", value: String(stats.cancelled), color: [220, 38, 38] },
      { label: "Success Rate", value: `${stats.successRate}%`, color: [15, 23, 42] },
      { label: "Total Pallets", value: String(stats.totalPallets), color: [15, 23, 42] },
      { label: "Items Picked", value: formatNumber(stats.qtyPicked), color: [15, 23, 42] },
      { label: "Avg Delivery Time", value: `${stats.avgDeliveryTime}h`, color: [15, 23, 42] },
    ];

    cards.forEach((card, i) => {
      const x = 14 + i * (cardW + gap);
      // Card background
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, cardY, cardW, cardH, 1.5, 1.5, "F");
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, cardY, cardW, cardH, 1.5, 1.5, "S");
      // Value
      doc.setTextColor(card.color[0], card.color[1], card.color[2]);
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text(card.value, x + cardW / 2, cardY + 7, { align: "center" });
      // Label
      doc.setTextColor(71, 85, 105);
      doc.setFontSize(5.5);
      doc.setFont("helvetica", "bold");
      doc.text(card.label.toUpperCase(), x + cardW / 2, cardY + 12, { align: "center" });
    });

    // --- Table ---
    const tableData = completedJobs.map((job) => {
      const completedDate = getHistoryDate(job);
      return [
        job.ref,
        job.customer,
        job.status === "delivered" ? "Delivered" : job.status === "returned" ? "Returned" : "Cancelled",
        `${job.pickup} > ${job.dropoff}`,
        job.warehouse || "—",
        job.driverId ? drivers.find((d) => d.id === job.driverId)?.name || "Unknown" : "Unassigned",
        getTruckSizeLabel(job.truckSize),
        String(job.pallets || 0),
        job.notes || "—",
        `W${getWeekNumber(completedDate)}`,
        formatDisplayDate(completedDate),
      ];
    });

    autoTable(doc, {
      startY: cardY + cardH + 5,
      head: [["Ref", "Customer", "Status", "Route", "Warehouse", "Transporter", "Type", "Plt", "Line Items", "Wk", "Completed"]],
      body: tableData,
      theme: "grid",
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 6.5,
        cellPadding: 2.5,
        halign: "left",
      },
      bodyStyles: {
        fontSize: 6.5,
        cellPadding: 2,
        textColor: [30, 41, 59],
        valign: "middle",
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 20 },                          // Ref
        1: { cellWidth: 40 },                          // Customer (wider)
        2: { cellWidth: 18, halign: "center" },        // Status
        3: { cellWidth: 46 },                          // Route
        4: { cellWidth: 22 },                          // Warehouse
        5: { cellWidth: 28 },                          // Transporter
        6: { cellWidth: 16 },                          // Type (narrower)
        7: { cellWidth: 8, halign: "center" },         // Pallets (narrower)
        8: { cellWidth: 38 },                          // Line Items
        9: { cellWidth: 9, halign: "center" },         // Week (narrower)
        10: { cellWidth: 24 },                         // Completed
      },
      styles: {
        lineColor: [226, 232, 240],
        lineWidth: 0.15,
        overflow: "linebreak",
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        // Status badges: strong tint background with darker text
        if (data.section === "body" && data.column.index === 2) {
          const val = String(data.cell.raw);
          if (val === "Delivered") {
            data.cell.styles.textColor = [5, 122, 85];     // darker green
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fillColor = [220, 252, 231];  // consistent green tint
          } else if (val === "Returned") {
            data.cell.styles.textColor = [180, 83, 9];      // darker amber
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fillColor = [254, 243, 199];  // consistent amber tint
          } else if (val === "Cancelled") {
            data.cell.styles.textColor = [185, 28, 28];    // darker red
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.fillColor = [254, 226, 226];  // consistent red tint
          }
        }
        // Week column — standard dark text
        if (data.section === "body" && data.column.index === 9) {
          data.cell.styles.textColor = [51, 65, 85];
        }
      },
      didDrawPage: () => {
        const pageH = doc.internal.pageSize.getHeight();
        // Footer line
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.3);
        doc.line(14, pageH - 10, pw - 14, pageH - 10);
        // Footer text
        doc.setTextColor(148, 163, 184);
        doc.setFontSize(6.5);
        doc.setFont("helvetica", "normal");
        doc.text("K58 Dispatch — Confidential", 14, pageH - 5);
        doc.text(reportDate, pw / 2, pageH - 5, { align: "center" });
        doc.text(
          `Page ${(doc as any).internal.getCurrentPageInfo().pageNumber}`,
          pw - 14, pageH - 5, { align: "right" }
        );
      },
    });

    const weekSuffix = selectedWeek !== "all" ? `-${selectedWeek}` : "";
    doc.save(`dispatch-report${weekSuffix}-${new Date().toISOString().split("T")[0]}.pdf`);
  };

  const getDriverName = (driverId?: string) => {
    if (!driverId) return "Unassigned";
    return drivers.find((d) => d.id === driverId)?.name || "Unknown";
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return formatDateTime(date);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Clock className="h-8 w-8 text-resilinc-primary" />
              <h1 className="text-2xl font-bold text-gray-900">Job History</h1>
              {selectedWeek !== "all" && (
                <span className="ml-2 inline-flex items-center px-3 py-1 rounded-lg bg-blue-100 text-blue-700 text-sm font-semibold">
                  {availableWeeks.find((w) => w.value === selectedWeek)?.label}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500">View completed, returned, and cancelled jobs with detailed tracking</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={exportToPDF} className="gap-2 bg-slate-800 hover:bg-slate-900">
              <FileText className="h-4 w-4" />
              Export PDF
            </Button>
            <Button onClick={exportToExcel} className="gap-2">
              <Download className="h-4 w-4" />
              Export Excel
            </Button>
          </div>
        </div>
      </Card>

      {/* Week Number Banner */}
      {selectedWeek !== "all" && (
        <Card className="p-5 border-l-4 border-l-blue-600">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-resilinc-primary flex items-center justify-center">
                <span className="text-white font-bold text-xl">
                  W{selectedWeek.split("-W")[1]}
                </span>
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {availableWeeks.find((w) => w.value === selectedWeek)?.label}
                </h2>
                <p className="text-sm text-gray-500">
                  Viewing {stats.total} completed {stats.total === 1 ? "job" : "jobs"} for this week
                </p>
              </div>
            </div>
            <button
              onClick={() => setSelectedWeek("all")}
              className="text-sm text-gray-400 hover:text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Clear filter
            </button>
          </div>
        </Card>
      )}

      {/* Statistics Cards — intentional color system */}
      <div className="grid gap-3 grid-cols-3 lg:grid-cols-7">
        {([
          { icon: Clock, label: "Total Jobs", value: String(stats.total), color: "text-gray-900", iconColor: "text-resilinc-primary", bg: "bg-green-50" },
          { icon: CheckCircle2, label: "Delivered", value: String(stats.delivered), color: "text-green-600", iconColor: "text-green-600", bg: "bg-green-50" },
          { icon: RotateCcw, label: "Returned", value: String(stats.returned), color: "text-amber-600", iconColor: "text-amber-600", bg: "bg-amber-50" },
          { icon: XCircle, label: "Cancelled", value: String(stats.cancelled), color: "text-red-600", iconColor: "text-red-600", bg: "bg-red-50" },
          { icon: CalendarIcon, label: "Success Rate", value: `${stats.successRate}%`, color: "text-green-600", iconColor: "text-green-600", bg: "bg-green-50" },
          { icon: Package, label: "Total Pallets", value: String(stats.totalPallets), color: "text-gray-900", iconColor: "text-orange-600", bg: "bg-orange-50" },
          { icon: Package, label: "Items Picked", value: formatNumber(stats.qtyPicked), color: "text-gray-900", iconColor: "text-gray-600", bg: "bg-gray-100" },
          { icon: Clock, label: "Avg Delivery Time", value: `${stats.avgDeliveryTime}h`, color: "text-gray-900", iconColor: "text-purple-600", bg: "bg-purple-50" },
        ] as const).map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="p-3">
              <div className="flex items-center gap-2.5">
                <div className={`rounded-lg p-1.5 ${kpi.bg}`}>
                  <Icon className={`h-4 w-4 ${kpi.iconColor}`} />
                </div>
                <div>
                  <div className={`text-xl font-bold leading-tight ${kpi.color}`}>{kpi.value}</div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">{kpi.label}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Filters — compact inline */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search ref, customer, location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 h-9 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
          />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as HistoryFilter)} className="w-auto text-sm">
          <option value="all">All Status</option>
          <option value="delivered">Delivered</option>
          <option value="returned">Returned</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select value={selectedTransporter} onChange={(e) => setSelectedTransporter(e.target.value)} className="w-auto text-sm">
          <option value="all">All Transporters</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select value={selectedWarehouse} onChange={(e) => setSelectedWarehouse(e.target.value)} className="w-auto text-sm">
          <option value="all">All Warehouses</option>
          {warehouses.map((wh) => <option key={wh} value={wh}>{wh}</option>)}
        </Select>
        <Select value={selectedWeek} onChange={(e) => setSelectedWeek(e.target.value)} className="w-auto text-sm">
          <option value="all">All Weeks</option>
          {availableWeeks.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
        </Select>
        <Select value={selectedWeek !== "all" ? "all" : dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-auto text-sm" disabled={selectedWeek !== "all"}>
          <option value="7d">7 Days</option>
          <option value="30d">30 Days</option>
          <option value="90d">90 Days</option>
          <option value="all">All Time</option>
          <option value="custom">Custom</option>
        </Select>
        <span className="text-xs text-gray-500">{completedJobs.length} jobs</span>
      </div>

      {/* Custom Date Range */}
      {dateFilter === "custom" && selectedWeek === "all" && (
        <div className="flex items-center gap-2">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-auto text-sm" />
          <span className="text-gray-400">to</span>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-auto text-sm" />
        </div>
      )}

      {/* History Table */}
      <Card>
        <CardHeader>
          <CardTitle>
            Completed Jobs History
            {selectedWeek !== "all" && (
              <span className="ml-2 text-sm font-normal text-resilinc-primary">
                — {availableWeeks.find((w) => w.value === selectedWeek)?.label}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left p-3 font-semibold text-gray-700">Reference</th>
                  <th className="text-left p-3 font-semibold text-gray-700">Customer</th>
                  <th className="text-left p-3 font-semibold text-gray-700">Status</th>
                  <th className="text-left p-3 font-semibold text-gray-700">Route</th>
                  <th className="text-left p-3 font-semibold text-gray-700">Warehouse</th>
                  <th className="text-left p-3 font-semibold text-gray-700">Transporter</th>
                  <th className="text-left p-3 font-semibold text-gray-700">Transport Type</th>
                  <th className="text-left p-3 font-semibold text-gray-700">Pallets</th>
                  <th className="text-left p-3 font-semibold text-gray-700">Line Items</th>
                  <th className="text-left p-3 font-semibold text-gray-700">Week</th>
                  <th className="text-left p-3 font-semibold text-gray-700">Completed</th>
                </tr>
              </thead>
              <tbody>
                {completedJobs.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-12 text-gray-500">
                      No completed jobs found matching your filters
                    </td>
                  </tr>
                ) : (
                  completedJobs.map((job) => {
                    const completedDate = getHistoryDate(job);
                    return (
                      <tr key={job.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="p-3 font-medium">
                          <button
                            className="text-resilinc-primary hover:text-resilinc-primary-dark hover:underline cursor-pointer"
                            onClick={() => setSelectedJob(job)}
                          >
                            {job.ref}
                          </button>
                        </td>
                        <td className="p-3 text-gray-700">{job.customer}</td>
                        <td className="p-3">
                          <Badge variant={job.status === "delivered" ? "success" : job.status === "returned" ? "warning" : "destructive"}>
                            {job.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-gray-700 text-xs">
                          <div>{job.pickup}</div>
                          <div className="text-gray-400">→ {job.dropoff}</div>
                        </td>
                        <td className="p-3 text-gray-700 text-xs">{job.warehouse || "—"}</td>
                        <td className="p-3 text-gray-700">{getDriverName(job.driverId)}</td>
                        <td className="p-3 text-gray-700 text-xs">{getTruckSizeLabel(job.truckSize)}</td>
                        <td className="p-3 text-gray-700">
                          {job.pallets || 0}
                          {job.outstandingQty && (
                            <div className="text-[10px] text-orange-600">{formatNumber(job.outstandingQty)} qty</div>
                          )}
                        </td>
                        <td className="p-3 text-gray-700 text-xs max-w-[200px]">
                          <span className="truncate block" title={job.notes || "—"}>{job.notes || "—"}</span>
                        </td>
                        <td className="p-3 text-gray-700">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            W{getWeekNumber(completedDate)}
                          </span>
                        </td>
                        <td className="p-3 text-gray-600 text-xs">
                          {formatDate(getHistoryDate(job).toISOString())}
                          {job.status === "returned" && job.returnReason && (
                            <div className="mt-1 text-[10px] text-amber-700">Returned: {job.returnReason}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Job Details Modal */}
      {selectedJob && (
        <JobDetailsModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onSelectLineItem={(lineItem) => setSelectedJob(lineItem)}
          driverName={selectedJob.driverId ? drivers.find((d) => d.id === selectedJob.driverId)?.name : undefined}
        />
      )}
    </div>
  );
};
