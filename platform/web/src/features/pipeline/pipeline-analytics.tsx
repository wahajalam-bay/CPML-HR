"use client";

import * as React from "react";
import { GitBranch, Layers, Route, Users } from "lucide-react";
import { fmtDays, fmtInt, fmtMonthKeyShort, fmtPct } from "@/lib/utils";
import { PageHeader, Section, SectionHead } from "@/components/layout/page-header";
import { Panel, PanelHeader, Badge, EmptyState, Segmented } from "@/components/ui/primitives";
import { MetricCard } from "@/components/metrics/metric-card";
import { ChartFrame, ordinalColor, seriesColor } from "@/components/charts/chart-kit";
import { StackedBars } from "@/components/charts/charts";
import { PipelineFunnel, StageLedger } from "@/components/charts/funnel";
import { CohortGrid, Heatmap } from "@/components/charts/heatmap";
import { SankeyFlow, type FlowLink, type FlowNode } from "@/components/charts/echarts";
import {
  useDimensionMetrics,
  useFunnel,
  useMetricsWithComparison,
  useTimeSeries,
} from "@/lib/hooks/use-analytics";
import { useStore } from "@/lib/providers/store-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import { buildFunnel } from "@/lib/data/query";
import { METRIC_BY_ID } from "@/lib/data/metrics";
import { STAGES, type DictField } from "@/lib/data/schema";

const BREAKDOWN_DIMS: { field: DictField; label: string }[] = [
  { field: "recruiter", label: "Recruiter" },
  { field: "source", label: "Source" },
  { field: "applied_role", label: "Role" },
  { field: "degree", label: "Education" },
  { field: "experience_band", label: "Experience" },
  { field: "industry", label: "Prior industry" },
];

export function PipelineAnalytics() {
  const store = useStore();
  const { patch, drillTo } = useFilters();
  const { current, previous, rows, deltaOf } = useMetricsWithComparison();
  const funnel = useFunnel(rows);
  const [breakdown, setBreakdown] = React.useState<DictField>("recruiter");
  const [cohortMode, setCohortMode] = React.useState<"rate" | "count">("rate");

  const monthly = useTimeSeries(rows, "applied_date", "month");

  /* --- Cohort progression --------------------------------------------- */

  const cohorts = React.useMemo(
    () =>
      monthly
        .filter((p) => p.rows.length > 0)
        .map((p) => {
          const stages = buildFunnel(store, p.rows);
          const size = stages[0]?.entered ?? 0;
          return {
            label: fmtMonthKeyShort(p.key),
            size,
            values: stages
              .slice(1)
              .map((s) =>
                cohortMode === "rate"
                  ? size
                    ? (s.entered / size) * 100
                    : null
                  : s.entered,
              ),
          };
        }),
    [monthly, store, cohortMode],
  );

  /* --- Stage conversion by dimension ----------------------------------- */

  const groups = useDimensionMetrics(rows, breakdown, 40);

  const heatCells = React.useMemo(() => {
    const cells: { row: string; col: string; value: number; denominator: number }[] = [];
    for (const g of groups.slice(0, 14)) {
      const stages = buildFunnel(store, g.rows);
      const intake = stages[0]?.entered ?? 0;
      for (let i = 1; i < stages.length; i++) {
        cells.push({
          row: g.key,
          col: STAGES[i].short,
          value: intake ? (stages[i].entered / intake) * 100 : 0,
          denominator: 100,
        });
      }
    }
    return cells;
  }, [groups, store]);

  /* --- Composition of each stage --------------------------------------- */

  const stageComposition = React.useMemo(() => {
    const dict = store.dicts[breakdown] ?? [];
    const col = store.cols[breakdown];
    const top = groups.slice(0, 6).map((g) => g.key);
    const topSet = new Set(top);

    return funnel.map((stage) => {
      const row: Record<string, string | number> = { label: stage.label };
      for (const t of top) row[t] = 0;
      row.Other = 0;
      for (let i = 0; i < stage.rows.length; i++) {
        const idx = col[stage.rows[i]];
        const key = idx >= 0 ? dict[idx] : null;
        if (key && topSet.has(key)) row[key] = Number(row[key]) + 1;
        else row.Other = Number(row.Other) + 1;
      }
      return row;
    });
  }, [funnel, groups, store, breakdown]);

  const compositionSeries = React.useMemo(() => {
    const top = groups.slice(0, 6).map((g, i) => ({
      key: g.key,
      label: g.key,
      color: seriesColor(i),
    }));
    return [...top, { key: "Other", label: "Other", color: "var(--ink-4)" }];
  }, [groups]);

  /* --- Sankey ---------------------------------------------------------- */

  const flow = React.useMemo(() => buildFlow(funnel), [funnel]);

  /* --- Stage detail ---------------------------------------------------- */

  const worstStage = React.useMemo(() => {
    let worst = funnel[0];
    let lowest = Infinity;
    for (const s of funnel.slice(0, -1)) {
      if (s.stepConversion != null && s.stepConversion < lowest) {
        lowest = s.stepConversion;
        worst = s;
      }
    }
    return worst;
  }, [funnel]);

  if (!rows.length) {
    return (
      <>
        <PageHeader title="Pipeline" />
        <Panel>
          <EmptyState title="No applications in scope" description="Adjust the filters above." />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Pipeline Analytics"
        description="Nine stages from application to start date. Entered means the candidate reached the stage; cleared means they passed its gate."
        breadcrumb={[{ label: "Command Center", href: "/" }, { label: "Pipeline" }]}
      />

      <Section>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="In pipeline"
            value={current.applications}
            format="int"
            delta={deltaOf((m) => m.applications)}
            previous={previous?.applications ?? null}
            accent="var(--g1)"
            definition="Applications in scope under the current filters."
          />
          <MetricCard
            label="Screen pass"
            value={current.screenPassRate}
            format="pct"
            polarity="higher-better"
            target={METRIC_BY_ID.screenPassRate.target}
            delta={deltaOf((m) => m.screenPassRate)}
            accent="var(--g2)"
            definition={METRIC_BY_ID.screenPassRate.definition}
          />
          <MetricCard
            label="Phone qualify"
            value={current.phoneQualifyRate}
            format="pct"
            polarity="higher-better"
            target={METRIC_BY_ID.phoneQualifyRate.target}
            delta={deltaOf((m) => m.phoneQualifyRate)}
            accent="var(--series-2)"
            definition={METRIC_BY_ID.phoneQualifyRate.definition}
          />
          <MetricCard
            label="Pitch pass"
            value={current.pitchPassRate}
            format="pct"
            polarity="higher-better"
            target={METRIC_BY_ID.pitchPassRate.target}
            delta={deltaOf((m) => m.pitchPassRate)}
            accent="var(--series-3)"
            definition={METRIC_BY_ID.pitchPassRate.definition}
          />
          <MetricCard
            label="Manager select"
            value={current.managerSelectRate}
            format="pct"
            polarity="higher-better"
            target={METRIC_BY_ID.managerSelectRate.target}
            delta={deltaOf((m) => m.managerSelectRate)}
            accent="var(--series-5)"
            definition={METRIC_BY_ID.managerSelectRate.definition}
          />
          <MetricCard
            label="Offer → join"
            value={current.joinRate}
            format="pct"
            polarity="higher-better"
            target={METRIC_BY_ID.joinRate.target}
            delta={deltaOf((m) => m.joinRate)}
            accent="var(--q-top)"
            definition={METRIC_BY_ID.joinRate.definition}
          />
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={GitBranch}
          title="The funnel"
          description={`Tightest gate right now: ${worstStage?.label ?? "—"} at ${fmtPct(worstStage?.stepConversion ?? null, 1)} carry-through.`}
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
          <ChartFrame
            title="Candidate flow"
            className="xl:col-span-2"
            tableView={{
              columns: ["Stage", "Entered", "Cleared", "Of intake"],
              rows: funnel.map((s) => [
                s.label,
                s.entered,
                s.cleared,
                `${s.cumulative.toFixed(1)}%`,
              ]),
            }}
          >
            <div className="p-3">
              <PipelineFunnel
                stages={funnel}
                height={330}
                onStageClick={(s) => patch({ stageAtLeast: s.index })}
              />
            </div>
          </ChartFrame>

          <ChartFrame
            title="Flow and loss between stages"
            description="Ribbon thickness is the number of candidates. The red arms are candidates who left at that stage."
            className="xl:col-span-3"
            tableView={{
              columns: ["From", "To", "Candidates"],
              rows: flow.links.map((l) => [l.source, l.target, l.value]),
            }}
            footnote={
              flow.omitted.stages > 0 ? (
                <>
                  {flow.omitted.stages} late-stage loss {flow.omitted.stages === 1 ? "arm" : "arms"}{" "}
                  totalling {fmtInt(flow.omitted.count)} candidates{" "}
                  {flow.omitted.stages === 1 ? "is" : "are"} omitted — each is under 1.5% of intake
                  and would render as an unreadable sliver. The stage ledger below carries the exact
                  numbers.
                </>
              ) : undefined
            }
          >
            <SankeyFlow nodes={flow.nodes} links={flow.links} height={360} />
          </ChartFrame>
        </div>

        <Panel className="mt-3 overflow-hidden">
          <PanelHeader
            title="Stage ledger"
            description="Median wait is the time between entering the previous stage and this one."
          />
          <StageLedger stages={funnel} onStageClick={(s) => patch({ stageAtLeast: s.index })} />
        </Panel>
      </Section>

      <Section>
        <SectionHead
          icon={Layers}
          title="Who makes it through"
          description="Compare conversion across any dimension. Switch the breakdown to change every panel below."
          actions={
            <Segmented
              value={breakdown}
              onChange={(v) => setBreakdown(v)}
              options={BREAKDOWN_DIMS.map((d) => ({ value: d.field, label: d.label }))}
              aria-label="Breakdown dimension"
            />
          }
        />

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ChartFrame
            title="Stage reach by group"
            description="Share of each group's intake that reached each stage. Read across a row to see where that group stalls."
            tableView={{
              columns: ["Group", ...STAGES.slice(1).map((s) => s.short)],
              rows: groups.slice(0, 14).map((g) => {
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
                rows={groups.slice(0, 14).map((g) => g.key)}
                cols={STAGES.slice(1).map((s) => s.short)}
                valueFormat={(v) => (v >= 10 ? v.toFixed(0) : v.toFixed(1))}
                legendLabel="Reach %"
                onCellClick={(c) => drillTo(breakdown, c.row)}
                height={368}
              />
            </div>
          </ChartFrame>

          <ChartFrame
            title="Composition at each stage"
            description="How the mix shifts as the funnel narrows. A group that shrinks between bars is being filtered out."
            legend={compositionSeries.map((s) => ({ label: s.label, color: s.color }))}
            tableView={{
              columns: ["Stage", ...compositionSeries.map((s) => s.label)],
              rows: stageComposition.map((r) => [
                String(r.label),
                ...compositionSeries.map((s) => Number(r[s.key] ?? 0)),
              ]),
            }}
          >
            <div className="p-2">
              <StackedBars
                data={stageComposition}
                series={compositionSeries}
                height={330}
                normalize
              />
            </div>
          </ChartFrame>
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={Route}
          title="Cohort progression"
          description="Each row is one intake month followed through the funnel. Reading down a column shows whether conversion is improving."
          actions={
            <Segmented
              value={cohortMode}
              onChange={(v) => setCohortMode(v)}
              options={[
                { value: "rate", label: "Rate %" },
                { value: "count", label: "Count" },
              ]}
              aria-label="Cohort display mode"
            />
          }
        />
        <Panel className="overflow-hidden">
          <div className="p-3.5">
            <CohortGrid
              cohorts={cohorts}
              stageLabels={STAGES.slice(1).map((s) => s.short)}
              onCellClick={(cohort) => {
                const point = monthly.find((p) => fmtMonthKeyShort(p.key) === cohort);
                if (point) patch({ from: point.day, to: point.day + 30 });
              }}
            />
          </div>
        </Panel>
      </Section>

      <Section>
        <SectionHead
          icon={Users}
          title="Stage detail"
          description="Volume, selectivity and wait time for every stage, side by side."
        />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {funnel.map((stage, i) => (
            <Panel key={stage.key} className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: ordinalColor(i, funnel.length) }}
                />
                <h3 className="flex-1 truncate text-body font-bold text-ink">{stage.label}</h3>
                <Badge tone="outline">{fmtPct(stage.cumulative, 1)} of intake</Badge>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 px-3.5 py-3">
                <Stat label="Entered" value={fmtInt(stage.entered)} />
                <Stat label="Cleared" value={fmtInt(stage.cleared)} />
                <Stat
                  label="Pass rate"
                  value={stage.passRate != null ? fmtPct(stage.passRate, 1) : "—"}
                />
                <Stat
                  label="Carried to next"
                  value={stage.stepConversion != null ? fmtPct(stage.stepConversion, 1) : "—"}
                />
                <Stat
                  label="Median wait"
                  value={stage.medianDays != null ? fmtDays(stage.medianDays, 1) : "—"}
                />
                <Stat label="Resting here" value={fmtInt(stage.resting)} />
              </dl>
              <button
                type="button"
                onClick={() => patch({ stageAtLeast: stage.index })}
                className="w-full border-t border-line px-3.5 py-2 text-left text-label font-semibold text-g1 transition-colors hover:bg-g6"
              >
                Filter to candidates who reached {stage.label} →
              </button>
            </Panel>
          ))}
        </div>
      </Section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-line py-1.5 last:border-0 [&:nth-last-child(2)]:border-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 text-lead font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/** Loss arms below this share of intake are omitted — see `omitted` below. */
const LOSS_LABEL_THRESHOLD = 0.015;

/**
 * Build the Sankey graph.
 *
 * Each stage forks into "advanced to the next stage" and "left here", so the
 * diagram accounts for candidates rather than silently dropping the ones who
 * did not progress.
 *
 * Loss arms worth under 1.5% of intake are folded away: at this scale they
 * render as sub-pixel ribbons whose labels pile on top of the ones that
 * matter. The count that was folded is reported back to the caller so the
 * chart can state it rather than quietly under-representing the total.
 */
function buildFlow(funnel: ReturnType<typeof useFunnel>): {
  nodes: FlowNode[];
  links: FlowLink[];
  omitted: { count: number; stages: number };
} {
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const intake = funnel[0]?.entered ?? 0;
  let omittedCount = 0;
  let omittedStages = 0;

  funnel.forEach((stage, i) => {
    nodes.push({
      name: stage.label,
      depth: i,
      tone: i === funnel.length - 1 ? "win" : "stage",
    });
  });

  funnel.forEach((stage, i) => {
    const next = funnel[i + 1];
    if (!next) return;
    if (next.entered > 0) {
      links.push({ source: stage.label, target: next.label, value: next.entered });
    }
    const lost = stage.entered - next.entered;
    if (lost <= 0) return;
    if (intake && lost / intake < LOSS_LABEL_THRESHOLD) {
      omittedCount += lost;
      omittedStages++;
      return;
    }
    const lossNode = `Left at ${stage.label}`;
    nodes.push({ name: lossNode, depth: i + 1, tone: "loss" });
    links.push({ source: stage.label, target: lossNode, value: lost });
  });

  return { nodes, links, omitted: { count: omittedCount, stages: omittedStages } };
}
