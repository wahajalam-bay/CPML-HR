"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* =========================================================================
 * Panel — the structural unit of every page
 * ========================================================================= */

export function Panel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("panel", className)} {...props} />;
}

export function PanelHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className={cn("panel-head", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="eyebrow mb-0.5">{eyebrow}</div> : null}
        {title ? (
          <h2 className="truncate text-body font-semibold text-ink">{title}</h2>
        ) : null}
        {description ? (
          <p className="mt-0.5 truncate text-label text-ink-3">{description}</p>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      ) : null}
    </header>
  );
}

export function PanelBody({
  className,
  padded = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { padded?: boolean }) {
  return <div className={cn(padded && "p-3.5", className)} {...props} />;
}

export function PanelFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <footer
      className={cn(
        "flex items-center justify-between gap-3 border-t border-line px-3.5 py-2 text-label text-ink-3",
        className,
      )}
      {...props}
    />
  );
}

/* =========================================================================
 * Badge
 * ========================================================================= */

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[var(--r-pill)] border font-bold whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "border-line bg-surface-2 text-ink-2",
        accent: "border-accent-line bg-accent-soft text-top-ink",
        top: "border-transparent bg-top-soft text-top-ink",
        good: "border-transparent bg-good-soft text-good-ink",
        info: "border-transparent bg-info-soft text-info-ink",
        warn: "border-transparent bg-warn-soft text-warn-ink",
        serious: "border-transparent bg-serious-soft text-serious-ink",
        critical: "border-transparent bg-critical-soft text-critical-ink",
        outline: "border-line bg-transparent text-ink-3",
      },
      size: {
        sm: "h-[18px] px-2 text-micro",
        md: "h-5 px-2.5 text-label",
      },
    },
    defaultVariants: { tone: "neutral", size: "sm" },
  },
);

export function Badge({
  className,
  tone,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

/* =========================================================================
 * Status dot — colour is never the only channel, so it always ships beside
 * a label. Kept tiny and desaturated so a wall of them stays calm.
 * ========================================================================= */

export function StatusDot({
  tone = "neutral",
  className,
}: {
  tone?: "good" | "top" | "info" | "warn" | "serious" | "critical" | "neutral" | "accent";
  className?: string;
}) {
  const map = {
    good: "bg-good",
    top: "bg-top",
    info: "bg-info",
    warn: "bg-warn",
    serious: "bg-serious",
    critical: "bg-critical",
    accent: "bg-accent",
    neutral: "bg-ink-4",
  } as const;
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", map[tone], className)}
    />
  );
}

/* =========================================================================
 * Band badge — the design system's conditional-formatting cue.
 * Hue, icon AND label together, so meaning never rests on colour alone.
 * ========================================================================= */

export type PerfBand = "critical" | "low" | "mid" | "good" | "top";

const BAND_UI: Record<PerfBand, { tone: "critical" | "serious" | "info" | "good" | "top"; icon: string; label: string }> = {
  critical: { tone: "critical", icon: "▼", label: "Critical" },
  low: { tone: "serious", icon: "▽", label: "Low" },
  mid: { tone: "info", icon: "●", label: "On track" },
  good: { tone: "good", icon: "▲", label: "Strong" },
  top: { tone: "top", icon: "★", label: "Top" },
};

export function BandBadge({
  band,
  size = "sm",
  showLabel = true,
  className,
}: {
  band: PerfBand | null;
  size?: "sm" | "md";
  showLabel?: boolean;
  className?: string;
}) {
  if (!band) {
    return <span className={cn("text-label text-ink-4", className)}>—</span>;
  }
  const ui = BAND_UI[band];
  return (
    <Badge tone={ui.tone} size={size} className={className}>
      <span aria-hidden className="leading-none">{ui.icon}</span>
      {showLabel ? ui.label : null}
    </Badge>
  );
}

/* =========================================================================
 * Separator
 * ========================================================================= */

export function Separator({
  orientation = "horizontal",
  className,
}: {
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-line",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
    />
  );
}

/* =========================================================================
 * Skeletons
 * ========================================================================= */

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton", className)} {...props} />;
}

export function SkeletonPanel({ height = 240 }: { height?: number }) {
  return (
    <div className="panel overflow-hidden">
      <div className="panel-head">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="p-3.5">
        <Skeleton style={{ height }} className="w-full" />
      </div>
    </div>
  );
}

/* =========================================================================
 * Empty & error states
 * ========================================================================= */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-1.5 px-4 py-8" : "gap-2 px-6 py-14",
        className,
      )}
    >
      {icon ? (
        <div className="mb-0.5 flex size-8 items-center justify-center rounded-full bg-surface-2 text-ink-4 [&_svg]:size-4">
          {icon}
        </div>
      ) : null}
      <p className="text-body font-medium text-ink-2">{title}</p>
      {description ? (
        <p className="max-w-xs text-label text-ink-3">{description}</p>
      ) : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}

/* =========================================================================
 * Field shell — label + control + hint, used across every filter surface
 * ========================================================================= */

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="eyebrow">{label}</span>
      {children}
      {hint ? <span className="text-micro text-ink-4">{hint}</span> : null}
    </div>
  );
}

/* =========================================================================
 * Input
 * ========================================================================= */

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-7 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-body text-ink",
      "placeholder:text-ink-4 outline-none transition-colors",
      "focus-visible:border-accent focus-visible:outline-none",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

/* =========================================================================
 * Toolbar — the horizontal control strip above tables and charts
 * ========================================================================= */

export function Toolbar({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-3 py-2",
        className,
      )}
      {...props}
    />
  );
}

/* =========================================================================
 * Segmented control — the compact alternative to a select for 2–5 options
 * ========================================================================= */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  size?: "xs" | "sm";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[var(--radius-control)] border border-line bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-[4px] font-medium transition-colors",
              size === "xs" ? "h-5 px-1.5 text-micro" : "h-6 px-2 text-label",
              active
                ? "bg-surface text-ink shadow-[0_1px_1px_rgb(0_0_0/0.04)]"
                : "text-ink-3 hover:text-ink-2",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* =========================================================================
 * Meter — a horizontal magnitude bar used inside dense table cells
 * ========================================================================= */

export function Meter({
  value,
  max,
  tone = "accent",
  className,
  label,
}: {
  value: number;
  max: number;
  tone?: "accent" | "good" | "warn" | "critical" | "neutral";
  className?: string;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const bg = {
    accent: "bg-accent",
    good: "bg-good",
    warn: "bg-warn",
    critical: "bg-critical",
    neutral: "bg-ink-4",
  }[tone];
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div className={cn("h-full rounded-full", bg)} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* =========================================================================
 * Coverage note — states plainly when a metric rests on partial data
 * ========================================================================= */

export function CoverageNote({
  known,
  total,
  what,
  className,
}: {
  known: number;
  total: number;
  what: string;
  className?: string;
}) {
  if (total === 0 || known === total) return null;
  const pct = (known / total) * 100;
  return (
    <p className={cn("text-micro text-ink-4", className)}>
      Based on {known.toLocaleString()} of {total.toLocaleString()} records (
      {pct.toFixed(0)}%) where {what} was recorded.
    </p>
  );
}
