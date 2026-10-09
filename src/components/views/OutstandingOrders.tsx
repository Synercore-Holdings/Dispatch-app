import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, RefreshCw, Search, X } from "lucide-react";
import * as XLSX from "../../lib/spreadsheet";
import { outstandingOrdersAPI, type OutstandingOrdersSnapshot } from "../../services/api";
import { formatNumber } from "../../utils/format";
import { addDays, formatIsoDate, todayIso } from "../../utils/dispatchPerformance";
import { DUE_SOON_DAYS, countOrders, sumValue, toOutstandingLine, type DueBucket, type OutstandingLine as Line } from "../../utils/outstandingOrders";
import { Panel, StatTile } from "../dispatch/DispatchUi";
import { OutstandingUpload } from "../outstanding/OutstandingUpload";

const PAGE_SIZE = 200;
const formatRand = (value: number) => `R${formatNumber(Math.round(value))}`;
const selectClass = "rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-900 focus:border-emerald-400 focus:outline-none";

type DueFilter = "all" | DueBucket;

const DueBadge: React.FC<{ line: Line }> = ({ line }) => {
  if (line.due === "overdue") {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600"><AlertTriangle className="h-3.5 w-3.5" /> {line.daysOverdue}d overdue</span>;
  }
  if (line.due === "due-soon") {
    return <span className="text-xs font-semibold text-amber-600">{line.daysOverdue === 0 ? "Due today" : `Due in ${-(line.daysOverdue ?? 0)}d`}</span>;
  }
  if (line.due === "no-date") return <span className="text-xs text-gray-500">No date</span>;
  return <span className="text-xs text-gray-500">In {-(line.daysOverdue ?? 0)}d</span>;
};

export const OutstandingOrders: React.FC = () => {
  const [snapshot, setSnapshot] = useState<OutstandingOrdersSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [status, setStatus] = useState("");
  const [customer, setCustomer] = useState("");
  const [due, setDue] = useState<DueFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSnapshot(await outstandingOrdersAPI.get());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load outstanding orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const today = todayIso();
  const lines = useMemo(() => (snapshot?.lines ?? []).map((l) => toOutstandingLine(l, today)), [snapshot, today]);

  const options = useMemo(() => {
    const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort();
    return {
      warehouses: uniq(lines.map((l) => l.warehouse)),
      statuses: uniq(lines.map((l) => l.status)),
      customers: uniq(lines.map((l) => l.customer)),
    };
  }, [lines]);

  // Everything except the due-date chip, so chip counts reflect the other filters.
  const baseFiltered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return lines.filter((l) => (
      (!warehouse || l.warehouse === warehouse)
      && (!status || l.status === status)
      && (!customer || l.customer === customer)
      && (!term || [l.documentNo, l.customer, l.customerCode, l.inventoryCode, l.inventoryDescription].some((v) => v.toLowerCase().includes(term)))
    ));
  }, [lines, search, warehouse, status, customer]);

  const filtered = useMemo(() => (due === "all" ? baseFiltered : baseFiltered.filter((l) => l.due === due)), [baseFiltered, due]);

  const totals = useMemo(() => {
    const ordersOf = countOrders;
    const valueOf = sumValue;
    const overdue = baseFiltered.filter((l) => l.due === "overdue");
    const dueSoon = baseFiltered.filter((l) => l.due === "due-soon");
    return {
      orders: ordersOf(baseFiltered),
      lines: baseFiltered.length,
      value: valueOf(baseFiltered),
      overdueOrders: ordersOf(overdue),
      overdueValue: valueOf(overdue),
      dueSoonOrders: ordersOf(dueSoon),
      dueSoonValue: valueOf(dueSoon),
      counts: {
        all: baseFiltered.length,
        overdue: overdue.length,
        "due-soon": dueSoon.length,
        later: baseFiltered.filter((l) => l.due === "later").length,
        "no-date": baseFiltered.filter((l) => l.due === "no-date").length,
      } as Record<DueFilter, number>,
    };
  }, [baseFiltered]);

  const byCustomer = useMemo(() => {
    const map = new Map<string, { customer: string; orders: Set<string>; lines: number; value: number; overdueValue: number; oldestDue: string }>();
    for (const l of filtered) {
      const row = map.get(l.customer) ?? { customer: l.customer, orders: new Set<string>(), lines: 0, value: 0, overdueValue: 0, oldestDue: "" };
      row.orders.add(l.documentNo);
      row.lines += 1;
      row.value += l.value;
      if (l.due === "overdue") row.overdueValue += l.value;
      if (l.deliveryDate && (!row.oldestDue || l.deliveryDate < row.oldestDue)) row.oldestDue = l.deliveryDate;
      map.set(l.customer, row);
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const exportLines = () => {
    const sheet = XLSX.utils.json_to_sheet(filtered.map((l) => ({
      "Document No": l.documentNo,
      "Customer Code": l.customerCode,
      "Customer Name": l.customer,
      Status: l.status,
      "Delivery Date": l.deliveryDate,
      "Days Overdue": l.daysOverdue !== null && l.daysOverdue > 0 ? l.daysOverdue : "",
      "Inventory Code": l.inventoryCode,
      "Inventory Description": l.inventoryDescription,
      Warehouse: l.warehouse,
      "Outstanding Qty": l.qty,
      "Unit Price": l.unitPrice ?? "",
      "Total Excl": l.value,
      "Date Created": l.dateCreated,
      "Created By": l.createdBy,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Outstanding orders");
    void XLSX.writeFile(wb, `outstanding-sales-orders-${today}.xlsx`);
  };

  const dueChips: { id: DueFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "overdue", label: "Overdue" },
    { id: "due-soon", label: `Due in ${DUE_SOON_DAYS} days` },
    { id: "later", label: "Later" },
    { id: "no-date", label: "No delivery date" },
  ];
  const hasFilters = Boolean(search || warehouse || status || customer);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Outstanding Sales Orders</h2>
        <p className="mt-1 text-sm text-gray-500">
          Open sales order lines from the latest upload. Overdue = Delivery Date before today ({formatIsoDate(today)}).
        </p>
      </div>

      <OutstandingUpload upload={snapshot?.upload ?? null} onUploaded={() => void load()} />

      <div className="z-10 -mx-1 md:sticky md:top-0 flex flex-wrap items-center gap-2 rounded-card border border-gray-200 bg-white/95 px-3 py-2.5 shadow-card backdrop-blur">
        <div className="relative w-full sm:w-auto">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
            placeholder="ASO, customer, product…"
            className="w-full sm:w-56 rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-900 focus:border-emerald-400 focus:outline-none"
          />
        </div>
        <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)} className={`${selectClass} max-w-[220px]`} aria-label="Warehouse">
          <option value="">All warehouses</option>
          {options.warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass} aria-label="Status">
          <option value="">All statuses</option>
          {options.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={customer} onChange={(e) => setCustomer(e.target.value)} className={`${selectClass} max-w-[220px]`} aria-label="Customer">
          <option value="">All customers</option>
          {options.customers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {hasFilters && (
          <button type="button" onClick={() => { setSearch(""); setWarehouse(""); setStatus(""); setCustomer(""); }} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-900">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        <button type="button" onClick={() => void load()} className="ml-auto text-gray-400 hover:text-gray-900" title="Refresh">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </button>
      </div>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!snapshot && loading ? (
        <div className="flex min-h-[300px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-resilinc-primary" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Open sales orders" value={formatNumber(totals.orders)} hint={`${formatNumber(totals.lines)} lines`} />
            <StatTile label="Outstanding value excl." value={formatRand(totals.value)} hint="Sum of Total Excl Tax Outstanding" />
            <StatTile
              label="Overdue"
              value={formatRand(totals.overdueValue)}
              hint={`${formatNumber(totals.overdueOrders)} orders past their delivery date`}
              tone={totals.overdueOrders ? "critical" : "good"}
            />
            <StatTile label={`Due in next ${DUE_SOON_DAYS} days`} value={formatRand(totals.dueSoonValue)} hint={`${formatNumber(totals.dueSoonOrders)} orders, up to ${formatIsoDate(addDays(today, DUE_SOON_DAYS))}`} />
          </div>

          <Panel title="By customer" subtitle={`${formatNumber(byCustomer.length)} customers · click a customer to filter`}>
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-xs text-gray-500">
                  <tr className="border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-medium">Customer</th>
                    <th className="px-3 py-2 text-right font-medium">Orders</th>
                    <th className="px-3 py-2 text-right font-medium">Lines</th>
                    <th className="px-3 py-2 text-right font-medium">Value excl.</th>
                    <th className="px-3 py-2 text-right font-medium">Overdue value</th>
                    <th className="px-3 py-2 text-right font-medium">Earliest delivery</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {byCustomer.map((c) => (
                    <tr key={c.customer} onClick={() => setCustomer(c.customer)} className="cursor-pointer border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{c.customer}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(c.orders.size)}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(c.lines)}</td>
                      <td className="px-3 py-2 text-right">{formatRand(c.value)}</td>
                      <td className={`px-3 py-2 text-right ${c.overdueValue ? "font-semibold text-red-600" : ""}`}>{c.overdueValue ? formatRand(c.overdueValue) : "-"}</td>
                      <td className="px-3 py-2 text-right">{formatIsoDate(c.oldestDue)}</td>
                    </tr>
                  ))}
                  {byCustomer.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">{lines.length ? "No orders match these filters." : "Upload the outstanding sales orders export to get started."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Outstanding lines"
            subtitle={`${formatNumber(filtered.length)} lines · sorted by delivery date`}
            actions={
              <button type="button" onClick={exportLines} disabled={!filtered.length} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                <Download className="h-3.5 w-3.5" /> Export Excel
              </button>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {dueChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => { setDue(chip.id); setVisibleCount(PAGE_SIZE); }}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${due === chip.id ? "border-emerald-300 bg-green-50 text-emerald-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                >
                  {chip.label} <span className="tabular-nums opacity-70">{formatNumber(totals.counts[chip.id])}</span>
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500">
                  <tr className="border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-medium">Document</th>
                    <th className="px-3 py-2 text-left font-medium">Customer</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium">Delivery</th>
                    <th className="px-3 py-2 text-left font-medium" />
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-left font-medium">Warehouse</th>
                    <th className="px-3 py-2 text-right font-medium">Outstanding qty</th>
                    <th className="px-3 py-2 text-right font-medium">Value excl.</th>
                    <th className="px-3 py-2 text-left font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, visibleCount).map((l, i) => (
                    <tr key={`${l.documentNo}-${l.inventoryCode}-${i}`} className={`border-b border-gray-200 ${l.due === "overdue" ? "bg-red-50/40" : ""}`}>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">{l.documentNo}</td>
                      <td className="max-w-[240px] truncate px-3 py-2 text-gray-900" title={`${l.customerCode} ${l.customer}`}>{l.customer}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">{l.status || "-"}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">{formatIsoDate(l.deliveryDate)}</td>
                      <td className="whitespace-nowrap px-3 py-2"><DueBadge line={l} /></td>
                      <td className="max-w-[260px] truncate px-3 py-2 text-gray-900" title={`${l.inventoryCode} ${l.inventoryDescription}`}>
                        <span className="text-gray-500">{l.inventoryCode}</span> {l.inventoryDescription}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-gray-600" title={l.warehouse}>{l.warehouse || "-"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(l.qty)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatRand(l.value)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500" title={l.createdBy}>{formatIsoDate(l.dateCreated)}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-500">{lines.length ? "No lines match these filters." : "No outstanding orders uploaded yet."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > visibleCount && (
              <button type="button" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)} className="mt-3 text-xs font-semibold text-emerald-700 hover:underline">
                Show more ({formatNumber(filtered.length - visibleCount)} remaining)
              </button>
            )}
          </Panel>
        </>
      )}
    </div>
  );
};
