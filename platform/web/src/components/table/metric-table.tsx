"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, Download } from "lucide-react";
import { cn, fmtInt } from "@/lib/utils";
import { Hint } from "@/components/ui/overlays";
import { Button } from "@/components/ui/button";
import { BandBadge, type PerfBand } from "@/components/ui/primitives";
import { bandOf } from "@/components/charts/chart-kit";
import { downloadCsv } from "@/lib/export/exporters";
import { Can } from "@/components/auth/guards";
import { useSession } from "@/lib/providers/session-provider";

/* =========================================================================
 * Column model
 * ========================================================================= */

export interface MetricColumn<T> {
  id: string;
  header: string;
  /** One sentence explaining what the column measures. */
  help?: string;
  /** Raw comparable value; null renders as an em dash and sorts last. */
  value: (row: T) => number | string | null;
  /** Display string. Falls back to the raw value. */
  render?: (row: T) => React.ReactNode;
  align?: "left" | "right";
  width?: string;
  /** Draw an inline magnitude bar behind the figure. */
  bar?: boolean;
  /** Quartile-band the column against the visible rows. */
  band?: "higher-better" | "lower-better";
  /** Absolute floor below which a value is Critical regardless of quartile. */
  floor?: number;
  sortable?: boolean;
  /** Hide below this breakpoint to keep narrow screens readable. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
}

type SortState = { id: string; dir: "asc" | "desc" } | null;

/**
 * The leaderboard table.
 *
 * Sorting, inline magnitude bars, quartile performance bands and CSV export.
 * Bands are computed against the rows actually on screen, so "Top quartile"
 * always means "of what you are currently looking at" rather than of some
 * hidden global population.
 */
export function MetricTable<T>({
  rows,
  columns,
  rowKey,
  rowHref,
  onRowClick,
  defaultSort,
  className,
  maxHeight,
  exportName,
  emptyLabel = "No rows match the current filters.",
  stickyFirstColumn = true,
  footer,
}: {
  rows: T[];
  columns: MetricColumn<T>[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  defaultSort?: { id: string; dir: "asc" | "desc" };
  className?: string;
  maxHeight?: number;
  exportName?: string;
  emptyLabel?: string;
  stickyFirstColumn?: boolean;
  footer?: React.ReactNode;
}) {
  const [sort, setSort] = React.useState<SortState>(defaultSort ?? null);
  const { audit } = useSession();

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls always sink
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * factor;
      }
      return (av - bv) * factor;
    });
  }, [rows, columns, sort]);

  // Per-column scales and quartiles, derived from the visible rows.
  const stats = React.useMemo(() => {
    const map = new Map<string, { max: number; q1: number; median: number; q3: number }>();
    for (const col of columns) {
      if (!col.bar && !col.band) continue;
      const values = rows
        .map((r) => col.value(r))
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        .sort((a, b) => a - b);
      if (!values.length) continue;
      const q = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))];
      map.set(col.id, {
        max: Math.max(...values.map(Math.abs)),
        q1: q(0.25),
        median: q(0.5),
        q3: q(0.75),
      });
    }
    return map;
  }, [rows, columns]);

  const toggleSort = (id: string) => {
    setSort((prev) => {
      if (prev?.id !== id) return { id, dir: "desc" };
      if (prev.dir === "desc") return { id, dir: "asc" };
      return null;
    });
  };

  const hideClass = (bp?: MetricColumn<T>["hideBelow"]) =>
    bp === "sm" ? "hidden sm:table-cell"
      : bp === "md" ? "hidden md:table-cell"
        : bp === "lg" ? "hidden lg:table-cell"
          : bp === "xl" ? "hidden xl:table-cell"
            : "";

  if (!rows.length) {
    return <p className="px-4 py-10 text-center text-meta text-ink-4">{emptyLabel}</p>;
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className="min-h-0 flex-1 overflow-auto"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full border-collapse text-meta">
          <thead className="sticky top-0 z-20">
            <tr>
              {columns.map((col, ci) => {
                const active = sort?.id === col.id;
                const sortable = col.sortable !== false;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    className={cn(
                      "border-b border-line bg-g6 px-3 py-1.5 col-head whitespace-nowrap",
                      col.align === "right" || (ci > 0 && col.align !== "left")
                        ? "text-right"
                        : "text-left",
                      stickyFirstColumn && ci === 0 && "sticky left-0 z-10",
                      hideClass(col.hideBelow),
                    )}
                  >
                    <Hint content={col.help ?? ""}>
                      <button
                        type="button"
                        disabled={!sortable}
                        onClick={() => sortable && toggleSort(col.id)}
                        className={cn(
                          "inline-flex items-center gap-1 col-head",
                          sortable && "cursor-pointer hover:text-ink",
                          col.align === "right" || (ci > 0 && col.align !== "left")
                            ? "flex-row-reverse"
                            : "",
                        )}
                      >
                        {col.header}
                        {sortable ? (
                          active ? (
                            sort.dir === "desc" ? (
                              <ArrowDown className="size-3" />
                            ) : (
                              <ArrowUp className="size-3" />
                            )
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-35" />
                          )
                        ) : null}
                      </button>
                    </Hint>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, ri) => {
              const key = rowKey(row);
              const interactive = Boolean(rowHref || onRowClick);
              const cells = columns.map((col, ci) => {
                const raw = col.value(row);
                const stat = stats.get(col.id);
                const numeric = typeof raw === "number" && Number.isFinite(raw);
                const band: PerfBand | null =
                  col.band && stat && numeric
                    ? bandOf(raw, { ...stat, floor: col.floor }, col.band)
                    : null;

                return (
                  <td
                    key={col.id}
                    className={cn(
                      "border-b border-line px-3 py-1.5",
                      col.align === "right" || (ci > 0 && col.align !== "left")
                        ? "text-right tabular-nums"
                        : "text-left",
                      ci === 0 ? "font-semibold text-ink" : "text-ink-2",
                      stickyFirstColumn && ci === 0 && "sticky left-0 z-10 bg-surface",
                      hideClass(col.hideBelow),
                    )}
                  >
                    {col.bar && stat && numeric ? (
                      <span className="flex items-center justify-end gap-2">
                        <span className="relative hidden h-1.5 w-14 overflow-hidden rounded-full bg-surface-3 sm:block">
                          <span
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{
                              width: `${stat.max ? (Math.abs(raw) / stat.max) * 100 : 0}%`,
                              background: band
                                ? `var(--q-${band === "critical" ? "crit" : band})`
                                : "var(--g3)",
                            }}
                          />
                        </span>
                        <span className="font-medium text-ink">
                          {col.render ? col.render(row) : formatCell(raw)}
                        </span>
                      </span>
                    ) : band ? (
                      <span className="inline-flex items-center gap-1.5">
                        <BandBadge band={band} showLabel={false} />
                        <span className="font-medium text-ink">
                          {col.render ? col.render(row) : formatCell(raw)}
                        </span>
                      </span>
                    ) : col.render ? (
                      col.render(row)
                    ) : (
                      formatCell(raw)
                    )}
                  </td>
                );
              });

              const rowClass = cn(
                "transition-colors",
                ri % 2 === 1 && "bg-surface-2/45",
                interactive && "drill",
              );

              if (rowHref) {
                return (
                  <tr
                    key={key}
                    className={rowClass}
                    onClick={(e) => {
                      // Let the anchor in the first cell handle modified clicks.
                      if (e.metaKey || e.ctrlKey) return;
                    }}
                  >
                    {columns.map((col, ci) =>
                      ci === 0 ? (
                        <td
                          key={col.id}
                          className={cn(
                            "border-b border-line px-3 py-1.5 font-semibold",
                            stickyFirstColumn && "sticky left-0 z-10 bg-surface",
                          )}
                        >
                          <Link
                            href={rowHref(row)}
                            className="text-ink hover:text-g1 hover:underline"
                          >
                            {col.render ? col.render(row) : formatCell(col.value(row))}
                          </Link>
                        </td>
                      ) : (
                        cells[ci]
                      ),
                    )}
                  </tr>
                );
              }

              return (
                <tr
                  key={key}
                  className={rowClass}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {cells}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(exportName || footer) && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-1.5 text-micro text-ink-4">
          <span>{footer ?? `${fmtInt(rows.length)} rows`}</span>
          {exportName ? (
            <Can capability="action.export.csv">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  downloadCsv(
                    exportName,
                    columns.map((c) => c.header),
                    sorted.map((r) => columns.map((c) => c.value(r) ?? "")),
                  );
                  audit("export.csv", exportName, { rowCount: sorted.length });
                }}
              >
                <Download />
                CSV
              </Button>
            </Can>
          ) : null}
        </div>
      )}
    </div>
  );
}

function formatCell(v: number | string | null): React.ReactNode {
  if (v == null) return <span className="text-ink-4">—</span>;
  if (typeof v === "number") return fmtInt(v);
  return v;
}
