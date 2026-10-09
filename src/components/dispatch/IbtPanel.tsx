import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { dispatchPerformanceAPI, type DispatchIbtLineDetail, type DispatchIbtSummary } from "../../services/api";
import { formatNumber } from "../../utils/format";
import { buildIbtRoutes, buildIbtSeries, formatIsoDate, type Granularity } from "../../utils/dispatchPerformance";
import { IbtDispatchedChart } from "./DispatchCharts";
import { Panel, StatTile } from "./DispatchUi";

const PAGE_SIZE = 200;

const IbtLines: React.FC<{ reference: string }> = ({ reference }) => {
  const [lines, setLines] = useState<DispatchIbtLineDetail[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    dispatchPerformanceAPI.getIbtLines(reference).then(setLines).catch((err) => setError(err instanceof Error ? err.message : "Failed to load lines"));
  }, [reference]);
  if (error) return <p className="px-4 py-3 text-xs text-red-600">{error}</p>;
  if (!lines) return <p className="flex items-center gap-2 px-4 py-3 text-xs text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading lines…</p>;
  return (
    <table className="w-full text-xs">
      <thead className="text-gray-500">
        <tr>
          <th className="px-4 py-1.5 text-left font-medium">Code</th>
          <th className="px-4 py-1.5 text-left font-medium">Item</th>
          <th className="px-4 py-1.5 text-left font-medium">Warehouse</th>
          <th className="px-4 py-1.5 text-right font-medium">Qty out</th>
          <th className="px-4 py-1.5 text-right font-medium">Qty in</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <tr key={`${line.sourceId}-${line.warehouseCode}`} className="border-t border-gray-200">
            <td className="px-4 py-1.5 text-gray-600">{line.inventoryCode || "-"}</td>
            <td className="px-4 py-1.5 text-gray-900">{line.inventoryName || "-"}</td>
            <td className="px-4 py-1.5 text-gray-600">{line.warehouseCode}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{line.qtyOut ? formatNumber(line.qtyOut) : "-"}</td>
            <td className="px-4 py-1.5 text-right tabular-nums">{line.qtyIn ? formatNumber(line.qtyIn) : "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

interface IbtPanelProps {
  ibts: DispatchIbtSummary[];
  from: string;
  to: string;
  granularity: Granularity;
}

export const IbtPanel: React.FC<IbtPanelProps> = ({ ibts, from, to, granularity }) => {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const series = useMemo(() => buildIbtSeries(ibts, from, to, granularity), [ibts, from, to, granularity]);
  const routes = useMemo(() => buildIbtRoutes(ibts), [ibts]);
  const totals = useMemo(() => ({
    transfers: ibts.length,
    qty: ibts.reduce((sum, ibt) => sum + ibt.qty, 0),
    productLines: ibts.reduce((sum, ibt) => sum + ibt.productCount, 0),
  }), [ibts]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return ibts
      .filter((ibt) => !term || [ibt.reference, ibt.fromWarehouses, ibt.toWarehouses].some((v) => v.toLowerCase().includes(term)))
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.reference.localeCompare(a.reference));
  }, [ibts, search]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="IBTs dispatched" value={formatNumber(totals.transfers)} hint="1 IBT reference = 1 transfer" />
        <StatTile label="Qty transferred" value={formatNumber(Math.round(totals.qty))} hint="Sum of QtyOut" />
        <StatTile label="Product lines" value={formatNumber(totals.productLines)} />
        <StatTile label="Routes used" value={formatNumber(routes.length)} hint="From → to warehouse pairs" />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="IBTs dispatched" subtitle="Counted on TransactionDate">
          <IbtDispatchedChart data={series} />
        </Panel>
        <Panel title="By route" subtitle="Sending → receiving warehouse">
          <div className="max-h-[260px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-xs text-gray-500">
                <tr className="border-b border-gray-200">
                  <th className="px-2 py-2 text-left font-medium">Route</th>
                  <th className="px-2 py-2 text-right font-medium">IBTs</th>
                  <th className="px-2 py-2 text-right font-medium">Qty</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {routes.map((route) => (
                  <tr key={route.route} onClick={() => setSearch(route.from)} className="cursor-pointer border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-2 py-2 text-gray-900">{route.route}</td>
                    <td className="px-2 py-2 text-right">{formatNumber(route.transfers)}</td>
                    <td className="px-2 py-2 text-right">{formatNumber(Math.round(route.qty))}</td>
                  </tr>
                ))}
                {routes.length === 0 && <tr><td colSpan={3} className="px-2 py-6 text-center text-gray-500">No IBTs in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel
        title="Dispatched IBTs"
        subtitle={`${formatNumber(filtered.length)} transfers`}
        actions={
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
              placeholder="Reference or warehouse…"
              className="w-full sm:w-56 rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs text-gray-900 focus:border-emerald-400 focus:outline-none"
            />
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="w-6" />
                <th className="px-3 py-2 text-left font-medium">Reference</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">From</th>
                <th className="px-3 py-2 text-left font-medium">To</th>
                <th className="px-3 py-2 text-right font-medium">Products</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, visibleCount).map((ibt) => (
                <React.Fragment key={ibt.reference}>
                  <tr onClick={() => setExpanded(expanded === ibt.reference ? null : ibt.reference)} className="cursor-pointer border-b border-gray-200 hover:bg-gray-50">
                    <td className="pl-2 text-gray-400">{expanded === ibt.reference ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                    <td className="px-3 py-2 font-medium text-gray-900">{ibt.reference}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-gray-600">{formatIsoDate(ibt.transactionDate)}</td>
                    <td className="px-3 py-2 text-gray-600">{ibt.fromWarehouses || "-"}</td>
                    <td className="px-3 py-2 text-gray-600">{ibt.toWarehouses || "-"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(ibt.productCount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(ibt.qty)}</td>
                  </tr>
                  {expanded === ibt.reference && (
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <td colSpan={7}><IbtLines reference={ibt.reference} /></td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">No IBTs match.</td></tr>}
            </tbody>
          </table>
        </div>
        {filtered.length > visibleCount && (
          <button type="button" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)} className="mt-3 text-xs font-semibold text-emerald-700 hover:underline">
            Show more ({formatNumber(filtered.length - visibleCount)} remaining)
          </button>
        )}
      </Panel>
    </div>
  );
};
