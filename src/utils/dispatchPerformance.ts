// Derived metrics for the Dispatch Performance view. All dates are YYYY-MM-DD strings.
import type { DispatchIbtSummary, DispatchInvoiceSummary } from "../services/api";

export type Granularity = "day" | "week" | "month";
export type DeliveryStatus = "on-time" | "late" | "no-due-date";
export type MatchStatus = "matched" | "lines-only" | "register-only";

export interface DispatchOrder extends DispatchInvoiceSummary {
  customer: string;
  /** Invoice Document Date from the lines file; falls back to the register's Dispatch Date. */
  dispatchedOn: string;
  status: DeliveryStatus;
  /** Positive = days after the due date; negative = days early. Null without a due date. */
  daysLate: number | null;
  match: MatchStatus;
}

const DAY_MS = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const toUtc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const fromUtc = (time: number) => new Date(time).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
export const addDays = (date: string, days: number) => fromUtc(toUtc(date) + days * DAY_MS);

export const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** Weeks start on Monday. */
export const periodKey = (date: string, granularity: Granularity) => {
  if (granularity === "month") return date.slice(0, 7);
  if (granularity === "day") return date;
  const weekday = (new Date(toUtc(date)).getUTCDay() + 6) % 7; // Mon = 0
  return addDays(date, -weekday);
};

export const formatIsoDate = (date: string) => (
  date ? `${date.slice(8, 10)} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : "-"
);

export const periodLabel = (key: string, granularity: Granularity) => {
  const month = MONTHS[Number(key.slice(5, 7)) - 1];
  if (granularity === "month") return `${month} ${key.slice(2, 4)}`;
  const label = `${key.slice(8, 10)} ${month}`;
  return granularity === "week" ? `Wk ${label}` : label;
};

export const periodRangeLabel = (key: string, granularity: Granularity) => {
  if (granularity === "day") return formatIsoDate(key);
  if (granularity === "month") return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  return `Week of ${formatIsoDate(key)} – ${formatIsoDate(addDays(key, 6))}`;
};

/** Every period between from and to (inclusive), so empty days/weeks still show as gaps. */
export const enumeratePeriods = (from: string, to: string, granularity: Granularity, max = 400) => {
  const keys: string[] = [];
  if (!from || !to || from > to) return keys;
  let cursor = periodKey(from, granularity);
  const last = periodKey(to, granularity);
  while (cursor <= last && keys.length < max) {
    keys.push(cursor);
    if (granularity === "day") cursor = addDays(cursor, 1);
    else if (granularity === "week") cursor = addDays(cursor, 7);
    else {
      const y = Number(cursor.slice(0, 4));
      const m = Number(cursor.slice(5, 7));
      cursor = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  return keys;
};

/** "(CHA003) Chateau Gateaux (Pty) Ltd" -> "Chateau Gateaux (Pty) Ltd" */
export const stripCustomerCode = (name: string) => name.replace(/^\s*\([^)]*\)\s*/, "").trim();

export const toDispatchOrder = (invoice: DispatchInvoiceSummary): DispatchOrder => {
  const dispatchedOn = invoice.documentDate || invoice.dispatchDate;
  const daysLate = invoice.dueDate && dispatchedOn ? daysBetween(invoice.dueDate, dispatchedOn) : null;
  return {
    ...invoice,
    customer: invoice.lineCustomer || stripCustomerCode(invoice.registerCustomer) || "Unknown customer",
    dispatchedOn,
    daysLate,
    status: daysLate === null ? "no-due-date" : daysLate > 0 ? "late" : "on-time",
    match: invoice.hasLines && invoice.hasRegister ? "matched" : invoice.hasLines ? "lines-only" : "register-only",
  };
};

export const onTimePercent = (onTime: number, late: number) => (onTime + late > 0 ? (onTime / (onTime + late)) * 100 : null);

export interface OrderPeriodPoint {
  key: string;
  label: string;
  rangeLabel: string;
  onTime: number;
  late: number;
  noDueDate: number;
  orders: number;
  qty: number;
  value: number;
  onTimePct: number | null;
}

export const buildOrderSeries = (orders: DispatchOrder[], from: string, to: string, granularity: Granularity): OrderPeriodPoint[] => {
  const points = new Map<string, OrderPeriodPoint>(enumeratePeriods(from, to, granularity).map((key) => [key, {
    key,
    label: periodLabel(key, granularity),
    rangeLabel: periodRangeLabel(key, granularity),
    onTime: 0, late: 0, noDueDate: 0, orders: 0, qty: 0, value: 0, onTimePct: null,
  }]));
  for (const order of orders) {
    const point = points.get(periodKey(order.dispatchedOn, granularity));
    if (!point) continue;
    point.orders += 1;
    point.qty += order.qty;
    point.value += order.totalExcl;
    if (order.status === "on-time") point.onTime += 1;
    else if (order.status === "late") point.late += 1;
    else point.noDueDate += 1;
  }
  return Array.from(points.values(), (point) => ({ ...point, onTimePct: onTimePercent(point.onTime, point.late) }));
};

export interface CustomerStat {
  customer: string;
  orders: number;
  qty: number;
  value: number;
  onTime: number;
  late: number;
  onTimePct: number | null;
  avgDaysLate: number | null;
}

export const buildCustomerStats = (orders: DispatchOrder[]): CustomerStat[] => {
  const byCustomer = new Map<string, CustomerStat & { lateDays: number }>();
  for (const order of orders) {
    const stat = byCustomer.get(order.customer) || {
      customer: order.customer, orders: 0, qty: 0, value: 0, onTime: 0, late: 0, onTimePct: null, avgDaysLate: null, lateDays: 0,
    };
    stat.orders += 1;
    stat.qty += order.qty;
    stat.value += order.totalExcl;
    if (order.status === "on-time") stat.onTime += 1;
    if (order.status === "late") { stat.late += 1; stat.lateDays += order.daysLate ?? 0; }
    byCustomer.set(order.customer, stat);
  }
  return Array.from(byCustomer.values(), ({ lateDays, ...stat }) => ({
    ...stat,
    onTimePct: onTimePercent(stat.onTime, stat.late),
    avgDaysLate: stat.late ? lateDays / stat.late : null,
  })).sort((a, b) => b.orders - a.orders || b.qty - a.qty);
};

export interface IbtPeriodPoint {
  key: string;
  label: string;
  rangeLabel: string;
  transfers: number;
  qty: number;
}

export const buildIbtSeries = (ibts: DispatchIbtSummary[], from: string, to: string, granularity: Granularity): IbtPeriodPoint[] => {
  const points = new Map<string, IbtPeriodPoint>(enumeratePeriods(from, to, granularity).map((key) => [key, {
    key, label: periodLabel(key, granularity), rangeLabel: periodRangeLabel(key, granularity), transfers: 0, qty: 0,
  }]));
  for (const ibt of ibts) {
    const point = points.get(periodKey(ibt.transactionDate, granularity));
    if (!point) continue;
    point.transfers += 1;
    point.qty += ibt.qty;
  }
  return Array.from(points.values());
};

export interface IbtRouteStat {
  route: string;
  from: string;
  to: string;
  transfers: number;
  qty: number;
}

export const buildIbtRoutes = (ibts: DispatchIbtSummary[]): IbtRouteStat[] => {
  const byRoute = new Map<string, IbtRouteStat>();
  for (const ibt of ibts) {
    const from = ibt.fromWarehouses || "?";
    const to = ibt.toWarehouses || "?";
    const route = `${from} → ${to}`;
    const stat = byRoute.get(route) || { route, from, to, transfers: 0, qty: 0 };
    stat.transfers += 1;
    stat.qty += ibt.qty;
    byRoute.set(route, stat);
  }
  return Array.from(byRoute.values()).sort((a, b) => b.transfers - a.transfers || b.qty - a.qty);
};
