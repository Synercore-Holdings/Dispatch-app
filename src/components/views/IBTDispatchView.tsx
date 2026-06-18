// src/components/views/IBTDispatchView.tsx
import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  closestCenter,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Truck, Briefcase, Plus, ArrowRightLeft, X, Save, Bell, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";

import { useDispatch } from "../../context/DispatchContext";
import { useNotification } from "../../context/NotificationContext";
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

import type { Job, Driver, JobPriority, JobStatus } from "../../types";

interface IBTDispatchViewProps {
  onOpenAlerts?: () => void;
}

export const IBTDispatchView: React.FC<IBTDispatchViewProps> = ({ onOpenAlerts }) => {
  const { jobs, drivers, updateJobs, updateDriver, addDriver, refreshData, filters, sortOptions } = useDispatch();
  const { showSuccess, showError, showWarning, confirm } = useNotification();

  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [selectedTransporter, setSelectedTransporter] = useState<Driver | null>(null);
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showAddJob, setShowAddJob] = useState(false);
  const [activeTab, setActiveTab] = useState<"open" | "assigned" | "in-transit" | "delivered">("open");
  const [selectedAlertDate, setSelectedAlertDate] = useState<string | null>(null);
  const [newJob, setNewJob] = useState({
    ref: "",
    customer: "",
    pickup: "",
    dropoff: "",
    warehouse: "",
    serviceType: "delivery" as "collection" | "delivery",
    priority: "normal" as JobPriority,
    pallets: undefined as number | undefined,
    outstandingQty: undefined as number | undefined,
    eta: "",
    notes: "",
  });

  // Filter to show only IBT jobs, deduplicated by ref,
  // and only jobs due within the selected ETA range when a range is selected.
  const ibtJobs = useMemo(() => {
    const allIbt = jobs.filter((job) => job.jobType === "ibt");

    // Deduplicate by ref - keep first occurrence, aggregate data
    const refMap = new Map<string, Job>();
    allIbt.forEach((job) => {
      const existing = refMap.get(job.ref);
      if (!existing) {
        refMap.set(job.ref, { ...job });
      } else {
        if (job.eta && (!existing.eta || job.eta < existing.eta)) existing.eta = job.eta;
        if (job.pallets) existing.pallets = Math.max(existing.pallets || 0, job.pallets);
        if (job.outstandingQty) existing.outstandingQty = (existing.outstandingQty || 0) + job.outstandingQty;
      }
    });

    if (filters.searchQuery && filters.searchQuery.trim()) {
      return Array.from(refMap.values());
    }

    const range = filters.etaRange || "5weeks";
    if (range === "all") {
      return Array.from(refMap.values());
    }

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfRange = new Date(startOfWeek);
    if (range === "3months") {
      endOfRange.setMonth(endOfRange.getMonth() + 3);
    } else if (range === "6months") {
      endOfRange.setMonth(endOfRange.getMonth() + 6);
    } else {
      endOfRange.setDate(endOfRange.getDate() + 5 * 7);
    }
    endOfRange.setHours(23, 59, 59, 999);

    return Array.from(refMap.values()).filter((job) => {
      if (!job.eta) return true;
      const etaDate = new Date(job.eta);
      return etaDate >= startOfWeek && etaDate <= endOfRange;
    });
  }, [jobs, filters.searchQuery, filters.etaRange]);

  // High volume IBT dates — current month + next 2 months. Counts distinct IBT refs, not lines.
  const busyDateAlerts = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfRange = new Date(now.getFullYear(), now.getMonth() + 3, 0);
    const dateRefs: Record<string, Set<string>> = {};
    jobs.forEach((j) => {
      if (j.jobType !== "ibt") return;
      if (!j.eta) return;
      if (j.status === "delivered" || j.status === "returned" || j.status === "cancelled") return;
      const dateKey = j.eta.split("T")[0];
      // Local-midnight parse (see DispatchView.busyDateAlerts comment).
      const d = new Date(`${dateKey}T00:00:00`);
      if (d < startOfMonth || d > endOfRange) return;
      if (!dateRefs[dateKey]) dateRefs[dateKey] = new Set();
      dateRefs[dateKey].add(j.ref || j.id);
    });
    return Object.entries(dateRefs)
      .filter(([, refs]) => refs.size >= 5)
      .map(([date, refs]) => ({ date, total: refs.size }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [jobs]);

  // IBTs due on selected alert date, grouped by ref (one row per IBT, lines aggregated).
  const alertDateOrders = useMemo(() => {
    if (!selectedAlertDate) return [];
    const matching = jobs.filter((job) => {
      if (job.jobType !== "ibt") return false;
      if (!job.eta) return false;
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

  const filteredAndSortedJobs = useMemo(() => {
    const filtered = filterJobs(ibtJobs, filters);
    const sorted = sortJobs(filtered, sortOptions);
    return sorted.filter((job) => {
      switch (activeTab) {
        case "open": return job.status === "pending" || job.status === "exception";
        case "assigned": return job.status === "assigned";
        case "in-transit": return job.status === "en-route";
        case "delivered": return job.status === "delivered" || job.status === "returned" || job.status === "cancelled";
        default: return true;
      }
    });
  }, [ibtJobs, filters, sortOptions, activeTab]);

  const tabCounts = useMemo(() => ({
    open: ibtJobs.filter((j) => j.status === "pending" || j.status === "exception").length,
    assigned: ibtJobs.filter((j) => j.status === "assigned").length,
    inTransit: ibtJobs.filter((j) => j.status === "en-route").length,
    delivered: ibtJobs.filter((j) => j.status === "delivered" || j.status === "returned" || j.status === "cancelled").length,
  }), [ibtJobs]);

  const stats = useMemo(() => {
    return {
      total: ibtJobs.length,
      pending: ibtJobs.filter((j) => j.status === "pending").length,
      inRoute: ibtJobs.filter((j) => j.status === "en-route").length,
      delivered: ibtJobs.filter((j) => j.status === "delivered").length,
      exceptions: ibtJobs.filter((j) => j.status === "exception").length,
      availableDrivers: drivers.filter((d) => d.status === "available").length,
      busyDrivers: drivers.filter((d) => d.status === "busy").length,
      alertCount: (() => {
        const now = new Date(); now.setHours(0, 0, 0, 0);
        const refSeen = new Set<string>();
        let count = 0;
        // Use ALL IBT jobs (not filtered) so overdue IBTs aren't missed.
        // One ref counts at most once even if it trips multiple alert conditions.
        jobs.filter((j) => j.jobType === "ibt").forEach((j) => {
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
    };
  }, [ibtJobs, jobs, drivers]);

  // Compute assigned pallets per driver by transfer ref. Pallets are order-level,
  // so multiple line items on one pallet must not multiply capacity usage.
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
    const job = ibtJobs.find((j) => j.id === event.active.id);
    setActiveJob(job || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const driver = drivers.find((d) => d.id === over.id);
      const job = ibtJobs.find((j) => j.id === active.id);

      if (driver && job) {
        (async () => {
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

          const allLineItemIds = jobs.filter((j) => j.ref === job.ref).map((j) => j.id);
          await updateJobs(allLineItemIds, { driverId: driver.id, status: "assigned" });
          showSuccess(`${job.ref} assigned to ${driver.name}`);
        })();
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
        pickup: newJob.pickup || "IBT Pickup",
        dropoff: newJob.dropoff || "IBT Destination",
        warehouse: newJob.warehouse,
        priority: newJob.priority,
        status: "pending" as JobStatus,
        pallets: newJob.pallets,
        outstandingQty: newJob.outstandingQty,
        eta: newJob.eta || undefined,
        notes: newJob.notes,
        jobType: "ibt",
      });

      await refreshData();
      setShowAddJob(false);
      setNewJob({
        ref: "",
        customer: "",
        pickup: "",
        dropoff: "",
        warehouse: "",
        serviceType: "delivery",
        priority: "normal",
        pallets: undefined,
        outstandingQty: undefined,
        eta: "",
        notes: "",
      });
    } catch (error) {
      console.error("Error creating IBT job:", error);
      showError("Failed to create IBT job");
    }
  };

  const [showMoreFilters, setShowMoreFilters] = useState(false);

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
  useEffect(() => { setCurrentPage(1); }, [prevFilterKey, activeTab]);

  return (
    <div className="space-y-3">
      {/* Header — compact */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ArrowRightLeft className="h-6 w-6 text-resilinc-primary" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">IBT Management</h1>
            <p className="text-sm text-gray-500">Manage Internal Branch Transfers and track deliveries</p>
          </div>
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

      {/* Statistics — compact */}
      <div className="grid gap-3 grid-cols-3 lg:grid-cols-7">
        {([
          { label: "Total", value: stats.total, color: "text-gray-900" },
          { label: "Pending", value: stats.pending, color: "text-resilinc-warning" },
          { label: "En Route", value: stats.inRoute, color: "text-blue-600" },
          { label: "Delivered", value: stats.delivered, color: "text-green-600" },
          { label: "Exceptions", value: stats.exceptions, color: "text-resilinc-alert" },
          { label: "Available", value: stats.availableDrivers, color: "text-green-600" },
          { label: "Busy", value: stats.busyDrivers, color: "text-resilinc-warning" },
        ]).map((s) => (
          <Card key={s.label} className="p-3">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 p-1">
        {([
          { key: "open" as const, label: "Open", count: tabCounts.open, dotColor: "bg-yellow-500" },
          { key: "assigned" as const, label: "Assigned", count: tabCounts.assigned, dotColor: "bg-blue-500" },
          { key: "in-transit" as const, label: "In Transit", count: tabCounts.inTransit, dotColor: "bg-indigo-500" },
          { key: "delivered" as const, label: "Delivered / Closed", count: tabCounts.delivered, dotColor: "bg-green-500" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? "bg-gray-900 text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${activeTab === tab.key ? "bg-white" : tab.dotColor}`} />
            {tab.label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === tab.key ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"
            }`}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* High Volume Dates — IBT only, current month + 2 months */}
      {busyDateAlerts.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <div className="flex items-center gap-1.5 text-amber-700">
            <AlertTriangle className="w-4 h-4" />
            <span className="font-semibold text-xs">High Volume:</span>
          </div>
          {busyDateAlerts.map((a) => (
            <button
              key={a.date}
              onClick={() => setSelectedAlertDate(a.date)}
              className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 hover:bg-amber-100 rounded-lg text-xs border border-amber-200 hover:border-amber-300 cursor-pointer transition-colors"
            >
              <span className="font-semibold text-amber-900">{a.date}</span>
              <span className="text-amber-600">{a.total} IBTs</span>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-48"><WarehouseSelector /></div>
          <div className="flex-1"><FilterBar showMore={showMoreFilters} /></div>
        </div>
        <div className="flex items-center gap-2">
          <SortBar />
          <button onClick={() => setShowMoreFilters(!showMoreFilters)} className="text-xs text-resilinc-primary hover:text-resilinc-primary-dark font-medium px-2 py-1 rounded hover:bg-green-50 transition-colors">{showMoreFilters ? "Less filters" : "More filters"}</button>
        </div>
      </div>

      {/* Main Content Grid */}
      <DndContext
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Jobs List */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-5 w-5 text-gray-600" />
                      <CardTitle>IBT Jobs ({filteredAndSortedJobs.length})</CardTitle>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">Drag jobs to transporters to assign</p>
                  </div>
                  <Button
                    size="sm"
                    className="gap-2 bg-green-600 hover:bg-green-700"
                    onClick={() => setShowAddJob(true)}
                  >
                    <Plus className="h-4 w-4" />
                    Add IBT Job
                  </Button>
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
                        No IBT jobs found matching your filters
                      </div>
                    ) : (
                      paginatedJobs.map((job) => (
                        <JobCard
                          key={job.id}
                          job={job}
                          onSelect={() => handleJobSelect(job)}
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

          {/* Transporters List - sticky */}
          <div className="lg:col-span-1">
            <div className="lg:sticky lg:top-4" style={{ maxHeight: "calc(100vh - 2rem)", overflowY: "auto" }}>
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
                  IBTs Due: {selectedAlertDate}
                </h2>
                <p className="text-sm text-gray-600 mt-0.5">
                  {alertDateOrders.length} {alertDateOrders.length === 1 ? "IBT" : "IBTs"}
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

      {/* Add IBT Job Modal */}
      {showAddJob && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Add IBT Job Manually</h2>
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
                  <label htmlFor="ibt-ref" className="block text-sm font-medium text-gray-700 mb-2">
                    IBT Reference / Transfer No <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="ibt-ref"
                    type="text"
                    value={newJob.ref}
                    onChange={(e) => setNewJob({ ...newJob, ref: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="IBT-0001"
                    required
                  />
                </div>

                {/* Customer/Branch */}
                <div>
                  <label htmlFor="ibt-customer" className="block text-sm font-medium text-gray-700 mb-2">
                    Branch / Destination Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="ibt-customer"
                    type="text"
                    value={newJob.customer}
                    onChange={(e) => setNewJob({ ...newJob, customer: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="Branch Name"
                    required
                  />
                </div>

                {/* Pickup Warehouse */}
                <div>
                  <label htmlFor="ibt-pickup" className="block text-sm font-medium text-gray-700 mb-2">
                    Pickup Warehouse
                  </label>
                  <select
                    id="ibt-pickup"
                    value={newJob.warehouse}
                    onChange={(e) => setNewJob({ ...newJob, pickup: e.target.value, warehouse: e.target.value })}
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
                  <label htmlFor="ibt-service-type" className="block text-sm font-medium text-gray-700 mb-2">
                    Service Type
                  </label>
                  <select
                    id="ibt-service-type"
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
                  <label htmlFor="ibt-dropoff" className="block text-sm font-medium text-gray-700 mb-2">
                    Destination / Dropoff Address
                  </label>
                  <input
                    id="ibt-dropoff"
                    type="text"
                    value={newJob.dropoff}
                    onChange={(e) => setNewJob({ ...newJob, dropoff: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                    placeholder="Destination address"
                  />
                </div>

                {/* Priority */}
                <div>
                  <label htmlFor="ibt-priority" className="block text-sm font-medium text-gray-700 mb-2">
                    Priority
                  </label>
                  <select
                    id="ibt-priority"
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
                  <label htmlFor="ibt-eta" className="block text-sm font-medium text-gray-700 mb-2">
                    Transfer Date (ETA)
                  </label>
                  <input
                    id="ibt-eta"
                    type="date"
                    value={newJob.eta}
                    onChange={(e) => setNewJob({ ...newJob, eta: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-resilinc-primary focus:border-transparent"
                  />
                </div>

                {/* Pallets */}
                <div>
                  <label htmlFor="ibt-pallets" className="block text-sm font-medium text-gray-700 mb-2">
                    Pallets
                  </label>
                  <input
                    id="ibt-pallets"
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
                  <label htmlFor="ibt-qty" className="block text-sm font-medium text-gray-700 mb-2">
                    Transfer Quantity
                  </label>
                  <input
                    id="ibt-qty"
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
                  <label htmlFor="ibt-notes" className="block text-sm font-medium text-gray-700 mb-2">
                    Notes / Description
                  </label>
                  <textarea
                    id="ibt-notes"
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
                <Button onClick={handleAddJob} className="flex-1 flex items-center justify-center gap-2 bg-resilinc-primary hover:bg-resilinc-primary-dark">
                  <Save className="w-4 h-4" />
                  Add IBT Job
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
