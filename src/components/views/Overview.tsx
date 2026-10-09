import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { dispatchPerformanceAPI, outstandingOrdersAPI, type DispatchPerformanceSummary, type OutstandingOrdersSnapshot } from "../../services/api";
import { formatNumber, formatPercent } from "../../utils/format";
import { buildOrderSeries, formatIsoDate, todayIso, toDispatchOrder } from "../../utils/dispatchPerformance";
import { DUE_SOON_DAYS, countOrders, sumValue, toOutstandingLine } from "../../utils/outstandingOrders";
import {
  TREND_WEEKS,
  dashboardDates,
  outstandingByWeek,
  overdueByCustomer,
  overdueOrders,
  periodTotals,
  recentLateDispatches,
  splitWarehouses,
  warehouseBreakdown,
} from "../../utils/dashboard";
import { ChartLegend, OnTimeTrendChart, OrdersDispatchedChart, OutstandingByWeekChart, STATUS_COLORS } from "../dispatch/DispatchCharts";
import { Panel, StatTile } from "../dispatch/DispatchUi";
import { MultiSelect } from "../MultiSelect";

const ON_TIME_TARGET = 95;
const LIST_SIZE = 10;
const WAREHOUSE_KEY = "dashboard_warehouse";
const formatRand = (value: number) => `R${formatNumber(Math.round(value))}`;

/** "▲ 12% vs 1–9 Sep" style comparison; null when there's nothing to compare against. */
const changeText = (current: number, previous: number) => {
  if (!previous) return null;
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(0)}%`;
};

const LinkButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline">
    {label} <ArrowRight className="h-3.5 w-3.5" />
  </button>
);

const EmptyRow: React.FC<{ cols: number; text: string }> = ({ cols, text }) => (
  <tr><td colSpan={cols} className="px-3 py-6 text-center text-sm text-gray-500">{text}</td></tr>
);

const th = "px-3 py-2 font-medium";
const td = "px-3 py-2";

interface OverviewProps {
  onNavigate: (item: string) => void;
}

export const Overview: React.FC<OverviewProps> = ({ onNavigate }) => {
  const dates = useMemo(() => dashboardDates(todayIso()), []);
  const [summary, setSummary] = useState<DispatchPerformanceSummary | null>(null);
  const [snapshot, setSnapshot] = useState<OutstandingOrdersSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [warehouse, setWarehouseState] = useState<string[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(WAREHOUSE_KEY) || "[]");
      return Array.isArray(stored) ? stored.filter((w): w is string => typeof w === "string") : [];
    } catch { return []; }
  });
  const setWarehouse = (value: string[]) => {
    setWarehouseState(value);
    try { localStorage.setItem(WAREHOUSE_KEY, JSON.stringify(value)); } catch { /* storage unavailable; keep in memory only */ }
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [dispatch, outstanding] = await Promise.allSettled([
      dispatchPerformanceAPI.getSummary(dates.loadFrom, dates.today),
      outstandingOrdersAPI.get(),
    ]);
    const messages: string[] = [];
    if (dispatch.status === "fulfilled") setSummary(dispatch.value);
    else messages.push(`Dispatch data: ${dispatch.reason instanceof Error ? dispatch.reason.message : "failed to load"}`);
    if (outstanding.status === "fulfilled") setSnapshot(outstanding.value);
    else messages.push(`Outstanding orders: ${outstanding.reason instanceof Error ? outstanding.reason.message : "failed to load"}`);
    setErrors(messages);
    setLoading(false);
  }, [dates]);

  useEffect(() => { void load(); }, [load]);

  const allOrders = useMemo(() => (summary?.invoices ?? []).map(toDispatchOrder), [summary]);
  const allIbts = useMemo(() => summary?.ibts ?? [], [summary]);
  const allLines = useMemo(() => (snapshot?.lines ?? []).map((l) => toOutstandingLine(l, dates.today)), [snapshot, dates]);

  const warehouseOptions = useMemo(() => Array.from(new Set([
    ...allOrders.flatMap((o) => splitWarehouses(o.warehouses)),
    ...allIbts.flatMap((i) => [...splitWarehouses(i.fromWarehouses), ...splitWarehouses(i.toWarehouses)]),
    ...allLines.map((l) => l.warehouse).filter(Boolean),
  ])).sort(), [allOrders, allIbts, allLines]);
  // Ignore remembered warehouses that no longer appear in the data.
  const activeWarehouses = useMemo(() => warehouse.filter((w) => warehouseOptions.includes(w)), [warehouse, warehouseOptions]);
  const picked = useMemo(() => (activeWarehouses.length ? new Set(activeWarehouses) : null), [activeWarehouses]);

  const orders = useMemo(() => (picked ? allOrders.filter((o) => splitWarehouses(o.warehouses).some((w) => picked.has(w))) : allOrders), [allOrders, picked]);
  const ibts = useMemo(() => (picked
    ? allIbts.filter((i) => [...splitWarehouses(i.fromWarehouses), ...splitWarehouses(i.toWarehouses)].some((w) => picked.has(w)))
    : allIbts), [allIbts, picked]);
  const lines = useMemo(() => (picked ? allLines.filter((l) => picked.has(l.warehouse)) : allLines), [allLines, picked]);

  const mtd = useMemo(() => periodTotals(orders, ibts, dates.monthStart, dates.today), [orders, ibts, dates]);
  const prev = useMemo(() => periodTotals(orders, ibts, dates.lastMonthStart, dates.lastMonthSameDay), [orders, ibts, dates]);
  const series = useMemo(() => buildOrderSeries(orders, dates.trendFrom, dates.today, "week"), [orders, dates]);
  const weeks = useMemo(() => outstandingByWeek(lines, dates.today), [lines, dates]);
  const topOverdue = useMemo(() => overdueOrders(lines), [lines]);
  const customersOverdue = useMemo(() => overdueByCustomer(lines), [lines]);
  const lateDispatches = useMemo(() => recentLateDispatches(orders), [orders]);
  const warehouses = useMemo(() => warehouseBreakdown(orders, ibts, lines, dates.monthStart, dates.today)
    .filter((w) => !picked || picked.has(w.warehouse)), [orders, ibts, lines, dates, picked]);

  const overdueLines = lines.filter((l) => l.due === "overdue");
  const dueSoonLines = lines.filter((l) => l.due === "due-soon");
  const prevLabel = `${formatIsoDate(dates.lastMonthStart).slice(0, 6)}–${formatIsoDate(dates.lastMonthSameDay).slice(0, 6)}`;
  const compare = (current: number, previous: number, format: (n: number) => string) => {
    const change = changeText(current, previous);
    return `${prevLabel}: ${format(previous)}${change ? ` · ${change}` : ""}`;
  };
  const onTimeHint = prev.onTimePct === null
    ? `${formatNumber(mtd.onTime)} of ${formatNumber(mtd.onTime + mtd.late)} · target ${ON_TIME_TARGET}%`
    : `${prevLabel}: ${formatPercent(prev.onTimePct)}${mtd.onTimePct === null ? "" : ` · ${mtd.onTimePct >= prev.onTimePct ? "▲" : "▼"} ${Math.abs(mtd.onTimePct - prev.onTimePct).toFixed(1)} pts`}`;

  if (loading && !summary && !snapshot) {
    return <div className="flex min-h-[300px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-resilinc-primary" /></div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
          <p className="mt-1 text-sm text-gray-500">
            Month to date ({formatIsoDate(dates.monthStart)} – {formatIsoDate(dates.today)}) compared with the same days last month
            {activeWarehouses.length ? <> · <span className="font-semibold text-gray-700">{activeWarehouses.join(", ")}</span></> : " · all warehouses"}.
          </p>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <MultiSelect options={warehouseOptions} value={activeWarehouses} onChange={setWarehouse} noun="warehouses" className="w-full sm:w-64" />
          <button type="button" onClick={() => void load()} className="text-gray-400 hover:text-gray-900" title="Refresh">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {errors.map((e) => <p key={e} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{e}</p>)}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Dispatch · this month</h3>
          <LinkButton label="Dispatch Performance" onClick={() => onNavigate("dispatch-performance")} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Orders dispatched" value={formatNumber(mtd.orders)} hint={compare(mtd.orders, prev.orders, formatNumber)} />
          <StatTile
            label="On time"
            value={mtd.onTimePct === null ? "-" : formatPercent(mtd.onTimePct)}
            hint={onTimeHint}
            tone={mtd.onTimePct === null ? undefined : mtd.onTimePct >= ON_TIME_TARGET ? "good" : "critical"}
          />
          <StatTile label="Value dispatched excl." value={formatRand(mtd.value)} hint={compare(mtd.value, prev.value, formatRand)} />
          <StatTile label="IBTs dispatched" value={formatNumber(mtd.ibts)} hint={compare(mtd.ibts, prev.ibts, formatNumber)} />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Outstanding sales orders{snapshot?.upload ? ` · uploaded ${formatIsoDate(snapshot.upload.uploadedAt.slice(0, 10))}` : ""}
          </h3>
          <LinkButton label="Outstanding Sales Orders" onClick={() => onNavigate("outstanding-orders")} />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Open sales orders" value={formatNumber(countOrders(lines))} hint={`${formatNumber(lines.length)} lines`} />
          <StatTile label="Outstanding value excl." value={formatRand(sumValue(lines))} />
          <StatTile
            label="Overdue"
            value={formatRand(sumValue(overdueLines))}
            hint={`${formatNumber(countOrders(overdueLines))} orders past delivery date`}
            tone={lines.length ? (overdueLines.length ? "critical" : "good") : undefined}
          />
          <StatTile label={`Due in next ${DUE_SOON_DAYS} days`} value={formatRand(sumValue(dueSoonLines))} hint={`${formatNumber(countOrders(dueSoonLines))} orders`} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Orders dispatched per week"
          subtitle={`Last ${TREND_WEEKS} weeks`}
          actions={<ChartLegend items={[
            { label: "On time", color: STATUS_COLORS.onTime },
            { label: "Late", color: STATUS_COLORS.late },
            { label: "No due date", color: STATUS_COLORS.noDueDate },
          ]} />}
        >
          <OrdersDispatchedChart data={series} />
        </Panel>
        <Panel title="Outstanding value by delivery week" subtitle="Overdue, then the next 8 weeks of delivery dates">
          <OutstandingByWeekChart data={weeks} />
        </Panel>
      </div>

      <Panel title="On-time % per week" subtitle={`Last ${TREND_WEEKS} weeks · target ${ON_TIME_TARGET}%`}>
        <OnTimeTrendChart data={series} target={ON_TIME_TARGET} />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Oldest overdue sales orders" subtitle={`${formatNumber(topOverdue.length)} overdue orders`} actions={<LinkButton label="View all" onClick={() => onNavigate("outstanding-orders")} />}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500">
                <tr className="border-b border-gray-200">
                  <th className={`${th} text-left`}>Order</th>
                  <th className={`${th} text-left`}>Customer</th>
                  <th className={`${th} text-left`}>Delivery</th>
                  <th className={`${th} text-right`}>Days</th>
                  <th className={`${th} text-right`}>Value excl.</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {topOverdue.slice(0, LIST_SIZE).map((o) => (
                  <tr key={o.documentNo} className="border-b border-gray-200">
                    <td className={`${td} whitespace-nowrap font-medium text-gray-900`}>{o.documentNo}</td>
                    <td className={`${td} max-w-[200px] truncate text-gray-900`} title={o.customer}>{o.customer}</td>
                    <td className={`${td} whitespace-nowrap text-gray-600`}>{formatIsoDate(o.deliveryDate)}</td>
                    <td className={`${td} text-right font-semibold text-red-600`}>{o.daysOverdue}</td>
                    <td className={`${td} text-right`}>{formatRand(o.value)}</td>
                  </tr>
                ))}
                {topOverdue.length === 0 && <EmptyRow cols={5} text={lines.length ? "Nothing overdue." : "No outstanding orders uploaded yet."} />}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Customers with most overdue value" subtitle={`${formatNumber(customersOverdue.length)} customers with overdue orders`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500">
                <tr className="border-b border-gray-200">
                  <th className={`${th} text-left`}>Customer</th>
                  <th className={`${th} text-right`}>Overdue orders</th>
                  <th className={`${th} text-right`}>Overdue value</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {customersOverdue.slice(0, LIST_SIZE).map((c) => (
                  <tr key={c.customer} className="border-b border-gray-200">
                    <td className={`${td} max-w-[260px] truncate font-medium text-gray-900`} title={c.customer}>{c.customer}</td>
                    <td className={`${td} text-right`}>{formatNumber(c.orders)}</td>
                    <td className={`${td} text-right font-semibold text-red-600`}>{formatRand(c.value)}</td>
                  </tr>
                ))}
                {customersOverdue.length === 0 && <EmptyRow cols={3} text={lines.length ? "Nothing overdue." : "No outstanding orders uploaded yet."} />}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title="Recent late dispatches" subtitle="Invoices dispatched after their Delivery / Due Date" actions={<LinkButton label="View all" onClick={() => onNavigate("dispatch-performance")} />}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500">
              <tr className="border-b border-gray-200">
                <th className={`${th} text-left`}>Invoice</th>
                <th className={`${th} text-left`}>Sales order</th>
                <th className={`${th} text-left`}>Customer</th>
                <th className={`${th} text-left`}>Due</th>
                <th className={`${th} text-left`}>Dispatched</th>
                <th className={`${th} text-right`}>Days late</th>
                <th className={`${th} text-right`}>Value excl.</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {lateDispatches.slice(0, LIST_SIZE).map((o) => (
                <tr key={o.invoiceNo} className="border-b border-gray-200">
                  <td className={`${td} whitespace-nowrap font-medium text-gray-900`}>{o.invoiceNo}</td>
                  <td className={`${td} whitespace-nowrap text-gray-600`}>{o.salesOrder || "-"}</td>
                  <td className={`${td} max-w-[240px] truncate text-gray-900`} title={o.customer}>{o.customer}</td>
                  <td className={`${td} whitespace-nowrap text-gray-600`}>{formatIsoDate(o.dueDate)}</td>
                  <td className={`${td} whitespace-nowrap text-gray-600`}>{formatIsoDate(o.dispatchedOn)}</td>
                  <td className={`${td} text-right font-semibold text-red-600`}>{o.daysLate}</td>
                  <td className={`${td} text-right`}>{o.hasLines ? formatRand(o.totalExcl) : "-"}</td>
                </tr>
              ))}
              {lateDispatches.length === 0 && <EmptyRow cols={7} text="No late dispatches in the last 12 weeks." />}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="By warehouse" subtitle="Dispatches and IBTs this month · outstanding from the latest upload">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500">
              <tr className="border-b border-gray-200">
                <th className={`${th} text-left`}>Warehouse</th>
                <th className={`${th} text-right`}>Orders dispatched</th>
                <th className={`${th} text-right`}>IBTs out</th>
                <th className={`${th} text-right`}>IBTs in</th>
                <th className={`${th} text-right`}>Outstanding value</th>
                <th className={`${th} text-right`}>Overdue value</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {warehouses.map((w) => (
                <tr key={w.warehouse} className="border-b border-gray-200">
                  <td className={`${td} max-w-[260px] truncate font-medium text-gray-900`} title={w.warehouse}>{w.warehouse}</td>
                  <td className={`${td} text-right`}>{formatNumber(w.ordersDispatched)}</td>
                  <td className={`${td} text-right`}>{formatNumber(w.ibtsOut)}</td>
                  <td className={`${td} text-right`}>{formatNumber(w.ibtsIn)}</td>
                  <td className={`${td} text-right`}>{w.outstandingValue ? formatRand(w.outstandingValue) : "-"}</td>
                  <td className={`${td} text-right ${w.overdueValue ? "font-semibold text-red-600" : ""}`}>{w.overdueValue ? formatRand(w.overdueValue) : "-"}</td>
                </tr>
              ))}
              {warehouses.length === 0 && <EmptyRow cols={6} text="No data uploaded yet." />}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
};
