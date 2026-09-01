"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Columns3,
  Download,
  FileSpreadsheet,
  Search,
  Table2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn, fmtInt } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Panel, Badge, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
} from "@/components/ui/overlays";
import { useStore } from "@/lib/providers/store-provider";
import { useFilters, serializeFilters } from "@/lib/providers/filter-provider";
import { useSelection } from "@/lib/hooks/use-analytics";
import { useSession } from "@/lib/providers/session-provider";
import { downloadCsv, downloadExcel } from "@/lib/export/exporters";
import {
  COLUMN_GROUPS,
  DEFAULT_VISIBLE,
  permittedColumns,
  type CandidateColumn,
} from "./candidate-columns";
import { Can } from "@/components/auth/guards";
import { CandidateDrawer } from "./candidate-drawer";

const ROW_HEIGHT = 32;
const VIEW_KEY = "cpml.candidateColumns.v1";
const EXPORT_CAP = 20_000;

type Sort = { id: string; dir: "asc" | "desc" } | null;

/**
 * Candidate Explorer.
 *
 * Renders all 28,366 application records without materialising a single row
 * object: sorting produces an index permutation over the columnar store, and
 * the virtualiser paints roughly forty <tr> elements at a time. That is what
 * keeps sorting and column changes instant on the full dataset rather than on
 * a paginated slice of it.
 */
export function CandidateExplorer() {
  const store = useStore();
  const { session, can, audit } = useSession();
  const { filters, patch } = useFilters();
  const rows = useSelection();
  const searchParams = useSearchParams();

  const available = React.useMemo(() => permittedColumns(session.role), [session.role]);

  const [visibleIds, setVisibleIds] = React.useState<string[]>(DEFAULT_VISIBLE);
  const [sort, setSort] = React.useState<Sort>({ id: "applied_date", dir: "desc" });
  const [quick, setQuick] = React.useState("");
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [focused, setFocused] = React.useState<number | null>(null);
  const [density, setDensity] = React.useState<"compact" | "comfortable">("compact");

  /* --- Persisted column choice ------------------------------------------ */

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(VIEW_KEY);
      if (raw) {
        const ids = JSON.parse(raw) as string[];
        if (Array.isArray(ids) && ids.length) setVisibleIds(ids);
      }
    } catch {
      /* storage unavailable — fall back to the defaults */
    }
  }, []);

  const persistColumns = React.useCallback((ids: string[]) => {
    setVisibleIds(ids);
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(ids));
    } catch {
      /* ignore */
    }
  }, []);

  /* --- Deep link from the command palette ------------------------------- */

  React.useEffect(() => {
    const focus = searchParams.get("focus");
    if (focus != null) {
      const id = Number(focus);
      if (Number.isFinite(id) && id >= 0 && id < store.meta.rowCount) setFocused(id);
    }
  }, [searchParams, store.meta.rowCount]);

  /* --- Columns ---------------------------------------------------------- */

  const columns = React.useMemo(
    () => visibleIds.map((id) => available.find((c) => c.id === id)).filter(Boolean) as CandidateColumn[],
    [visibleIds, available],
  );

  const totalWidth = React.useMemo(
    () => columns.reduce((w, c) => w + c.width, 0) + 44,
    [columns],
  );

  /* --- Quick filter over the visible selection --------------------------- */

  const filtered = React.useMemo(() => {
    const needle = quick.trim().toLowerCase();
    if (!needle) return rows;
    const out = new Uint32Array(rows.length);
    let n = 0;
    for (let i = 0; i < rows.length; i++) {
      if (store.searchIndex[rows[i]].includes(needle)) out[n++] = rows[i];
    }
    return out.subarray(0, n);
  }, [rows, quick, store.searchIndex]);

  /* --- Sorting ----------------------------------------------------------
     Sorting an index array keeps the store untouched and means a re-sort of
     28k rows costs one comparison pass, not a data copy.                    */

  const ordered = React.useMemo(() => {
    if (!sort) return filtered;
    const col = available.find((c) => c.id === sort.id);
    if (!col) return filtered;

    const factor = sort.dir === "asc" ? 1 : -1;
    const indices = Array.from(filtered);
    const cache = new Map<number, string | number | null>();
    const valueOf = (row: number) => {
      let v = cache.get(row);
      if (v === undefined) {
        v = col.value(store, row);
        cache.set(row, v);
      }
      return v;
    };

    indices.sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls always sink, in both directions
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * factor;
      }
      return (av - bv) * factor;
    });
    return Uint32Array.from(indices);
  }, [filtered, sort, available, store]);

  /* --- Virtualisation ---------------------------------------------------- */

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rowHeight = density === "compact" ? ROW_HEIGHT : ROW_HEIGHT + 10;

  const virtualizer = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 14,
  });

  const toggleSort = (id: string) => {
    setSort((prev) => {
      if (prev?.id !== id) return { id, dir: "desc" };
      if (prev.dir === "desc") return { id, dir: "asc" };
      return null;
    });
  };

  const toggleRow = (row: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });
  };

  const allSelected = selected.size > 0 && selected.size === ordered.length;

  /* --- Export ------------------------------------------------------------ */

  const exportRows = React.useCallback(() => {
    const source = selected.size ? Array.from(selected) : Array.from(ordered);
    const capped = source.slice(0, EXPORT_CAP);
    return {
      capped,
      truncated: source.length - capped.length,
      headers: columns.map((c) => c.header),
      body: capped.map((row) => columns.map((c) => c.value(store, row))),
    };
  }, [selected, ordered, columns, store]);

  const canExportCsv = can("action.export.csv");
  const canExportExcel = can("action.export.excel");

  const doCsv = () => {
    // Belt and braces: the button is hidden without the capability, but a
    // handler that can be reached by keyboard or by a stale render should
    // check for itself.
    if (!canExportCsv) return;
    const { headers, body, truncated } = exportRows();
    downloadCsv("cpml-candidates", headers, body);
    audit("export.csv", "candidates", {
      scope: serializeFilters(filters),
      rowCount: body.length,
    });
    toast.success(
      truncated > 0
        ? `Exported ${fmtInt(body.length)} rows — ${fmtInt(truncated)} beyond the ${fmtInt(EXPORT_CAP)} row cap were left out`
        : `Exported ${fmtInt(body.length)} rows`,
    );
  };

  const doExcel = async () => {
    if (!canExportExcel) return;
    const { headers, body, truncated } = exportRows();
    await downloadExcel("cpml-candidates", [
      { name: "Candidates", headers, rows: body },
    ]);
    audit("export.excel", "candidates", {
      scope: serializeFilters(filters),
      rowCount: body.length,
    });
    toast.success(
      truncated > 0
        ? `Exported ${fmtInt(body.length)} rows — ${fmtInt(truncated)} beyond the cap were left out`
        : `Exported ${fmtInt(body.length)} rows`,
    );
  };

  /* --- Render ------------------------------------------------------------ */

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <>
      <PageHeader
        title="Candidate Explorer"
        /* Against the dataset's true size, not the size of what was delivered.
           A scoped session receives only its own book, so `rowCount` is 4,999
           for both halves and the sentence reads "4,999 of 4,999" — true of the
           payload, and useless: it hides that a filter is in force. */
        description={`Every application record in scope. ${fmtInt(ordered.length)} of ${fmtInt(
          store.meta.scopedFrom ?? store.meta.rowCount,
        )} shown.`}
        breadcrumb={[{ label: "Command Center", href: "/" }, { label: "Candidate Explorer" }]}
        actions={
          <>
            <Badge tone="outline" size="md">
              {session.role} view
            </Badge>
            <Can capability="action.export.csv">
              <Button variant="default" size="sm" onClick={doCsv}>
                <Download />
                CSV
              </Button>
            </Can>
            <Can
              capability="action.export.excel"
              fallback={
                <Badge tone="warn" size="md">
                  <span aria-hidden>▽</span>
                  Export needs Recruitment Manager
                </Badge>
              }
            >
              <Button variant="primary" size="sm" onClick={doExcel}>
                <FileSpreadsheet />
                Excel
              </Button>
            </Can>
          </>
        }
      />

      <Panel className="flex flex-col overflow-hidden">
        {/* ---- Toolbar ---- */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="flex h-8 min-w-[220px] flex-1 items-center gap-1.5 rounded-[var(--r-xs)] border border-line bg-surface-2 px-2.5">
            <Search className="size-3.5 shrink-0 text-ink-4" />
            <input
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              placeholder="Filter these rows by name, phone or recruiter…"
              className="w-full bg-transparent text-meta text-ink outline-none placeholder:text-ink-4"
              aria-label="Quick filter"
            />
            {quick ? (
              <button
                type="button"
                onClick={() => setQuick("")}
                aria-label="Clear quick filter"
                className="text-ink-4 hover:text-ink-2"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>

          {selected.size > 0 ? (
            <span className="fchip">
              {fmtInt(selected.size)} selected
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                aria-label="Clear selection"
                className="grid size-4 place-items-center rounded-full bg-g1/15"
              >
                <X className="size-2.5" strokeWidth={3} />
              </button>
            </span>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="default" size="sm">
                <Columns3 />
                Columns
                <Badge tone="neutral" size="sm">
                  {columns.length}
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-[70vh] w-[248px] overflow-y-auto">
              {COLUMN_GROUPS.map((group) => {
                const groupColumns = available.filter((c) => c.group === group);
                if (!groupColumns.length) return null;
                return (
                  <React.Fragment key={group}>
                    <DropdownMenuLabel>{group}</DropdownMenuLabel>
                    {groupColumns.map((col) => (
                      <DropdownMenuCheckboxItem
                        key={col.id}
                        checked={visibleIds.includes(col.id)}
                        onCheckedChange={(checked) => {
                          persistColumns(
                            checked
                              ? [...visibleIds, col.id]
                              : visibleIds.filter((id) => id !== col.id),
                          );
                        }}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {col.header}
                      </DropdownMenuCheckboxItem>
                    ))}
                    <DropdownMenuSeparator />
                  </React.Fragment>
                );
              })}
              <DropdownMenuItem onSelect={() => persistColumns(DEFAULT_VISIBLE)}>
                Reset to defaults
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => persistColumns(available.map((c) => c.id))}>
                Show every column
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="default"
            size="sm"
            onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
          >
            <Table2 />
            {density === "compact" ? "Compact" : "Comfortable"}
          </Button>

          {sort ? (
            <button
              type="button"
              onClick={() => setSort(null)}
              className="fchip !border-dashed !border-line !bg-transparent !text-ink-3"
            >
              Sorted by {available.find((c) => c.id === sort.id)?.header ?? sort.id} ·{" "}
              {sort.dir === "desc" ? "high → low" : "low → high"}
            </button>
          ) : null}
        </div>

        {/* ---- Table ---- */}
        {ordered.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="No records match"
            description={
              quick
                ? `Nothing in the current selection matches “${quick}”.`
                : "Widen the global filters to bring records back into view."
            }
            action={
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  setQuick("");
                  patch({ search: "" });
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div
            ref={scrollRef}
            className="relative max-h-[68vh] min-h-[420px] overflow-auto"
            role="region"
            aria-label="Candidate records"
            tabIndex={0}
          >
            <div style={{ width: totalWidth, position: "relative" }}>
              {/* Header */}
              <div
                className="sticky top-0 z-20 flex border-b border-line bg-g6"
                style={{ width: totalWidth }}
              >
                <div className="sticky left-0 z-10 flex w-11 shrink-0 items-center justify-center bg-g6">
                  <Checkbox
                    checked={allSelected}
                    aria-label="Select all rows in view"
                    onCheckedChange={(checked: boolean | "indeterminate") => {
                      setSelected(checked === true ? new Set(Array.from(ordered)) : new Set());
                    }}
                  />
                </div>
                {columns.map((col, ci) => {
                  const active = sort?.id === col.id;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      onClick={() => toggleSort(col.id)}
                      style={{ width: col.width }}
                      className={cn(
                        "flex shrink-0 items-center gap-1 px-2.5 py-1.5 col-head transition-colors hover:text-ink",
                        col.align === "right" ? "justify-end" : "justify-start",
                        ci === 0 && "sticky left-11 z-10 bg-g6",
                      )}
                    >
                      <span className="truncate">{col.header}</span>
                      {active ? (
                        sort.dir === "desc" ? (
                          <ArrowDown className="size-3 shrink-0" />
                        ) : (
                          <ArrowUp className="size-3 shrink-0" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 shrink-0 opacity-30" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Virtualised body */}
              <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
                {virtualRows.map((virtualRow) => {
                  const row = ordered[virtualRow.index];
                  const isSelected = selected.has(row);
                  return (
                    <div
                      key={virtualRow.key}
                      className={cn(
                        "absolute left-0 flex border-b border-line transition-colors",
                        virtualRow.index % 2 === 1 && "bg-surface-2/45",
                        isSelected && "!bg-accent-soft",
                        "hover:bg-surface-2",
                      )}
                      style={{
                        top: 0,
                        transform: `translateY(${virtualRow.start}px)`,
                        height: virtualRow.size,
                        width: totalWidth,
                      }}
                    >
                      <div
                        className={cn(
                          "sticky left-0 z-10 flex w-11 shrink-0 items-center justify-center bg-surface",
                          virtualRow.index % 2 === 1 && "bg-[color-mix(in_srgb,var(--surface-2)_45%,var(--surface))]",
                          isSelected && "!bg-accent-soft",
                        )}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleRow(row)}
                          aria-label={`Select ${store.names[row]}`}
                        />
                      </div>
                      {columns.map((col, ci) => (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => setFocused(row)}
                          style={{ width: col.width }}
                          className={cn(
                            "flex shrink-0 items-center overflow-hidden px-2.5 text-left text-meta text-ink-2",
                            col.align === "right" ? "justify-end" : "justify-start",
                            ci === 0 &&
                              "sticky left-11 z-10 bg-inherit",
                          )}
                        >
                          <span className="w-full truncate">
                            {col.render
                              ? col.render(store, row)
                              : (col.value(store, row) ?? <span className="text-ink-4">—</span>)}
                          </span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ---- Footer ---- */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-1.5 text-micro text-ink-4">
          <span>
            {fmtInt(ordered.length)} rows
            {quick ? ` matching “${quick}”` : ""} · {columns.length} of {available.length} columns
            {selected.size ? ` · ${fmtInt(selected.size)} selected` : ""}
          </span>
          <span className="flex items-center gap-3">
            <Hint content="Click any cell to open the candidate's full record and stage timeline.">
              <span className="cursor-help border-b border-dotted border-ink-4">
                Click a row for detail
              </span>
            </Hint>
            {ordered.length > EXPORT_CAP ? (
              <span>Exports are capped at {fmtInt(EXPORT_CAP)} rows</span>
            ) : null}
          </span>
        </div>
      </Panel>

      <CandidateDrawer
        row={focused}
        onClose={() => setFocused(null)}
        onNavigate={(direction) => {
          if (focused == null) return;
          const idx = Array.prototype.indexOf.call(ordered, focused);
          if (idx < 0) return;
          const next = idx + (direction === "next" ? 1 : -1);
          if (next >= 0 && next < ordered.length) setFocused(ordered[next]);
        }}
      />
    </>
  );
}
