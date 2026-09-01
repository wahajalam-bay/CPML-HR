"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarRange,
  GitBranch,
  Target,
  TrendingDown,
  UserCog,
} from "lucide-react";
import {
  cn,
  fmtDay,
  fmtInt,
  fmtMonthKeyShort,
  fmtPct,
  fmtYears,
  initials,
} from "@/lib/utils";
import { PageHeader, Section, SectionHead } from "@/components/layout/page-header";
import {
  Panel,
  PanelHeader,
  Badge,
  BandBadge,
  EmptyState,
} from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { MetricCard, StatRow } from "@/components/metrics/metric-card";
import { ChartFrame, bandOf, ordinalColor } from "@/components/charts/chart-kit";
import { ColumnChart, RankedBars, TimeSeries } from "@/components/charts/charts";
import { PipelineFunnel, StageLedger } from "@/components/charts/funnel";
import { CalendarHeatmap } from "@/components/charts/heatmap";
import {
  useDimensionMetrics,
  useEntitySelection,
  useFunnel,
  useSelection,
} from "@/lib/hooks/use-analytics";
import { useStore } from "@/lib/providers/store-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import {
  computeMetrics,
  groupMetrics,
  healthScore,
  METRIC_BY_ID,
} from "@/lib/data/metrics";
import {
  EXPERIENCE_SCALE,
  SALARY_SCALE,
  groupByDim,
  statsOf,
  timeSeries,
} from "@/lib/data/query";
import { useBaselineMetrics } from "@/lib/hooks/use-analytics";
import { ProtectedValue } from "@/components/auth/guards";

export function RecruiterProfile({ name }: { name: string }) {
  const store = useStore();
  const { drillTo, patch } = useFilters();
  const rows = useEntitySelection("recruiter", name);
  const allRows = useSelection();
  const funnel = useFunnel(rows);
  const baseline = useBaselineMetrics();

  const metrics = React.useMemo(() => computeMetrics(store, rows), [store, rows]);
  const health = React.useMemo(
    () => healthScore(metrics, baseline),
    [metrics, baseline],
  );

  /* --- Peer comparison -------------------------------------------------- */

  const peers = useDimensionMetrics(allRows, "recruiter", 25);
  const peerStats = React.useMemo(() => {
    const values = peers
      .map((p) => p.metrics.overallConversion)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    if (!values.length) return null;
    const q = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))];
    return { q1: q(0.25), median: q(0.5), q3: q(0.75) };
  }, [peers]);

  const rank = React.useMemo(() => {
    const ordered = [...peers].sort((a, b) => b.metrics.hired - a.metrics.hired);
    const idx = ordered.findIndex((p) => p.key === name);
    return idx >= 0 ? { position: idx + 1, total: ordered.length } : null;
  }, [peers, name]);

  const band = peerStats
    ? bandOf(metrics.overallConversion, peerStats, "higher-better")
    : null;

  /* --- Activity --------------------------------------------------------- */

  const monthly = React.useMemo(
    () => timeSeries(store, rows, "applied_date", "month"),
    [store, rows],
  );

  const activity = React.useMemo(
    () =>
      monthly.map((p) => {
        const m = computeMetrics(store, p.rows);
        return {
          label: fmtMonthKeyShort(p.key),
          day: p.day,
          applications: m.applications,
          contacted: m.phoneScreened,
          pitched: m.pitched,
          hires: m.hired,
        };
      }),
    [monthly, store],
  );

  const dailyCalls = React.useMemo(() => {
    const col = store.cols.call_date;
    const map = new Map<number, number>();
    for (let i = 0; i < rows.length; i++) {
      const d = col[rows[i]];
      if (d < 0) continue;
      map.set(d, (map.get(d) ?? 0) + 1);
    }
    return map;
  }, [rows, store]);

  /* --- Mix -------------------------------------------------------------- */

  const sourceMix = React.useMemo(
    () =>
      groupByDim(store, rows, "source", { topN: 6 }).map((b) => ({
        label: b.key,
        value: b.count,
        columns: [fmtPct((b.count / rows.length) * 100, 1)],
        onClick: () => drillTo("source", b.key),
      })),
    [store, rows, drillTo],
  );

  const lossMix = React.useMemo(() => {
    const groups = groupMetrics(store, rows, "loss_reason", { minApplications: 1 })
      .filter((g) => g.key !== "Went Cold")
      .sort((a, b) => b.metrics.applications - a.metrics.applications)
      .slice(0, 8);
    return groups.map((g) => ({
      label: g.key,
      value: g.metrics.applications,
      onClick: () => drillTo("loss_reason", g.key),
    }));
  }, [store, rows, drillTo]);

  const roleMix = React.useMemo(
    () =>
      groupByDim(store, rows, "applied_role", { topN: 5 }).map((b) => ({
        label: b.key,
        value: b.count,
      })),
    [store, rows],
  );

  /* --- Candidate profile ------------------------------------------------ */

  const experience = React.useMemo(
    () => statsOf(store, rows, "experience_years", EXPERIENCE_SCALE),
    [store, rows],
  );
  const salary = React.useMemo(
    () => statsOf(store, rows, "current_salary", SALARY_SCALE),
    [store, rows],
  );

  const firstSeen = React.useMemo(() => {
    const col = store.cols.applied_date;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < rows.length; i++) {
      const d = col[rows[i]];
      if (d < 0) continue;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    return Number.isFinite(min) ? { min, max } : null;
  }, [rows, store]);

  const known = store.dicts.recruiter?.includes(name);

  if (!known) {
    return (
      <>
        <PageHeader
          title="Recruiter not found"
          breadcrumb={[
            { label: "Command Center", href: "/" },
            { label: "Recruiters", href: "/recruiters" },
            { label: name },
          ]}
        />
        <Panel>
          <EmptyState
            icon={<UserCog />}
            title={`No recruiter named “${name}”`}
            description="The name may have changed in the source sheet, or the record may sit under a different spelling."
            action={
              <Button variant="primary" size="md" asChild>
                <Link href="/recruiters">Back to all recruiters</Link>
              </Button>
            }
          />
        </Panel>
      </>
    );
  }

  if (!rows.length) {
    return (
      <>
        <PageHeader
          title={name}
          breadcrumb={[
            { label: "Command Center", href: "/" },
            { label: "Recruiters", href: "/recruiters" },
            { label: name },
          ]}
        />
        <Panel>
          <EmptyState
            title="No applications in the current date range"
            description="This recruiter has records in the dataset, but none inside the filters you have applied."
          />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={name}
        description={
          firstSeen
            ? `Active ${fmtDay(firstSeen.min)} → ${fmtDay(firstSeen.max)} · ${fmtInt(rows.length)} applications handled`
            : `${fmtInt(rows.length)} applications handled`
        }
        breadcrumb={[
          { label: "Command Center", href: "/" },
          { label: "Recruiters", href: "/recruiters" },
          { label: name },
        ]}
        actions={
          <>
            {band ? <BandBadge band={band} size="md" /> : null}
            {rank ? (
              <Badge tone="outline" size="md">
                #{rank.position} of {rank.total} by hires
              </Badge>
            ) : null}
            <Button variant="default" size="sm" onClick={() => drillTo("recruiter", name)}>
              Filter platform to {name.split(" ")[0]}
              <ArrowRight />
            </Button>
          </>
        }
      />

      {/* ================= Identity + headline ================= */}
      <Section>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
          <Panel className="flex flex-col overflow-hidden xl:col-span-1">
            <div
              className="flex items-center gap-3 p-4"
              style={{ background: "var(--grad-hero)" }}
            >
              <span
                aria-hidden
                className="grid size-12 shrink-0 place-items-center rounded-[14px] border border-white/35 text-[16px] font-extrabold text-white"
                style={{ background: "linear-gradient(135deg,#27a96d,#0a5c3d)" }}
              >
                {initials(name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-lead font-extrabold text-white">{name}</p>
                <p className="text-label font-semibold uppercase tracking-[0.6px] text-white/70">
                  Talent Acquisition
                </p>
              </div>
            </div>
            <div className="flex flex-col px-4 py-2">
              <StatRow label="Applications" value={fmtInt(metrics.applications)} />
              <StatRow label="Unique candidates" value={fmtInt(metrics.candidates)} />
              <StatRow
                label="Contacted"
                value={`${fmtInt(metrics.phoneScreened)} (${fmtPct((metrics.phoneScreened / metrics.applications) * 100, 0)})`}
              />
              <StatRow label="Sales pitches" value={fmtInt(metrics.pitched)} />
              <StatRow label="Interviews" value={fmtInt(metrics.totalInterviews)} />
              <StatRow label="Offers" value={fmtInt(metrics.offers)} />
              <StatRow label="Hires" value={fmtInt(metrics.hired)} />
              <StatRow
                label="Live pipeline"
                value={fmtInt(metrics.inProcess)}
                hint="Applications with recent activity that are still progressing."
              />
              <StatRow
                label="Gone cold"
                value={fmtInt(metrics.lapsed)}
                hint="No recorded activity for 45+ days while short of an offer."
              />
              <StatRow
                label="Median candidate experience"
                value={experience.median != null ? fmtYears(experience.median) : "—"}
              />
              <StatRow
                label="Median prior salary"
                value={
                  <ProtectedValue field="salary">
                    {salary.median != null ? `PKR ${fmtInt(salary.median)}` : "—"}
                  </ProtectedValue>
                }
              />
            </div>
          </Panel>

          <div className="grid grid-cols-2 gap-3 xl:col-span-3 xl:grid-cols-3">
            <MetricCard
              label="App → Hire"
              value={metrics.overallConversion}
              format="pct"
              polarity="higher-better"
              target={peerStats?.median}
              accent="var(--q-top)"
              definition={METRIC_BY_ID.overallConversion.definition}
              footnote={
                peerStats
                  ? `Team median ${fmtPct(peerStats.median, 2)} · top quartile ${fmtPct(peerStats.q3, 2)}`
                  : undefined
              }
            />
            <MetricCard
              label="Phone qualify"
              value={metrics.phoneQualifyRate}
              format="pct"
              polarity="higher-better"
              target={METRIC_BY_ID.phoneQualifyRate.target}
              accent="var(--g2)"
              definition={METRIC_BY_ID.phoneQualifyRate.definition}
            />
            <MetricCard
              label="Pitch pass"
              value={metrics.pitchPassRate}
              format="pct"
              polarity="higher-better"
              target={METRIC_BY_ID.pitchPassRate.target}
              accent="var(--series-2)"
              definition={METRIC_BY_ID.pitchPassRate.definition}
            />
            <MetricCard
              label="Time to first contact"
              value={metrics.timeToFirstContact.median}
              format="days"
              polarity="lower-better"
              target={METRIC_BY_ID.timeToFirstContact.target}
              accent="var(--series-3)"
              definition={METRIC_BY_ID.timeToFirstContact.definition}
            />
            <MetricCard
              label="Time to hire"
              value={metrics.timeToHire.median}
              format="days"
              polarity="lower-better"
              target={METRIC_BY_ID.timeToHire.target}
              accent="var(--series-5)"
              definition={METRIC_BY_ID.timeToHire.definition}
            />
            <MetricCard
              label="Applications per hire"
              value={metrics.applicationsPerHire}
              format="ratio"
              polarity="lower-better"
              target={METRIC_BY_ID.applicationsPerHire.target}
              accent="var(--series-4)"
              definition={METRIC_BY_ID.applicationsPerHire.definition}
            />

            <Panel className="col-span-2 overflow-hidden xl:col-span-3">
              <PanelHeader
                title="Health contribution"
                description={`Composite score ${health.score}/100 against CPML's own all-time baseline.`}
                actions={<Badge tone="outline" size="md">{health.band}</Badge>}
              />
              <div className="grid grid-cols-1 gap-x-6 px-4 py-2 sm:grid-cols-2 lg:grid-cols-3">
                {health.contributions.map((c) => {
                  const share = c.weight ? (c.scaled / c.weight) * 100 : 0;
                  return (
                    <div key={c.label} className="flex items-center gap-2 py-1.5">
                      <span className="w-[46%] shrink-0 truncate text-label text-ink-3">
                        {c.label}
                      </span>
                      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700"
                          style={{
                            width: `${Math.min(100, share)}%`,
                            background:
                              share >= 62 ? "var(--q-good)" : share >= 45 ? "var(--q-mid)" : "var(--q-low)",
                          }}
                        />
                      </span>
                      <span className="w-8 shrink-0 text-right text-label font-bold tabular-nums text-ink">
                        {share.toFixed(0)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>
        </div>
      </Section>

      {/* ================= Funnel ================= */}
      <Section>
        <SectionHead
          icon={GitBranch}
          title="Personal funnel"
          description="How this recruiter's own pipeline converts, stage by stage."
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <ChartFrame
            title="Candidate flow"
            className="xl:col-span-1"
            tableView={{
              columns: ["Stage", "Entered", "Cleared"],
              rows: funnel.map((s) => [s.label, s.entered, s.cleared]),
            }}
          >
            <div className="p-3">
              <PipelineFunnel stages={funnel} height={280} />
            </div>
          </ChartFrame>

          <Panel className="overflow-hidden xl:col-span-2">
            <PanelHeader
              title="Stage ledger"
              description="Median wait is measured from entering the previous stage."
            />
            <StageLedger stages={funnel} />
          </Panel>
        </div>
      </Section>

      {/* ================= Activity ================= */}
      <Section>
        <SectionHead
          icon={CalendarRange}
          title="Activity"
          description="Volume handled per month, and the daily call pattern behind it."
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ChartFrame
            title="Monthly workload"
            description="Applications, calls made and pitches arranged."
            legend={[
              { label: "Applications", color: "var(--series-1)" },
              { label: "Contacted", color: "var(--series-2)" },
              { label: "Pitches", color: "var(--series-3)" },
            ]}
            tableView={{
              columns: ["Month", "Applications", "Contacted", "Pitches", "Hires"],
              rows: activity.map((a) => [a.label, a.applications, a.contacted, a.pitched, a.hires]),
            }}
          >
            <div className="p-2">
              <TimeSeries
                data={activity}
                series={[
                  { key: "applications", label: "Applications" },
                  { key: "contacted", label: "Contacted" },
                  { key: "pitched", label: "Pitches" },
                ]}
                height={250}
                onPointClick={(d) => {
                  const point = activity.find((a) => a.label === d.label);
                  if (point) patch({ from: point.day, to: point.day + 30 });
                }}
              />
            </div>
          </ChartFrame>

          <ChartFrame
            title="Hires by month"
            description="Shown apart from workload — hires and applications differ by two orders of magnitude and share no useful axis."
            tableView={{
              columns: ["Month", "Hires"],
              rows: activity.map((a) => [a.label, a.hires]),
            }}
          >
            <div className="p-2">
              <ColumnChart
                data={activity}
                valueKey="hires"
                height={250}
                showLabels={activity.length <= 18}
              />
            </div>
          </ChartFrame>
        </div>

        <Panel className="mt-3 overflow-hidden">
          <PanelHeader
            title="Daily call pattern"
            description="Every day this recruiter made contact. Gaps are leave, weekends or reassignment."
          />
          <div className="p-4">
            {firstSeen ? (
              <CalendarHeatmap
                values={dailyCalls}
                from={firstSeen.min}
                to={firstSeen.max}
                label="calls"
              />
            ) : null}
          </div>
        </Panel>
      </Section>

      {/* ================= Mix ================= */}
      <Section>
        <SectionHead
          icon={Target}
          title="What they work with"
          description="The channels, roles and rejection reasons that make up this recruiter's book."
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <ChartFrame
            title="Source mix"
            tableView={{
              columns: ["Source", "Applications", "Share"],
              rows: sourceMix.map((s) => [s.label, s.value, String(s.columns?.[0] ?? "")]),
            }}
          >
            <RankedBars items={sourceMix} format={fmtInt} columnHeaders={["Apps", "Share"]} />
          </ChartFrame>

          <ChartFrame
            title="Roles recruited for"
            tableView={{
              columns: ["Role", "Applications"],
              rows: roleMix.map((r) => [r.label, r.value]),
            }}
          >
            <RankedBars items={roleMix} format={fmtInt} tone="var(--series-2)" />
          </ChartFrame>

          <ChartFrame
            title="Recorded rejection reasons"
            description="Excludes candidates who simply went cold."
            actions={
              <Button variant="ghost" size="xs" asChild>
                <Link href="/attrition">
                  <TrendingDown />
                  Loss analysis
                </Link>
              </Button>
            }
            tableView={{
              columns: ["Reason", "Candidates"],
              rows: lossMix.map((l) => [l.label, l.value]),
            }}
          >
            <RankedBars
              items={lossMix}
              format={fmtInt}
              tone="var(--q-low)"
              emptyLabel="No reasons recorded for this recruiter."
            />
          </ChartFrame>
        </div>
      </Section>

      {/* ================= Peer comparison ================= */}
      <Section>
        <SectionHead
          icon={UserCog}
          title="Against the team"
          description="Every recruiter meeting the volume threshold, ranked by hires. This recruiter is highlighted."
        />
        <ChartFrame
          title="Hires delivered"
          tableView={{
            columns: ["Recruiter", "Hires", "Applications", "Conversion"],
            rows: peers
              .slice()
              .sort((a, b) => b.metrics.hired - a.metrics.hired)
              .map((p) => [
                p.key,
                p.metrics.hired,
                p.metrics.applications,
                fmtPct(p.metrics.overallConversion, 2),
              ]),
          }}
        >
          <RankedBars
            format={fmtInt}
            columnHeaders={["Hires", "Apps", "Conv."]}
            items={peers
              .slice()
              .sort((a, b) => b.metrics.hired - a.metrics.hired)
              .map((p, i) => ({
                label: p.key,
                value: p.metrics.hired,
                color: p.key === name ? "var(--g1)" : ordinalColor(Math.min(i, 6), 7),
                columns: [
                  fmtInt(p.metrics.applications),
                  fmtPct(p.metrics.overallConversion, 2),
                ],
                href: `/recruiters/${encodeURIComponent(p.key)}`,
              }))}
          />
        </ChartFrame>
      </Section>
    </>
  );
}

export { cn };
