"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { BookmarkPlus, Lock, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { cn, fmtInt } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  Hint,
} from "@/components/ui/overlays";
import { useFilters } from "@/lib/providers/filter-provider";
import { useStore } from "@/lib/providers/store-provider";
import { useSession } from "@/lib/providers/session-provider";
import { useSelection } from "@/lib/hooks/use-analytics";
import {
  DIMENSIONS,
  DIMENSION_BY_FIELD,
  ORDINAL_DOMAINS,
  OUTCOMES,
  STAGES,
  type DictField,
  type Outcome,
} from "@/lib/data/schema";
import { groupByDim } from "@/lib/data/query";
import { MultiSelect } from "./multi-select";
import { DateRangeFilter } from "./date-range";

/** Dimensions promoted to the always-visible row; the rest live behind "More". */
const PRIMARY: DictField[] = ["recruiter", "source", "applied_role", "team"];

export function FilterBar() {
  const store = useStore();
  const pathname = usePathname();
  const { filters, patch, setDim, clearDim, reset, saveView } = useFilters();
  const { scope } = useSession();
  const rows = useSelection();

  // Option counts come from the unfiltered dataset so a filter never hides the
  // very option a user is about to add — but the record count in the summary
  // reflects the live selection.
  const counts = React.useMemo(() => {
    const all = new Uint32Array(store.meta.rowCount);
    for (let i = 0; i < all.length; i++) all[i] = i;
    const map = {} as Record<DictField, { value: string; count: number }[]>;
    for (const dim of DIMENSIONS) {
      map[dim.field] = groupByDim(store, all, dim.field, {
        order: ORDINAL_DOMAINS[dim.field],
      }).map((b) => ({ value: b.key, count: b.count }));
    }
    return map;
  }, [store]);

  const activeChips = React.useMemo(() => {
    const chips: {
      key: string;
      label: string;
      onRemove: () => void;
      /** Imposed by the session's scope — shown, but not removable. */
      locked?: boolean;
    }[] = [];

    if (filters.from != null || filters.to != null) {
      chips.push({
        key: "date",
        label: "Date range",
        onRemove: () => patch({ from: null, to: null }),
      });
    }
    for (const [field, values] of Object.entries(filters.dims) as [DictField, string[]][]) {
      if (!values?.length) continue;
      const spec = DIMENSION_BY_FIELD[field];
      chips.push({
        key: field,
        label: `${spec?.label ?? field}: ${values.length === 1 ? values[0] : `${values.length} selected`}`,
        onRemove: () => clearDim(field),
        locked: field === "recruiter" && scope.kind !== "all",
      });
    }
    if (filters.outcomes.length) {
      chips.push({
        key: "outcome",
        label: `Outcome: ${filters.outcomes.length === 1 ? filters.outcomes[0] : `${filters.outcomes.length} selected`}`,
        onRemove: () => patch({ outcomes: [] }),
      });
    }
    if (filters.stageAtLeast != null) {
      chips.push({
        key: "stageMin",
        label: `Reached ${STAGES[filters.stageAtLeast]?.label ?? "stage"}+`,
        onRemove: () => patch({ stageAtLeast: null }),
      });
    }
    if (filters.stageExactly != null) {
      chips.push({
        key: "stageAt",
        label: `Stopped at ${STAGES[filters.stageExactly]?.label ?? "stage"}`,
        onRemove: () => patch({ stageExactly: null }),
      });
    }
    if (filters.repeats != null) {
      chips.push({
        key: "repeats",
        label: filters.repeats ? "Re-applicants only" : "First-time applicants only",
        onRemove: () => patch({ repeats: null }),
      });
    }
    if (filters.search.trim()) {
      chips.push({
        key: "search",
        label: `Search: ${filters.search}`,
        onRemove: () => patch({ search: "" }),
      });
    }
    return chips;
  }, [filters, patch, clearDim, scope]);

  const pct = store.meta.rowCount ? (rows.length / store.meta.rowCount) * 100 : 0;

  // A scoped session cannot change recruiter, so the control is removed rather
  // than shown inert. The scope banner above the page explains why.
  const primaryFields = React.useMemo(
    () => (scope.kind === "all" ? PRIMARY : PRIMARY.filter((f) => f !== "recruiter")),
    [scope.kind],
  );

  return (
    <div className="no-print sticky top-[68px] z-40 mb-4 flex flex-wrap items-center gap-2 rounded-[var(--r-lg)] px-3 py-2.5 shadow-[var(--sh-2)] glass">
      <DateRangeFilter
        from={filters.from}
        to={filters.to}
        horizon={store.meta.horizon}
        min={store.meta.dateMin}
        onChange={(r) => patch(r)}
      />

      {primaryFields.map((field) => {
        const spec = DIMENSION_BY_FIELD[field];
        return (
          <MultiSelect
            key={field}
            label={spec.label}
            options={counts[field] ?? []}
            selected={filters.dims[field] ?? []}
            onChange={(v) => setDim(field, v)}
            width={200}
          />
        );
      })}

      <MoreFilters counts={counts} />

      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
        {activeChips.length > 0 ? (
          <>
            {activeChips.slice(0, 4).map((chip) =>
              chip.locked ? (
                <Hint
                  key={chip.key}
                  content="Fixed by your access level. This filter cannot be changed or removed."
                >
                  <span className="fchip cursor-help">
                    <Lock className="size-2.5 shrink-0" aria-hidden />
                    <span className="max-w-[180px] truncate">{chip.label}</span>
                  </span>
                </Hint>
              ) : (
                <span key={chip.key} className="fchip">
                  <span className="max-w-[180px] truncate">{chip.label}</span>
                  <button
                    type="button"
                    onClick={chip.onRemove}
                    aria-label={`Remove ${chip.label}`}
                    className="grid size-4 place-items-center rounded-full bg-g1/15 text-current"
                  >
                    <X className="size-2.5" strokeWidth={3} />
                  </button>
                </span>
              ),
            )}
            {activeChips.length > 4 ? (
              <span className="fchip">+{activeChips.length - 4} more</span>
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="fchip !border-dashed !border-line !bg-transparent !text-ink-3"
            >
              Clear all
            </button>
          </>
        ) : null}

        <Hint content="Save this exact view — filters and page — to reopen later.">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Save current view"
            onClick={() => {
              const name = window.prompt("Name this view", "Untitled view");
              if (!name) return;
              saveView(name, pathname);
              toast.success(`Saved “${name}”`);
            }}
          >
            <BookmarkPlus />
          </Button>
        </Hint>

        <Hint
          content={`${fmtInt(rows.length)} of ${fmtInt(store.meta.rowCount)} applications match (${pct.toFixed(1)}%).`}
        >
          <span className="rounded-[var(--r-pill)] border border-line bg-surface px-2 py-1 text-label font-bold tabular-nums text-ink-2">
            {fmtInt(rows.length)}
            <span className="ml-1 font-normal text-ink-4">records</span>
          </span>
        </Hint>
      </div>
    </div>
  );
}

/* =========================================================================
 * The full filter surface
 * ========================================================================= */

function MoreFilters({
  counts,
}: {
  counts: Record<DictField, { value: string; count: number }[]>;
}) {
  const { filters, patch, setDim } = useFilters();

  const secondary = DIMENSIONS.filter(
    (d) => d.filterable && !PRIMARY.includes(d.field),
  );

  const extraCount =
    secondary.filter((d) => (filters.dims[d.field] ?? []).length > 0).length +
    (filters.outcomes.length ? 1 : 0) +
    (filters.stageAtLeast != null || filters.stageExactly != null ? 1 : 0) +
    (filters.repeats != null ? 1 : 0) +
    (filters.expMin != null || filters.expMax != null ? 1 : 0);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-[var(--r-xs)] border border-line bg-surface-2 px-2.5 text-meta text-ink transition-colors hover:border-g4",
            extraCount > 0 && "border-accent-line bg-accent-soft",
          )}
        >
          <SlidersHorizontal className="size-3.5 text-ink-3" />
          More filters
          {extraCount > 0 ? (
            <span className="grid size-4 place-items-center rounded-full bg-accent text-micro font-bold text-accent-fg">
              {extraCount}
            </span>
          ) : null}
        </button>
      </DialogTrigger>
      <DialogContent
        title="All filters"
        description="Every dimension in the dataset. Selections combine with AND across fields, OR within a field."
        width="lg"
      >
        <div className="max-h-[70vh] overflow-y-auto p-4">
          <section className="mb-5">
            <h3 className="eyebrow mb-2">Pipeline position</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-label text-ink-3">Reached at least</span>
                <select
                  value={filters.stageAtLeast ?? ""}
                  onChange={(e) =>
                    patch({ stageAtLeast: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  className="h-8 rounded-[var(--r-xs)] border border-line bg-surface-2 px-2 text-meta text-ink"
                >
                  <option value="">Any stage</option>
                  {STAGES.map((s, i) => (
                    <option key={s.key} value={i}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-label text-ink-3">Stopped exactly at</span>
                <select
                  value={filters.stageExactly ?? ""}
                  onChange={(e) =>
                    patch({ stageExactly: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  className="h-8 rounded-[var(--r-xs)] border border-line bg-surface-2 px-2 text-meta text-ink"
                >
                  <option value="">Any stage</option>
                  {STAGES.map((s, i) => (
                    <option key={s.key} value={i}>{s.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="mb-5">
            <h3 className="eyebrow mb-2">Outcome</h3>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOMES.map((o) => {
                const active = filters.outcomes.includes(o);
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() =>
                      patch({
                        outcomes: active
                          ? filters.outcomes.filter((x) => x !== o)
                          : [...filters.outcomes, o as Outcome],
                      })
                    }
                    className={cn(
                      "rounded-[var(--r-pill)] border px-2.5 py-1 text-meta transition-colors",
                      active
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-line bg-surface-2 text-ink-2 hover:border-g4",
                    )}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mb-5">
            <h3 className="eyebrow mb-2">Experience (years)</h3>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={45}
                step={0.5}
                value={filters.expMin ?? ""}
                placeholder="Min"
                onChange={(e) =>
                  patch({ expMin: e.target.value === "" ? null : Number(e.target.value) })
                }
                className="h-8 w-24 rounded-[var(--r-xs)] border border-line bg-surface-2 px-2 text-meta text-ink"
              />
              <span className="text-ink-4">→</span>
              <input
                type="number"
                min={0}
                max={45}
                step={0.5}
                value={filters.expMax ?? ""}
                placeholder="Max"
                onChange={(e) =>
                  patch({ expMax: e.target.value === "" ? null : Number(e.target.value) })
                }
                className="h-8 w-24 rounded-[var(--r-xs)] border border-line bg-surface-2 px-2 text-meta text-ink"
              />
              <span className="text-label text-ink-4">
                Only applies to the 35% of records where experience was recorded.
              </span>
            </div>
          </section>

          <section className="mb-5">
            <h3 className="eyebrow mb-2">Applicant history</h3>
            <div className="flex gap-1.5">
              {[
                { label: "Everyone", value: null },
                { label: "Re-applicants only", value: true },
                { label: "First-time only", value: false },
              ].map((o) => (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => patch({ repeats: o.value })}
                  className={cn(
                    "rounded-[var(--r-pill)] border px-2.5 py-1 text-meta transition-colors",
                    filters.repeats === o.value
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-line bg-surface-2 text-ink-2 hover:border-g4",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="eyebrow mb-2">Dimensions</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {secondary.map((dim) => (
                <MultiSelect
                  key={dim.field}
                  label={dim.label}
                  options={counts[dim.field] ?? []}
                  selected={filters.dims[dim.field] ?? []}
                  onChange={(v) => setDim(dim.field, v)}
                  width={999}
                  className="w-full !max-w-none"
                />
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
