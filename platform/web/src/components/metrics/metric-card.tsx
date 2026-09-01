"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Info,
  Minus,
} from "lucide-react";
import { cn, fmtDays, fmtInt, fmtPct, fmtSalary, fmtYears } from "@/lib/utils";
import type { MetricFormat, MetricPolarity } from "@/lib/data/metrics";
import { Hint } from "@/components/ui/overlays";
import { BulletBar, Sparkline } from "./sparkline";

/* =========================================================================
 * Formatting
 * ========================================================================= */

export function formatMetric(
  value: number | null | undefined,
  format: MetricFormat,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (format) {
    case "int": return fmtInt(value);
    case "pct": return fmtPct(value, value >= 100 ? 0 : 1);
    case "days": return fmtDays(value, value < 10 ? 1 : 0);
    case "ratio": return value.toFixed(1);
    case "salary": return fmtSalary(value);
    case "years": return fmtYears(value);
  }
}

/* =========================================================================
 * Delta chip
 * ========================================================================= */

/**
 * A period-over-period change.
 *
 * Direction and sentiment are separate: a 12% rise in time-to-hire is an
 * up-arrow and a bad outcome, so the arrow shows direction while the colour
 * and the icon-plus-label pairing carry the judgement.
 */
export function DeltaChip({
  delta,
  polarity = "higher-better",
  suffix = "%",
  className,
  size = "sm",
  label,
}: {
  delta: number | null | undefined;
  polarity?: MetricPolarity;
  suffix?: string;
  className?: string;
  size?: "xs" | "sm";
  label?: string;
}) {
  if (delta == null || !Number.isFinite(delta)) {
    return (
      <span className={cn("text-label text-ink-4", className)} title="No comparable prior period">
        —
      </span>
    );
  }

  const flat = Math.abs(delta) < 0.5;
  const up = delta > 0;
  const good =
    polarity === "neutral" || flat ? null : polarity === "higher-better" ? up : !up;

  const tone =
    good === null ? "text-ink-3" : good ? "text-good-ink" : "text-critical-ink";
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-medium tabular-nums",
        size === "xs" ? "text-micro" : "text-label",
        tone,
        className,
      )}
      title={label ?? `${up ? "Up" : "Down"} ${Math.abs(delta).toFixed(1)}${suffix} vs previous period`}
    >
      <Icon className={size === "xs" ? "size-2.5" : "size-3"} strokeWidth={2.5} aria-hidden />
      {flat ? "0" : `${Math.abs(delta).toFixed(1)}`}
      {suffix}
    </span>
  );
}

/* =========================================================================
 * Metric card
 * ========================================================================= */

/**
 * Count-up animation for the hero figure (design system §4: 650ms ease-out).
 * Skipped entirely under prefers-reduced-motion — the number just appears.
 */
function useCountUp(target: number | null, enabled: boolean): number | null {
  const [display, setDisplay] = React.useState<number | null>(target);
  const previous = React.useRef<number | null>(target);

  React.useEffect(() => {
    if (target == null) {
      setDisplay(null);
      previous.current = null;
      return;
    }
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!enabled || reduce) {
      setDisplay(target);
      previous.current = target;
      return;
    }

    const from = previous.current ?? 0;
    const delta = target - from;
    if (delta === 0) return;

    const DURATION = 650;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 4);
      setDisplay(from + delta * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else previous.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, enabled]);

  return display;
}

export interface MetricCardProps {
  label: string;
  value: number | null;
  format: MetricFormat;
  /** One sentence explaining exactly what the number counts. */
  definition?: string;
  polarity?: MetricPolarity;
  /** Percentage change vs the comparison period. */
  delta?: number | null;
  /** Absolute value in the comparison period, shown as context. */
  previous?: number | null;
  target?: number;
  /** Trailing period values driving the sparkline. */
  trend?: number[];
  /** Secondary line under the figure — a denominator, a count, a caveat. */
  footnote?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
  size?: "sm" | "md" | "lg";
  /** Colour of the 3px top accent bar. Varies by metric family. */
  accent?: string;
  /** Selected cards carry the glow ring and cross-filter the dashboard. */
  selected?: boolean;
  animate?: boolean;
}

export function MetricCard({
  label,
  value,
  format,
  definition,
  polarity = "neutral",
  delta,
  previous,
  target,
  trend,
  footnote,
  href,
  onClick,
  className,
  size = "md",
  accent = "var(--g1)",
  selected = false,
  animate = true,
}: MetricCardProps) {
  const interactive = Boolean(href || onClick);
  const animated = useCountUp(value, animate);

  const figureClass =
    size === "lg" ? "text-hero" : size === "md" ? "text-figure" : "text-title";

  const meetsTarget =
    target != null && value != null
      ? polarity === "lower-better"
        ? value <= target
        : value >= target
      : null;

  const body = (
    <>
      <span aria-hidden className="accent-bar" style={{ background: accent }} />

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="eyebrow truncate">{label}</span>
          {definition ? (
            <Hint content={definition}>
              <span
                aria-label={`What ${label} means`}
                className="shrink-0 text-ink-4 transition-colors hover:text-ink-2"
              >
                <Info className="size-3" />
              </span>
            </Hint>
          ) : null}
        </div>
        {interactive ? (
          <ArrowRight className="size-3 shrink-0 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
        ) : null}
      </div>

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div
            className={cn(
              "font-extrabold leading-none tracking-[-0.5px] text-ink tabular-nums",
              figureClass,
            )}
          >
            {formatMetric(animated, format)}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <DeltaChip delta={delta} polarity={polarity} />
            {previous != null ? (
              <span className="text-label text-ink-4">
                vs {formatMetric(previous, format)}
              </span>
            ) : null}
          </div>
        </div>

        {trend && trend.length > 1 ? (
          <Sparkline
            values={trend}
            width={size === "lg" ? 108 : 82}
            height={size === "lg" ? 32 : 26}
            tone={
              polarity === "neutral" || delta == null
                ? "muted"
                : (polarity === "higher-better") === delta > 0
                  ? "good"
                  : "critical"
            }
            className="shrink-0"
          />
        ) : null}
      </div>

      {target != null ? (
        <div className="mt-3">
          <BulletBar value={value} target={target} polarity={polarity} />
          <div className="mt-1.5 flex items-center justify-between text-micro text-ink-4">
            <span>Target {formatMetric(target, format)}</span>
            {meetsTarget != null ? (
              <span
                className={cn(
                  "font-bold",
                  meetsTarget ? "text-good-ink" : "text-serious-ink",
                )}
              >
                {meetsTarget ? "▲ On target" : `▽ ${formatMetric(Math.abs((value ?? 0) - target), format)} off`}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {footnote ? (
        <p className="mt-2.5 text-micro leading-4 text-ink-4">{footnote}</p>
      ) : null}
    </>
  );

  const shell = cn(
    "panel group relative flex flex-col overflow-hidden p-4 pt-[18px] text-left",
    interactive && "panel-interactive cursor-pointer",
    selected && "panel-selected",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={shell}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className={shell}
      >
        {body}
      </button>
    );
  }
  return <div className={shell}>{body}</div>;
}

/* =========================================================================
 * Metric tile — the compact form used in dense rows and drawers
 * ========================================================================= */

export function MetricTile({
  label,
  value,
  format,
  delta,
  polarity = "neutral",
  definition,
  className,
  align = "left",
}: {
  label: string;
  value: number | null;
  format: MetricFormat;
  delta?: number | null;
  polarity?: MetricPolarity;
  definition?: string;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <div className={cn("min-w-0", align === "right" && "text-right", className)}>
      <div
        className={cn(
          "flex items-center gap-1",
          align === "right" && "justify-end",
        )}
      >
        <span className="eyebrow truncate">{label}</span>
        {definition ? (
          <Hint content={definition}>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`What ${label} means`}
              className="shrink-0 text-ink-4 hover:text-ink-2"
            >
              <Info className="size-2.5" />
            </button>
          </Hint>
        ) : null}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5" style={align === "right" ? { justifyContent: "flex-end" } : undefined}>
        <span className="text-lead font-semibold text-ink tabular-nums">
          {formatMetric(value, format)}
        </span>
        {delta != null ? (
          <DeltaChip delta={delta} polarity={polarity} size="xs" />
        ) : null}
      </div>
    </div>
  );
}

/* =========================================================================
 * Stat row — label/value pairs in drawers and detail panels
 * ========================================================================= */

export function StatRow({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 border-b border-line py-1.5 last:border-0",
        className,
      )}
    >
      <span className="flex items-center gap-1 text-label text-ink-3">
        {label}
        {hint ? (
          <Hint content={hint}>
            <Info className="size-2.5 text-ink-4" />
          </Hint>
        ) : null}
      </span>
      <span className="text-right text-body font-medium text-ink tabular-nums">
        {value ?? "—"}
      </span>
    </div>
  );
}
