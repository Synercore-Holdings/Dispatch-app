import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatNumber, formatPercent } from "../../utils/format";
import type { IbtPeriodPoint, OrderPeriodPoint } from "../../utils/dispatchPerformance";

// Status colours are reserved for on-time / late; "no due date" is neutral gray.
export const STATUS_COLORS = {
  onTime: "#0ca30c",
  late: "#d03b3b",
  noDueDate: "#a8a69e",
};
const SERIES_BLUE = "#2a78d6";
const SURFACE = "rgb(var(--color-surface))";
const GRID = "rgb(var(--color-border))";
const AXIS_TEXT = "rgb(var(--color-text-tertiary))";

const axisProps = {
  tick: { fill: AXIS_TEXT, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: GRID },
};

const TooltipCard: React.FC<{ title: string; rows: { label: string; value: string; color?: string }[] }> = ({ title, rows }) => (
  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-card-hover">
    <p className="mb-1.5 font-semibold text-gray-900">{title}</p>
    {rows.map((row) => (
      <div key={row.label} className="flex items-center justify-between gap-6 py-0.5">
        <span className="flex items-center gap-1.5 text-gray-600">
          {row.color && <span className="h-2 w-2 rounded-sm" style={{ background: row.color }} />}
          {row.label}
        </span>
        <span className="font-semibold tabular-nums text-gray-900">{row.value}</span>
      </div>
    ))}
  </div>
);

export const ChartLegend: React.FC<{ items: { label: string; color: string }[] }> = ({ items }) => (
  <div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
    {items.map((item) => (
      <span key={item.label} className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
        {item.label}
      </span>
    ))}
  </div>
);

type TooltipProps<T> = { active?: boolean; payload?: { payload: T }[] };

export const OrdersDispatchedChart: React.FC<{ data: OrderPeriodPoint[]; onSelect?: (key: string) => void }> = ({ data, onSelect }) => (
  <ResponsiveContainer width="100%" height={260}>
    <BarChart
      data={data}
      margin={{ top: 8, right: 8, bottom: 0, left: -12 }}
      barCategoryGap="18%"
      onClick={(state) => {
        const key = (state as { activeLabel?: string } | null)?.activeLabel;
        const point = data.find((p) => p.label === key);
        if (point && onSelect) onSelect(point.key);
      }}
    >
      <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="0" />
      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={12} />
      <YAxis {...axisProps} axisLine={false} allowDecimals={false} width={44} />
      <Tooltip
        cursor={{ fill: "rgb(var(--color-surface-tertiary))", opacity: 0.6 }}
        content={({ active, payload }: TooltipProps<OrderPeriodPoint>) => {
          const point = active && payload?.[0]?.payload;
          if (!point) return null;
          return (
            <TooltipCard
              title={point.rangeLabel}
              rows={[
                { label: "Orders dispatched", value: formatNumber(point.orders) },
                { label: "On time", value: formatNumber(point.onTime), color: STATUS_COLORS.onTime },
                { label: "Late", value: formatNumber(point.late), color: STATUS_COLORS.late },
                ...(point.noDueDate ? [{ label: "No due date", value: formatNumber(point.noDueDate), color: STATUS_COLORS.noDueDate }] : []),
                { label: "On-time %", value: point.onTimePct === null ? "-" : formatPercent(point.onTimePct) },
                { label: "Qty", value: formatNumber(Math.round(point.qty)) },
              ]}
            />
          );
        }}
      />
      <Bar dataKey="onTime" name="On time" stackId="s" fill={STATUS_COLORS.onTime} stroke={SURFACE} strokeWidth={1} maxBarSize={36} />
      <Bar dataKey="late" name="Late" stackId="s" fill={STATUS_COLORS.late} stroke={SURFACE} strokeWidth={1} maxBarSize={36} />
      <Bar dataKey="noDueDate" name="No due date" stackId="s" fill={STATUS_COLORS.noDueDate} stroke={SURFACE} strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={36} />
    </BarChart>
  </ResponsiveContainer>
);

export const OnTimeTrendChart: React.FC<{ data: OrderPeriodPoint[]; target: number }> = ({ data, target }) => (
  <ResponsiveContainer width="100%" height={200}>
    <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
      <CartesianGrid vertical={false} stroke={GRID} />
      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={12} />
      <YAxis {...axisProps} axisLine={false} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} width={44} />
      <ReferenceLine y={target} stroke={AXIS_TEXT} strokeDasharray="4 4" label={{ value: `Target ${target}%`, position: "insideBottomRight", fill: AXIS_TEXT, fontSize: 11 }} />
      <Tooltip
        cursor={{ stroke: GRID }}
        content={({ active, payload }: TooltipProps<OrderPeriodPoint>) => {
          const point = active && payload?.[0]?.payload;
          if (!point) return null;
          return (
            <TooltipCard
              title={point.rangeLabel}
              rows={[
                { label: "On-time %", value: point.onTimePct === null ? "No due dates" : formatPercent(point.onTimePct), color: SERIES_BLUE },
                { label: "On time / measured", value: `${formatNumber(point.onTime)} / ${formatNumber(point.onTime + point.late)}` },
              ]}
            />
          );
        }}
      />
      <Line type="monotone" dataKey="onTimePct" stroke={SERIES_BLUE} strokeWidth={2} dot={{ r: 3, fill: SERIES_BLUE, stroke: SURFACE, strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls />
    </LineChart>
  </ResponsiveContainer>
);

export const IbtDispatchedChart: React.FC<{ data: IbtPeriodPoint[] }> = ({ data }) => (
  <ResponsiveContainer width="100%" height={260}>
    <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barCategoryGap="18%">
      <CartesianGrid vertical={false} stroke={GRID} />
      <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={12} />
      <YAxis {...axisProps} axisLine={false} allowDecimals={false} width={44} />
      <Tooltip
        cursor={{ fill: "rgb(var(--color-surface-tertiary))", opacity: 0.6 }}
        content={({ active, payload }: TooltipProps<IbtPeriodPoint>) => {
          const point = active && payload?.[0]?.payload;
          if (!point) return null;
          return (
            <TooltipCard
              title={point.rangeLabel}
              rows={[
                { label: "IBTs dispatched", value: formatNumber(point.transfers), color: SERIES_BLUE },
                { label: "Qty transferred", value: formatNumber(Math.round(point.qty)) },
              ]}
            />
          );
        }}
      />
      <Bar dataKey="transfers" name="IBTs" fill={SERIES_BLUE} radius={[4, 4, 0, 0]} maxBarSize={36} />
    </BarChart>
  </ResponsiveContainer>
);
