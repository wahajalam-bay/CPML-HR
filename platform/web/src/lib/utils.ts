import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* -------------------------------------------------------------------------
 * Number formatting
 * ---------------------------------------------------------------------- */

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** 28366 → "28,366" */
export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return nf0.format(Math.round(n));
}

/** 28366 → "28.4k" — for axis ticks and tight cells only. */
export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${nf1.format(n / 1_000_000)}M`;
  if (a >= 10_000) return `${nf0.format(n / 1000)}k`;
  if (a >= 1_000) return `${nf1.format(n / 1000)}k`;
  return nf0.format(n);
}

/** 43.72 → "43.7%" (takes an already-scaled percentage) */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

/** 0.4372 → "43.7%" (takes a 0–1 fraction) */
export function fmtRatio(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

/** Signed delta for variance chips: 4.2 → "+4.2" */
export function fmtDelta(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

/** 88000 → "PKR 88,000"; compact: "88k" */
export function fmtSalary(n: number | null | undefined, compact = false): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return compact ? `${Math.round(n / 1000)}k` : `PKR ${nf0.format(n)}`;
}

export function fmtDays(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}d`;
}

export function fmtYears(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${nf1.format(n)} yrs`;
}

/* -------------------------------------------------------------------------
 * Dates — the store speaks in day-offsets from a fixed epoch
 * ---------------------------------------------------------------------- */

export const EPOCH_MS = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;

export function dayToDate(day: number): Date {
  return new Date(EPOCH_MS + day * DAY_MS);
}

export function dateToDay(d: Date): number {
  return Math.floor(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH_MS) / DAY_MS,
  );
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** 512 → "27 May 2025" */
export function fmtDay(day: number | null | undefined): string {
  if (day == null || day < 0) return "—";
  const d = dayToDate(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 512 → "27 May" */
export function fmtDayShort(day: number | null | undefined): string {
  if (day == null || day < 0) return "—";
  const d = dayToDate(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "2025-05" → "May 2025" */
export function fmtMonthKey(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** "2025-05" → "May '25" */
export function fmtMonthKeyShort(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1]} '${y.slice(2)}`;
}

export function monthKeyOf(day: number): string {
  const d = dayToDate(day);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function weekKeyOf(day: number): string {
  // ISO-ish: bucket to the Monday of the week containing `day`.
  const d = dayToDate(day);
  const dow = (d.getUTCDay() + 6) % 7;
  return String(day - dow);
}

export function quarterKeyOf(day: number): string {
  const d = dayToDate(day);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

/* -------------------------------------------------------------------------
 * Misc
 * ---------------------------------------------------------------------- */

export function slugify(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Safe division that yields null rather than NaN/Infinity. */
export function safeDiv(a: number, b: number): number | null {
  return b === 0 ? null : a / b;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
