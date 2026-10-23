// Calculations for the Dashboard. Builds on the dispatch and outstanding-order helpers
// so every figure matches the detail pages.
import type { DispatchIbtSummary } from "../services/api";
import { addDays, onTimePercent, periodKey, periodLabel, periodRangeLabel, formatIsoDate, type DispatchOrder } from "./dispatchPerformance";
import { countOrders, sumValue, type OutstandingLine } from "./outstandingOrders";
import type { OutstandingWeekPoint } from "../components/dispatch/DispatchCharts";

export const TREND_WEEKS = 12;
const UPCOMING_WEEKS = 8;

/** Warehouse lists come back from the API as "K58, CPT01". */
export const splitWarehouses = (value: string) => value.split(",").map((w) => w.trim()).filter(Boolean);
const inRange = (date: string, from: string, to: string) => Boolean(date) && date >= from && date <= to;

export interface DashboardDates {
  today: string;
  monthStart: string;
  lastMonthStart: string;
  /** Same day-of-month last month (capped at month end), for like-for-like comparisons. */
  lastMonthSameDay: string;
  trendFrom: string;
  /** Earliest date the dashboard needs dispatch data from. */
  loadFrom: string;
}

export const dashboardDates = (today: string): DashboardDates => {
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = addDays(monthStart, -1);
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  const sameDay = addDays(lastMonthStart, Number(today.slice(8, 10)) - 1);
  const lastMonthSameDay = sameDay > lastMonthEnd ? lastMonthEnd : sameDay;
  const trendFrom = periodKey(addDays(today, -7 * (TREND_WEEKS - 1)), "week");
  return { today, monthStart, lastMonthStart, lastMonthSameDay, trendFrom, loadFrom: trendFrom < lastMonthStart ? trendFrom : lastMonthStart };
};

export interface PeriodTotals {
  orders: number;
  onTime: number;
  late: number;
  onTimePct: number | null;
  value: number;
  ibts: number;
}

export const periodTotals = (orders: DispatchOrder[], ibts: DispatchIbtSummary[], from: string, to: string): PeriodTotals => {
  const inPeriod = orders.filter((o) => inRange(o.dispatchedOn, from, to));
  const onTime = inPeriod.filter((o) => o.status === "on-time").length;
  const late = inPeriod.filter((o) => o.status === "late").length;
  return {
    orders: inPeriod.length,
    onTime,
    late,
    onTimePct: onTimePercent(onTime, late),
    value: inPeriod.reduce((sum, o) => sum + o.totalExcl, 0),
    ibts: ibts.filter((i) => inRange(i.transactionDate, from, to)).length,
  };
};

/** One "Overdue" bar, the next few delivery weeks, then "Later" and "No date" if any. */
export const outstandingByWeek = (lines: OutstandingLine[], today: string): OutstandingWeekPoint[] => {
  const thisWeek = periodKey(today, "week");
  const lastWeek = addDays(thisWeek, 7 * (UPCOMING_WEEKS - 1));
  const overdue: OutstandingWeekPoint = { key: "overdue", label: "Overdue", rangeLabel: `Delivery date before ${formatIsoDate(today)}`, value: 0, orders: 0, tone: "overdue" };
  const weeks = Array.from({ length: UPCOMING_WEEKS }, (_, i): OutstandingWeekPoint => {
    const key = addDays(thisWeek, 7 * i);
    return { key, label: periodLabel(key, "week").replace("Wk ", ""), rangeLabel: periodRangeLabel(key, "week"), value: 0, orders: 0, tone: "upcoming" };
  });
  const later: OutstandingWeekPoint = { key: "later", label: "Later", rangeLabel: `After ${formatIsoDate(addDays(lastWeek, 6))}`, value: 0, orders: 0, tone: "neutral" };
  const noDate: OutstandingWeekPoint = { key: "no-date", label: "No date", rangeLabel: "No delivery date", value: 0, orders: 0, tone: "neutral" };

  const docs = new Map<string, Set<string>>();
  const add = (point: OutstandingWeekPoint, line: OutstandingLine) => {
    point.value += line.value;
    const set = docs.get(point.key) ?? new Set<string>();
    set.add(line.documentNo);
    docs.set(point.key, set);
  };
  for (const line of lines) {
    if (line.due === "overdue") add(overdue, line);
    else if (line.due === "no-date") add(noDate, line);
    else {
      const week = periodKey(line.deliveryDate, "week");
      add(week > lastWeek ? later : weeks.find((w) => w.key === week) ?? later, line);
    }
  }
  const points = [overdue, ...weeks, later, ...(noDate.value || docs.has("no-date") ? [noDate] : [])];
  return points.map((p) => ({ ...p, orders: docs.get(p.key)?.size ?? 0 }));
};

export interface OverdueOrder {
  documentNo: string;
  customer: string;
  deliveryDate: string;
  daysOverdue: number;
  value: number;
}

export const overdueOrders = (lines: OutstandingLine[]): OverdueOrder[] => {
  const byDoc = new Map<string, OverdueOrder>();
  for (const l of lines) {
    if (l.due !== "overdue") continue;
    const row = byDoc.get(l.documentNo) ?? { documentNo: l.documentNo, customer: l.customer, deliveryDate: l.deliveryDate, daysOverdue: 0, value: 0 };
    row.value += l.value;
    if ((l.daysOverdue ?? 0) > row.daysOverdue) { row.daysOverdue = l.daysOverdue ?? 0; row.deliveryDate = l.deliveryDate; }
    byDoc.set(l.documentNo, row);
  }
  return Array.from(byDoc.values()).sort((a, b) => b.daysOverdue - a.daysOverdue || b.value - a.value);
};

export interface CustomerOverdue {
  customer: string;
  orders: number;
  value: number;
}

export const overdueByCustomer = (lines: OutstandingLine[]): CustomerOverdue[] => {
  const byCustomer = new Map<string, OutstandingLine[]>();
  for (const l of lines) {
    if (l.due !== "overdue") continue;
    byCustomer.set(l.customer, [...(byCustomer.get(l.customer) ?? []), l]);
  }
  return Array.from(byCustomer, ([customer, ls]) => ({ customer, orders: countOrders(ls), value: sumValue(ls) }))
    .sort((a, b) => b.value - a.value);
};

export const recentLateDispatches = (orders: DispatchOrder[]) => orders
  .filter((o) => o.status === "late")
  .sort((a, b) => b.dispatchedOn.localeCompare(a.dispatchedOn) || (b.daysLate ?? 0) - (a.daysLate ?? 0));

export interface WarehouseRow {
  warehouse: string;
  ordersDispatched: number;
  ibtsOut: number;
  ibtsIn: number;
  outstandingValue: number;
  overdueValue: number;
}

/** Dispatch and IBT counts for [from, to]; outstanding figures are the current snapshot. */
export const warehouseBreakdown = (
  orders: DispatchOrder[],
  ibts: DispatchIbtSummary[],
  lines: OutstandingLine[],
  from: string,
  to: string,
): WarehouseRow[] => {
  const rows = new Map<string, WarehouseRow>();
  const row = (warehouse: string) => {
    const existing = rows.get(warehouse);
    if (existing) return existing;
    const created = { warehouse, ordersDispatched: 0, ibtsOut: 0, ibtsIn: 0, outstandingValue: 0, overdueValue: 0 };
    rows.set(warehouse, created);
    return created;
  };
  for (const o of orders) {
    if (!inRange(o.dispatchedOn, from, to)) continue;
    for (const w of splitWarehouses(o.warehouses)) row(w).ordersDispatched += 1;
  }
  for (const i of ibts) {
    if (!inRange(i.transactionDate, from, to)) continue;
    for (const w of splitWarehouses(i.fromWarehouses)) row(w).ibtsOut += 1;
    for (const w of splitWarehouses(i.toWarehouses)) row(w).ibtsIn += 1;
  }
  for (const l of lines) {
    const r = row(l.warehouse || "Unknown");
    r.outstandingValue += l.value;
    if (l.due === "overdue") r.overdueValue += l.value;
  }
  return Array.from(rows.values()).sort((a, b) => b.outstandingValue - a.outstandingValue || b.ordersDispatched - a.ordersDispatched);
};
