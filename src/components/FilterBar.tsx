import React, { useMemo } from "react";
import { Search, X } from "lucide-react";
import { Button } from "./ui/Button";
import { useDispatch } from "../context/DispatchContext";
import { JobStatus, JobPriority } from "../types";

export const FilterBar: React.FC<{ showMore?: boolean }> = ({ showMore }) => {
  const { filters, setFilters, resetFilters, drivers, jobs } = useDispatch();

  const getWeekInfo = (dateString: string | undefined) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const startOfYear = new Date(date.getFullYear(), 0, 1);
    const daysSinceStart = Math.floor((date.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((daysSinceStart + startOfYear.getDay() + 1) / 7);
    return { week: weekNumber, year: date.getFullYear(), value: `${date.getFullYear()}-W${weekNumber.toString().padStart(2, '0')}` };
  };

  const etaWeeks = useMemo(() => {
    const weeks = new Set<string>();
    jobs.forEach(job => {
      const weekInfo = getWeekInfo(job.eta);
      if (weekInfo) weeks.add(weekInfo.value);
    });
    return Array.from(weeks).sort().reverse();
  }, [jobs]);

  const hasActiveFilters =
    filters.searchQuery ||
    (filters.status && filters.status.length > 0) ||
    (filters.priority && filters.priority.length > 0) ||
    filters.driverId ||
    filters.etaWeek ||
    (filters.etaRange && filters.etaRange !== "all") ||
    filters.workflowStatus ||
    filters.transporterBooked !== undefined ||
    filters.orderPicked !== undefined ||
    filters.coaAvailable !== undefined;

  const selCls = "h-7 text-[11px] border border-gray-300 rounded-md bg-white px-2 py-0 focus:outline-none focus:ring-2 focus:ring-resilinc-primary";

  return (
    <div className="flex items-center gap-1.5">
      {/* Search */}
      <div className="relative" style={{ width: "11rem" }}>
        <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search ref, customer..."
          value={filters.searchQuery || ""}
          onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
          className="h-7 text-[11px] w-full pl-7 pr-2 border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-resilinc-primary placeholder:text-gray-400"
        />
      </div>

      {/* Core filters */}
      <select value={filters.status?.[0] || "all"} onChange={(e) => setFilters({ ...filters, status: e.target.value === "all" ? undefined : [e.target.value as JobStatus] })} className={selCls}>
        <option value="all">Status</option>
        <option value="pending">Pending</option>
        <option value="assigned">Assigned</option>
        <option value="en-route">En Route</option>
        <option value="returned">Returned</option>
        <option value="exception">Exception</option>
      </select>

      <select value={filters.priority?.[0] || "all"} onChange={(e) => setFilters({ ...filters, priority: e.target.value === "all" ? undefined : [e.target.value as JobPriority] })} className={selCls}>
        <option value="all">Priority</option>
        <option value="urgent">Urgent</option>
        <option value="high">High</option>
        <option value="normal">Normal</option>
        <option value="low">Low</option>
      </select>

      <select value={filters.driverId || "all"} onChange={(e) => setFilters({ ...filters, driverId: e.target.value === "all" ? undefined : e.target.value })} className={selCls}>
        <option value="all">Transporter</option>
        <option value="unassigned">Unassigned</option>
        {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>

      <select value={filters.etaRange || "5weeks"} onChange={(e) => setFilters({ ...filters, etaRange: e.target.value as "5weeks" | "3months" | "6months" | "all" })} className={selCls} title="ETA range window for the order list. Search ignores this filter.">
        <option value="all">All Dates</option>
        <option value="5weeks">Next 5 Weeks</option>
        <option value="3months">Next 3 Months</option>
        <option value="6months">Next 6 Months</option>
      </select>

      <select value={filters.etaWeek || "all"} onChange={(e) => setFilters({ ...filters, etaWeek: e.target.value === "all" ? undefined : e.target.value })} className={selCls}>
        <option value="all">ETA Week</option>
        {etaWeeks.map(w => { const [y, wn] = w.split('-W'); return <option key={w} value={w}>W{wn}, {y}</option>; })}
      </select>

      {/* Workflow filters */}
      {showMore && (
        <>
          <select value={filters.workflowStatus || "all"} onChange={(e) => setFilters({ ...filters, workflowStatus: e.target.value === "all" ? undefined : e.target.value as "ready" | "in-progress" | "not-started" })} className={selCls}>
            <option value="all">Workflow</option>
            <option value="ready">Ready</option>
            <option value="in-progress">In Progress</option>
            <option value="not-started">Not Started</option>
          </select>

          <select value={filters.transporterBooked === undefined ? "all" : filters.transporterBooked ? "yes" : "no"} onChange={(e) => setFilters({ ...filters, transporterBooked: e.target.value === "all" ? undefined : e.target.value === "yes" })} className={selCls}>
            <option value="all">TB</option>
            <option value="yes">Booked</option>
            <option value="no">Not Booked</option>
          </select>

          <select value={filters.orderPicked === undefined ? "all" : filters.orderPicked ? "yes" : "no"} onChange={(e) => setFilters({ ...filters, orderPicked: e.target.value === "all" ? undefined : e.target.value === "yes" })} className={selCls}>
            <option value="all">OP</option>
            <option value="yes">Picked</option>
            <option value="no">Not Picked</option>
          </select>

          <select value={filters.coaAvailable === undefined ? "all" : filters.coaAvailable ? "yes" : "no"} onChange={(e) => setFilters({ ...filters, coaAvailable: e.target.value === "all" ? undefined : e.target.value === "yes" })} className={selCls}>
            <option value="all">COA</option>
            <option value="yes">Available</option>
            <option value="no">Not Available</option>
          </select>
        </>
      )}

      {hasActiveFilters && (
        <Button variant="outline" size="icon" onClick={resetFilters} title="Clear all filters" className="h-7 w-7">
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
};
