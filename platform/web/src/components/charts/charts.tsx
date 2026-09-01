"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { cn, fmtCompact, fmtInt } from "@/lib/utils";
import {
  MARGIN,
  SERIES,
  TooltipShell,
  axisLine,
  axisTick,
  gridLine,
  ordinalColor,
  seriesColor,
} from "./chart-kit";

/* =========================================================================
 * Shared types
 * ========================================================================= */

export interface SeriesSpec {
  key: string;
  label: string;
  color?: string;
  /** Render this series as a line on top of bars/areas. */
  type?: "line" | "area" | "bar";
  /** Format a raw value for tooltips and labels. */
  format?: (v: number) => string;
  /** Dashed stroke for targets and baselines. */
  dashed?: boolean;
}

type Datum = Record<string, string | number | null>;

const defaultFormat = (v: number) => fmtInt(v);

/* =========================================================================
 * Time series — line, area, or stacked area
 * ========================================================================= */

export function TimeSeries({
  data,
  series,
  xKey = "label",
  height = 240,
  stacked = false,
  variant = "area",
  yFormat = fmtCompact,
  onPointClick,
  showGrid = true,
  yDomain,
  referenceLines,
  tooltipSubtitle,
  className,
}: {
  data: Datum[];
  series: SeriesSpec[];
  xKey?: string;
  height?: number;
  stacked?: boolean;
  variant?: "line" | "area";
  yFormat?: (v: number) => string;
  onPointClick?: (datum: Datum) => void;
  showGrid?: boolean;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  referenceLines?: { y: number; label: string; tone?: "neutral" | "good" | "critical" }[];
  tooltipSubtitle?: (datum: Datum) => string | undefined;
  className?: string;
}) {
  const Chart = variant === "line" ? LineChart : AreaChart;
  const gradientPrefix = React.useId();

  return (
    <div className={cn("size-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart
          data={data}
          margin={MARGIN.default}
          onClick={(state) => {
            const idx = state?.activeTooltipIndex;
            if (onPointClick && typeof idx === "number" && data[idx]) onPointClick(data[idx]);
          }}
        >
          {variant === "area" ? (
            <defs>
              {series.map((s, i) => (
                <linearGradient
                  key={s.key}
                  id={`${gradientPrefix}-${s.key}`}
                  x1="0" y1="0" x2="0" y2="1"
                >
                  <stop offset="0%" stopColor={s.color ?? seriesColor(i)} stopOpacity={stacked ? 0.85 : 0.22} />
                  <stop offset="100%" stopColor={s.color ?? seriesColor(i)} stopOpacity={stacked ? 0.85 : 0.02} />
                </linearGradient>
              ))}
            </defs>
          ) : null}

          {showGrid ? (
            <CartesianGrid {...gridLine} strokeDasharray="0" vertical={false} />
          ) : null}

          <XAxis
            dataKey={xKey}
            tick={axisTick}
            {...axisLine}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
            padding={{ left: 4, right: 4 }}
          />
          <YAxis
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={yFormat}
            domain={yDomain}
          />

          {referenceLines?.map((r) => (
            <ReferenceLine
              key={r.label}
              y={r.y}
              stroke={
                r.tone === "good" ? "var(--good)" : r.tone === "critical" ? "var(--critical)" : "var(--ink-4)"
              }
              strokeDasharray="3 3"
              strokeWidth={1}
              label={{
                value: r.label,
                position: "right",
                fill: "var(--ink-4)",
                fontSize: 10,
              }}
            />
          ))}

          <Tooltip
            cursor={{ stroke: "var(--ink-4)", strokeWidth: 1, strokeDasharray: "3 3" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const datum = payload[0].payload as Datum;
              return (
                <TooltipShell
                  title={String(label)}
                  subtitle={tooltipSubtitle?.(datum)}
                  rows={payload.map((p) => {
                    const spec = series.find((s) => s.key === p.dataKey);
                    const value = Number(p.value ?? 0);
                    return {
                      label: spec?.label ?? String(p.dataKey),
                      value: (spec?.format ?? defaultFormat)(value),
                      color: p.color,
                    };
                  })}
                  footer={onPointClick ? "Click to filter to this period" : undefined}
                />
              );
            }}
          />

          {series.map((s, i) =>
            variant === "line" ? (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color ?? seriesColor(i)}
                strokeWidth={2}
                strokeDasharray={s.dashed ? "4 3" : undefined}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                isAnimationActive={false}
              />
            ) : (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stackId={stacked ? "1" : undefined}
                stroke={s.color ?? seriesColor(i)}
                strokeWidth={2}
                fill={`url(#${gradientPrefix}-${s.key})`}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
                isAnimationActive={false}
              />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

/* =========================================================================
 * Combo — bars for volume with a rate line above them.
 * Both series share one axis by construction: the rate is pre-scaled by the
 * caller onto the bar axis, never given a second y-scale.
 * ========================================================================= */

export function ComboChart({
  data,
  bars,
  lines,
  xKey = "label",
  height = 260,
  yFormat = fmtCompact,
  onPointClick,
  stacked = true,
}: {
  data: Datum[];
  bars: SeriesSpec[];
  lines: SeriesSpec[];
  xKey?: string;
  height?: number;
  yFormat?: (v: number) => string;
  onPointClick?: (datum: Datum) => void;
  stacked?: boolean;
}) {
  return (
    <div className="size-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={MARGIN.default}
          barCategoryGap="22%"
          onClick={(state) => {
            const idx = state?.activeTooltipIndex;
            if (onPointClick && typeof idx === "number" && data[idx]) onPointClick(data[idx]);
          }}
        >
          <CartesianGrid {...gridLine} vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={axisTick}
            {...axisLine}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={yFormat}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <TooltipShell
                  title={String(label)}
                  rows={payload.map((p) => {
                    const spec = [...bars, ...lines].find((s) => s.key === p.dataKey);
                    return {
                      label: spec?.label ?? String(p.dataKey),
                      value: (spec?.format ?? defaultFormat)(Number(p.value ?? 0)),
                      color: p.color,
                    };
                  })}
                  footer={onPointClick ? "Click to filter to this period" : undefined}
                />
              );
            }}
          />
          {bars.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId={stacked ? "vol" : undefined}
              fill={s.color ?? seriesColor(i)}
              radius={stacked ? 0 : [4, 4, 0, 0]}
              stroke="var(--surface)"
              strokeWidth={stacked ? 2 : 0}
              isAnimationActive={false}
            />
          ))}
          {lines.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color ?? seriesColor(bars.length + i)}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "4 3" : undefined}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* =========================================================================
 * Ranked horizontal bars — the default for comparing named things
 * ========================================================================= */

export interface RankedItem {
  label: string;
  value: number;
  color?: string;
  /** Extra measures rendered as right-aligned figures beside the bar. */
  columns?: (string | number)[];
  onClick?: () => void;
  href?: string;
}

/**
 * Ranked horizontal bars — the default for comparing named things.
 *
 * Nominal categories all take the same hue: bar length already encodes the
 * value, so spending the identity channel on it would be redundant.
 *
 * Secondary measures print as right-aligned figures rather than as a second
 * track behind the bar. A shared-scale track only reads when both measures
 * share a magnitude — drawing 876 hires against 23,017 applications on one
 * axis compresses every bar to a sliver and communicates nothing.
 */
export function RankedBars({
  items,
  max,
  format = defaultFormat,
  className,
  columnHeaders,
  barHeight = 20,
  tone = "var(--series-1)",
  emptyLabel = "No data",
  labelWidth = "36%",
}: {
  items: RankedItem[];
  max?: number;
  format?: (v: number) => string;
  className?: string;
  /** Headers for the per-item `columns` figures. Also renders a header row. */
  columnHeaders?: string[];
  barHeight?: number;
  tone?: string;
  emptyLabel?: string;
  labelWidth?: string;
}) {
  const ceiling = max ?? Math.max(...items.map((i) => i.value), 1);

  if (!items.length) {
    return <p className="px-3.5 py-6 text-center text-label text-ink-4">{emptyLabel}</p>;
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {columnHeaders?.length ? (
        <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-3.5 py-1">
          <span className="shrink-0" style={{ width: labelWidth }} />
          <span className="flex-1" />
          {columnHeaders.map((h) => (
            <span key={h} className="w-[62px] shrink-0 text-right col-head">
              {h}
            </span>
          ))}
        </div>
      ) : null}

      <ul>
        {items.map((item) => {
          const pct = (item.value / ceiling) * 100;
          const interactive = Boolean(item.onClick || item.href);
          const Row = (
            <div
              className={cn(
                "group flex items-center gap-3 px-3.5 py-1.5",
                interactive && "drill",
              )}
            >
              <span
                className="shrink-0 truncate text-meta text-ink-2"
                style={{ width: labelWidth }}
                title={item.label}
              >
                {item.label}
              </span>
              <span className="relative min-w-[36px] flex-1" style={{ height: barHeight }}>
                <span
                  className="absolute inset-y-0 my-auto block h-2.5 rounded-r-[4px] transition-[width] duration-500"
                  style={{
                    width: `${Math.max(pct, item.value > 0 ? 2 : 0)}%`,
                    background: item.color ?? tone,
                  }}
                  aria-hidden
                />
              </span>
              <span className="w-[62px] shrink-0 text-right text-meta font-bold tabular-nums text-ink">
                {format(item.value)}
              </span>
              {item.columns?.map((c, i) => (
                <span
                  key={i}
                  className="w-[62px] shrink-0 text-right text-meta tabular-nums text-ink-3"
                >
                  {typeof c === "number" ? fmtInt(c) : c}
                </span>
              ))}
            </div>
          );
          return (
            <li key={item.label} className="border-b border-line last:border-0">
              {item.href ? (
                <a href={item.href} className="block">{Row}</a>
              ) : item.onClick ? (
                <button type="button" onClick={item.onClick} className="block w-full text-left">
                  {Row}
                </button>
              ) : (
                Row
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* =========================================================================
 * Vertical bars with direct labels
 * ========================================================================= */

export function ColumnChart({
  data,
  valueKey = "value",
  xKey = "label",
  height = 220,
  format = defaultFormat,
  onBarClick,
  colorFor,
  ordinal = false,
  showLabels = true,
  yFormat = fmtCompact,
}: {
  data: Datum[];
  valueKey?: string;
  xKey?: string;
  height?: number;
  format?: (v: number) => string;
  onBarClick?: (datum: Datum) => void;
  colorFor?: (datum: Datum, index: number) => string;
  ordinal?: boolean;
  showLabels?: boolean;
  yFormat?: (v: number) => string;
}) {
  return (
    <div className="size-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: showLabels ? 18 : 8, right: 8, bottom: 4, left: 4 }} barCategoryGap="24%">
          <CartesianGrid {...gridLine} vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={axisTick}
            {...axisLine}
            tickLine={false}
            interval={0}
            minTickGap={2}
          />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={40} tickFormatter={yFormat} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <TooltipShell
                  title={String(label)}
                  rows={[{ label: "Count", value: format(Number(payload[0].value ?? 0)) }]}
                  footer={onBarClick ? "Click to drill in" : undefined}
                />
              );
            }}
          />
          <Bar
            dataKey={valueKey}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            onClick={(d) => onBarClick?.(d as unknown as Datum)}
            cursor={onBarClick ? "pointer" : undefined}
            label={
              showLabels
                ? {
                    position: "top",
                    fill: "var(--ink-2)",
                    fontSize: 10,
                    formatter: (label: unknown) => {
                      const v = Number(label);
                      return Number.isFinite(v) && v > 0 ? fmtCompact(v) : "";
                    },
                  }
                : undefined
            }
          >
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={
                  colorFor?.(d, i) ??
                  (ordinal ? ordinalColor(i, data.length) : "var(--series-1)")
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* =========================================================================
 * Stacked composition bars — "what is this made of, over time"
 * ========================================================================= */

export function StackedBars({
  data,
  series,
  xKey = "label",
  height = 240,
  normalize = false,
  onBarClick,
  yFormat,
}: {
  data: Datum[];
  series: SeriesSpec[];
  xKey?: string;
  height?: number;
  normalize?: boolean;
  onBarClick?: (datum: Datum) => void;
  yFormat?: (v: number) => string;
}) {
  const format = yFormat ?? (normalize ? (v: number) => `${Math.round(v)}%` : fmtCompact);

  return (
    <div className="size-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={MARGIN.default}
          barCategoryGap="22%"
          stackOffset={normalize ? "expand" : undefined}
          onClick={(state) => {
            const idx = state?.activeTooltipIndex;
            if (onBarClick && typeof idx === "number" && data[idx]) onBarClick(data[idx]);
          }}
        >
          <CartesianGrid {...gridLine} vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={axisTick}
            {...axisLine}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={20}
          />
          <YAxis
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={normalize ? (v: number) => `${Math.round(v * 100)}%` : format}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const total = payload.reduce((s, p) => s + Number(p.value ?? 0), 0);
              return (
                <TooltipShell
                  title={String(label)}
                  rows={[
                    ...[...payload].reverse().map((p) => {
                      const spec = series.find((s) => s.key === p.dataKey);
                      const v = Number(p.value ?? 0);
                      return {
                        label: spec?.label ?? String(p.dataKey),
                        value: normalize
                          ? `${((v / (total || 1)) * 100).toFixed(1)}%`
                          : fmtInt(v),
                        color: p.color,
                      };
                    }),
                    { label: "Total", value: fmtInt(total), muted: true },
                  ]}
                />
              );
            }}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="a"
              fill={s.color ?? seriesColor(i)}
              stroke="var(--surface)"
              strokeWidth={2}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* =========================================================================
 * Scatter — volume against quality, the classic performance quadrant
 * ========================================================================= */

export interface ScatterPoint {
  label: string;
  x: number;
  y: number;
  size?: number;
  href?: string;
  meta?: string;
}

export function QuadrantScatter({
  points,
  xLabel,
  yLabel,
  xFormat = fmtCompact,
  yFormat = (v: number) => `${v.toFixed(1)}%`,
  xMedian,
  yMedian,
  height = 320,
  onPointClick,
  quadrantLabels,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  xMedian?: number;
  yMedian?: number;
  height?: number;
  onPointClick?: (p: ScatterPoint) => void;
  quadrantLabels?: { tl: string; tr: string; bl: string; br: string };
}) {
  return (
    <div className="relative size-full" style={{ height }}>
      {quadrantLabels ? (
        <div className="pointer-events-none absolute inset-0 z-10 hidden p-6 text-micro text-ink-4 sm:block">
          <span className="absolute left-14 top-3">{quadrantLabels.tl}</span>
          <span className="absolute right-4 top-3">{quadrantLabels.tr}</span>
          <span className="absolute bottom-8 left-14">{quadrantLabels.bl}</span>
          <span className="absolute bottom-8 right-4">{quadrantLabels.br}</span>
        </div>
      ) : null}
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 16, bottom: 24, left: 8 }}>
          <CartesianGrid {...gridLine} />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            tick={axisTick}
            {...axisLine}
            tickLine={false}
            tickFormatter={xFormat}
            label={{
              value: xLabel,
              position: "insideBottom",
              offset: -14,
              fill: "var(--ink-3)",
              fontSize: 11,
            }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            tick={axisTick}
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={yFormat}
            label={{
              value: yLabel,
              angle: -90,
              position: "insideLeft",
              fill: "var(--ink-3)",
              fontSize: 11,
              style: { textAnchor: "middle" },
            }}
          />
          <ZAxis type="number" dataKey="size" range={[64, 460]} />
          {xMedian != null ? (
            <ReferenceLine x={xMedian} stroke="var(--ink-4)" strokeDasharray="3 3" />
          ) : null}
          {yMedian != null ? (
            <ReferenceLine y={yMedian} stroke="var(--ink-4)" strokeDasharray="3 3" />
          ) : null}
          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: "var(--ink-4)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as ScatterPoint;
              return (
                <TooltipShell
                  title={p.label}
                  subtitle={p.meta}
                  rows={[
                    { label: xLabel, value: xFormat(p.x) },
                    { label: yLabel, value: yFormat(p.y) },
                  ]}
                  footer={onPointClick ? "Click to open profile" : undefined}
                />
              );
            }}
          />
          <Scatter
            data={points}
            fill="var(--series-1)"
            fillOpacity={0.72}
            stroke="var(--surface)"
            strokeWidth={2}
            isAnimationActive={false}
            cursor={onPointClick ? "pointer" : undefined}
            onClick={(d) => onPointClick?.(d as unknown as ScatterPoint)}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/* =========================================================================
 * Distribution histogram
 * ========================================================================= */

export function Histogram({
  bins,
  height = 200,
  xLabel,
  median,
  onBinClick,
}: {
  bins: { label: string; count: number; from: number; to: number }[];
  height?: number;
  xLabel?: string;
  median?: number;
  onBinClick?: (bin: { from: number; to: number }) => void;
}) {
  return (
    <div className="size-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bins} margin={{ top: 8, right: 8, bottom: xLabel ? 20 : 4, left: 4 }} barCategoryGap="12%">
          <CartesianGrid {...gridLine} vertical={false} />
          <XAxis
            dataKey="label"
            tick={axisTick}
            {...axisLine}
            tickLine={false}
            interval="preserveStartEnd"
            label={
              xLabel
                ? { value: xLabel, position: "insideBottom", offset: -12, fill: "var(--ink-3)", fontSize: 11 }
                : undefined
            }
          />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={40} tickFormatter={fmtCompact} />
          {median != null ? (
            <ReferenceLine
              x={bins.find((b) => median >= b.from && median < b.to)?.label}
              stroke="var(--ink)"
              strokeDasharray="3 3"
              label={{ value: "median", position: "top", fill: "var(--ink-3)", fontSize: 10 }}
            />
          ) : null}
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <TooltipShell
                  title={String(label)}
                  rows={[{ label: "Candidates", value: fmtInt(Number(payload[0].value ?? 0)) }]}
                />
              );
            }}
          />
          <Bar
            dataKey="count"
            fill="var(--series-1)"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
            cursor={onBinClick ? "pointer" : undefined}
            onClick={(d) => onBinClick?.(d as unknown as { from: number; to: number })}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export { SERIES };
