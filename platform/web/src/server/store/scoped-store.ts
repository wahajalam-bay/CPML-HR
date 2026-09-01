import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { NULL_IDX } from "@/lib/data/schema";
import type { Principal } from "@/server/rbac";

/**
 * The dataset, scoped to a session before it leaves the server.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 *
 * The dashboard's speed comes from holding the whole columnar store in the
 * browser: a filter pass is integer comparisons over typed arrays, so
 * cross-filtering 28,366 records is instant and needs no round trip. The cost
 * is that whatever is in that payload has been *delivered*, and no amount of
 * client-side checking un-delivers it. A Recruiter whose UI shows 4,999 records
 * still received all 28,366 if the payload was the static file.
 *
 * `DATASET_MODE=server-scoped` is the claim that this is not so. This module is
 * what makes the claim true: it filters rows to the session's scope and blanks
 * the fields the role may not see, then re-encodes.
 *
 * ── Why re-encode rather than rebuild from Postgres ─────────────────────
 *
 * A store built from a fresh SQL query would be a second implementation of the
 * ETL's encoding, and the warehouse does not carry every column the store has
 * (final_interviewer, director, the derived bands). The two would drift, and
 * the drift would show up as a metric that differs by posture — which is
 * exactly the failure this codebase spends its effort avoiding. Slicing the
 * canonical payload cannot drift from it.
 *
 * ── Cost ────────────────────────────────────────────────────────────────
 *
 * The parsed store is held once per server instance (~30 MB of arrays) and each
 * request builds only the slice it needs. For an unscoped role the slice is the
 * whole thing, so the gzipped bytes are cached per redaction shape rather than
 * rebuilt — that covers every Manager, Director and Admin with one buffer.
 */

type SparseColumn = { s: 1; i: number[]; v: number[] };
type WireColumn = number[] | SparseColumn;

interface WireStore {
  meta: { rowCount: number; nulls?: Record<string, number>; [k: string]: unknown };
  dicts: Record<string, string[]>;
  cols: Record<string, WireColumn>;
  names: string[];
  phones: string[];
}

/**
 * Store columns that carry a protected field.
 *
 * Only salary and phone appear in the columnar store; email, national identity
 * number and recruiter notes are never encoded into it at all, so there is
 * nothing here to withhold for them. That is by design — the store exists for
 * aggregation, and those three fields aggregate to nothing.
 */
const PROTECTED_COLUMNS: { column: string; field: string }[] = [
  { column: "current_salary", field: "salary" },
  { column: "salary_band", field: "salary" },
];

/**
 * Dictionaries that name people, and are therefore compacted to the values the
 * delivered rows actually reference.
 *
 * A scoped payload used to carry every dictionary whole: a Recruiter with 4,999
 * of their own rows still received the names of all 17 recruiters, 123 hiring
 * managers, 83 final interviewers and 4 directors — the entire org chart, none
 * of which appears in any row they were given. Two problems with that: it
 * contradicts the claim that the browser is never handed what the session may
 * not see, and the filter dropdowns built from these lists offered values that
 * could only ever return nothing.
 *
 * The taxonomies — source, role, city, degree, institute, industry, team,
 * statuses, bands — are deliberately NOT compacted. They are organisational
 * vocabulary rather than personal data, chart legends and colour assignments
 * stay stable across roles when they are shared, and `experience_band` and
 * `salary_band` are also indexed by arrays in `meta`, so remapping one without
 * the other would silently mislabel every band in the app.
 */
const PEOPLE_DICTS = ["recruiter", "hiring_manager", "final_interviewer", "director"] as const;

/* -------------------------------------------------------------------------
 * The canonical store, parsed once
 * ---------------------------------------------------------------------- */

let canonical: Promise<WireStore> | null = null;

function loadCanonical(): Promise<WireStore> {
  canonical ??= readFile(join(process.cwd(), "public", "data", "store.json"), "utf8")
    .then((raw) => JSON.parse(raw) as WireStore)
    .catch((error) => {
      // Reset so a transient read failure does not poison every later request.
      canonical = null;
      throw error;
    });
  return canonical;
}

/* -------------------------------------------------------------------------
 * Slicing
 * ---------------------------------------------------------------------- */

function densify(col: WireColumn, rowCount: number, nullValue: number): number[] {
  if (Array.isArray(col)) return col;
  const out = new Array<number>(rowCount).fill(nullValue);
  let cursor = 0;
  for (let k = 0; k < col.i.length; k++) {
    cursor += col.i[k];
    out[cursor] = col.v[k];
  }
  return out;
}

/**
 * Re-sparsify a column whose values are mostly the null marker.
 *
 * The ETL does this to keep the payload small — two thirds of the columns only
 * apply to candidates deep in the funnel. Preserving the encoding matters:
 * densifying everything on the way out would roughly quadruple what a Recruiter
 * downloads, which is the opposite of the point.
 */
function sparsify(values: number[], nullValue: number): WireColumn {
  let present = 0;
  for (const v of values) if (v !== nullValue) present++;
  // Sparse costs two entries per present row, so it only wins below half.
  if (present * 2 >= values.length) return values;

  const i: number[] = [];
  const v: number[] = [];
  let previous = -1;
  for (let row = 0; row < values.length; row++) {
    if (values[row] === nullValue) continue;
    i.push(row - previous);
    v.push(values[row]);
    previous = row;
  }
  return { s: 1, i, v };
}

export interface ScopedStoreResult {
  /** Gzipped JSON, ready to serve. */
  body: Buffer;
  rowCount: number;
  /** Rows withheld from this session. */
  withheldRows: number;
  withheldFields: string[];
}

export async function buildScopedStore(
  principal: Principal,
): Promise<ScopedStoreResult> {
  const store = await loadCanonical();
  const total = store.meta.rowCount;

  const withheldFields = PROTECTED_COLUMNS.filter((p) => !principal.canSeeField(p.field))
    .map((p) => p.field)
    .filter((field, index, all) => all.indexOf(field) === index);
  const hidePhone = !principal.canSeeField("phone");
  if (hidePhone) withheldFields.push("phone");

  /* ---- Which rows this session may see ------------------------------- */
  let keep: number[] | null = null; // null means every row

  if (principal.scope.kind === "none") {
    keep = [];
  } else if (principal.scope.kind === "own-book") {
    const dict = store.dicts.recruiter ?? [];
    const wanted = dict.indexOf(principal.scope.recruiter);
    const recruiterCol = densify(
      store.cols.recruiter,
      total,
      store.meta.nulls?.recruiter ?? NULL_IDX,
    );
    keep = [];
    // An unknown recruiter name yields no rows rather than every row. A book
    // that does not exist in the dataset must fail closed.
    if (wanted >= 0) {
      for (let row = 0; row < total; row++) {
        if (recruiterCol[row] === wanted) keep.push(row);
      }
    }
  }

  const cacheKey = keep === null ? `all:${withheldFields.sort().join(",")}` : null;
  if (cacheKey) {
    const hit = unscopedCache.get(cacheKey);
    if (hit) return hit;
  }

  /* ---- Build the payload --------------------------------------------- */
  const rowCount = keep ? keep.length : total;
  const cols: Record<string, WireColumn> = {};

  for (const [key, column] of Object.entries(store.cols)) {
    const nullValue = store.meta.nulls?.[key] ?? NULL_IDX;
    const protection = PROTECTED_COLUMNS.find((p) => p.column === key);
    const withhold = protection && !principal.canSeeField(protection.field);

    if (withhold) {
      /* An empty sparse column decodes to `meta.nulls[key]` for every row —
         -1 for a dictionary index, -32768 for a number. Withholding as the null
         marker rather than as zero matters: zero is a valid salary, and a
         redaction that looks like data corrupts every average computed from it.
         The column is still present and still the right length, so nothing
         downstream has to know it was redacted. */
      cols[key] = { s: 1, i: [], v: [] };
      continue;
    }

    if (!keep) {
      cols[key] = column;
      continue;
    }

    const dense = densify(column, total, nullValue);
    const sliced = new Array<number>(rowCount);
    for (let k = 0; k < rowCount; k++) sliced[k] = dense[keep[k]];
    cols[key] = sparsify(sliced, nullValue);
  }

  /* ---- Compact the people dictionaries --------------------------------- */
  const dicts: Record<string, string[]> = { ...store.dicts };

  if (keep) {
    for (const field of PEOPLE_DICTS) {
      const source = store.dicts[field];
      if (!source) continue;

      const nullValue = store.meta.nulls?.[field] ?? NULL_IDX;
      const dense = densify(cols[field], rowCount, nullValue);

      // Old index → new index, assigned in first-appearance order so the
      // dictionary stays deterministic for a given scope.
      const remap = new Map<number, number>();
      const compacted: string[] = [];
      for (const index of dense) {
        if (index === nullValue || index < 0) continue;
        if (remap.has(index)) continue;
        remap.set(index, compacted.length);
        compacted.push(source[index]);
      }

      dicts[field] = compacted;
      cols[field] = sparsify(
        dense.map((index) => (remap.has(index) ? remap.get(index)! : nullValue)),
        nullValue,
      );
    }
  }

  const names = keep ? keep.map((row) => store.names[row]) : store.names;
  const phones = hidePhone
    ? new Array<string>(rowCount).fill("")
    : keep
      ? keep.map((row) => store.phones[row])
      : store.phones;

  const payload: WireStore = {
    meta: {
      ...store.meta,
      rowCount,
      // So the UI can say "4,999 of 28,366" honestly without holding the rest.
      scopedFrom: total,
      scope:
        principal.scope.kind === "own-book"
          ? { kind: "own-book", recruiter: principal.scope.recruiter }
          : { kind: principal.scope.kind },
      withheldFields,
    },
    dicts,
    cols,
    names,
    phones,
  };

  const result: ScopedStoreResult = {
    body: gzipSync(Buffer.from(JSON.stringify(payload), "utf8")),
    rowCount,
    withheldRows: total - rowCount,
    withheldFields,
  };

  if (cacheKey) unscopedCache.set(cacheKey, result);
  return result;
}

/**
 * Gzipped payloads for roles that see every row, keyed by redaction shape.
 *
 * Bounded to the number of distinct shapes the permission model can produce —
 * a handful — so this cannot grow with traffic. Scoped payloads are never
 * cached: they are per-recruiter, and a cache keyed on identity is a cache that
 * eventually serves the wrong one.
 */
const unscopedCache = new Map<string, ScopedStoreResult>();
