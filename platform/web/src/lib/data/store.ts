import { DATASET_MODE } from "@/lib/auth/permissions";
import {
  DICT_FIELDS,
  type ColumnKey,
  type DictField,
  type RecruitmentStore,
  type StoreMeta,
} from "./schema";

/* -------------------------------------------------------------------------
 * Wire format
 * ---------------------------------------------------------------------- */

type SparseColumn = { s: 1; i: number[]; v: number[] };
type WireColumn = number[] | SparseColumn;

interface WireStore {
  meta: StoreMeta;
  dicts: Record<string, string[]>;
  cols: Record<string, WireColumn>;
  names: string[];
  phones: string[];
}

function isSparse(c: WireColumn): c is SparseColumn {
  return !Array.isArray(c);
}

/**
 * Expand a wire column to a dense Int32Array.
 *
 * Sparse columns carry delta-encoded row indices — roughly two thirds of the
 * dataset's columns only apply to candidates deep in the funnel, so shipping
 * them densely would quadruple the payload for no information.
 */
function expandColumn(col: WireColumn, rowCount: number, nullValue: number): Int32Array {
  if (!isSparse(col)) return Int32Array.from(col);
  const out = new Int32Array(rowCount).fill(nullValue);
  let cursor = 0;
  for (let k = 0; k < col.i.length; k++) {
    cursor += col.i[k];
    out[cursor] = col.v[k];
  }
  return out;
}

/* -------------------------------------------------------------------------
 * Loading
 * ---------------------------------------------------------------------- */

/**
 * Where the dataset comes from, and why it differs by posture.
 *
 * `server-scoped` — an authenticated endpoint that filters rows to the session's
 *                   scope and blanks fields the role may not see, before
 *                   serialising. The browser is never handed records it is not
 *                   entitled to.
 * `client-full`   — the static build artefact: every record, scoped in the
 *                   browser. Fast and works with no backend, but scoping there
 *                   governs what is shown, not what was delivered.
 *
 * The static file is deliberately NOT a fallback for the scoped endpoint. If the
 * endpoint fails, the honest outcome is an error — quietly serving the full
 * dataset instead would turn an outage into a disclosure.
 */
const SOURCE =
  DATASET_MODE === "server-scoped" ? "/api/v1/store" : "/data/store.gz";

async function inflate(res: Response): Promise<WireStore> {
  /* The scoped endpoint declares Content-Encoding: gzip, which makes it part of
     the transfer rather than the payload — fetch inflates it before we see the
     body. The static file carries no such header (it is served as a plain .gz
     asset), so that one has to be inflated here. */
  if (SOURCE === "/api/v1/store") {
    return (await res.json()) as WireStore;
  }

  const body = res.body;
  if (body && typeof DecompressionStream !== "undefined") {
    const stream = body.pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text()) as WireStore;
  }
  // Fallback for runtimes without DecompressionStream.
  const plain = await fetch("/data/store.json");
  return (await plain.json()) as WireStore;
}

function hydrate(wire: WireStore): RecruitmentStore {
  const { meta } = wire;
  const rowCount = meta.rowCount;

  const cols = {} as Record<ColumnKey, Int32Array>;
  for (const [key, col] of Object.entries(wire.cols)) {
    const nullValue = meta.nulls?.[key] ?? -1;
    cols[key as ColumnKey] = expandColumn(col, rowCount, nullValue);
  }

  const lookups = {} as Record<DictField, Map<string, number>>;
  for (const field of DICT_FIELDS) {
    const values = wire.dicts[field] ?? [];
    const map = new Map<string, number>();
    for (let i = 0; i < values.length; i++) map.set(values[i], i);
    lookups[field] = map;
  }

  // One lowercase haystack per row powers global search and table filtering.
  const searchIndex = new Array<string>(rowCount);
  const recruiterDict = wire.dicts.recruiter ?? [];
  const recruiterCol = cols.recruiter;
  for (let i = 0; i < rowCount; i++) {
    const recruiter = recruiterCol[i] >= 0 ? recruiterDict[recruiterCol[i]] : "";
    searchIndex[i] = `${wire.names[i]} ${wire.phones[i]} ${recruiter}`.toLowerCase();
  }

  return {
    meta,
    dicts: wire.dicts as Record<DictField, string[]>,
    cols,
    names: wire.names,
    phones: wire.phones,
    searchIndex,
    lookups,
  };
}

let cached: Promise<RecruitmentStore> | null = null;

/** Fetch, inflate and hydrate the store. Memoised for the page lifetime. */
export function loadStore(): Promise<RecruitmentStore> {
  if (!cached) {
    cached = fetch(SOURCE, { credentials: "same-origin" })
      .then((res) => {
        if (res.status === 401) {
          throw new Error("Your session has ended. Sign in again to load the dataset.");
        }
        if (!res.ok) throw new Error(`Dataset unavailable (HTTP ${res.status})`);
        return inflate(res);
      })
      .then(hydrate)
      .catch((err) => {
        cached = null;
        throw err;
      });
  }
  return cached;
}

/* -------------------------------------------------------------------------
 * Dictionary helpers
 * ---------------------------------------------------------------------- */

export function dictValue(
  store: RecruitmentStore,
  field: DictField,
  index: number,
): string | null {
  if (index < 0) return null;
  return store.dicts[field]?.[index] ?? null;
}

export function dictIndex(
  store: RecruitmentStore,
  field: DictField,
  value: string,
): number {
  return store.lookups[field]?.get(value) ?? -1;
}

/** Every distinct value of a dimension, most frequent first. */
export function dimensionValues(
  store: RecruitmentStore,
  field: DictField,
): string[] {
  return store.dicts[field] ?? [];
}
