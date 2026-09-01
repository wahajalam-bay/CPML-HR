"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Hand-rolled SVG sparklines.
 *
 * These render dozens at a time inside KPI cards and table cells, so they
 * deliberately avoid a charting library: no axes, no tooltips, no layout
 * pass — just a path. The readable detail lives in the chart the card
 * drills into, not in a 60px trace.
 */

export function Sparkline({
  values,
  className,
  width = 96,
  height = 26,
  tone = "accent",
  showArea = true,
  showLast = true,
}: {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
  tone?: "accent" | "good" | "critical" | "muted";
  showArea?: boolean;
  showLast?: boolean;
}) {
  const stroke = {
    accent: "var(--accent)",
    good: "var(--good)",
    critical: "var(--critical)",
    muted: "var(--ink-4)",
  }[tone];

  // Declared before the early return: a hook cannot sit behind a conditional,
  // or the hook order changes between a sparkline that has data and one that
  // does not.
  const gradientId = React.useId();

  const geom = React.useMemo(() => {
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pad = 2;
    const w = width - pad * 2;
    const h = height - pad * 2;
    const pts = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * w;
      const y = pad + h - ((v - min) / span) * h;
      return [x, y] as const;
    });
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${height} L${pts[0][0].toFixed(1)} ${height} Z`;
    return { line, area, last: pts[pts.length - 1] };
  }, [values, width, height]);

  if (!geom) {
    return (
      <div
        className={cn("hatch rounded-[2px] opacity-50", className)}
        style={{ width, height }}
        aria-hidden
      />
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden
      focusable="false"
    >
      {showArea ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.16} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={geom.area} fill={`url(#${gradientId})`} />
        </>
      ) : null}
      <path
        d={geom.line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {showLast ? (
        <circle
          cx={geom.last[0]}
          cy={geom.last[1]}
          r={2}
          fill={stroke}
          stroke="var(--surface)"
          strokeWidth={1.5}
        />
      ) : null}
    </svg>
  );
}

/**
 * Bullet bar: actual against a target on a shared scale.
 * The target is a tick, not a second bar — one axis, one comparison.
 */
export function BulletBar({
  value,
  target,
  max,
  polarity = "higher-better",
  className,
  height = 6,
}: {
  value: number | null;
  target: number;
  max?: number;
  polarity?: "higher-better" | "lower-better" | "neutral";
  className?: string;
  height?: number;
}) {
  if (value == null) {
    return <div className={cn("hatch rounded-full", className)} style={{ height }} />;
  }
  const ceiling = max ?? Math.max(value, target) * 1.25;
  const valuePct = Math.min(100, (value / ceiling) * 100);
  const targetPct = Math.min(100, (target / ceiling) * 100);

  const meetsTarget =
    polarity === "lower-better" ? value <= target : polarity === "neutral" ? true : value >= target;
  const fill = meetsTarget ? "var(--good)" : "var(--serious)";

  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-full bg-surface-3", className)}
      style={{ height }}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={ceiling}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${valuePct}%`, background: fill }}
      />
      <div
        className="absolute top-0 h-full w-0.5 bg-ink"
        style={{ left: `calc(${targetPct}% - 1px)` }}
        aria-hidden
      />
    </div>
  );
}

/**
 * Micro column chart — a denser sparkline for discrete period counts, where a
 * line would falsely imply a continuous quantity between buckets.
 */
export function MicroBars({
  values,
  className,
  width = 96,
  height = 26,
  tone = "accent",
  highlightLast = true,
}: {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
  tone?: "accent" | "muted";
  highlightLast?: boolean;
}) {
  if (!values.length) {
    return <div className={cn("hatch rounded-[2px] opacity-50", className)} style={{ width, height }} />;
  }
  const max = Math.max(...values, 1);
  const gap = 1;
  const barWidth = Math.max(1, (width - gap * (values.length - 1)) / values.length);
  const base = tone === "accent" ? "var(--accent)" : "var(--ink-4)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      {values.map((v, i) => {
        const h = Math.max(v > 0 ? 1 : 0, (v / max) * height);
        const isLast = i === values.length - 1;
        return (
          <rect
            key={i}
            x={i * (barWidth + gap)}
            y={height - h}
            width={barWidth}
            height={h}
            rx={Math.min(1.5, barWidth / 2)}
            fill={base}
            opacity={highlightLast && !isLast ? 0.42 : 1}
          />
        );
      })}
    </svg>
  );
}
