"use client";

import * as React from "react";
import { ArrowRight, TrendingDown } from "lucide-react";
import { cn, fmtDays, fmtInt, fmtPct } from "@/lib/utils";
import type { FunnelStage } from "@/lib/data/query";
import { ordinalColor } from "./chart-kit";
import { Hint } from "@/components/ui/overlays";

/**
 * The pipeline funnel.
 *
 * Rendered as a tapering SVG ribbon rather than stacked bars so the shape
 * itself carries the story: where the ribbon pinches is where the operation
 * loses people. Stage colour is an ORDINAL ramp — one hue, monotone
 * lightness — because funnel stages have an inherent order that a
 * categorical palette would hide.
 */

export interface FunnelRow extends FunnelStage {
  /** Median days spent entering this stage from the previous one. */
  medianDays?: number | null;
  description?: string;
}

export function PipelineFunnel({
  stages,
  onStageClick,
  activeStage,
  height = 300,
  className,
  showLostWedge = true,
}: {
  stages: FunnelRow[];
  onStageClick?: (stage: FunnelRow) => void;
  activeStage?: number | null;
  height?: number;
  className?: string;
  showLostWedge?: boolean;
}) {
  const [hover, setHover] = React.useState<number | null>(null);

  const total = stages[0]?.entered ?? 0;
  if (!total) {
    return (
      <p className="px-4 py-10 text-center text-label text-ink-4">
        No candidates match the current filters.
      </p>
    );
  }

  // A pure linear width mapping makes the last four stages invisible when the
  // top of funnel is 20x the bottom, so widths use a gentle power scale. The
  // printed numbers stay exact — only the ribbon is eased.
  const widthOf = (n: number) => Math.max(0.035, Math.pow(n / total, 0.42));

  const rowHeight = height / stages.length;
  const barHeight = Math.min(rowHeight * 0.56, 26);

  return (
    <div className={cn("relative", className)}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="block"
        aria-hidden
      >
        {stages.map((s, i) => {
          const next = stages[i + 1];
          const w = widthOf(s.entered) * 100;
          const nw = next ? widthOf(next.entered) * 100 : w;
          const y = i * rowHeight + (rowHeight - barHeight) / 2;
          const x = (100 - w) / 2;
          const nx = (100 - nw) / 2;
          const connectorTop = y + barHeight;
          const connectorBottom = (i + 1) * rowHeight + (rowHeight - barHeight) / 2;
          const active = activeStage === i || hover === i;

          return (
            <g key={s.key}>
              {next && showLostWedge ? (
                <path
                  d={`M${x} ${connectorTop} L${x + w} ${connectorTop} L${nx + nw} ${connectorBottom} L${nx} ${connectorBottom} Z`}
                  fill={ordinalColor(i, stages.length)}
                  opacity={0.14}
                />
              ) : null}
              <rect
                x={x}
                y={y}
                width={w}
                height={barHeight}
                rx={2}
                fill={ordinalColor(i, stages.length)}
                opacity={activeStage != null && !active ? 0.4 : 1}
                stroke="var(--surface)"
                strokeWidth={0.4}
              />
            </g>
          );
        })}
      </svg>

      {/* Interactive overlay — real DOM rows so labels stay crisp and the
          whole band is a hit target, not just the mark. */}
      <div className="absolute inset-0">
        {stages.map((s, i) => {
          const active = activeStage === i;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onStageClick?.(s)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ height: rowHeight }}
              className={cn(
                "group flex w-full items-center justify-between gap-3 px-3 text-left transition-colors",
                onStageClick && "cursor-pointer hover:bg-ink/[0.03] dark:hover:bg-white/[0.03]",
                active && "bg-ink/[0.05] dark:bg-white/[0.05]",
              )}
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="text-meta font-medium text-ink">{s.label}</span>
                {s.medianDays != null ? (
                  <span className="hidden text-micro text-ink-3 sm:inline">
                    +{fmtDays(s.medianDays, s.medianDays < 10 ? 1 : 0)}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-meta font-semibold tabular-nums text-ink">
                  {fmtInt(s.entered)}
                </span>
                <span className="w-12 text-right text-label tabular-nums text-ink-3">
                  {fmtPct(s.cumulative, s.cumulative < 10 ? 1 : 0)}
                </span>
                {onStageClick ? (
                  <ArrowRight className="size-3 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
                ) : (
                  <span className="w-3" />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================================
 * Stage ledger — the exact numbers behind the ribbon
 * ========================================================================= */

export function StageLedger({
  stages,
  onStageClick,
  className,
  showDuration = true,
}: {
  stages: FunnelRow[];
  onStageClick?: (stage: FunnelRow) => void;
  className?: string;
  showDuration?: boolean;
}) {
  const worstDrop = Math.max(
    ...stages.map((s) => (s.stepConversion != null ? 100 - s.stepConversion : 0)),
  );

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-meta">
        <thead>
          <tr className="border-b border-line bg-surface-2">
            <th scope="col" className="px-3 py-1.5 text-left font-medium text-ink-3">Stage</th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium text-ink-3">Entered</th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium text-ink-3">Cleared</th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium text-ink-3">Pass rate</th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium text-ink-3">
              <Hint content="Share of this stage's candidates who appear in the next stage. The lowest number here is your biggest leak.">
                <span className="cursor-help border-b border-dotted border-ink-4">To next</span>
              </Hint>
            </th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium text-ink-3">Lost</th>
            {showDuration ? (
              <th scope="col" className="px-3 py-1.5 text-right font-medium text-ink-3">Median wait</th>
            ) : null}
            <th scope="col" className="px-3 py-1.5 text-right font-medium text-ink-3">Of intake</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((s, i) => {
            const drop = s.stepConversion != null ? 100 - s.stepConversion : null;
            const isWorst = drop != null && drop === worstDrop && i < stages.length - 1;
            return (
              <tr
                key={s.key}
                onClick={() => onStageClick?.(s)}
                className={cn(
                  "border-b border-line last:border-0",
                  onStageClick && "drill",
                )}
              >
                <td className="px-3 py-1.5">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ background: ordinalColor(i, stages.length) }}
                    />
                    <span className="font-medium text-ink">{s.label}</span>
                    {isWorst ? (
                      <Hint content="Largest volume loss between two consecutive stages under the current filters.">
                        <span className="inline-flex items-center gap-0.5 rounded-[3px] bg-critical-soft px-1 text-micro font-medium text-critical-ink">
                          <TrendingDown className="size-2.5" />
                          Biggest leak
                        </span>
                      </Hint>
                    ) : null}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink">{fmtInt(s.entered)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{fmtInt(s.cleared)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                  {s.passRate != null ? fmtPct(s.passRate, 1) : "—"}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right font-medium tabular-nums",
                    isWorst ? "text-critical-ink" : "text-ink-2",
                  )}
                >
                  {s.stepConversion != null ? fmtPct(s.stepConversion, 1) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-3">
                  {fmtInt(s.entered - (stages[i + 1]?.entered ?? s.entered))}
                </td>
                {showDuration ? (
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-3">
                    {s.medianDays != null ? fmtDays(s.medianDays, s.medianDays < 10 ? 1 : 0) : "—"}
                  </td>
                ) : null}
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-3">
                  {fmtPct(s.cumulative, s.cumulative < 10 ? 1 : 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* =========================================================================
 * Conversion strip — a compact inline funnel for cards and table rows
 * ========================================================================= */

export function ConversionStrip({
  stages,
  className,
  labels = false,
}: {
  stages: { label: string; value: number }[];
  className?: string;
  labels?: boolean;
}) {
  const max = stages[0]?.value || 1;
  return (
    <div className={cn("flex items-end gap-[3px]", className)}>
      {stages.map((s, i) => {
        const h = Math.max(2, (s.value / max) * 100);
        return (
          <Hint key={s.label} content={`${s.label}: ${fmtInt(s.value)} (${((s.value / max) * 100).toFixed(1)}% of intake)`}>
            <span className="flex flex-1 flex-col items-center gap-0.5">
              <span
                className="w-full rounded-[2px]"
                style={{ height: `${h * 0.28}px`, background: ordinalColor(i, stages.length) }}
              />
              {labels ? (
                <span className="text-micro text-ink-4">{s.label.slice(0, 3)}</span>
              ) : null}
            </span>
          </Hint>
        );
      })}
    </div>
  );
}
