"use client";

import * as React from "react";
import Link from "next/link";
import {
  Bookmark,
  Check,
  FileSpreadsheet,
  FileText,
  Printer,
  ScrollText,
  Table2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn, fmtDay, fmtInt } from "@/lib/utils";
import { PageHeader, Section, SectionHead } from "@/components/layout/page-header";
import { Panel, PanelHeader, Badge, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/filters/filter-bar";
import { useStore } from "@/lib/providers/store-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import { useSelection } from "@/lib/hooks/use-analytics";
import { useSession } from "@/lib/providers/session-provider";
import { computeMetrics } from "@/lib/data/metrics";
import { downloadCsv, downloadExcel, downloadPdf, printView } from "@/lib/export/exporters";
import { REPORTS, describeScope, type ReportDefinition } from "./report-builders";

export function ReportsWorkspace() {
  const store = useStore();
  const { filters, savedViews, deleteView } = useFilters();
  const { session, can, audit } = useSession();
  const rows = useSelection();
  const [busy, setBusy] = React.useState<string | null>(null);

  const metrics = React.useMemo(() => computeMetrics(store, rows), [store, rows]);
  const scope = React.useMemo(
    () => describeScope(store, filters, rows.length),
    [store, filters, rows.length],
  );

  const generated = React.useMemo(
    () =>
      new Date().toLocaleString("en-GB", {
        dateStyle: "long",
        timeStyle: "short",
      }),
    [],
  );

  const run = React.useCallback(
    async (report: ReportDefinition, format: "pdf" | "excel" | "csv") => {
      if (!rows.length) {
        toast.error("Nothing to report — no records match the current filters.");
        return;
      }
      setBusy(`${report.id}:${format}`);
      try {
        const content = report.build({ store, rows, metrics, scope });

        if (format === "pdf") {
          await downloadPdf(
            report.title,
            {
              subtitle: report.purpose,
              generated,
              scope,
            },
            content.pdf,
          );
        } else if (format === "excel") {
          await downloadExcel(`cpml-${report.id}`, content.excel);
        } else {
          const first = content.excel[0];
          downloadCsv(`cpml-${report.id}-${first.name.toLowerCase()}`, first.headers, first.rows);
        }
        audit(`export.${format}` as const, `report:${report.id}`, {
          scope,
          rowCount: rows.length,
        });
        toast.success(`${report.title} exported`);
      } catch (err) {
        toast.error(
          `Could not generate the report: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setBusy(null);
      }
    },
    [store, rows, metrics, scope, generated, audit],
  );

  const canExport = can("action.export.pdf");

  return (
    <>
      <PageHeader
        title="Reports"
        description="Every report runs against the filters set below, so what you export is exactly what you were looking at."
        breadcrumb={[{ label: "Command Center", href: "/" }, { label: "Reports" }]}
        actions={
          <Button variant="default" size="sm" onClick={printView}>
            <Printer />
            Print this page
          </Button>
        }
      />

      <div className="mb-4">
        <FilterBar />
      </div>

      <Section>
        <Panel className="relative overflow-hidden p-4 pt-[18px]">
          <span aria-hidden className="accent-bar" style={{ background: "var(--grad-green)" }} />
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow">Current scope</p>
              <p className="mt-1 max-w-4xl text-body font-semibold text-ink">{scope}</p>
              <p className="mt-1.5 text-label text-ink-3">
                {fmtInt(metrics.applications)} applications · {fmtInt(metrics.hired)} hires ·{" "}
                {fmtInt(metrics.offers)} offers · dataset current to {fmtDay(store.meta.horizon)}
              </p>
            </div>
            <Badge tone={canExport ? "good" : "warn"} size="md">
              <span aria-hidden>{canExport ? "▲" : "▽"}</span>
              {canExport ? `${session.role} — exports enabled` : `${session.role} — exports restricted`}
            </Badge>
          </div>
        </Panel>
      </Section>

      <Section>
        <SectionHead
          icon={ScrollText}
          title="Report library"
          description="PDF for circulation, Excel for analysis, CSV for the first table only."
        />

        {!canExport ? (
          <Panel>
            <EmptyState
              title="Reporting is restricted for this role"
              description="Recruiters can browse every analytics page, but generating circulated reports requires Recruitment Manager access or above. Switch role from the profile menu to preview."
            />
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {REPORTS.map((report) => (
              <Panel key={report.id} className="flex flex-col overflow-hidden">
                <div className="flex-1 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-g6 text-g1"
                    >
                      <FileText className="size-4" />
                    </span>
                    <Badge tone="outline">{report.audience}</Badge>
                  </div>
                  <h3 className="mt-2.5 text-body font-bold text-ink">{report.title}</h3>
                  <p className="mt-1 text-label leading-[1.6] text-ink-3">{report.purpose}</p>
                </div>
                <div className="flex items-center gap-1.5 border-t border-line px-3 py-2">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy != null}
                    onClick={() => run(report, "pdf")}
                    className="flex-1"
                  >
                    {busy === `${report.id}:pdf` ? "Generating…" : <><FileText />PDF</>}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={busy != null}
                    onClick={() => run(report, "excel")}
                    className="flex-1"
                  >
                    {busy === `${report.id}:excel` ? "…" : <><FileSpreadsheet />Excel</>}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy != null}
                    aria-label={`Download ${report.title} as CSV`}
                    title="First table only, as CSV"
                    onClick={() => run(report, "csv")}
                  >
                    <Table2 />
                  </Button>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </Section>

      <Section>
        <SectionHead
          icon={Bookmark}
          title="Saved views"
          description="Filter combinations you have bookmarked. Opening one restores the exact scope it was saved with."
        />
        {savedViews.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Bookmark />}
              title="No saved views yet"
              description="Set the filters you care about on any analytics page, then use the bookmark button in the filter bar to save that exact scope."
              compact
            />
          </Panel>
        ) : (
          <Panel className="overflow-hidden">
            <PanelHeader title={`${savedViews.length} saved`} />
            <ul>
              {savedViews.map((view) => (
                <li
                  key={view.id}
                  className="flex items-center gap-3 border-b border-line px-3.5 py-2 last:border-0"
                >
                  <Bookmark className="size-3.5 shrink-0 text-ink-4" />
                  <Link
                    href={view.query ? `${view.path}?${view.query}` : view.path}
                    className="min-w-0 flex-1 truncate text-meta font-semibold text-ink hover:text-g1 hover:underline"
                  >
                    {view.name}
                  </Link>
                  <span className="hidden shrink-0 text-label text-ink-4 sm:block">
                    {view.path}
                  </span>
                  <span className="shrink-0 text-label tabular-nums text-ink-4">
                    {new Date(view.createdAt).toLocaleDateString("en-GB")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      deleteView(view.id);
                      toast(`Deleted “${view.name}”`);
                    }}
                    aria-label={`Delete ${view.name}`}
                    className="shrink-0 text-ink-4 transition-colors hover:text-critical"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </Section>

      <Section>
        <SectionHead icon={Check} title="What is in each format" />
        <Panel className="overflow-hidden">
          <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <FormatNote
              icon={<FileText className="size-4" />}
              title="PDF"
              body="Branded, paginated and ready to circulate. Carries the scope line on the cover so a reader always knows which filters produced the numbers."
            />
            <FormatNote
              icon={<FileSpreadsheet className="size-4" />}
              title="Excel"
              body="Every table on its own sheet with a frozen header row and sized columns. Values are written as real numbers, not text, so they pivot correctly."
            />
            <FormatNote
              icon={<Table2 className="size-4" />}
              title="CSV"
              body="The report's first table only, UTF-8 with a byte-order mark so Excel opens non-ASCII names correctly on Windows."
            />
          </div>
        </Panel>
      </Section>
    </>
  );
}

function FormatNote({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="p-4">
      <span
        aria-hidden
        className={cn("grid size-7 place-items-center rounded-[8px] bg-g6 text-g1")}
      >
        {icon}
      </span>
      <h3 className="mt-2 text-meta font-bold text-ink">{title}</h3>
      <p className="mt-1 text-label leading-[1.6] text-ink-3">{body}</p>
    </div>
  );
}
