"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Building2,
  Gauge,
  Layers,
  Target,
  UserCog,
  Users,
} from "lucide-react";
import { fmtCompact, fmtDays, fmtInt, fmtMonthKeyShort, fmtPct } from "@/lib/utils";
import { PageHeader, Section, SectionHead } from "@/components/layout/page-header";
import { Panel, EmptyState, Segmented } from "@/components/ui/primitives";
import { MetricCard } from "@/components/metrics/metric-card";
import { ChartFrame, seriesColor } from "@/components/charts/chart-kit";
import { QuadrantScatter, TimeSeries } from "@/components/charts/charts";
import { Heatmap } from "@/components/charts/heatmap";
import { MetricTable, type MetricColumn } from "@/components/table/metric-table";
import {
  useDimensionMetrics,
  useMetricsWithComparison,
  useTimeSeries,
} from "@/lib/hooks/use-analytics";
import { useStore } from "@/lib/providers/store-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import { buildFunnel } from "@/lib/data/query";
import { computeMetrics, type GroupRow } from "@/lib/data/metrics";
import { STAGES, type DictField } from "@/lib/data/schema";

/**
 * Page configuration.
 *
 * Every field is a plain serialisable value: these pages are configured from
 * Server Components, and a React component or a callback cannot cross that
 * boundary. The icon is named rather than imported, and the drill-down link is
 * a template rather than a function.
 */
export interface DimensionPageConfig {
  field: DictField;
  title: string;
  description: string;
  /** Key into ICONS below. */
  icon: keyof typeof ICONS;
  /** Noun for a single member of this dimension. */
  entity: string;
  /** Minimum applications before a group is comparable. */
  minApplications?: number;
  /** Link template with `{key}` substituted for the URL-encoded member name. */
  hrefPattern?: string;
  /** Extra context sentence shown under the leaderboard. */
  note?: string;
}

const ICONS = {
  activity: Activity,
  building: Building2,
  gauge: Gauge,
  users: Users,
  userCog: UserCog,
  target: Target,
} satisfies Record<string, LucideIcon>;

const TREND_MODES = [
  { value: "applications" as const, label: "Applications" },
  { value: "hired" as const, label: "Hires" },
  { value: "conversion" as const, label: "Conversion %" },
];

export function DimensionAnalytics({ config }: { config: DimensionPageConfig }) {
  const store = useStore();
  const { drillTo } = useFilters();
  const { current, previous, rows, deltaOf } = useMetricsWithComparison();
  const minApps = config.minApplications ?? 25;

  const groups = useDimensionMetrics(rows, config.field, minApps);
  const [trendMode, setTrendMode] = React.useState<"applications" | "hired" | "conversion">(
    "applications",
  );

  const hrefFor = React.useCallback(
    (key: string) =>
      config.hrefPattern
        ? config.hrefPattern.replace("{key}", encodeURIComponent(key))
        : null,
    [config.hrefPattern],
  );

  const monthly = useTimeSeries(rows, "applied_date", "month");

  /* --- Trend for the top groups ---------------------------------------- */

  const topKeys = React.useMemo(
    () => groups.slice(0, 5).map((g) => g.key),
    [groups],
  );

  const trendData = React.useMemo(() => {
    const col = store.cols[config.field];
    const lookup = store.lookups[config.field];
    const indices = topKeys.map((k) => lookup?.get(k) ?? -1);

    return monthly.map((point) => {
      const row: Record<string, string | number> = { label: fmtMonthKeyShort(point.key) };
      topKeys.forEach((key, i) => {
        const idx = indices[i];
        if (idx < 0) {
          row[key] = 0;
          return;
        }
        const subset: number[] = [];
        for (let r = 0; r < point.rows.length; r++) {
          if (col[point.rows[r]] === idx) subset.push(point.rows[r]);
        }
        const m = computeMetrics(store, Uint32Array.from(subset));
        row[key] =
          trendMode === "applications"
            ? m.applications
            : trendMode === "hired"
              ? m.hired
              : Number((m.overallConversion ?? 0).toFixed(2));
      });
      return row;
    });
  }, [monthly, store, config.field, topKeys, trendMode]);

  /* --- Volume vs quality ------------------------------------------------ */

  const scatter = React.useMemo(
    () =>
      groups
        .filter((g) => g.metrics.overallConversion != null)
        .map((g) => ({
          label: g.key,
          x: g.metrics.applications,
          y: g.metrics.overallConversion ?? 0,
          size: Math.max(1, g.metrics.hired),
          meta: `${fmtInt(g.metrics.hired)} hires from ${fmtInt(g.metrics.applications)} applications`,
        })),
    [groups],
  );

  const medians = React.useMemo(() => {
    if (!scatter.length) return { x: undefined, y: undefined };
    const xs = scatter.map((p) => p.x).sort((a, b) => a - b);
    const ys = scatter.map((p) => p.y).sort((a, b) => a - b);
    return {
      x: xs[Math.floor(xs.length / 2)],
      y: ys[Math.floor(ys.length / 2)],
    };
  }, [scatter]);

  /* --- Stage reach heatmap --------------------------------------------- */

  const heatCells = React.useMemo(() => {
    const cells: { row: string; col: string; value: number }[] = [];
    for (const g of groups.slice(0, 12)) {
      const stages = buildFunnel(store, g.rows);
      const intake = stages[0]?.entered ?? 0;
      for (let i = 1; i < stages.length; i++) {
        cells.push({
          row: g.key,
          col: STAGES[i].short,
          value: intake ? (stages[i].entered / intake) * 100 : 0,
        });
      }
    }
    return cells;
  }, [groups, store]);

  /* --- Table ------------------------------------------------------------ */

  const columns = React.useMemo<MetricColumn<GroupRow>[]>(
    () => [
      {
        id: "key",
        header: config.entity,
        value: (r) => r.key,
        align: "left",
        width: "18%",
      },
      {
        id: "applications",
        header: "Applications",
        help: "Application records attributed to this group.",
        value: (r) => r.metrics.applications,
        bar: true,
      },
      {
        id: "contacted",
        header: "Contacted",
        help: "Candidates actually reached by phone.",
        value: (r) => r.metrics.phoneScreened,
        hideBelow: "lg",
      },
      {
        id: "pitched",
        header: "Pitches",
        help: "Candidates who sat the live sales-pitch evaluation.",
        value: (r) => r.metrics.pitched,
        hideBelow: "lg",
      },
      {
        id: "interviews",
        header: "Interviews",
        help: "Manager and final-panel interviews combined.",
        value: (r) => r.metrics.totalInterviews,
        hideBelow: "xl",
      },
      {
        id: "offers",
        header: "Offers",
        help: "Offers placed with candidates from this group.",
        value: (r) => r.metrics.offers,
        hideBelow: "md",
      },
      {
        id: "hired",
        header: "Hires",
        help: "Candidates onboarded or in training.",
        value: (r) => r.metrics.hired,
        bar: true,
      },
      {
        id: "conversion",
        header: "App → Hire",
        help: "Share of this group's applications that became a hire. The single best measure of quality.",
        value: (r) => r.metrics.overallConversion,
        render: (r) => fmtPct(r.metrics.overallConversion, 2),
        band: "higher-better",
      },
      {
        id: "pitchPass",
        header: "Pitch pass",
        help: "Share of sales pitches marked SP+.",
        value: (r) => r.metrics.pitchPassRate,
        render: (r) => fmtPct(r.metrics.pitchPassRate, 1),
        band: "higher-better",
        hideBelow: "xl",
      },
      {
        id: "accept",
        header: "Offer accept",
        help: "Share of placed offers the candidate accepted.",
        value: (r) => r.metrics.offerAcceptRate,
        render: (r) => fmtPct(r.metrics.offerAcceptRate, 1),
        band: "higher-better",
        hideBelow: "xl",
      },
      {
        id: "tth",
        header: "Time to hire",
        help: "Median days from application to actual start date.",
        value: (r) => r.metrics.timeToHire.median,
        render: (r) => fmtDays(r.metrics.timeToHire.median, 1),
        band: "lower-better",
        hideBelow: "lg",
      },
      {
        id: "perHire",
        header: "Apps / hire",
        help: "How many applications this group consumes to produce one hire. Lower is more efficient.",
        value: (r) => r.metrics.applicationsPerHire,
        render: (r) =>
          r.metrics.applicationsPerHire != null
            ? r.metrics.applicationsPerHire.toFixed(0)
            : "—",
        band: "lower-better",
        hideBelow: "md",
      },
    ],
    [config.entity],
  );

  const excluded = React.useMemo(
    () => countDistinct(store, rows, config.field) - groups.length,
    [store, rows, config.field, groups.length],
  );

  if (!rows.length) {
    return (
      <>
        <PageHeader title={config.title} />
        <Panel>
          <EmptyState title="No applications in scope" description="Adjust the filters above." />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={config.title}
        description={config.description}
        breadcrumb={[{ label: "Command Center", href: "/" }, { label: config.title }]}
      />

      <Section>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <MetricCard
            label={`Active ${config.title.toLowerCase()}`}
            value={groups.length}
            format="int"
            accent="var(--g1)"
            definition={`${config.entity}s with at least ${minApps} applications in scope. Smaller groups are excluded from comparison because their rates are not stable.`}
          />
          <MetricCard
            label="Applications"
            value={current.applications}
            format="int"
            delta={deltaOf((m) => m.applications)}
            previous={previous?.applications ?? null}
            accent="var(--g2)"
          />
          <MetricCard
            label="Hires"
            value={current.hired}
            format="int"
            polarity="higher-better"
            delta={deltaOf((m) => m.hired)}
            previous={previous?.hired ?? null}
            accent="var(--q-top)"
          />
          <MetricCard
            label="App → Hire"
            value={current.overallConversion}
            format="pct"
            polarity="higher-better"
            delta={deltaOf((m) => m.overallConversion)}
            accent="var(--series-2)"
          />
          <MetricCard
            label="Best performer"
            value={best(groups)?.metrics.overallConversion ?? null}
            format="pct"
            polarity="higher-better"
            accent="var(--series-5)"
            footnote={best(groups)?.key ?? "—"}
            definition={`Highest application-to-hire rate among ${config.entity.toLowerCase()}s meeting the volume threshold.`}
          />
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={ICONS[config.icon] ?? BarChart3}
          title={`${config.title} leaderboard`}
          description="Sort any column. Performance bands compare each row against the quartiles of the rows on screen."
        />
        <Panel className="overflow-hidden">
          <MetricTable
            rows={groups}
            columns={columns}
            rowKey={(r) => r.key}
            rowHref={config.hrefPattern ? (r) => hrefFor(r.key) ?? "#" : undefined}
            onRowClick={config.hrefPattern ? undefined : (r) => drillTo(config.field, r.key)}
            defaultSort={{ id: "applications", dir: "desc" }}
            exportName={`cpml-${config.field}`}
            maxHeight={620}
            footer={
              excluded > 0
                ? `${fmtInt(groups.length)} shown · ${fmtInt(excluded)} ${config.entity.toLowerCase()}s hidden with fewer than ${minApps} applications`
                : `${fmtInt(groups.length)} ${config.entity.toLowerCase()}s`
            }
          />
        </Panel>
        {config.note ? (
          <p className="mt-2 px-1 text-label text-ink-4">{config.note}</p>
        ) : null}
      </Section>

      <Section>
        <SectionHead
          icon={Target}
          title="Volume against quality"
          description="Bubble size is hires delivered. The dashed lines are the medians — the top-right quadrant is where both volume and conversion are above par."
        />
        <ChartFrame
          title={`${config.entity} positioning`}
          description="A high-volume, low-conversion group is where the largest recoverable waste sits."
          tableView={{
            columns: [config.entity, "Applications", "App → Hire", "Hires"],
            rows: scatter.map((p) => [p.label, p.x, `${p.y.toFixed(2)}%`, p.size]),
          }}
          footnote="Single hue by design — this form needs every mark to stay distinguishable from every other, which a multi-colour palette cannot guarantee at this many points."
        >
          <div className="p-2">
            <QuadrantScatter
              points={scatter}
              xLabel="Applications handled"
              yLabel="Application → hire %"
              xFormat={fmtCompact}
              yFormat={(v) => `${v.toFixed(1)}%`}
              xMedian={medians.x}
              yMedian={medians.y}
              height={340}
              onPointClick={(p) => drillTo(config.field, p.label)}
              quadrantLabels={{
                tl: "Low volume · high yield",
                tr: "High volume · high yield",
                bl: "Low volume · low yield",
                br: "High volume · low yield",
              }}
            />
          </div>
        </ChartFrame>
      </Section>

      <Section>
        <SectionHead
          icon={Layers}
          title="Behaviour over time and through the funnel"
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ChartFrame
            title={`Top ${topKeys.length} over time`}
            description="Monthly, for the five highest-volume groups."
            legend={topKeys.map((k, i) => ({ label: k, color: seriesColor(i) }))}
            actions={
              <Segmented
                value={trendMode}
                onChange={setTrendMode}
                options={TREND_MODES}
                aria-label="Trend measure"
              />
            }
            tableView={{
              columns: ["Month", ...topKeys],
              rows: trendData.map((r) => [
                String(r.label),
                ...topKeys.map((k) => Number(r[k] ?? 0)),
              ]),
            }}
          >
            <div className="p-2">
              <TimeSeries
                data={trendData}
                series={topKeys.map((k, i) => ({
                  key: k,
                  label: k,
                  color: seriesColor(i),
                  format: trendMode === "conversion" ? (v) => `${v.toFixed(2)}%` : fmtInt,
                }))}
                variant={trendMode === "conversion" ? "line" : "area"}
                height={300}
                yFormat={trendMode === "conversion" ? (v) => `${v.toFixed(0)}%` : fmtCompact}
              />
            </div>
          </ChartFrame>

          <ChartFrame
            title="Stage reach"
            description="Share of each group's intake reaching each stage. A row that darkens late is converting deep; one that fades early is stalling."
            tableView={{
              columns: [config.entity, ...STAGES.slice(1).map((s) => s.short)],
              rows: groups.slice(0, 12).map((g) => {
                const stages = buildFunnel(store, g.rows);
                const intake = stages[0]?.entered || 1;
                return [
                  g.key,
                  ...stages.slice(1).map((s) => `${((s.entered / intake) * 100).toFixed(1)}%`),
                ];
              }),
            }}
          >
            <div className="p-3">
              <Heatmap
                cells={heatCells}
                rows={groups.slice(0, 12).map((g) => g.key)}
                cols={STAGES.slice(1).map((s) => s.short)}
                valueFormat={(v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1))}
                legendLabel="Reach %"
                onCellClick={(c) => drillTo(config.field, c.row)}
                height={320}
              />
            </div>
          </ChartFrame>
        </div>
      </Section>
    </>
  );
}

function best(groups: GroupRow[]): GroupRow | null {
  let winner: GroupRow | null = null;
  for (const g of groups) {
    const v = g.metrics.overallConversion;
    if (v == null) continue;
    if (!winner || v > (winner.metrics.overallConversion ?? -1)) winner = g;
  }
  return winner;
}

/** Distinct values of `field` present in a selection, regardless of threshold. */
function countDistinct(
  store: ReturnType<typeof useStore>,
  rows: Uint32Array,
  field: DictField,
): number {
  const col = store.cols[field];
  const seen = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    const v = col[rows[i]];
    if (v >= 0) seen.add(v);
  }
  return seen.size;
}
