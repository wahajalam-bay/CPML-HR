"use client";

import * as React from "react";
import { CalendarClock, Hourglass, Timer, TrendingDown } from "lucide-react";
import { fmtDays, fmtInt, fmtMonthKeyShort, fmtPct } from "@/lib/utils";
import { PageHeader, Section, SectionHead } from "@/components/layout/page-header";
import { Panel, PanelHeader, Badge, EmptyState, Segmented, CoverageNote } from "@/components/ui/primitives";
import { MetricCard } from "@/components/metrics/metric-card";
import { ChartFrame, ordinalColor, seriesColor } from "@/components/charts/chart-kit";
import { Histogram, RankedBars, TimeSeries } from "@/components/charts/charts";
import { BoxPlot } from "@/components/charts/echarts";
import { Heatmap } from "@/components/charts/heatmap";
import { MetricTable, type MetricColumn } from "@/components/table/metric-table";
import {
  useDimensionMetrics,
  useMetricsWithComparison,
  useTimeSeries,
} from "@/lib/hooks/use-analytics";
import { useStore } from "@/lib/providers/store-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import { statsOf, valuesOf, type Stats } from "@/lib/data/query";
import { coverage, histogram, METRIC_BY_ID, type GroupRow } from "@/lib/data/metrics";
import { NULL_NUM, STAGES, type DictField, type NumField } from "@/lib/data/schema";

/** Each hand-off in the pipeline and the column that measures it. */
const HANDOFFS: { field: NumField; label: string; from: string; to: string }[] = [
  { field: "d_to_call", label: "Application → first call", from: "Applied", to: "Phone Screen" },
  { field: "d_call_to_assessment", label: "Call → assessment", from: "Phone Screen", to: "Assessment" },
  { field: "d_assessment_to_sp", label: "Assessment → sales pitch", from: "Assessment", to: "Sales Pitch" },
  { field: "d_sp_to_manager", label: "Pitch → manager interview", from: "Sales Pitch", to: "Manager Interview" },
  { field: "d_manager_to_final", label: "Manager → final interview", from: "Manager Interview", to: "Final Interview" },
  { field: "d_final_to_offer", label: "Final interview → offer", from: "Final Interview", to: "Offer" },
  { field: "d_offer_to_join", label: "Offer → start date", from: "Offer", to: "Joined" },
];

const AGE_BUCKETS = [
  { label: "0–7 days", min: 0, max: 7 },
  { label: "8–14 days", min: 8, max: 14 },
  { label: "15–30 days", min: 15, max: 30 },
  { label: "31–45 days", min: 31, max: 45 },
  { label: "46–90 days", min: 46, max: 90 },
  { label: "90+ days", min: 91, max: Infinity },
];

const BREAKDOWN_DIMS: { field: DictField; label: string }[] = [
  { field: "recruiter", label: "Recruiter" },
  { field: "source", label: "Source" },
  { field: "applied_role", label: "Role" },
  { field: "team", label: "Business unit" },
];

export function VelocityAnalytics() {
  const store = useStore();
  const { patch, drillTo } = useFilters();
  const { current, previous, rows, deltaOf } = useMetricsWithComparison();
  const [breakdown, setBreakdown] = React.useState<DictField>("recruiter");
  const monthly = useTimeSeries(rows, "applied_date", "month");

  /* --- Hand-off durations ---------------------------------------------- */

  const handoffs = React.useMemo(
    () =>
      HANDOFFS.map((h) => ({
        ...h,
        stats: statsOf(store, rows, h.field),
        values: valuesOf(store, rows, h.field).filter((v) => v >= 0 && v <= 120),
      })),
    [store, rows],
  );

  const totalMedian = React.useMemo(
    () => handoffs.reduce((sum, h) => sum + (h.stats.median ?? 0), 0),
    [handoffs],
  );

  /* --- Aging: how long has the live pipeline been sitting? -------------- */

  const aging = React.useMemo(() => {
    const idleCol = store.cols.days_idle;
    const stageCol = store.cols.stage_reached;
    const outcomeCol = store.cols.outcome;
    const liveOutcomes = new Set([
      store.meta.outcomes.indexOf("In Process"),
      store.meta.outcomes.indexOf("Lapsed"),
    ]);

    const buckets = AGE_BUCKETS.map((b) => ({ ...b, count: 0, byStage: new Map<number, number>() }));
    let live = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!liveOutcomes.has(outcomeCol[row])) continue;
      const idle = idleCol[row];
      if (idle === NULL_NUM) continue;
      live++;
      const bucket = buckets.find((b) => idle >= b.min && idle <= b.max);
      if (!bucket) continue;
      bucket.count++;
      const stage = stageCol[row];
      bucket.byStage.set(stage, (bucket.byStage.get(stage) ?? 0) + 1);
    }
    return { buckets, live };
  }, [rows, store]);

  const agingCells = React.useMemo(() => {
    const cells: { row: string; col: string; value: number }[] = [];
    for (const bucket of aging.buckets) {
      for (let s = 0; s < STAGES.length; s++) {
        cells.push({
          row: STAGES[s].label,
          col: bucket.label,
          value: bucket.byStage.get(s) ?? 0,
        });
      }
    }
    return cells;
  }, [aging]);

  /* --- Velocity over time ---------------------------------------------- */

  const velocityTrend = React.useMemo(
    () =>
      monthly.map((p) => {
        const contact = statsOf(store, p.rows, "d_to_call");
        const offer = statsOf(store, p.rows, "time_to_offer");
        const hire = statsOf(store, p.rows, "time_to_hire");
        return {
          label: fmtMonthKeyShort(p.key),
          day: p.day,
          contact: contact.median ?? 0,
          offer: offer.median ?? 0,
          hire: hire.median ?? 0,
        };
      }),
    [monthly, store],
  );

  /* --- Distribution comparison ------------------------------------------ */

  const groups = useDimensionMetrics(rows, breakdown, 40);

  const boxGroups = React.useMemo(
    () =>
      groups.slice(0, 8).map((g) => ({
        label: g.key,
        values: valuesOf(store, g.rows, "time_to_hire").filter((v) => v >= 0 && v <= 90),
      })).filter((g) => g.values.length >= 5),
    [groups, store],
  );

  /* --- Slowest handoffs by group ---------------------------------------- */

  const slowestContact = React.useMemo(
    () =>
      groups
        .map((g) => ({
          key: g.key,
          median: statsOf(store, g.rows, "d_to_call").median,
          n: g.metrics.applications,
        }))
        .filter((g): g is { key: string; median: number; n: number } => g.median != null)
        .sort((a, b) => b.median - a.median)
        .slice(0, 10)
        .map((g) => ({
          label: g.key,
          value: Number(g.median.toFixed(1)),
          columns: [fmtInt(g.n)],
          onClick: () => drillTo(breakdown, g.key),
        })),
    [groups, store, breakdown, drillTo],
  );

  /* --- Table ------------------------------------------------------------ */

  const tableColumns = React.useMemo<MetricColumn<GroupRow>[]>(
    () => [
      { id: "key", header: BREAKDOWN_DIMS.find((d) => d.field === breakdown)?.label ?? "Group", value: (r) => r.key, align: "left", width: "20%" },
      { id: "apps", header: "Applications", value: (r) => r.metrics.applications, bar: true },
      {
        id: "contact",
        header: "To first call",
        help: "Median days from the application arriving to the recruiter's first call.",
        value: (r) => r.metrics.timeToFirstContact.median,
        render: (r) => fmtDays(r.metrics.timeToFirstContact.median, 1),
        band: "lower-better",
      },
      {
        id: "offer",
        header: "To offer",
        help: "Median days from application to offer placement.",
        value: (r) => r.metrics.timeToOffer.median,
        render: (r) => fmtDays(r.metrics.timeToOffer.median, 1),
        band: "lower-better",
        hideBelow: "md",
      },
      {
        id: "hire",
        header: "To hire",
        help: "Median days from application to actual start date.",
        value: (r) => r.metrics.timeToHire.median,
        render: (r) => fmtDays(r.metrics.timeToHire.median, 1),
        band: "lower-better",
      },
      {
        id: "join",
        header: "Offer → join",
        help: "Median days between an accepted offer and the candidate starting.",
        value: (r) => r.metrics.offerToJoin.median,
        render: (r) => fmtDays(r.metrics.offerToJoin.median, 1),
        band: "lower-better",
        hideBelow: "lg",
      },
      {
        id: "slip",
        header: "DOJ slip",
        help: "Median days the actual start date landed after the planned one. Positive means late.",
        value: (r) => r.metrics.dojSlip.median,
        render: (r) => (r.metrics.dojSlip.median != null ? fmtDays(r.metrics.dojSlip.median, 1) : "—"),
        band: "lower-better",
        hideBelow: "lg",
      },
      {
        id: "lapse",
        header: "Gone cold",
        help: "Share of this group's applications with no activity for 45+ days.",
        value: (r) => r.metrics.lapseRate,
        render: (r) => fmtPct(r.metrics.lapseRate, 1),
        band: "lower-better",
        hideBelow: "xl",
      },
    ],
    [breakdown],
  );

  const contactCoverage = React.useMemo(
    () => coverage(store, rows, "d_to_call"),
    [store, rows],
  );

  if (!rows.length) {
    return (
      <>
        <PageHeader title="Velocity & Aging" />
        <Panel>
          <EmptyState title="No applications in scope" description="Adjust the filters above." />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Velocity & Aging"
        description="Every hand-off in the pipeline, how long it takes, and how much of the live pipeline has stopped moving."
        breadcrumb={[{ label: "Command Center", href: "/" }, { label: "Velocity & Aging" }]}
      />

      <Section>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="To first contact"
            value={current.timeToFirstContact.median}
            format="days"
            polarity="lower-better"
            target={METRIC_BY_ID.timeToFirstContact.target}
            delta={deltaOf((m) => m.timeToFirstContact.median)}
            previous={previous?.timeToFirstContact.median ?? null}
            accent="var(--g1)"
            definition={METRIC_BY_ID.timeToFirstContact.definition}
          />
          <MetricCard
            label="To offer"
            value={current.timeToOffer.median}
            format="days"
            polarity="lower-better"
            target={METRIC_BY_ID.timeToOffer.target}
            delta={deltaOf((m) => m.timeToOffer.median)}
            previous={previous?.timeToOffer.median ?? null}
            accent="var(--g2)"
            definition={METRIC_BY_ID.timeToOffer.definition}
          />
          <MetricCard
            label="To hire"
            value={current.timeToHire.median}
            format="days"
            polarity="lower-better"
            target={METRIC_BY_ID.timeToHire.target}
            delta={deltaOf((m) => m.timeToHire.median)}
            previous={previous?.timeToHire.median ?? null}
            accent="var(--q-top)"
            definition={METRIC_BY_ID.timeToHire.definition}
          />
          <MetricCard
            label="Offer → join"
            value={current.offerToJoin.median}
            format="days"
            polarity="lower-better"
            target={METRIC_BY_ID.offerToJoin.target}
            delta={deltaOf((m) => m.offerToJoin.median)}
            accent="var(--series-2)"
            definition={METRIC_BY_ID.offerToJoin.definition}
          />
          <MetricCard
            label="Start-date slip"
            value={current.dojSlip.median}
            format="days"
            polarity="lower-better"
            accent="var(--series-3)"
            definition="Median days the actual joining date landed after the planned one. Positive means candidates start later than the plan assumed."
            footnote={`${fmtInt(current.dojSlip.count)} hires with both dates recorded`}
          />
          <MetricCard
            label="Pipeline gone cold"
            value={current.lapseRate}
            format="pct"
            polarity="lower-better"
            target={METRIC_BY_ID.lapseRate.target}
            delta={deltaOf((m) => m.lapseRate)}
            accent="var(--q-low)"
            definition={METRIC_BY_ID.lapseRate.definition}
            footnote={`${fmtInt(current.lapsed)} applications idle 45+ days`}
            onClick={() => patch({ outcomes: ["Lapsed"] })}
          />
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={Timer}
          title="Where the time goes"
          description={`Median hand-off times sum to roughly ${fmtDays(totalMedian, 1)} end to end. The distribution matters more than the median — a long tail is where candidates disengage.`}
        />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {handoffs.map((h, i) => (
            <HandoffCard key={h.field} handoff={h} index={i} total={handoffs.length} />
          ))}
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={Hourglass}
          title="Aging pipeline"
          description={`${fmtInt(aging.live)} applications are still open. This is how long each has been sitting untouched, and at which stage.`}
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <ChartFrame
            title="Idle time"
            description="Days since the last recorded activity"
            className="xl:col-span-1"
            tableView={{
              columns: ["Idle for", "Applications", "Share"],
              rows: aging.buckets.map((b) => [
                b.label,
                b.count,
                fmtPct(aging.live ? (b.count / aging.live) * 100 : 0, 1),
              ]),
            }}
          >
            <RankedBars
              items={aging.buckets.map((b, i) => ({
                label: b.label,
                value: b.count,
                color: ordinalColor(i, aging.buckets.length),
                columns: [fmtPct(aging.live ? (b.count / aging.live) * 100 : 0, 1)],
              }))}
              format={fmtInt}
              columnHeaders={["Apps", "Share"]}
              labelWidth="42%"
            />
          </ChartFrame>

          <ChartFrame
            title="Idle time by stage"
            description="A large cell far to the right is a cohort that has been abandoned deep in the funnel — the most expensive kind of loss."
            className="xl:col-span-2"
            tableView={{
              columns: ["Stage", ...aging.buckets.map((b) => b.label)],
              rows: STAGES.map((s, si) => [
                s.label,
                ...aging.buckets.map((b) => b.byStage.get(si) ?? 0),
              ]),
            }}
          >
            <div className="p-3">
              <Heatmap
                cells={agingCells}
                rows={STAGES.map((s) => s.label)}
                cols={aging.buckets.map((b) => b.label)}
                legendLabel="Applications"
                rowLabelWidth={132}
                height={352}
                onCellClick={(c) => {
                  const stageIndex = STAGES.findIndex((s) => s.label === c.row);
                  if (stageIndex >= 0) patch({ stageExactly: stageIndex });
                }}
              />
            </div>
          </ChartFrame>
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={CalendarClock}
          title="Velocity over time"
          description="Median days for each milestone, by intake month. All three series are days, so they share one axis honestly."
        />
        <ChartFrame
          title="Median days to milestone"
          legend={[
            { label: "To first call", color: seriesColor(0) },
            { label: "To offer", color: seriesColor(1) },
            { label: "To hire", color: seriesColor(2) },
          ]}
          tableView={{
            columns: ["Month", "To first call", "To offer", "To hire"],
            rows: velocityTrend.map((v) => [v.label, v.contact, v.offer, v.hire]),
          }}
        >
          <div className="p-2">
            <TimeSeries
              data={velocityTrend}
              series={[
                { key: "contact", label: "To first call", format: (v) => fmtDays(v, 1) },
                { key: "offer", label: "To offer", format: (v) => fmtDays(v, 1) },
                { key: "hire", label: "To hire", format: (v) => fmtDays(v, 1) },
              ]}
              variant="line"
              height={260}
              yFormat={(v) => `${v.toFixed(0)}d`}
              onPointClick={(d) => {
                const point = velocityTrend.find((v) => v.label === d.label);
                if (point) patch({ from: point.day, to: point.day + 30 });
              }}
            />
          </div>
        </ChartFrame>
      </Section>

      <Section>
        <SectionHead
          icon={TrendingDown}
          title="Who is slow"
          description="Compare velocity across any dimension."
          actions={
            <Segmented
              value={breakdown}
              onChange={setBreakdown}
              options={BREAKDOWN_DIMS.map((d) => ({ value: d.field, label: d.label }))}
              aria-label="Breakdown dimension"
            />
          }
        />

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ChartFrame
            title="Slowest to first contact"
            description="Median days before the first call. Sales candidates go cold fast — this is the most recoverable delay in the funnel."
            tableView={{
              columns: ["Group", "Median days", "Applications"],
              rows: slowestContact.map((s) => [s.label, s.value, String(s.columns?.[0] ?? "")]),
            }}
            footnote={
              <CoverageNote
                known={contactCoverage.known}
                total={contactCoverage.total}
                what="a call date"
              />
            }
          >
            <RankedBars
              items={slowestContact}
              format={(v) => fmtDays(v, 1)}
              tone="var(--q-low)"
              columnHeaders={["Days", "Apps"]}
            />
          </ChartFrame>

          <ChartFrame
            title="Time-to-hire spread"
            description="Box shows the middle 50% of hires; whiskers reach 1.5× the interquartile range. A wide box means an unpredictable process."
            tableView={{
              columns: ["Group", "Hires measured", "Median days"],
              rows: boxGroups.map((g) => [
                g.label,
                g.values.length,
                median(g.values).toFixed(1),
              ]),
            }}
          >
            <div className="p-2">
              <BoxPlot groups={boxGroups} height={280} unit="d" />
            </div>
          </ChartFrame>
        </div>

        <Panel className="mt-3 overflow-hidden">
          <PanelHeader
            title="Velocity ledger"
            description="Every group meeting the volume threshold. Bands compare each row against the quartiles on screen."
            actions={<Badge tone="outline">{fmtInt(groups.length)} groups</Badge>}
          />
          <MetricTable
            rows={groups}
            columns={tableColumns}
            rowKey={(r) => r.key}
            onRowClick={(r) => drillTo(breakdown, r.key)}
            defaultSort={{ id: "apps", dir: "desc" }}
            exportName={`cpml-velocity-${breakdown}`}
            maxHeight={520}
          />
        </Panel>
      </Section>
    </>
  );
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function HandoffCard({
  handoff,
  index,
  total,
}: {
  handoff: { label: string; from: string; to: string; stats: Stats; values: number[] };
  index: number;
  total: number;
}) {
  const { stats, values } = handoff;

  const bins = React.useMemo(
    () => histogram(values, values.length && Math.max(...values) > 40 ? 7 : 2, { unit: "d" }),
    [values],
  );

  const sameDay = values.filter((v) => v <= 0).length;
  const sameDayPct = values.length ? (sameDay / values.length) * 100 : 0;
  const withinWeek = values.filter((v) => v <= 7).length;
  const withinWeekPct = values.length ? (withinWeek / values.length) * 100 : 0;
  const tail = values.filter((v) => v > 14).length;

  // When a hand-off is essentially instantaneous, a histogram is one bar and
  // six empty ones. A concentration read-out says the same thing honestly and
  // leaves room for the part that does vary — the tail.
  const modalShare = bins.length
    ? Math.max(...bins.map((b) => b.count)) / Math.max(1, values.length)
    : 0;
  const degenerate = values.length > 0 && modalShare >= 0.85;

  return (
    <Panel className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-[3px]"
          style={{ background: ordinalColor(index, total) }}
        />
        <h3 className="flex-1 truncate text-body font-bold text-ink">{handoff.label}</h3>
        <Badge tone="outline">{fmtInt(stats.count)} measured</Badge>
      </div>

      <div className="grid grid-cols-4 gap-2 px-3.5 py-3">
        <Figure label="p25" value={stats.p25} />
        <Figure label="Median" value={stats.median} emphasis />
        <Figure label="p75" value={stats.p75} />
        <Figure label="p90" value={stats.p90} />
      </div>

      {!values.length ? (
        <p className="flex-1 px-3.5 pb-4 text-label text-ink-4">
          No records carry both dates for this hand-off.
        </p>
      ) : degenerate ? (
        <div className="flex-1 px-3.5 pb-3">
          <ConcentrationBar
            segments={[
              { label: "Same day", value: sameDay, color: "var(--q-top)" },
              { label: "Within a week", value: withinWeek - sameDay, color: "var(--g3)" },
              { label: "8–14 days", value: values.length - withinWeek - tail, color: "var(--q-mid)" },
              { label: "Over 14 days", value: tail, color: "var(--q-low)" },
            ]}
            total={values.length}
          />
        </div>
      ) : (
        <div className="flex-1 px-1 pb-1">
          <Histogram bins={bins} height={110} />
        </div>
      )}

      <footer className="border-t border-line px-3.5 py-2 text-micro leading-4 text-ink-4">
        {values.length === 0 ? (
          <>This hand-off is not dated in the source sheet.</>
        ) : sameDayPct >= 85 ? (
          <>
            Effectively instantaneous — {fmtPct(sameDayPct, 0)} happen the same day. The{" "}
            {fmtInt(tail)} taking over a fortnight are the only ones worth chasing.
          </>
        ) : (
          <>
            {fmtPct(sameDayPct, 0)} happen same day and {fmtPct(withinWeekPct, 0)} within a week.
            The p90 tail runs to {fmtDays(stats.p90, 0)} — that is the number worth managing, not
            the median.
          </>
        )}
      </footer>
    </Panel>
  );
}

/** A single stacked bar showing how a near-instant hand-off actually splits. */
function ConcentrationBar({
  segments,
  total,
}: {
  segments: { label: string; value: number; color: string }[];
  total: number;
}) {
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-[4px] bg-surface-3">
        {visible.map((s) => (
          <span
            key={s.label}
            title={`${s.label}: ${fmtInt(s.value)} (${fmtPct((s.value / total) * 100, 1)})`}
            style={{
              width: `${(s.value / total) * 100}%`,
              background: s.color,
              boxShadow: "inset -2px 0 0 var(--surface)",
            }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-col gap-1">
        {visible.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-label">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: s.color }}
            />
            <span className="flex-1 truncate text-ink-2">{s.label}</span>
            <span className="tabular-nums text-ink">{fmtInt(s.value)}</span>
            <span className="w-12 text-right tabular-nums text-ink-4">
              {fmtPct((s.value / total) * 100, 1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Figure({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number | null;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p
        className={
          emphasis
            ? "text-lead font-extrabold tabular-nums text-ink"
            : "text-meta font-semibold tabular-nums text-ink-2"
        }
      >
        {value != null ? fmtDays(value, value < 10 ? 1 : 0) : "—"}
      </p>
    </div>
  );
}
