"use client";

import * as React from "react";
import { Table2, LineChart as LineChartIcon, Download } from "lucide-react";
import { cn, fmtInt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";

/* =========================================================================
 * Palette
 *
 * Six categorical slots, in a fixed order that is never cycled — the Bayut
 * brand has exactly six distinct hue families, so a seventh series folds into
 * "Other" rather than inventing a near-duplicate. Provenance and the measured
 * CVD separation for each mode are documented in globals.css.
 * ========================================================================= */

export const SERIES = [
  "var(--series-1)", // green — Bayut primary
  "var(--series-2)", // blue
  "var(--series-3)", // orange
  "var(--series-4)", // pink
  "var(--series-5)", // purple
  "var(--series-6)", // red
] as const;

export const SERIES_MAX = SERIES.length;

/**
 * Cap for chart forms where any two marks can end up adjacent — scatter,
 * bubble, small multiples. Those need all-pairs separation, which this brand's
 * hues only sustain for a handful of series; past it, facet or fold to Other.
 */
export const SERIES_MAX_ALL_PAIRS = 4;

/** Categorical hue for slot `i`. Past the last slot the caller folds to Other. */
export function seriesColor(i: number): string {
  return SERIES[Math.min(i, SERIES_MAX - 1)];
}

/** Sequential ramp (magnitude): the Bayut green scale, light → dark. */
export const SEQUENTIAL = [
  "var(--seq-100)",
  "var(--seq-200)",
  "var(--seq-300)",
  "var(--seq-400)",
  "var(--seq-500)",
  "var(--seq-600)",
  "var(--seq-700)",
] as const;

/** Ordinal ramp (funnel stages, tiers): monotone lightness, light end ≥ 2:1. */
export const ORDINAL = [
  "var(--ord-1)", "var(--ord-2)", "var(--ord-3)", "var(--ord-4)",
  "var(--ord-5)", "var(--ord-6)", "var(--ord-7)",
] as const;

export function ordinalColor(i: number, total: number): string {
  if (total <= 1) return ORDINAL[3];
  const t = i / (total - 1);
  return ORDINAL[Math.round(t * (ORDINAL.length - 1))];
}

export function sequentialColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  return SEQUENTIAL[Math.round(clamped * (SEQUENTIAL.length - 1))];
}

/* -------------------------------------------------------------------------
 * Conditional-formatting bands (design system §2.5)
 *
 * Five performance bands, each carrying a hue AND an icon AND a label, so
 * meaning survives red-green colour blindness. The blue mid-band is what
 * breaks the red → green collision.
 * ---------------------------------------------------------------------- */

export type Band = "critical" | "low" | "mid" | "good" | "top";

export const BAND_META: Record<
  Band,
  { color: string; soft: string; ink: string; label: string; icon: string }
> = {
  critical: { color: "var(--q-crit)", soft: "var(--critical-soft)", ink: "var(--critical-ink)", label: "Critical", icon: "▼" },
  low:      { color: "var(--q-low)",  soft: "var(--serious-soft)",  ink: "var(--serious-ink)",  label: "Low",      icon: "▽" },
  mid:      { color: "var(--q-mid)",  soft: "var(--info-soft)",     ink: "var(--info-ink)",     label: "On track", icon: "●" },
  good:     { color: "var(--q-good)", soft: "var(--good-soft)",     ink: "var(--good-ink)",     label: "Strong",   icon: "▲" },
  top:      { color: "var(--q-top)",  soft: "var(--top-soft)",      ink: "var(--top-ink)",      label: "Top",      icon: "★" },
};

/**
 * Place a value into a performance band against the distribution it belongs
 * to. Quartile-relative rather than absolute, so a band means "compared with
 * your peers this period" — the only comparison that stays honest when the
 * filter changes.
 */
export function bandOf(
  value: number | null,
  quartiles: { q1: number; median: number; q3: number; floor?: number },
  polarity: "higher-better" | "lower-better" = "higher-better",
): Band | null {
  if (value == null || !Number.isFinite(value)) return null;
  const v = polarity === "lower-better" ? -value : value;
  const q1 = polarity === "lower-better" ? -quartiles.q3 : quartiles.q1;
  const med = polarity === "lower-better" ? -quartiles.median : quartiles.median;
  const q3 = polarity === "lower-better" ? -quartiles.q1 : quartiles.q3;
  const floor = quartiles.floor != null
    ? (polarity === "lower-better" ? -quartiles.floor : quartiles.floor)
    : null;

  if (floor != null && v < floor) return "critical";
  if (v >= q3) return "top";
  if (v >= med) return "good";
  if (v >= q1) return "mid";
  return "low";
}

export const STATUS_COLOR = {
  good: "var(--good)",
  top: "var(--top)",
  info: "var(--info)",
  warn: "var(--warn)",
  serious: "var(--serious)",
  critical: "var(--critical)",
  neutral: "var(--ink-4)",
} as const;

export const CHART_INK = {
  grid: "var(--grid)",
  axis: "var(--axis)",
  label: "var(--ink-3)",
  text: "var(--ink)",
  surface: "var(--surface)",
} as const;

/* =========================================================================
 * ChartFrame — the shell every visualisation lives in
 *
 * Provides the title, the legend, the table-view relief channel, export,
 * and a consistent empty state. Charts themselves stay purely about marks.
 * ========================================================================= */

export interface LegendItem {
  label: string;
  color: string;
  value?: string | number;
  onClick?: () => void;
  active?: boolean;
}

export interface TableView {
  columns: string[];
  rows: (string | number)[][];
}

export function ChartFrame({
  title,
  description,
  eyebrow,
  legend,
  actions,
  tableView,
  children,
  className,
  bodyClassName,
  height,
  isEmpty,
  emptyMessage = "No records match the current filters.",
  footnote,
  onExport,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  legend?: LegendItem[];
  actions?: React.ReactNode;
  tableView?: TableView;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  height?: number;
  isEmpty?: boolean;
  emptyMessage?: string;
  footnote?: React.ReactNode;
  onExport?: () => void;
}) {
  const [mode, setMode] = React.useState<"chart" | "table">("chart");

  return (
    <section className={cn("panel flex flex-col overflow-hidden", className)}>
      {(title || legend || actions || tableView) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            {eyebrow ? <div className="eyebrow mb-0.5">{eyebrow}</div> : null}
            {title ? (
              <h3 className="truncate text-body font-semibold text-ink">{title}</h3>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-label leading-4 text-ink-3">{description}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1 no-print">
            {actions}
            {tableView ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={mode === "chart" ? "Show as table" : "Show as chart"}
                title={mode === "chart" ? "Show underlying values" : "Back to chart"}
                onClick={() => setMode(mode === "chart" ? "table" : "chart")}
              >
                {mode === "chart" ? <Table2 /> : <LineChartIcon />}
              </Button>
            ) : null}
            {onExport ? (
              <Button variant="ghost" size="icon-sm" aria-label="Export data" onClick={onExport}>
                <Download />
              </Button>
            ) : null}
          </div>
        </header>
      )}

      {legend && legend.length > 1 ? <ChartLegend items={legend} /> : null}

      <div
        className={cn("relative min-h-0 flex-1", bodyClassName)}
        style={height ? { height } : undefined}
      >
        {isEmpty ? (
          <EmptyState title="Nothing to show" description={emptyMessage} compact />
        ) : mode === "table" && tableView ? (
          <ChartTable {...tableView} />
        ) : (
          children
        )}
      </div>

      {footnote ? (
        <footer className="border-t border-line px-3.5 py-2 text-micro leading-4 text-ink-4">
          {footnote}
        </footer>
      ) : null}
    </section>
  );
}

/* =========================================================================
 * Legend
 * ========================================================================= */

export function ChartLegend({
  items,
  className,
}: {
  items: LegendItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3.5 py-1.5",
        className,
      )}
    >
      {items.map((item) => {
        const content = (
          <>
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: item.color }}
            />
            <span className="truncate">{item.label}</span>
            {item.value != null ? (
              <span className="tabular-nums text-ink-4">
                {typeof item.value === "number" ? fmtInt(item.value) : item.value}
              </span>
            ) : null}
          </>
        );
        const base =
          "inline-flex max-w-[200px] items-center gap-1.5 text-label transition-opacity";
        if (item.onClick) {
          return (
            <button
              key={item.label}
              type="button"
              onClick={item.onClick}
              className={cn(
                base,
                "cursor-pointer hover:opacity-100",
                item.active === false ? "opacity-40" : "text-ink-2",
              )}
            >
              {content}
            </button>
          );
        }
        return (
          <span key={item.label} className={cn(base, "text-ink-2")}>
            {content}
          </span>
        );
      })}
    </div>
  );
}

/* =========================================================================
 * Table view — the relief channel and the accessibility fallback
 * ========================================================================= */

export function ChartTable({ columns, rows }: TableView) {
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-meta">
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  "border-b border-line px-3 py-1.5 text-left font-medium text-ink-3",
                  i > 0 && "text-right",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-line last:border-0 hover:bg-surface-2">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "px-3 py-1.5 text-ink-2",
                    ci > 0 && "text-right tabular-nums text-ink",
                  )}
                >
                  {typeof cell === "number" ? fmtInt(cell) : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* =========================================================================
 * Tooltip shell — shared by every Recharts and ECharts surface so hover
 * detail looks identical wherever it appears.
 * ========================================================================= */

export function TooltipShell({
  title,
  subtitle,
  rows,
  footer,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  rows: {
    label: string;
    value: React.ReactNode;
    color?: string;
    muted?: boolean;
  }[];
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-w-[168px] max-w-[280px] rounded-[var(--radius-control)] border border-line bg-overlay px-2.5 py-2 shadow-[var(--shadow-pop)]">
      <div className="mb-1.5 border-b border-line pb-1.5">
        <div className="text-label font-semibold text-ink">{title}</div>
        {subtitle ? <div className="text-micro text-ink-3">{subtitle}</div> : null}
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-1.5">
              {r.color ? (
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: r.color }}
                />
              ) : null}
              <span className={cn("truncate text-label", r.muted ? "text-ink-4" : "text-ink-2")}>
                {r.label}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 text-label font-medium tabular-nums",
                r.muted ? "text-ink-3" : "text-ink",
              )}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
      {footer ? (
        <div className="mt-1.5 border-t border-line pt-1.5 text-micro leading-4 text-ink-4">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/* =========================================================================
 * Axis tick helpers
 * ========================================================================= */

export const axisTick = {
  fill: "var(--ink-3)",
  fontSize: 11,
} as const;

export const axisLine = { stroke: "var(--axis)" } as const;
export const gridLine = { stroke: "var(--grid)" } as const;

/** Recharts margin presets — tight, because panels supply their own padding. */
export const MARGIN = {
  default: { top: 8, right: 12, bottom: 4, left: 4 },
  withLeftAxis: { top: 8, right: 12, bottom: 4, left: 0 },
  horizontal: { top: 4, right: 40, bottom: 4, left: 4 },
} as const;
