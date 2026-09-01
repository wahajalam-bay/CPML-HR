"use client";

import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn, fmtInt } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";

export interface MultiSelectOption {
  value: string;
  /** Count shown beside the option, so the user knows what they are picking. */
  count?: number;
}

/**
 * Dimension filter.
 *
 * Long tails are the norm here — 299 institutes, 123 hiring managers — so the
 * list is searchable, virtualised past a threshold, and always shows how many
 * records sit behind each option.
 */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = "All",
  className,
  width = 240,
  showCounts = true,
  align = "start",
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  width?: number;
  showCounts?: boolean;
  align?: "start" | "end";
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.value.toLowerCase().includes(q));
  }, [options, query]);

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-[var(--r-xs)] border border-line bg-surface-2 px-2.5 text-meta text-ink transition-colors hover:border-g4",
            selected.length > 0 && "border-accent-line bg-accent-soft",
            className,
          )}
          style={{ maxWidth: width }}
          aria-label={`Filter by ${label}`}
        >
          <span className="shrink-0 text-label font-bold uppercase tracking-[0.5px] text-ink-3">
            {label}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left",
              selected.length === 0 && "text-ink-4",
            )}
          >
            {summary}
          </span>
          <ChevronDown className="size-3 shrink-0 text-ink-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[280px] p-0">
        <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-2">
          <Search className="size-3.5 shrink-0 text-ink-4" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="w-full bg-transparent text-meta text-ink outline-none placeholder:text-ink-4"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-ink-4 hover:text-ink-2"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>

        <div className="max-h-[280px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-label text-ink-4">
              Nothing matches “{query}”.
            </p>
          ) : (
            filtered.map((o) => {
              const checked = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition-colors hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      "grid size-3.5 shrink-0 place-items-center rounded-[3px] border transition-colors",
                      checked
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-line-2 bg-surface",
                    )}
                  >
                    {checked ? <Check className="size-2.5" strokeWidth={3.5} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{o.value}</span>
                  {showCounts && o.count != null ? (
                    <span className="shrink-0 text-label tabular-nums text-ink-4">
                      {fmtInt(o.count)}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
          <span className="text-label text-ink-4">
            {selected.length ? `${selected.length} of ${options.length}` : `${options.length} options`}
          </span>
          <div className="flex gap-1">
            {selected.length > 0 ? (
              <Button variant="ghost" size="xs" onClick={() => onChange([])}>
                Clear
              </Button>
            ) : null}
            <Button variant="ghost" size="xs" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
