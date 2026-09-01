"use client";

import * as React from "react";
import { AlertOctagon, Layers, TrendingDown, UserMinus } from "lucide-react";
import { fmtInt, fmtMonthKeyShort, fmtPct } from "@/lib/utils";
import { PageHeader, Section, SectionHead } from "@/components/layout/page-header";
import { Panel, Badge, EmptyState, Segmented } from "@/components/ui/primitives";
import { MetricCard } from "@/components/metrics/metric-card";
import { ChartFrame, ordinalColor, seriesColor } from "@/components/charts/chart-kit";
import { RankedBars, StackedBars } from "@/components/charts/charts";
import { Heatmap } from "@/components/charts/heatmap";
import { Treemap } from "@/components/charts/echarts";
import {
  useDimensionMetrics,
  useMetricsWithComparison,
  useTimeSeries,
} from "@/lib/hooks/use-analytics";
import { useStore } from "@/lib/providers/store-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import { groupByDim } from "@/lib/data/query";
import { STAGES, type DictField } from "@/lib/data/schema";

/**
 * The synthetic category assigned to candidates who simply stopped being
 * worked. It is inferred from inactivity, not recorded by a recruiter, and it
 * outnumbers every genuine reason — so it is reported separately throughout
 * rather than mixed into the recorded ones.
 */
const INFERRED_CATEGORY = "Contactability";

const BREAKDOWN_DIMS: { field: DictField; label: string }[] = [
  { field: "recruiter", label: "Recruiter" },
  { field: "source", label: "Source" },
  { field: "applied_role", label: "Role" },
  { field: "experience_band", label: "Experience" },
  { field: "degree", label: "Education" },
];

export function LossAnalytics() {
  const store = useStore();
  const { patch, drillTo } = useFilters();
  const { current, rows, deltaOf } = useMetricsWithComparison();
  const [breakdown, setBreakdown] = React.useState<DictField>("recruiter");
  const monthly = useTimeSeries(rows, "applied_date", "month");

  /* --- Recorded vs inferred -------------------------------------------- */

  const categories = useDimensionMetrics(rows, "loss_category", 1);
  const recorded = React.useMemo(
    () => categories.filter((c) => c.key !== INFERRED_CATEGORY),
    [categories],
  );
  const inferred = React.useMemo(
    () => categories.find((c) => c.key === INFERRED_CATEGORY),
    [categories],
  );

  const recordedTotal = React.useMemo(
    () => recorded.reduce((s, c) => s + c.metrics.applications, 0),
    [recorded],
  );

  /* --- Reasons ---------------------------------------------------------- */

  const reasons = React.useMemo(() => {
    const buckets = groupByDim(store, rows, "loss_reason", {});
    return buckets
      .filter((b) => b.key !== "Went Cold")
      .sort((a, b) => b.count - a.count)
      .slice(0, 14);
  }, [store, rows]);

  const treemapData = React.useMemo(
    () =>
      recorded
        .sort((a, b) => b.metrics.applications - a.metrics.applications)
        .map((c) => ({ name: c.key, value: c.metrics.applications })),
    [recorded],
  );

  /* --- Where losses happen ---------------------------------------------- */

  const exitStages = React.useMemo(() => {
    const buckets = groupByDim(store, rows, "exit_stage", {});
    const byKey = new Map(buckets.map((b) => [b.key, b.count]));
    return STAGES.map((s, i) => ({
      label: s.label,
      index: i,
      // exit_stage stores the stage key, not its label.
      value: byKey.get(s.key) ?? 0,
    })).filter((s) => s.value > 0);
  }, [store, rows]);

  /* --- Reason × stage --------------------------------------------------- */

  const reasonStageCells = React.useMemo(() => {
    const reasonCol = store.cols.loss_category;
    const exitCol = store.cols.exit_stage;
    const reasonDict = store.dicts.loss_category ?? [];
    const exitDict = store.dicts.exit_stage ?? [];
    const counts = new Map<string, number>();

    for (let i = 0; i < rows.length; i++) {
      const r = reasonCol[rows[i]];
      const e = exitCol[rows[i]];
      if (r < 0 || e < 0) continue;
      const reason = reasonDict[r];
      if (reason === INFERRED_CATEGORY) continue;
      const stageKey = exitDict[e];
      const stage = STAGES.find((s) => s.key === stageKey);
      if (!stage) continue;
      const key = `${reason}|${stage.short}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return [...counts.entries()].map(([key, value]) => {
      const [row, col] = key.split("|");
      return { row, col, value };
    });
  }, [rows, store]);

  const reasonRows = React.useMemo(
    () => recorded.slice(0, 10).map((c) => c.key),
    [recorded],
  );

  /* --- Composition over time -------------------------------------------- */

  const lossTrend = React.useMemo(() => {
    const col = store.cols.loss_category;
    const dict = store.dicts.loss_category ?? [];
    const keys = recorded.slice(0, 6).map((c) => c.key);
    const keySet = new Set(keys);

    return monthly.map((p) => {
      const row: Record<string, string | number> = { label: fmtMonthKeyShort(p.key) };
      for (const k of keys) row[k] = 0;
      row.Other = 0;
      for (let i = 0; i < p.rows.length; i++) {
        const idx = col[p.rows[i]];
        if (idx < 0) continue;
        const key = dict[idx];
        if (key === INFERRED_CATEGORY) continue;
        if (keySet.has(key)) row[key] = Number(row[key]) + 1;
        else row.Other = Number(row.Other) + 1;
      }
      return row;
    });
  }, [monthly, store, recorded]);

  const lossSeries = React.useMemo(() => {
    const keys = recorded.slice(0, 6).map((c, i) => ({
      key: c.key,
      label: c.key,
      color: seriesColor(i),
    }));
    return [...keys, { key: "Other", label: "Other", color: "var(--ink-4)" }];
  }, [recorded]);

  /* --- Losses by group -------------------------------------------------- */

  const groups = useDimensionMetrics(rows, breakdown, 40);
  const groupLoss = React.useMemo(
    () =>
      groups
        .map((g) => ({
          label: g.key,
          value: g.metrics.lapseRate ?? 0,
          columns: [fmtInt(g.metrics.lapsed), fmtInt(g.metrics.applications)],
          onClick: () => drillTo(breakdown, g.key),
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 12),
    [groups, breakdown, drillTo],
  );

  /* --- The expensive losses --------------------------------------------- */

  const lateLosses = React.useMemo(() => {
    const stageCol = store.cols.stage_reached;
    const outcomeCol = store.cols.outcome;
    const hiredIdx = store.meta.outcomes.indexOf("Hired");
    const inProcessIdx = store.meta.outcomes.indexOf("In Process");
    const pitchIndex = STAGES.findIndex((s) => s.key === "sales_pitch");

    let count = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const o = outcomeCol[row];
      if (o === hiredIdx || o === inProcessIdx) continue;
      if (stageCol[row] >= pitchIndex) count++;
    }
    return count;
  }, [rows, store]);

  if (!rows.length) {
    return (
      <>
        <PageHeader title="Loss Analysis" />
        <Panel>
          <EmptyState title="No applications in scope" description="Adjust the filters above." />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Loss Analysis"
        description="Where candidates leave, why, and what each departure cost in effort already spent."
        breadcrumb={[{ label: "Command Center", href: "/" }, { label: "Loss Analysis" }]}
      />

      <Section>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="Rejected"
            value={current.rejected}
            format="int"
            polarity="neutral"
            delta={deltaOf((m) => m.rejected)}
            accent="var(--ink-4)"
            definition="Candidates CPML declined at a specific stage."
            onClick={() => patch({ outcomes: ["Rejected"] })}
          />
          <MetricCard
            label="Withdrew"
            value={current.withdrawn}
            format="int"
            polarity="lower-better"
            delta={deltaOf((m) => m.withdrawn)}
            accent="var(--series-4)"
            definition="Candidates who stepped away or turned down an offer."
            onClick={() => patch({ outcomes: ["Withdrawn"] })}
          />
          <MetricCard
            label="Gone cold"
            value={current.lapsed}
            format="int"
            polarity="lower-better"
            delta={deltaOf((m) => m.lapsed)}
            accent="var(--q-low)"
            definition="No recorded activity for 45+ days while short of an offer. No reason was recorded — the pipeline simply stopped."
            onClick={() => patch({ outcomes: ["Lapsed"] })}
          />
          <MetricCard
            label="Offer no-shows"
            value={current.droppedOff}
            format="int"
            polarity="lower-better"
            delta={deltaOf((m) => m.droppedOff)}
            accent="var(--q-crit)"
            definition="Accepted an offer, then never started training. The single most expensive loss in the funnel."
            footnote={`${fmtPct(current.noShowRate, 1)} of accepted offers`}
            onClick={() => patch({ outcomes: ["Dropped Off"] })}
          />
          <MetricCard
            label="Lost after the pitch"
            value={lateLosses}
            format="int"
            polarity="lower-better"
            accent="var(--series-5)"
            definition="Candidates lost at or beyond the sales pitch — the point where CPML has already invested assessor and manager time."
          />
          <MetricCard
            label="Reasons recorded"
            value={
              rows.length
                ? (recordedTotal / rows.length) * 100
                : null
            }
            format="pct"
            polarity="higher-better"
            accent="var(--g2)"
            definition="Share of applications carrying a recruiter-recorded loss reason. Everything else left without explanation."
            footnote={`${fmtInt(recordedTotal)} of ${fmtInt(rows.length)} applications`}
          />
        </div>
      </Section>

      {inferred && inferred.metrics.applications > 0 ? (
        <Section>
          <Panel className="relative overflow-hidden p-4 pt-[18px]">
            <span aria-hidden className="accent-bar" style={{ background: "var(--q-low)" }} />
            <div className="flex flex-wrap items-start gap-3">
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-warn-soft text-warn-ink"
              >
                <AlertOctagon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-body font-bold text-ink">
                  {fmtInt(inferred.metrics.applications)} applications ended with no reason recorded
                </h3>
                <p className="mt-1 max-w-4xl text-label leading-[1.6] text-ink-3">
                  That is {fmtPct((inferred.metrics.applications / rows.length) * 100, 1)} of
                  everything in scope. These are not counted in any chart below, because
                  attributing a cause to silence would drown out the{" "}
                  {fmtInt(recordedTotal)} losses a recruiter actually explained. Closing this
                  recording gap is the highest-leverage change available to the team — every
                  reason captured here becomes a reason that can be acted on.
                </p>
              </div>
              <Badge tone="serious" size="md">
                <span aria-hidden>▽</span>
                Data quality
              </Badge>
            </div>
          </Panel>
        </Section>
      ) : null}

      <Section>
        <SectionHead
          icon={TrendingDown}
          title="Why candidates leave"
          description="Recorded reasons only, grouped into categories and shown at full detail."
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <ChartFrame
            title="Loss categories"
            description="Area is proportional to volume"
            className="xl:col-span-1"
            tableView={{
              columns: ["Category", "Candidates", "Share"],
              rows: treemapData.map((d) => [
                d.name,
                d.value,
                fmtPct(recordedTotal ? (d.value / recordedTotal) * 100 : 0, 1),
              ]),
            }}
          >
            <div className="p-2">
              <Treemap
                data={treemapData}
                height={320}
                onLeafClick={(name) => drillTo("loss_category", name)}
              />
            </div>
          </ChartFrame>

          <ChartFrame
            title="Specific reasons"
            description="The exact wording recorded, normalised"
            className="xl:col-span-2"
            tableView={{
              columns: ["Reason", "Candidates", "Share of recorded"],
              rows: reasons.map((r) => [
                r.key,
                r.count,
                fmtPct(recordedTotal ? (r.count / recordedTotal) * 100 : 0, 1),
              ]),
            }}
          >
            <RankedBars
              items={reasons.map((r) => ({
                label: r.key,
                value: r.count,
                columns: [fmtPct(recordedTotal ? (r.count / recordedTotal) * 100 : 0, 1)],
                onClick: () => drillTo("loss_reason", r.key),
              }))}
              format={fmtInt}
              tone="var(--q-low)"
              columnHeaders={["Count", "Share"]}
              labelWidth="34%"
            />
          </ChartFrame>
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={Layers}
          title="Where losses happen"
          description="The stage a candidate was standing at when they left. Losses late in the funnel cost far more than losses early in it."
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ChartFrame
            title="Exit stage"
            tableView={{
              columns: ["Stage", "Candidates"],
              rows: exitStages.map((s) => [s.label, s.value]),
            }}
          >
            <RankedBars
              items={exitStages.map((s) => ({
                label: s.label,
                value: s.value,
                color: ordinalColor(s.index, STAGES.length),
                onClick: () => patch({ stageExactly: s.index }),
              }))}
              format={fmtInt}
            />
          </ChartFrame>

          <ChartFrame
            title="Reason against exit stage"
            description="Reading across a row shows where that reason bites; reading down a column shows what kills candidates at that stage."
            tableView={{
              columns: ["Reason", ...STAGES.map((s) => s.short)],
              rows: reasonRows.map((r) => [
                r,
                ...STAGES.map(
                  (s) =>
                    reasonStageCells.find((c) => c.row === r && c.col === s.short)?.value ?? 0,
                ),
              ]),
            }}
          >
            <div className="p-3">
              <Heatmap
                cells={reasonStageCells}
                rows={reasonRows}
                cols={STAGES.map((s) => s.short)}
                legendLabel="Candidates"
                height={300}
                onCellClick={(c) => drillTo("loss_category", c.row)}
                emptyLabel="No recorded reasons carry an exit stage."
              />
            </div>
          </ChartFrame>
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={UserMinus}
          title="How losses are changing"
          description="Composition of recorded reasons by intake month. A band that grows is a problem getting worse."
        />
        <ChartFrame
          title="Recorded loss mix over time"
          legend={lossSeries.map((s) => ({ label: s.label, color: s.color }))}
          tableView={{
            columns: ["Month", ...lossSeries.map((s) => s.label)],
            rows: lossTrend.map((r) => [
              String(r.label),
              ...lossSeries.map((s) => Number(r[s.key] ?? 0)),
            ]),
          }}
        >
          <div className="p-2">
            <StackedBars data={lossTrend} series={lossSeries} height={260} />
          </div>
        </ChartFrame>
      </Section>

      <Section>
        <SectionHead
          icon={TrendingDown}
          title="Who loses most"
          description="Share of each group's pipeline that went cold without an explanation."
          actions={
            <Segmented
              value={breakdown}
              onChange={setBreakdown}
              options={BREAKDOWN_DIMS.map((d) => ({ value: d.field, label: d.label }))}
              aria-label="Breakdown dimension"
            />
          }
        />
        <ChartFrame
          title="Pipeline lapse rate"
          description="Ranked worst first. High volume with a high lapse rate means candidates are being sourced faster than they can be worked."
          tableView={{
            columns: ["Group", "Lapse rate", "Gone cold", "Applications"],
            rows: groupLoss.map((g) => [
              g.label,
              `${g.value.toFixed(1)}%`,
              String(g.columns?.[0] ?? ""),
              String(g.columns?.[1] ?? ""),
            ]),
          }}
        >
          <RankedBars
            items={groupLoss}
            format={(v) => `${v.toFixed(1)}%`}
            tone="var(--q-low)"
            columnHeaders={["Lapse", "Cold", "Apps"]}
          />
        </ChartFrame>
      </Section>
    </>
  );
}
