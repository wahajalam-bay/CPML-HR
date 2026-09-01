"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  GitBranch,
  Info,
  LayoutDashboard,
  TrendingDown,
  UserCog,
} from "lucide-react";
import {
  cn,
  fmtCompact,
  fmtDay,
  fmtInt,
  fmtMonthKeyShort,
  fmtPct,
} from "@/lib/utils";
import { PageHeader, Section, SectionHead } from "@/components/layout/page-header";
import { Panel, PanelHeader, Badge, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/metrics/metric-card";
import { ChartFrame, seriesColor } from "@/components/charts/chart-kit";
import { ColumnChart, RankedBars, StackedBars, TimeSeries } from "@/components/charts/charts";
import { PipelineFunnel, StageLedger } from "@/components/charts/funnel";
import {
  useAutoGranularity,
  useDimensionMetrics,
  useFunnel,
  useMetricsWithComparison,
  useTimeSeries,
} from "@/lib/hooks/use-analytics";
import { useStore } from "@/lib/providers/store-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import { useAlerts } from "@/lib/hooks/use-alerts";
import { computeMetrics, METRIC_BY_ID } from "@/lib/data/metrics";
import { OUTCOMES, STAGE_INDEX, type Outcome } from "@/lib/data/schema";
import { HealthGauge } from "./health-gauge";

const OUTCOME_TONE: Record<Outcome, string> = {
  Hired: "var(--q-top)",
  "In Process": "var(--q-mid)",
  Rejected: "var(--ink-4)",
  Lapsed: "var(--q-low)",
  Withdrawn: "var(--series-4)",
  "Dropped Off": "var(--q-crit)",
};

export function CommandCenter() {
  const store = useStore();
  const { filters, patch, drillTo } = useFilters();
  const { current, previous, rows, deltaOf } = useMetricsWithComparison();
  const funnel = useFunnel(rows);
  const alerts = useAlerts();
  const granularity = useAutoGranularity();

  const series = useTimeSeries(rows, "applied_date", granularity);

  /* --- Trend data ----------------------------------------------------- */

  const trend = React.useMemo(
    () =>
      series.map((p) => {
        const m = computeMetrics(store, p.rows);
        return {
          key: p.key,
          label: granularity === "month" || granularity === "quarter"
            ? fmtMonthKeyShort(p.key)
            : fmtDay(p.day),
          day: p.day,
          applications: m.applications,
          contacted: m.phoneScreened,
          pitched: m.pitched,
          interviewed: m.managerInterviews,
          offers: m.offers,
          hires: m.hired,
          conversion: m.overallConversion ?? 0,
        };
      }),
    [series, store, granularity],
  );

  const sparkOf = React.useCallback(
    (key: keyof (typeof trend)[number]) => trend.map((t) => Number(t[key] ?? 0)),
    [trend],
  );

  /* --- Outcome composition over time ----------------------------------- */

  const outcomeTrend = React.useMemo(() => {
    const outcomeCol = store.cols.outcome;
    return series.map((p) => {
      const counts = new Array(OUTCOMES.length).fill(0);
      for (let i = 0; i < p.rows.length; i++) counts[outcomeCol[p.rows[i]]]++;
      const row: Record<string, string | number> = {
        label:
          granularity === "month" || granularity === "quarter"
            ? fmtMonthKeyShort(p.key)
            : fmtDay(p.day),
        key: p.key,
      };
      OUTCOMES.forEach((o, i) => (row[o] = counts[i]));
      return row;
    });
  }, [series, store, granularity]);

  /* --- Leaderboards ---------------------------------------------------- */

  const recruiters = useDimensionMetrics(rows, "recruiter", 30);
  const sources = useDimensionMetrics(rows, "source", 25);

  const topRecruiters = React.useMemo(
    () =>
      [...recruiters]
        .sort((a, b) => b.metrics.hired - a.metrics.hired)
        .slice(0, 8)
        .map((r) => ({
          label: r.key,
          value: r.metrics.hired,
          columns: [
            fmtInt(r.metrics.applications),
            r.metrics.overallConversion != null ? fmtPct(r.metrics.overallConversion, 2) : "—",
          ],
          href: `/recruiters/${encodeURIComponent(r.key)}`,
        })),
    [recruiters],
  );

  const sourceYield = React.useMemo(
    () =>
      [...sources]
        .sort((a, b) => b.metrics.hired - a.metrics.hired)
        .slice(0, 8)
        .map((s) => ({
          label: s.key,
          value: s.metrics.hired,
          columns: [
            fmtInt(s.metrics.applications),
            s.metrics.overallConversion != null ? fmtPct(s.metrics.overallConversion, 2) : "—",
          ],
          onClick: () => drillTo("source", s.key),
        })),
    [sources, drillTo],
  );

  /* --- Loss composition ------------------------------------------------
     "Went Cold" is inferred from inactivity rather than recorded by a
     recruiter, and it outnumbers every real reason nine to one. Mixing the
     two would bury the reasons someone can actually act on, so it is
     separated out and reported as its own figure.                          */

  const lossMix = useDimensionMetrics(rows, "loss_category", 1);
  const { topLosses, wentCold } = React.useMemo(() => {
    const cold = lossMix.find((l) => l.key === "Contactability");
    const recorded = lossMix.filter((l) => l.key !== "Contactability");
    return {
      wentCold: cold?.metrics.applications ?? 0,
      topLosses: [...recorded]
        .sort((a, b) => b.metrics.applications - a.metrics.applications)
        .slice(0, 6)
        .map((l) => ({
          label: l.key,
          value: l.metrics.applications,
          onClick: () => drillTo("loss_category", l.key),
        })),
    };
  }, [lossMix, drillTo]);

  const rangeLabel =
    filters.from != null || filters.to != null
      ? `${fmtDay(filters.from ?? store.meta.dateMin)} → ${fmtDay(filters.to ?? store.meta.horizon)}`
      : `${fmtDay(store.meta.dateMin)} → ${fmtDay(store.meta.horizon)} (all time)`;

  if (!rows.length) {
    return (
      <>
        <PageHeader title="Command Center" description={rangeLabel} />
        <Panel>
          <EmptyState
            icon={<Info />}
            title="No applications match the current filters"
            description="Widen the date range or clear a dimension to bring records back into view."
          />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Command Center"
        description={`${fmtInt(rows.length)} applications · ${rangeLabel}`}
        actions={
          <Badge tone="outline" size="md">
            Dataset current to {fmtDay(store.meta.horizon)}
          </Badge>
        }
      />

      {/* ================= Executive KPIs ================= */}
      <Section>
        <SectionHead
          icon={LayoutDashboard}
          title="Executive KPIs"
          description="Every card is clickable and cross-filters the whole platform."
        />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="Applications"
            value={current.applications}
            format="int"
            definition={METRIC_BY_ID.applications.definition}
            delta={deltaOf((m) => m.applications)}
            previous={previous?.applications ?? null}
            trend={sparkOf("applications")}
            accent="var(--g1)"
            footnote={`${fmtInt(current.repeatApplications)} are re-applications`}
            href="/candidates"
          />
          <MetricCard
            label="Contacted"
            value={current.phoneScreened}
            format="int"
            definition={METRIC_BY_ID.phoneScreened.definition}
            polarity="higher-better"
            delta={deltaOf((m) => m.phoneScreened)}
            previous={previous?.phoneScreened ?? null}
            trend={sparkOf("contacted")}
            accent="var(--g2)"
            footnote={`${fmtPct((current.phoneScreened / current.applications) * 100, 0)} of intake reached`}
            onClick={() => patch({ stageAtLeast: STAGE_INDEX.phone_screen })}
          />
          <MetricCard
            label="Sales Pitches"
            value={current.pitched}
            format="int"
            definition={METRIC_BY_ID.pitched.definition}
            polarity="higher-better"
            delta={deltaOf((m) => m.pitched)}
            previous={previous?.pitched ?? null}
            trend={sparkOf("pitched")}
            accent="var(--series-2)"
            footnote={`${fmtInt(current.pitchPassed)} passed (${fmtPct(current.pitchPassRate, 0)})`}
            onClick={() => patch({ stageAtLeast: STAGE_INDEX.sales_pitch })}
          />
          <MetricCard
            label="Offers Placed"
            value={current.offers}
            format="int"
            definition={METRIC_BY_ID.offers.definition}
            polarity="higher-better"
            delta={deltaOf((m) => m.offers)}
            previous={previous?.offers ?? null}
            trend={sparkOf("offers")}
            accent="var(--series-3)"
            footnote={`${fmtPct(current.offerAcceptRate, 1)} accepted`}
            onClick={() => patch({ stageAtLeast: STAGE_INDEX.offer })}
          />
          <MetricCard
            label="Hires"
            value={current.hired}
            format="int"
            definition={METRIC_BY_ID.hired.definition}
            polarity="higher-better"
            delta={deltaOf((m) => m.hired)}
            previous={previous?.hired ?? null}
            trend={sparkOf("hires")}
            accent="var(--q-top)"
            footnote={`${fmtInt(current.droppedOff)} accepted but never started`}
            onClick={() => patch({ outcomes: ["Hired"] })}
          />
          <MetricCard
            label="Application → Hire"
            value={current.overallConversion}
            format="pct"
            definition={METRIC_BY_ID.overallConversion.definition}
            polarity="higher-better"
            delta={deltaOf((m) => m.overallConversion)}
            previous={previous?.overallConversion ?? null}
            target={METRIC_BY_ID.overallConversion.target}
            accent="var(--series-5)"
            footnote={`${current.applicationsPerHire != null ? current.applicationsPerHire.toFixed(0) : "—"} applications per hire`}
            href="/pipeline"
          />
        </div>
      </Section>

      {/* ================= Alerts ================= */}
      {alerts.length ? (
        <Section id="alerts-panel">
          <SectionHead
            icon={AlertTriangle}
            title="Needs attention"
            description="Ranked by cost to the operation. Every alert opens the records behind it."
          />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {alerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        </Section>
      ) : null}

      {/* ================= Pipeline ================= */}
      <Section>
        <SectionHead
          icon={GitBranch}
          title="Where the funnel stands"
          description="Entered versus cleared at every stage. The pinch points are the story."
          actions={
            <Button variant="default" size="sm" asChild>
              <Link href="/pipeline">
                Full pipeline analysis
                <ArrowRight />
              </Link>
            </Button>
          }
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <ChartFrame
            title="Candidate flow"
            description="Ribbon width is eased for legibility; the printed counts are exact."
            className="xl:col-span-2"
            tableView={{
              columns: ["Stage", "Entered", "Cleared", "Pass %", "Of intake"],
              rows: funnel.map((s) => [
                s.label,
                s.entered,
                s.cleared,
                s.passRate != null ? `${s.passRate.toFixed(1)}%` : "—",
                `${s.cumulative.toFixed(1)}%`,
              ]),
            }}
          >
            <div className="p-3">
              <PipelineFunnel
                stages={funnel}
                height={300}
                onStageClick={(s) => patch({ stageAtLeast: s.index })}
              />
            </div>
          </ChartFrame>

          <HealthGauge rows={rows} metrics={current} />
        </div>

        <Panel className="mt-3 overflow-hidden">
          <PanelHeader
            title="Stage ledger"
            description="Click any row to filter the platform to candidates who reached that stage."
          />
          <StageLedger stages={funnel} onStageClick={(s) => patch({ stageAtLeast: s.index })} />
        </Panel>
      </Section>

      {/* ================= Trends ================= */}
      <Section>
        <SectionHead
          icon={Activity}
          title="Trends over time"
          description={`Bucketed by ${granularity}. Click any point to filter to that period.`}
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ChartFrame
            title="Intake and pipeline progression"
            description="Counts only — each series is on the same scale, so no measure is visually inflated."
            legend={[
              { label: "Applications", color: seriesColor(0) },
              { label: "Contacted", color: seriesColor(1) },
              { label: "Sales pitches", color: seriesColor(2) },
            ]}
            tableView={{
              columns: ["Period", "Applications", "Contacted", "Pitches", "Offers", "Hires"],
              rows: trend.map((t) => [t.label, t.applications, t.contacted, t.pitched, t.offers, t.hires]),
            }}
          >
            <div className="p-2">
              <TimeSeries
                data={trend}
                series={[
                  { key: "applications", label: "Applications" },
                  { key: "contacted", label: "Contacted" },
                  { key: "pitched", label: "Sales pitches" },
                ]}
                height={250}
                variant="area"
                onPointClick={(d) => {
                  const point = trend.find((t) => t.label === d.label);
                  if (point) patch({ from: point.day, to: point.day + bucketSpan(granularity) });
                }}
              />
            </div>
          </ChartFrame>

          <ChartFrame
            title="Hires delivered"
            description="Shown separately from intake: a hires line drawn against 2,000 applications would be a flat line at zero."
            tableView={{
              columns: ["Period", "Hires", "Offers", "Conversion %"],
              rows: trend.map((t) => [t.label, t.hires, t.offers, `${t.conversion.toFixed(2)}%`]),
            }}
          >
            <div className="p-2">
              <ColumnChart
                data={trend}
                valueKey="hires"
                xKey="label"
                height={250}
                showLabels={trend.length <= 20}
                onBarClick={(d) => {
                  const point = trend.find((t) => t.label === d.label);
                  if (point) patch({ from: point.day, to: point.day + bucketSpan(granularity) });
                }}
              />
            </div>
          </ChartFrame>
        </div>

        <div className="mt-3">
          <ChartFrame
            title="What happened to each intake period"
            description="Composition of every application cohort. A growing amber band means the pipeline is going cold faster than it is converting."
            legend={OUTCOMES.map((o) => ({ label: o, color: OUTCOME_TONE[o] }))}
            tableView={{
              columns: ["Period", ...OUTCOMES],
              rows: outcomeTrend.map((r) => [
                String(r.label),
                ...OUTCOMES.map((o) => Number(r[o] ?? 0)),
              ]),
            }}
          >
            <div className="p-2">
              <StackedBars
                data={outcomeTrend}
                series={OUTCOMES.map((o) => ({
                  key: o,
                  label: o,
                  color: OUTCOME_TONE[o],
                }))}
                height={240}
                normalize
              />
            </div>
          </ChartFrame>
        </div>
      </Section>

      {/* ================= People & sourcing ================= */}
      <Section>
        <SectionHead
          icon={UserCog}
          title="Who is delivering"
          description="Bars show hires; the muted track behind each bar is the application volume that produced them."
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <ChartFrame
            title="Recruiter leaderboard"
            description="Ranked by hires delivered"
            actions={
              <Button variant="ghost" size="xs" asChild>
                <Link href="/recruiters">All recruiters</Link>
              </Button>
            }
            tableView={{
              columns: ["Recruiter", "Hires", "Applications", "Conversion"],
              rows: topRecruiters.map((r) => [r.label, r.value, ...(r.columns ?? [])]),
            }}
          >
            <RankedBars
              items={topRecruiters}
              format={fmtInt}
              columnHeaders={["Hires", "Apps", "Conv."]}
            />
          </ChartFrame>

          <ChartFrame
            title="Source yield"
            description="Hires per channel"
            actions={
              <Button variant="ghost" size="xs" asChild>
                <Link href="/sources">All sources</Link>
              </Button>
            }
            tableView={{
              columns: ["Source", "Hires", "Applications", "Conversion"],
              rows: sourceYield.map((r) => [r.label, r.value, ...(r.columns ?? [])]),
            }}
          >
            <RankedBars
              items={sourceYield}
              format={fmtInt}
              tone="var(--series-2)"
              columnHeaders={["Hires", "Apps", "Conv."]}
            />
          </ChartFrame>

          <ChartFrame
            title="Why candidates leave"
            description="Reasons a recruiter actually recorded"
            actions={
              <Button variant="ghost" size="xs" asChild>
                <Link href="/attrition">Loss analysis</Link>
              </Button>
            }
            tableView={{
              columns: ["Category", "Candidates"],
              rows: topLosses.map((l) => [l.label, l.value]),
            }}
            footnote={
              <>
                A further <strong className="font-bold text-ink-2">{fmtInt(wentCold)}</strong>{" "}
                applications simply went cold with no reason recorded. They are excluded here
                because inferring a cause from silence would bury the reasons someone can act on.
              </>
            }
          >
            <RankedBars items={topLosses} format={fmtInt} tone="var(--q-low)" />
          </ChartFrame>
        </div>
      </Section>

      {/* ================= Quick navigation ================= */}
      <Section>
        <SectionHead icon={Building2} title="Go deeper" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QuickLink
            href="/pipeline"
            icon={GitBranch}
            title="Pipeline"
            body="Stage-by-stage conversion, cohort progression and the exact point candidates are lost."
          />
          <QuickLink
            href="/velocity"
            icon={CalendarClock}
            title="Velocity & aging"
            body="How long each hand-off takes, and how much of the pipeline is standing still."
          />
          <QuickLink
            href="/attrition"
            icon={TrendingDown}
            title="Loss analysis"
            body="Every rejection and drop-out reason, attributed to the stage it happened at."
          />
          <QuickLink
            href="/talent"
            icon={Activity}
            title="Talent insights"
            body="Which backgrounds, institutes and experience levels actually convert."
          />
        </div>
      </Section>
    </>
  );
}

/* =========================================================================
 * Pieces
 * ========================================================================= */

function bucketSpan(granularity: string): number {
  return granularity === "day" ? 0 : granularity === "week" ? 6 : granularity === "month" ? 30 : 91;
}

function AlertCard({
  alert,
}: {
  alert: ReturnType<typeof useAlerts>[number];
}) {
  const { patch } = useFilters();
  const tone =
    alert.severity === "critical"
      ? { badge: "critical" as const, icon: "▼", bar: "var(--q-crit)" }
      : alert.severity === "warning"
        ? { badge: "serious" as const, icon: "▽", bar: "var(--q-low)" }
        : { badge: "info" as const, icon: "●", bar: "var(--q-mid)" };

  return (
    <Link
      href={alert.href}
      onClick={() => {
        if (alert.apply) patch(alert.apply);
      }}
      className="panel panel-interactive group relative flex flex-col overflow-hidden p-4 pt-[18px]"
    >
      <span aria-hidden className="accent-bar" style={{ background: tone.bar }} />
      <div className="flex items-start justify-between gap-2">
        <Badge tone={tone.badge} size="md">
          <span aria-hidden>{tone.icon}</span>
          {alert.severity === "critical" ? "Critical" : alert.severity === "warning" ? "Watch" : "Insight"}
        </Badge>
        <ArrowRight className="size-3.5 shrink-0 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <h3 className="mt-2 text-body font-bold leading-snug text-ink">{alert.title}</h3>
      <p className="mt-1 flex-1 text-label leading-[1.55] text-ink-3">{alert.detail}</p>
      <p className="mt-2.5 text-meta font-bold tabular-nums text-ink-2">{alert.value}</p>
    </Link>
  );
}

function QuickLink({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}) {
  return (
    <Link href={href} className="panel panel-interactive group flex flex-col p-4">
      <span
        aria-hidden
        className="mb-2.5 grid size-8 place-items-center rounded-[9px] bg-g6 text-g1"
      >
        <Icon className="size-4" />
      </span>
      <h3 className="flex items-center gap-1 text-body font-bold text-ink">
        {title}
        <ArrowRight className="size-3 text-ink-4 opacity-0 transition-opacity group-hover:opacity-100" />
      </h3>
      <p className="mt-1 text-label leading-[1.55] text-ink-3">{body}</p>
    </Link>
  );
}

export { cn, fmtCompact };
