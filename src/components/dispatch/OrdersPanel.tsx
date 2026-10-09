import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, HelpCircle, Loader2, Search } from "lucide-react";
import * as XLSX from "../../lib/spreadsheet";
import { dispatchPerformanceAPI, type DispatchInvoiceLineDetail } from "../../services/api";
import { formatNumber, formatPercent } from "../../utils/format";
import {
  buildCustomerStats,
  buildOrderSeries,
  formatIsoDate,
  onTimePercent,
  periodKey,
  type DispatchOrder,
  type Granularity,
} from "../../utils/dispatchPerformance";
import { ChartLegend, OnTimeTrendChart, OrdersDispatchedChart, STATUS_COLORS } from "./DispatchCharts";
import { Panel, StatTile } from "./DispatchUi";

const ON_TIME_TARGET = 95;
const PAGE_SIZE = 200;
const formatRand = (value: number) => `R${formatNumber(Math.round(value))}`;

type StatusFilter = "all" | "late" | "on-time" | "unmatched";

const StatusBadge: React.FC<{ order: DispatchOrder }> = ({ order }) => {
  if (order.status === "late") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600">
        <AlertTriangle className="h-3.5 w-3.5" /> Late {order.daysLate}d
      </span>
    );
  }
  if (order.status === "on-time") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> On time
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500" title="Invoice isn't in the register upload yet, so there's no due date">
      <HelpCircle className="h-3.5 w-3.5" /> No due date
    </span>
  );
};

const InvoiceLines: React.FC<{ invoiceNo: string }> = ({ invoiceNo }) => {
  const [lines, setLines] = useState<DispatchInvoiceLineDetail[] | null>(null);
  const [error, setError] = useState("");
  React.useEffect(() => {
    dispatchPerformanceAPI.getInvoiceLines(invoiceNo).then(setLines).catch((err) => setError(err instanceof Error ? err.message : "Failed to load lines"));
  }, [invoiceNo]);
  if (error) return <p className="px-4 py-3 text-xs text-red-600">{error}</p>;
  if (!lines) return <p className="flex items-center gap-2 px-4 py-3 text-xs text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading lines…</p>;
  if (lines.length === 0) return <p className="px-4 py-3 text-xs text-gray-500">No invoice lines uploaded for this invoice yet.</p>;
  return (
    <table className="w-full text-xs">
      <thead className="text-gray-500">
        <tr>
          <th className="px-4 py-1.5 text-left font-medium">Item</th>
          <th className="px-4 py-1.5 text-left font-medium">Warehouse</th>
          <th className="px-4 py-1.5 text-right font-medium">Qty</th>
          <th className="px-4 py-1.5 text-right font-medium">Unit price</th>
          <th className="px-4 py-1.5 text-right font-medium">Total excl.</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={line.lineNo} className="border-t border-gray-200">
            <td className="px-4 py-1.5 text-gray-900">{line.inventoryName || "-"}</td>
            <td className="px-4 py-1.5 text-gray-600">{line.warehouse || "-"}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{formatNumber(line.qty)}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{line.unitPriceExcl === null ? "-" : `R${line.unitPriceExcl.toFixed(2)}`}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{line.totalExcl === null ? "-" : formatRand(line.totalExcl)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

interface OrdersPanelProps {
  orders: DispatchOrder[];
  from: string;
  to: string;
  granularity: Granularity;
  onSelectCustomer: (customer: string) => void;
}

export const OrdersPanel: React.FC<OrdersPanelProps> = ({ orders, from, to, granularity, onSelectCustomer }) => {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [periodFilter, setPeriodFilter] = useState<string | null>(null);

  const series = useMemo(() => buildOrderSeries(orders, from, to, granularity), [orders, from, to, granularity]);
  const customers = useMemo(() => buildCustomerStats(orders), [orders]);

  const totals = useMemo(() => {
    const onTime = orders.filter((o) => o.status === "on-time").length;
    const late = orders.filter((o) => o.status === "late").length;
    return {
      orders: orders.length,
      onTime,
      late,
      noDueDate: orders.length - onTime - late,
      registerOnly: orders.filter((o) => o.match === "register-only").length,
      qty: orders.reduce((sum, o) => sum + o.qty, 0),
      value: orders.reduce((sum, o) => sum + o.totalExcl, 0),
      onTimePct: onTimePercent(onTime, late),
    };
  }, [orders]);

  const periodOf = useMemo(() => {
    const point = series.find((p) => p.key === periodFilter);
    return point ? { key: point.key, label: point.rangeLabel } : null;
  }, [series, periodFilter]);

  const filteredOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders
      .filter((o) => statusFilter === "all"
        || (statusFilter === "unmatched" ? o.match !== "matched" : o.status === statusFilter))
      .filter((o) => !periodOf || periodKey(o.dispatchedOn, granularity) === periodOf.key)
      .filter((o) => !term || [o.invoiceNo, o.salesOrder, o.customer, o.deliveryNote].some((v) => v.toLowerCase().includes(term)))
      .sort((a, b) => b.dispatchedOn.localeCompare(a.dispatchedOn) || b.invoiceNo.localeCompare(a.invoiceNo));
  }, [orders, statusFilter, search, periodOf, granularity]);

  const exportInvoices = () => {
    const sheet = XLSX.utils.json_to_sheet(filteredOrders.map((o) => ({
      "Invoice No": o.invoiceNo,
      "Sales Order": o.salesOrder,
      "Delivery Note": o.deliveryNote,
      Branch: o.branch,
      Customer: o.customer,
      "Dispatched (Document Date)": o.dispatchedOn,
      "Delivery / Due Date": o.dueDate,
      Status: o.status === "on-time" ? "On time" : o.status === "late" ? "Late" : "No due date",
      "Days Late": o.daysLate ?? "",
      Qty: o.qty,
      "Total Excl": o.totalExcl,
      "Total Incl": o.totalIncl,
      Lines: o.lineCount,
      Match: o.match === "matched" ? "Both files" : o.match === "lines-only" ? "Invoice lines only" : "Register only",
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Dispatched orders");
    const custSheet = XLSX.utils.json_to_sheet(customers.map((c) => ({
      Customer: c.customer, Orders: c.orders, Qty: c.qty, "Value Excl": Math.round(c.value),
      "On Time": c.onTime, Late: c.late, "On-time %": c.onTimePct === null ? "" : Number(c.onTimePct.toFixed(1)),
    })));
    XLSX.utils.book_append_sheet(wb, custSheet, "By customer");
    void XLSX.writeFile(wb, `dispatch-performance-${from}-to-${to}.xlsx`);
  };

  const statusChips: { id: StatusFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: totals.orders },
    { id: "late", label: "Late", count: totals.late },
    { id: "on-time", label: "On time", count: totals.onTime },
    { id: "unmatched", label: "Not in both files", count: orders.filter((o) => o.match !== "matched").length },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Orders dispatched" value={formatNumber(totals.orders)} hint="1 invoice = 1 order" />
        <StatTile
          label="On time"
          value={totals.onTimePct === null ? "-" : formatPercent(totals.onTimePct)}
          hint={`${formatNumber(totals.onTime)} of ${formatNumber(totals.onTime + totals.late)} with a due date · target ${ON_TIME_TARGET}%`}
          tone={totals.onTimePct === null ? undefined : totals.onTimePct >= ON_TIME_TARGET ? "good" : "critical"}
        />
        <StatTile label="Late orders" value={formatNumber(totals.late)} hint="Dispatched after Delivery / Due Date" tone={totals.late ? "critical" : undefined} />
        <StatTile label="Qty dispatched" value={formatNumber(Math.round(totals.qty))} hint="Sum of invoice line qty" />
        <StatTile label="Value excl. VAT" value={formatRand(totals.value)} hint="Sum of invoice lines" />
      </div>

      {(totals.noDueDate > 0 || totals.registerOnly > 0) && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          {totals.noDueDate > 0 && <>{formatNumber(totals.noDueDate)} invoice(s) have no due date (not in the invoice register upload), so they aren't counted in on-time %. </>}
          {totals.registerOnly > 0 && <>{formatNumber(totals.registerOnly)} invoice(s) are in the register but have no invoice lines, so their qty and value show as 0.</>}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Orders dispatched"
          subtitle="Click a bar to list that period's invoices"
          actions={<ChartLegend items={[
            { label: "On time", color: STATUS_COLORS.onTime },
            { label: "Late", color: STATUS_COLORS.late },
            { label: "No due date", color: STATUS_COLORS.noDueDate },
          ]} />}
        >
          <OrdersDispatchedChart data={series} onSelect={(key) => { setPeriodFilter(key); setVisibleCount(PAGE_SIZE); }} />
        </Panel>
        <Panel title="On-time %" subtitle="Document Date on or before Delivery / Due Date">
          <OnTimeTrendChart data={series} target={ON_TIME_TARGET} />
        </Panel>
      </div>

      <Panel title="By customer" subtitle={`${formatNumber(customers.length)} customers · click a customer to filter`}>
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-xs text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="px-3 py-2 text-left font-medium">Customer</th>
                <th className="px-3 py-2 text-right font-medium">Orders</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Value excl.</th>
                <th className="px-3 py-2 text-right font-medium">On time</th>
                <th className="px-3 py-2 text-right font-medium">Late</th>
                <th className="px-3 py-2 text-right font-medium">On-time %</th>
                <th className="px-3 py-2 text-right font-medium">Avg days late</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {customers.map((c) => (
                <tr key={c.customer} onClick={() => onSelectCustomer(c.customer)} className="cursor-pointer border-b border-gray-200 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">{c.customer}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(c.orders)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(Math.round(c.qty))}</td>
                  <td className="px-3 py-2 text-right">{formatRand(c.value)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(c.onTime)}</td>
                  <td className={`px-3 py-2 text-right ${c.late ? "font-semibold text-red-600" : ""}`}>{formatNumber(c.late)}</td>
                  <td className="px-3 py-2 text-right">{c.onTimePct === null ? "-" : formatPercent(c.onTimePct)}</td>
                  <td className="px-3 py-2 text-right">{c.avgDaysLate === null ? "-" : c.avgDaysLate.toFixed(1)}</td>
                </tr>
              ))}
              {customers.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">No dispatched orders in this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Dispatched invoices"
        subtitle={periodOf ? `Showing ${periodOf.label}` : `${formatNumber(filteredOrders.length)} invoices`}
        actions={
          <button type="button" onClick={exportInvoices} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
            <Download className="h-3.5 w-3.5" /> Export Excel
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {statusChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => { setStatusFilter(chip.id); setVisibleCount(PAGE_SIZE); }}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusFilter === chip.id ? "border-emerald-300 bg-green-50 text-emerald-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
            >
              {chip.label} <span className="tabular-nums opacity-70">{formatNumber(chip.count)}</span>
            </button>
          ))}
          {periodOf && (
            <button type="button" onClick={() => setPeriodFilter(null)} className="rounded-full border border-emerald-300 bg-green-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              {periodOf.label} ✕
            </button>
          )}
          <div className="relative w-full sm:ml-auto sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
              placeholder="Invoice, ASO, customer…"
              className="w-full sm:w-56 rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-900 focus:border-emerald-400 focus:outline-none"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="w-6" />
                <th className="px-3 py-2 text-left font-medium">Invoice</th>
                <th className="px-3 py-2 text-left font-medium">Sales order</th>
                <th className="px-3 py-2 text-left font-medium">Customer</th>
                <th className="px-3 py-2 text-left font-medium">Branch</th>
                <th className="px-3 py-2 text-left font-medium">Dispatched</th>
                <th className="px-3 py-2 text-left font-medium">Due</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Value excl.</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.slice(0, visibleCount).map((o) => (
                <React.Fragment key={o.invoiceNo}>
                  <tr onClick={() => setExpanded(expanded === o.invoiceNo ? null : o.invoiceNo)} className="cursor-pointer border-b border-gray-200 hover:bg-gray-50">
                    <td className="pl-2 text-gray-400">{expanded === o.invoiceNo ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{o.invoiceNo}</td>
                    <td className="px-3 py-2 text-gray-600">{o.salesOrder || "-"}</td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-gray-900" title={o.customer}>{o.customer}</td>
                    <td className="px-3 py-2 text-gray-600">{o.branch.replace(/^African Foods\s*/i, "") || "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">{formatIsoDate(o.dispatchedOn)}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">{formatIsoDate(o.dueDate)}</td>
                    <td className="whitespace-nowrap px-3 py-2"><StatusBadge order={o} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{o.hasLines ? formatNumber(o.qty) : "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{o.hasLines ? formatRand(o.totalExcl) : "-"}</td>
                  </tr>
                  {expanded === o.invoiceNo && (
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <td colSpan={10}><InvoiceLines invoiceNo={o.invoiceNo} /></td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filteredOrders.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-500">No invoices match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredOrders.length > visibleCount && (
          <button type="button" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)} className="mt-3 text-xs font-semibold text-emerald-700 hover:underline">
            Show more ({formatNumber(filteredOrders.length - visibleCount)} remaining)
          </button>
        )}
      </Panel>
    </div>
  );
};
