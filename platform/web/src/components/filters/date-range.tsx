"use client";

import * as React from "react";
import { CalendarDays, Check } from "lucide-react";
import { cn, dateToDay, dayToDate, fmtDay } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";

export interface DatePreset {
  id: string;
  label: string;
  /** Returns inclusive day-offset bounds relative to the dataset horizon. */
  resolve: (horizon: number, min: number) => { from: number | null; to: number | null };
}

/**
 * Presets are anchored to the dataset's own horizon rather than to today's
 * date. The sheet's last recorded activity is what "last 30 days" has to mean
 * here — anchoring to the wall clock would silently return nothing.
 */
export const DATE_PRESETS: DatePreset[] = [
  { id: "all", label: "All time", resolve: () => ({ from: null, to: null }) },
  { id: "7d", label: "Last 7 days", resolve: (h) => ({ from: h - 6, to: h }) },
  { id: "30d", label: "Last 30 days", resolve: (h) => ({ from: h - 29, to: h }) },
  { id: "90d", label: "Last 90 days", resolve: (h) => ({ from: h - 89, to: h }) },
  {
    id: "mtd",
    label: "Month to date",
    resolve: (h) => {
      const d = dayToDate(h);
      return { from: dateToDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), to: h };
    },
  },
  {
    id: "qtd",
    label: "Quarter to date",
    resolve: (h) => {
      const d = dayToDate(h);
      const qm = Math.floor(d.getUTCMonth() / 3) * 3;
      return { from: dateToDay(new Date(Date.UTC(d.getUTCFullYear(), qm, 1))), to: h };
    },
  },
  {
    id: "ytd",
    label: "Year to date",
    resolve: (h) => {
      const d = dayToDate(h);
      return { from: dateToDay(new Date(Date.UTC(d.getUTCFullYear(), 0, 1))), to: h };
    },
  },
  { id: "12m", label: "Last 12 months", resolve: (h) => ({ from: h - 364, to: h }) },
];

function toInputValue(day: number | null): string {
  if (day == null) return "";
  return dayToDate(day).toISOString().slice(0, 10);
}

function fromInputValue(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return dateToDay(new Date(Date.UTC(y, m - 1, d)));
}

export function DateRangeFilter({
  from,
  to,
  horizon,
  min,
  onChange,
  className,
}: {
  from: number | null;
  to: number | null;
  horizon: number;
  min: number;
  onChange: (range: { from: number | null; to: number | null }) => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  const activePreset = React.useMemo(() => {
    for (const p of DATE_PRESETS) {
      const r = p.resolve(horizon, min);
      if (r.from === from && r.to === to) return p.id;
    }
    return from == null && to == null ? "all" : "custom";
  }, [from, to, horizon, min]);

  const summary =
    activePreset === "custom"
      ? `${from != null ? fmtDay(from) : "Start"} → ${to != null ? fmtDay(to) : "End"}`
      : (DATE_PRESETS.find((p) => p.id === activePreset)?.label ?? "All time");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-[var(--r-xs)] border border-line bg-surface-2 px-2.5 text-meta text-ink transition-colors hover:border-g4",
            activePreset !== "all" && "border-accent-line bg-accent-soft",
            className,
          )}
          aria-label="Filter by date range"
        >
          <CalendarDays className="size-3.5 shrink-0 text-ink-3" />
          <span className="truncate">{summary}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[236px] p-0">
        <div className="py-1">
          {DATE_PRESETS.map((p) => {
            const active = activePreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onChange(p.resolve(horizon, min));
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition-colors hover:bg-surface-2"
              >
                <span className="grid size-4 shrink-0 place-items-center">
                  {active ? (
                    <Check className="size-4 text-accent" strokeWidth={3} />
                  ) : null}
                </span>
                <span className={cn(active ? "font-semibold text-ink" : "text-ink-2")}>
                  {p.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-line p-2.5">
          <p className="eyebrow mb-1.5">Custom range</p>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={toInputValue(from)}
              min={toInputValue(min)}
              max={toInputValue(horizon)}
              onChange={(e) => onChange({ from: fromInputValue(e.target.value), to })}
              className="h-7 w-full rounded-[var(--r-xs)] border border-line bg-surface px-1.5 text-label text-ink outline-none focus-visible:border-accent"
              aria-label="Range start"
            />
            <span className="shrink-0 text-ink-4">→</span>
            <input
              type="date"
              value={toInputValue(to)}
              min={toInputValue(min)}
              max={toInputValue(horizon)}
              onChange={(e) => onChange({ from, to: fromInputValue(e.target.value) })}
              className="h-7 w-full rounded-[var(--r-xs)] border border-line bg-surface px-1.5 text-label text-ink outline-none focus-visible:border-accent"
              aria-label="Range end"
            />
          </div>
          <p className="mt-1.5 text-micro text-ink-4">
            Dataset covers {fmtDay(min)} → {fmtDay(horizon)}.
          </p>
          {activePreset !== "all" ? (
            <Button
              variant="ghost"
              size="xs"
              className="mt-1.5 w-full"
              onClick={() => {
                onChange({ from: null, to: null });
                setOpen(false);
              }}
            >
              Clear date filter
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Compact period chips for card-level scoping. */
export function PeriodChips({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("chips", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          data-active={value === o.id}
          onClick={() => onChange(o.id)}
          className="chip"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
