import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import { dispatchPerformanceAPI, type DispatchPerformanceSummary } from "../../services/api";
import { addDays, formatIsoDate, todayIso, toDispatchOrder, type Granularity } from "../../utils/dispatchPerformance";
import { DispatchUploads } from "../dispatch/DispatchUploads";
import { OrdersPanel } from "../dispatch/OrdersPanel";
import { IbtPanel } from "../dispatch/IbtPanel";
import { SegmentedControl } from "../dispatch/DispatchUi";

type RangePreset = "this-month" | "last-month" | "last-3-months" | "ytd" | "all" | "custom";
type Tab = "orders" | "ibt";

const RANGE_OPTIONS: { id: RangePreset; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "last-3-months", label: "Last 3 months" },
  { id: "ytd", label: "Year to date" },
  { id: "all", label: "All data" },
  { id: "custom", label: "Custom" },
];

const presetRange = (preset: RangePreset, bounds: { minDate: string; maxDate: string }) => {
  const today = todayIso();
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "this-month":
      return { from: monthStart, to: today };
    case "last-month": {
      const lastMonthEnd = addDays(monthStart, -1);
      return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd };
    }
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "all":
      return { from: bounds.minDate || monthStart, to: bounds.maxDate > today ? bounds.maxDate : today };
    default: {
      const y = Number(today.slice(0, 4));
      const m = Number(today.slice(5, 7)) - 2;
      const start = m > 0 ? `${y}-${String(m).padStart(2, "0")}-01` : `${y - 1}-${String(m + 12).padStart(2, "0")}-01`;
      return { from: start, to: today };
    }
  }
};

/** Warehouse lists come back from the API as "K58, CPT01". */
const splitWarehouses = (value: string) => value.split(",").map((w) => w.trim()).filter(Boolean);

const selectClass ="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 focus:border-emerald-400 focus:outline-none";

export const DispatchPerformance: React.FC = () => {
  const [tab, setTab] = useState<Tab>("orders");
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [preset, setPreset] = useState<RangePreset>("last-3-months");
  const [customRange, setCustomRange] = useState(() => presetRange("last-3-months", { minDate: "", maxDate: "" }));
  const [branch, setBranch] = useState("");
  const [customer, setCustomer] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [summary, setSummary] = useState<DispatchPerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const bounds = summary?.bounds ?? { minDate: "", maxDate: "" };
  const range = preset === "custom" ? customRange : presetRange(preset, bounds);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError("");
    try {
      setSummary(await dispatchPerformanceAPI.getSummary(from, to));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dispatch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(range.from, range.to); }, [load, range.from, range.to]);

  const orders = useMemo(() => (summary?.invoices ?? []).map(toDispatchOrder), [summary]);
  const branches = useMemo(() => Array.from(new Set(orders.map((o) => o.branch).filter(Boolean))).sort(), [orders]);
  const customers = useMemo(() => Array.from(new Set(orders.map((o) => o.customer))).sort(), [orders]);
  const ibts = useMemo(() => summary?.ibts ?? [], [summary]);
  const warehouses = useMemo(() => Array.from(new Set([
    ...orders.flatMap((o) => splitWarehouses(o.warehouses)),
    ...ibts.flatMap((ibt) => [...splitWarehouses(ibt.fromWarehouses), ...splitWarehouses(ibt.toWarehouses)]),
  ])).sort(), [orders, ibts]);
  const filteredOrders = useMemo(() => orders.filter((o) => (
    (!branch || o.branch === branch)
    && (!customer || o.customer === customer)
    && (!warehouse || splitWarehouses(o.warehouses).includes(warehouse))
  )), [orders, branch, customer, warehouse]);
  const filteredIbts = useMemo(() => (warehouse
    ? ibts.filter((ibt) => [...splitWarehouses(ibt.fromWarehouses), ...splitWarehouses(ibt.toWarehouses)].includes(warehouse))
    : ibts
  ), [ibts, warehouse]);

  const handleUploaded = (uploaded: { minDate: string; maxDate: string }) => {
    // If the new file falls outside the current window, widen to show all data.
    if (uploaded.minDate && (uploaded.minDate < range.from || uploaded.maxDate > range.to) && preset !== "all") {
      setPreset("all");
    } else {
      void load(range.from, range.to);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dispatch Performance</h2>
          <p className="mt-1 text-sm text-gray-500">
            Customer orders and IBTs dispatched, matched on invoice number. On time = invoice Document Date on or before the Delivery / Due Date.
          </p>
        </div>
        {bounds.minDate && (
          <p className="text-xs text-gray-500">Data on file: {formatIsoDate(bounds.minDate)} – {formatIsoDate(bounds.maxDate)}</p>
        )}
      </div>

      <DispatchUploads uploads={summary?.uploads ?? {}} onUploaded={handleUploaded} />

      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-card border border-gray-200 bg-white/95 px-3 py-2.5 shadow-card backdrop-blur">
        <SegmentedControl<Tab> value={tab} onChange={setTab} options={[{ id: "orders", label: "Customer orders" }, { id: "ibt", label: "IBT transfers" }]} />
        <span className="mx-1 h-5 w-px bg-gray-200" />
        <select value={preset} onChange={(e) => setPreset(e.target.value as RangePreset)} className={selectClass} aria-label="Date range">
          {RANGE_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        {preset === "custom" ? (
          <>
            <input type="date" value={customRange.from} max={customRange.to} onChange={(e) => e.target.value && setCustomRange((r) => ({ ...r, from: e.target.value }))} className={selectClass} />
            <span className="text-xs text-gray-400">to</span>
            <input type="date" value={customRange.to} min={customRange.from} onChange={(e) => e.target.value && setCustomRange((r) => ({ ...r, to: e.target.value }))} className={selectClass} />
          </>
        ) : (
          <span className="text-xs tabular-nums text-gray-500">{formatIsoDate(range.from)} – {formatIsoDate(range.to)}</span>
        )}
        <SegmentedControl<Granularity> value={granularity} onChange={setGranularity} options={[{ id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "month", label: "Month" }]} />
        <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className={selectClass} aria-label="Warehouse">
          <option value="">All warehouses</option>
          {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        {tab === "orders" && (
          <>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className={selectClass} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={customer} onChange={(e) => setCustomer(e.target.value)} className={`${selectClass} max-w-[220px]`} aria-label="Customer">
              <option value="">All customers</option>
              {customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        )}
        {(warehouse || (tab === "orders" && (branch || customer))) && (
          <button type="button" onClick={() => { setWarehouse(""); setBranch(""); setCustomer(""); }} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-900">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        <button type="button" onClick={() => void load(range.from, range.to)} className="ml-auto text-gray-400 hover:text-gray-900" title="Refresh">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!summary && loading ? (
        <div className="flex min-h-[300px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-resilinc-primary" /></div>
      ) : tab === "orders" ? (
        <OrdersPanel orders={filteredOrders} from={range.from} to={range.to} granularity={granularity} onSelectCustomer={setCustomer} />
      ) : (
        <IbtPanel ibts={filteredIbts} from={range.from} to={range.to} granularity={granularity} />
      )}
    </div>
  );
};
