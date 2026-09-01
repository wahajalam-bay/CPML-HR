import {
  NULL_NUM,
  OUTCOME_INDEX,
  STAGES as STAGE_META,
  STAGE_COUNT,
  type ColumnKey,
  type DateField,
  type DictField,
  type NumField,
  type Outcome,
  type RecruitmentStore,
  type Selection,
} from "./schema";

/* =========================================================================
 * Filter model
 * ========================================================================= */

export interface FilterState {
  /** Inclusive day-offset bounds, or null for "all time". */
  from: number | null;
  to: number | null;
  /** Which date column the range applies to. */
  dateField: DateField;
  /** Dimension → selected values. OR within a field, AND across fields. */
  dims: Partial<Record<DictField, string[]>>;
  outcomes: Outcome[];
  /** Keep only candidates who reached at least this stage index. */
  stageAtLeast: number | null;
  /** Keep only candidates whose furthest stage is exactly this index. */
  stageExactly: number | null;
  /** Free-text over name / phone / recruiter. */
  search: string;
  /** null = everyone, true = repeat applicants only, false = first-time only. */
  repeats: boolean | null;
  /** Inclusive experience bounds in years. */
  expMin: number | null;
  expMax: number | null;
}

export const EMPTY_FILTERS: FilterState = {
  from: null,
  to: null,
  dateField: "applied_date",
  dims: {},
  outcomes: [],
  stageAtLeast: null,
  stageExactly: null,
  search: "",
  repeats: null,
  expMin: null,
  expMax: null,
};

export function isFilterActive(f: FilterState): boolean {
  return (
    f.from != null ||
    f.to != null ||
    f.outcomes.length > 0 ||
    f.stageAtLeast != null ||
    f.stageExactly != null ||
    f.search.trim() !== "" ||
    f.repeats != null ||
    f.expMin != null ||
    f.expMax != null ||
    Object.values(f.dims).some((v) => v && v.length > 0)
  );
}

export function countActiveFilters(f: FilterState): number {
  let n = 0;
  if (f.from != null || f.to != null) n++;
  if (f.outcomes.length) n++;
  if (f.stageAtLeast != null || f.stageExactly != null) n++;
  if (f.search.trim()) n++;
  if (f.repeats != null) n++;
  if (f.expMin != null || f.expMax != null) n++;
  for (const v of Object.values(f.dims)) if (v && v.length) n++;
  return n;
}

/* =========================================================================
 * Filter execution
 * ========================================================================= */

interface CompiledDim {
  col: Int32Array;
  /** mask[dictIndex] === 1 when that value is selected. */
  mask: Uint8Array;
}

/**
 * Run the filter set over the whole store and return matching row ids.
 *
 * Dimension predicates compile to a Uint8Array mask over the field's
 * dictionary, so the hot loop is `mask[col[row]]` — an integer index into a
 * byte array. On 28k rows the full pass costs well under a millisecond, which
 * is what lets every chart on a page re-derive itself on each keystroke.
 */
export function runFilter(store: RecruitmentStore, f: FilterState): Selection {
  const n = store.meta.rowCount;

  const dims: CompiledDim[] = [];
  for (const [field, values] of Object.entries(f.dims) as [DictField, string[]][]) {
    if (!values?.length) continue;
    const dict = store.dicts[field] ?? [];
    const mask = new Uint8Array(dict.length + 1);
    let any = false;
    for (const v of values) {
      const idx = store.lookups[field]?.get(v);
      if (idx != null && idx >= 0) {
        mask[idx] = 1;
        any = true;
      }
    }
    // A selection naming only unknown values matches nothing — respect that
    // rather than silently widening back to "all".
    dims.push({ col: store.cols[field], mask: any ? mask : new Uint8Array(dict.length + 1) });
  }

  const dateCol = store.cols[f.dateField];
  const from = f.from;
  const to = f.to;
  const useDate = from != null || to != null;

  let outcomeMask: Uint8Array | null = null;
  if (f.outcomes.length) {
    outcomeMask = new Uint8Array(16);
    for (const o of f.outcomes) outcomeMask[OUTCOME_INDEX[o]] = 1;
  }

  const stageCol = store.cols.stage_reached;
  const repeatCol = store.cols.is_repeat;
  const expCol = store.cols.experience_years;
  const expMin = f.expMin != null ? Math.round(f.expMin * 10) : null;
  const expMax = f.expMax != null ? Math.round(f.expMax * 10) : null;

  const needle = f.search.trim().toLowerCase();
  const searchIndex = store.searchIndex;

  const out = new Uint32Array(n);
  let count = 0;

  outer: for (let i = 0; i < n; i++) {
    if (useDate) {
      const d = dateCol[i];
      if (d < 0) continue;
      if (from != null && d < from) continue;
      if (to != null && d > to) continue;
    }
    for (let k = 0; k < dims.length; k++) {
      const { col, mask } = dims[k];
      const v = col[i];
      if (v < 0 || mask[v] !== 1) continue outer;
    }
    if (outcomeMask && outcomeMask[store.cols.outcome[i]] !== 1) continue;
    if (f.stageAtLeast != null && stageCol[i] < f.stageAtLeast) continue;
    if (f.stageExactly != null && stageCol[i] !== f.stageExactly) continue;
    if (f.repeats != null && (repeatCol[i] === 1) !== f.repeats) continue;
    if (expMin != null || expMax != null) {
      const e = expCol[i];
      if (e === NULL_NUM) continue;
      if (expMin != null && e < expMin) continue;
      if (expMax != null && e > expMax) continue;
    }
    if (needle && !searchIndex[i].includes(needle)) continue;
    out[count++] = i;
  }

  return out.subarray(0, count);
}

/** All rows, unfiltered — cheaper than running an empty filter. */
export function allRows(store: RecruitmentStore): Selection {
  const out = new Uint32Array(store.meta.rowCount);
  for (let i = 0; i < out.length; i++) out[i] = i;
  return out;
}

/** Narrow an existing selection with an extra predicate. */
export function refine(
  rows: Selection,
  predicate: (row: number) => boolean,
): Selection {
  const out = new Uint32Array(rows.length);
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    if (predicate(rows[i])) out[count++] = rows[i];
  }
  return out.subarray(0, count);
}

/* =========================================================================
 * Aggregation
 * ========================================================================= */

export interface Bucket {
  key: string;
  /** Dictionary index, or -1 for the synthesised "Other"/"Unknown" bucket. */
  index: number;
  count: number;
  rows: Selection;
}

/**
 * Group a selection by a dimension.
 *
 * `topN` folds the long tail into a single "Other" bucket rather than
 * generating extra hues — a categorical palette is never cycled.
 */
export function groupByDim(
  store: RecruitmentStore,
  rows: Selection,
  field: DictField,
  opts: { topN?: number; includeUnknown?: boolean; order?: string[] } = {},
): Bucket[] {
  const dict = store.dicts[field] ?? [];
  const col = store.cols[field];
  const counts = new Int32Array(dict.length);
  let unknown = 0;

  for (let i = 0; i < rows.length; i++) {
    const v = col[rows[i]];
    if (v < 0) unknown++;
    else counts[v]++;
  }

  const members: number[][] = Array.from({ length: dict.length }, () => []);
  const unknownRows: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const v = col[row];
    if (v < 0) unknownRows.push(row);
    else members[v].push(row);
  }

  let buckets: Bucket[] = [];
  for (let i = 0; i < dict.length; i++) {
    if (!counts[i]) continue;
    buckets.push({
      key: dict[i],
      index: i,
      count: counts[i],
      rows: Uint32Array.from(members[i]),
    });
  }

  if (opts.order) {
    const rank = new Map(opts.order.map((k, i) => [k, i]));
    buckets.sort(
      (a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999),
    );
  } else {
    buckets.sort((a, b) => b.count - a.count);
  }

  if (opts.topN && buckets.length > opts.topN) {
    const head = buckets.slice(0, opts.topN);
    const tail = buckets.slice(opts.topN);
    const tailRows: number[] = [];
    for (const b of tail) for (let i = 0; i < b.rows.length; i++) tailRows.push(b.rows[i]);
    head.push({
      key: "Other",
      index: -1,
      count: tail.reduce((s, b) => s + b.count, 0),
      rows: Uint32Array.from(tailRows),
    });
    buckets = head;
  }

  if (opts.includeUnknown && unknown) {
    buckets.push({
      key: "Not recorded",
      index: -1,
      count: unknown,
      rows: Uint32Array.from(unknownRows),
    });
  }

  return buckets;
}

/** Group by an arbitrary computed key — months, weeks, day-buckets, bands. */
export function groupByKey(
  rows: Selection,
  keyOf: (row: number) => string | null,
): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = keyOf(row);
    if (key == null) continue;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/* =========================================================================
 * Descriptive statistics
 * ========================================================================= */

export interface Stats {
  count: number;
  mean: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
}

export const EMPTY_STATS: Stats = {
  count: 0,
  mean: null,
  p25: null,
  median: null,
  p75: null,
  p90: null,
  min: null,
  max: null,
};

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Descriptive stats for a numeric column over a selection.
 *
 * `scale` converts the store's integer encoding back to real units
 * (experience is stored x10, salary in 500-rupee units).
 */
export function statsOf(
  store: RecruitmentStore,
  rows: Selection,
  field: NumField,
  scale = 1,
): Stats {
  const col = store.cols[field];
  const values: number[] = [];
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = col[rows[i]];
    if (v === NULL_NUM) continue;
    const scaled = v * scale;
    values.push(scaled);
    sum += scaled;
  }
  if (!values.length) return EMPTY_STATS;
  values.sort((a, b) => a - b);
  return {
    count: values.length,
    mean: sum / values.length,
    p25: quantile(values, 0.25),
    median: quantile(values, 0.5),
    p75: quantile(values, 0.75),
    p90: quantile(values, 0.9),
    min: values[0],
    max: values[values.length - 1],
  };
}

/** Raw scaled values of a numeric column — for histograms and box plots. */
export function valuesOf(
  store: RecruitmentStore,
  rows: Selection,
  field: NumField,
  scale = 1,
): number[] {
  const col = store.cols[field];
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const v = col[rows[i]];
    if (v !== NULL_NUM) out.push(v * scale);
  }
  return out;
}

export const EXPERIENCE_SCALE = 0.1;
export const SALARY_SCALE = 500;

/* =========================================================================
 * Funnel
 * ========================================================================= */

export interface FunnelStage {
  index: number;
  key: string;
  label: string;
  /** Candidates who entered this stage. */
  entered: number;
  /** Candidates who cleared it and were eligible to advance. */
  cleared: number;
  /** cleared / entered — how selective the stage is. */
  passRate: number | null;
  /** entered(n+1) / entered(n) — how much volume survives to the next stage. */
  stepConversion: number | null;
  /** entered / entered(0) — share of the original intake still present. */
  cumulative: number;
  /** Candidates who entered but did not clear. */
  lost: number;
  /** Rows still sitting in this stage as their furthest point. */
  resting: number;
  rows: Selection;
}

export function buildFunnel(
  store: RecruitmentStore,
  rows: Selection,
): FunnelStage[] {
  const reached = store.cols.stage_reached;
  const passed = store.cols.stage_passed;

  const entered = new Int32Array(STAGE_COUNT);
  const cleared = new Int32Array(STAGE_COUNT);
  const resting = new Int32Array(STAGE_COUNT);
  const members: number[][] = Array.from({ length: STAGE_COUNT }, () => []);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = reached[row];
    const p = passed[row];
    resting[r]++;
    for (let s = 0; s <= r; s++) {
      entered[s]++;
      members[s].push(row);
      if ((p >> s) & 1) cleared[s]++;
    }
  }

  const total = entered[0] || 1;
  const out: FunnelStage[] = [];
  for (let s = 0; s < STAGE_COUNT; s++) {
    const next = s + 1 < STAGE_COUNT ? entered[s + 1] : null;
    out.push({
      index: s,
      key: STAGE_META[s].key,
      label: STAGE_META[s].label,
      entered: entered[s],
      cleared: cleared[s],
      passRate: entered[s] ? (cleared[s] / entered[s]) * 100 : null,
      stepConversion: next != null && entered[s] ? (next / entered[s]) * 100 : null,
      cumulative: (entered[s] / total) * 100,
      lost: entered[s] - cleared[s],
      resting: resting[s],
      rows: Uint32Array.from(members[s]),
    });
  }
  return out;
}

/* =========================================================================
 * Time series
 * ========================================================================= */

export type Granularity = "day" | "week" | "month" | "quarter";

export interface TimePoint {
  key: string;
  /** Sortable numeric position — the first day of the bucket. */
  day: number;
  rows: Selection;
}

const DAY_MS = 86_400_000;
const EPOCH_MS = Date.UTC(2024, 0, 1);

function bucketKey(day: number, g: Granularity): { key: string; start: number } {
  if (g === "day") return { key: String(day), start: day };
  if (g === "week") {
    const d = new Date(EPOCH_MS + day * DAY_MS);
    const dow = (d.getUTCDay() + 6) % 7;
    const start = day - dow;
    return { key: `W${start}`, start };
  }
  const d = new Date(EPOCH_MS + day * DAY_MS);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (g === "quarter") {
    const qm = Math.floor(m / 3) * 3;
    const start = Math.floor((Date.UTC(y, qm, 1) - EPOCH_MS) / DAY_MS);
    return { key: `${y}-Q${Math.floor(m / 3) + 1}`, start };
  }
  const start = Math.floor((Date.UTC(y, m, 1) - EPOCH_MS) / DAY_MS);
  return { key: `${y}-${String(m + 1).padStart(2, "0")}`, start };
}

/**
 * Bucket a selection into time periods on a chosen date column.
 *
 * Buckets with no rows are materialised so a line never joins across a gap
 * and silently implies activity that did not happen.
 */
export function timeSeries(
  store: RecruitmentStore,
  rows: Selection,
  field: DateField,
  granularity: Granularity,
  opts: { fillGaps?: boolean } = { fillGaps: true },
): TimePoint[] {
  const col = store.cols[field];
  const map = new Map<string, { day: number; rows: number[] }>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const d = col[row];
    if (d < 0) continue;
    const { key, start } = bucketKey(d, granularity);
    const entry = map.get(key);
    if (entry) entry.rows.push(row);
    else map.set(key, { day: start, rows: [row] });
  }

  const points = [...map.entries()]
    .map(([key, v]) => ({ key, day: v.day, rows: Uint32Array.from(v.rows) }))
    .sort((a, b) => a.day - b.day);

  if (!opts.fillGaps || points.length < 2) return points;

  const step =
    granularity === "day" ? 1 : granularity === "week" ? 7 : granularity === "month" ? 30 : 91;
  const filled: TimePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    filled.push(points[i]);
    const next = points[i + 1];
    if (!next) break;
    let cursor = points[i].day;
    // Walk calendar-correct buckets rather than adding a fixed day count.
    while (true) {
      const d = new Date(EPOCH_MS + cursor * DAY_MS);
      let nextDay: number;
      if (granularity === "month") {
        nextDay = Math.floor(
          (Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - EPOCH_MS) / DAY_MS,
        );
      } else if (granularity === "quarter") {
        nextDay = Math.floor(
          (Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1) - EPOCH_MS) / DAY_MS,
        );
      } else {
        nextDay = cursor + step;
      }
      if (nextDay >= next.day) break;
      const { key } = bucketKey(nextDay, granularity);
      filled.push({ key, day: nextDay, rows: new Uint32Array(0) });
      cursor = nextDay;
    }
  }
  return filled;
}

/* =========================================================================
 * Period comparison
 * ========================================================================= */

/**
 * The equally-sized window immediately preceding the current one.
 * Falls back to the dataset's own bounds when the range is open-ended, so
 * "vs previous period" always means something concrete.
 */
export function previousPeriod(
  f: FilterState,
  meta: { dateMin: number; dateMax: number },
): { from: number; to: number } | null {
  const from = f.from ?? meta.dateMin;
  const to = f.to ?? meta.dateMax;
  const span = to - from;
  if (span <= 0) return null;
  const prevTo = from - 1;
  const prevFrom = prevTo - span;
  if (prevTo < meta.dateMin) return null;
  return { from: Math.max(prevFrom, meta.dateMin - span), to: prevTo };
}

/** Percentage change from `previous` to `current`, or null when undefined. */
export function delta(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}

/* =========================================================================
 * Column access helpers
 * ========================================================================= */

export function colValue(
  store: RecruitmentStore,
  row: number,
  field: ColumnKey,
): number {
  return store.cols[field][row];
}

export function dimOf(
  store: RecruitmentStore,
  row: number,
  field: DictField,
): string | null {
  const idx = store.cols[field][row];
  return idx < 0 ? null : store.dicts[field][idx];
}

export function numOf(
  store: RecruitmentStore,
  row: number,
  field: NumField,
  scale = 1,
): number | null {
  const v = store.cols[field][row];
  return v === NULL_NUM ? null : v * scale;
}

export function dateOf(
  store: RecruitmentStore,
  row: number,
  field: DateField,
): number | null {
  const v = store.cols[field][row];
  return v < 0 ? null : v;
}

export function outcomeOf(store: RecruitmentStore, row: number): Outcome {
  return store.meta.outcomes[store.cols.outcome[row]] as Outcome;
}
