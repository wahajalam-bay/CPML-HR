"use client";

import * as React from "react";
import { EMPTY_FILTERS, type FilterState } from "@/lib/data/query";
import { DICT_FIELDS, OUTCOMES, type DictField, type Outcome } from "@/lib/data/schema";
import { useSession } from "@/lib/providers/session-provider";

/* =========================================================================
 * URL serialisation
 *
 * Filters live in the query string so any view a director is looking at can
 * be pasted into an email and reopened exactly as it was. The encoding is
 * compact by design — a full cross-filter should not produce a 600-character
 * URL.
 * ========================================================================= */

const DIM_PARAM: Record<DictField, string> = {
  source: "src",
  channel: "chn",
  recruiter: "rec",
  applied_role: "role",
  hired_role: "hrole",
  industry: "ind",
  degree: "deg",
  institute: "inst",
  city: "city",
  team: "team",
  hiring_manager: "hm",
  final_interviewer: "fi",
  director: "dir",
  drive: "drv",
  experience_band: "exp",
  screen_status: "ss",
  call_status: "cs",
  assessment_status: "as",
  sp_status: "sp",
  manager_status: "ms",
  final_status: "fs",
  offer_status: "os",
  outcome_status: "ostat",
  loss_category: "lc",
  loss_reason: "lr",
  exit_stage: "es",
  salary_band: "sal",
};

const PARAM_DIM = Object.fromEntries(
  Object.entries(DIM_PARAM).map(([k, v]) => [v, k as DictField]),
) as Record<string, DictField>;

export function serializeFilters(f: FilterState): string {
  const p = new URLSearchParams();
  if (f.from != null || f.to != null) p.set("d", `${f.from ?? ""}-${f.to ?? ""}`);
  if (f.dateField !== "applied_date") p.set("df", f.dateField);
  for (const [field, values] of Object.entries(f.dims) as [DictField, string[]][]) {
    if (values?.length) p.set(DIM_PARAM[field], values.join("~"));
  }
  if (f.outcomes.length) p.set("out", f.outcomes.join("~"));
  if (f.stageAtLeast != null) p.set("smin", String(f.stageAtLeast));
  if (f.stageExactly != null) p.set("sat", String(f.stageExactly));
  if (f.search.trim()) p.set("q", f.search.trim());
  if (f.repeats != null) p.set("rep", f.repeats ? "1" : "0");
  if (f.expMin != null) p.set("emin", String(f.expMin));
  if (f.expMax != null) p.set("emax", String(f.expMax));
  return p.toString();
}

export function deserializeFilters(search: string): FilterState {
  const p = new URLSearchParams(search);
  const f: FilterState = {
    ...EMPTY_FILTERS,
    dims: {},
    outcomes: [],
  };

  const d = p.get("d");
  if (d) {
    const [from, to] = d.split("-");
    f.from = from ? Number(from) : null;
    f.to = to ? Number(to) : null;
    if (Number.isNaN(f.from)) f.from = null;
    if (Number.isNaN(f.to)) f.to = null;
  }

  const df = p.get("df");
  if (df) f.dateField = df as FilterState["dateField"];

  for (const [param, value] of p.entries()) {
    const field = PARAM_DIM[param];
    if (field && value) f.dims[field] = value.split("~").filter(Boolean);
  }

  const out = p.get("out");
  if (out) {
    f.outcomes = out
      .split("~")
      .filter((o): o is Outcome => (OUTCOMES as readonly string[]).includes(o));
  }

  const smin = p.get("smin");
  if (smin != null && smin !== "") f.stageAtLeast = Number(smin);
  const sat = p.get("sat");
  if (sat != null && sat !== "") f.stageExactly = Number(sat);

  f.search = p.get("q") ?? "";

  const rep = p.get("rep");
  if (rep === "1") f.repeats = true;
  else if (rep === "0") f.repeats = false;

  const emin = p.get("emin");
  if (emin) f.expMin = Number(emin);
  const emax = p.get("emax");
  if (emax) f.expMax = Number(emax);

  return f;
}

/* =========================================================================
 * Context
 * ========================================================================= */

export interface SavedView {
  id: string;
  name: string;
  query: string;
  path: string;
  createdAt: number;
}

interface FilterContextValue {
  filters: FilterState;
  setFilters: (next: FilterState | ((prev: FilterState) => FilterState)) => void;
  patch: (partial: Partial<FilterState>) => void;
  toggleDim: (field: DictField, value: string) => void;
  setDim: (field: DictField, values: string[]) => void;
  clearDim: (field: DictField) => void;
  reset: () => void;
  /** Replace all dimension filters with a single value — used by drill-downs. */
  drillTo: (field: DictField, value: string) => void;
  savedViews: SavedView[];
  saveView: (name: string, path: string) => void;
  deleteView: (id: string) => void;
}

const FilterContext = React.createContext<FilterContextValue | null>(null);

const VIEWS_KEY = "cpml.savedViews.v1";

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const { scope } = useSession();
  const [filters, setFiltersState] = React.useState<FilterState>(EMPTY_FILTERS);
  const [savedViews, setSavedViews] = React.useState<SavedView[]>([]);
  const hydrated = React.useRef(false);

  /**
   * Force the recruiter dimension to the session's scope.
   *
   * The query layer already narrows results, so a hand-edited URL cannot leak
   * another recruiter's records. But without this the filter STATE would still
   * hold the value the URL asked for, and the filter bar would render a chip
   * claiming a filter that is not in effect — the UI would be describing a view
   * the user is not actually looking at.
   */
  const normalise = React.useCallback(
    (next: FilterState): FilterState => {
      if (scope.kind === "all") return next;
      const recruiter = scope.kind === "own-book" ? [scope.recruiter] : [];
      const current = next.dims.recruiter ?? [];
      if (
        current.length === recruiter.length &&
        current.every((v, i) => v === recruiter[i])
      ) {
        return next;
      }
      const dims = { ...next.dims };
      if (recruiter.length) dims.recruiter = recruiter;
      else delete dims.recruiter;
      return { ...next, dims };
    },
    [scope],
  );

  // Re-apply when the session's scope changes, e.g. after a role switch.
  React.useEffect(() => {
    if (!hydrated.current) return;
    setFiltersState((prev) => normalise(prev));
  }, [normalise]);

  // Hydrate from the URL once on mount. Reading location directly (rather than
  // useSearchParams) keeps every page out of a Suspense boundary it does not
  // otherwise need.
  //
  // Deliberately runs once: re-running on a `normalise` identity change would
  // discard whatever the user has filtered since mount and snap them back to
  // the URL they arrived on. The effect above already re-applies scope when it
  // changes, which is the only reason `normalise` would differ.
  const normaliseOnMount = React.useRef(normalise);
  React.useEffect(() => {
    setFiltersState(normaliseOnMount.current(deserializeFilters(window.location.search)));
    try {
      const raw = localStorage.getItem(VIEWS_KEY);
      if (raw) setSavedViews(JSON.parse(raw) as SavedView[]);
    } catch {
      /* storage unavailable — saved views degrade to session-only */
    }
    hydrated.current = true;
  }, []);

  // Mirror state back to the URL without pushing history entries, so the back
  // button still means "previous page", not "previous filter tweak".
  React.useEffect(() => {
    if (!hydrated.current) return;
    const qs = serializeFilters(filters);
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [filters]);

  const setFilters = React.useCallback(
    (next: FilterState | ((prev: FilterState) => FilterState)) => {
      setFiltersState((prev) =>
        normalise(typeof next === "function" ? next(prev) : next),
      );
    },
    [normalise],
  );

  const patch = React.useCallback(
    (partial: Partial<FilterState>) => {
      setFiltersState((prev) => normalise({ ...prev, ...partial }));
    },
    [normalise],
  );

  const toggleDim = React.useCallback((field: DictField, value: string) => {
    setFiltersState((prev) => normalise((() => {
      const current = prev.dims[field] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const dims = { ...prev.dims };
      if (next.length) dims[field] = next;
      else delete dims[field];
      return { ...prev, dims };
    })()));
  }, [normalise]);

  const setDim = React.useCallback(
    (field: DictField, values: string[]) => {
      setFiltersState((prev) => {
        const dims = { ...prev.dims };
        if (values.length) dims[field] = values;
        else delete dims[field];
        return normalise({ ...prev, dims });
      });
    },
    [normalise],
  );

  const clearDim = React.useCallback(
    (field: DictField) => {
      setFiltersState((prev) => {
        const dims = { ...prev.dims };
        delete dims[field];
        return normalise({ ...prev, dims });
      });
    },
    [normalise],
  );

  // Clearing filters returns a scoped user to their own book, never to the
  // whole dataset.
  const reset = React.useCallback(() => {
    setFiltersState(normalise({ ...EMPTY_FILTERS, dims: {}, outcomes: [] }));
  }, [normalise]);

  const drillTo = React.useCallback(
    (field: DictField, value: string) => {
      setFiltersState((prev) =>
        normalise({ ...prev, dims: { ...prev.dims, [field]: [value] } }),
      );
    },
    [normalise],
  );

  const persistViews = React.useCallback((views: SavedView[]) => {
    setSavedViews(views);
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
    } catch {
      /* ignore */
    }
  }, []);

  const saveView = React.useCallback(
    (name: string, path: string) => {
      const view: SavedView = {
        id: `${Date.now()}`,
        name,
        query: serializeFilters(filters),
        path,
        createdAt: Date.now(),
      };
      persistViews([view, ...savedViews].slice(0, 40));
    },
    [filters, savedViews, persistViews],
  );

  const deleteView = React.useCallback(
    (id: string) => persistViews(savedViews.filter((v) => v.id !== id)),
    [savedViews, persistViews],
  );

  const value = React.useMemo<FilterContextValue>(
    () => ({
      filters, setFilters, patch, toggleDim, setDim, clearDim,
      reset, drillTo, savedViews, saveView, deleteView,
    }),
    [filters, setFilters, patch, toggleDim, setDim, clearDim, reset, drillTo, savedViews, saveView, deleteView],
  );

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters(): FilterContextValue {
  const ctx = React.useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be used inside <FilterProvider>");
  return ctx;
}

export { DIM_PARAM };
export const ALL_DICT_FIELDS = DICT_FIELDS;
