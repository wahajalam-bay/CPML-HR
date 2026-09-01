"use client";

import * as React from "react";
import { Banknote, Briefcase, GraduationCap, Users2 } from "lucide-react";
import { fmtInt, fmtPct, fmtSalary, fmtYears } from "@/lib/utils";
import { PageHeader, Section, SectionHead } from "@/components/layout/page-header";
import { Panel, EmptyState, CoverageNote, Segmented } from "@/components/ui/primitives";
import { MetricCard } from "@/components/metrics/metric-card";
import { ChartFrame, ordinalColor } from "@/components/charts/chart-kit";
import { ColumnChart, Histogram, QuadrantScatter, RankedBars } from "@/components/charts/charts";
import { MetricTable, type MetricColumn } from "@/components/table/metric-table";
import { useMetricsWithComparison, useSelection } from "@/lib/hooks/use-analytics";
import { useSession } from "@/lib/providers/session-provider";
import { Restricted } from "@/components/auth/guards";
import { useStore } from "@/lib/providers/store-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import { EXPERIENCE_SCALE, SALARY_SCALE, statsOf, valuesOf } from "@/lib/data/query";
import { coverage, groupMetrics, histogram, type GroupRow } from "@/lib/data/metrics";
import {
  DEGREE_ORDER,
  EXPERIENCE_BAND_ORDER,
  ORDINAL_DOMAINS,
  SALARY_BAND_ORDER,
  type DictField,
} from "@/lib/data/schema";

const PROFILE_DIMS: { field: DictField; label: string; min: number }[] = [
  { field: "industry", label: "Prior industry", min: 40 },
  { field: "institute", label: "Institute", min: 30 },
  { field: "degree", label: "Education", min: 1 },
  { field: "experience_band", label: "Experience", min: 1 },
  { field: "salary_band", label: "Salary expectation", min: 1 },
];

export function TalentInsights() {
  const store = useStore();
  const { drillTo } = useFilters();
  const rows = useSelection();
  const { current, previous, deltaOf } = useMetricsWithComparison();
  const [profileDim, setProfileDim] = React.useState<DictField>("industry");
  const { canSeeField } = useSession();
  const seeSalary = canSeeField("salary");

  /* --- Coverage --------------------------------------------------------- */

  const expCoverage = React.useMemo(
    () => coverage(store, rows, "experience_years"),
    [store, rows],
  );
  const salaryCoverage = React.useMemo(
    () => coverage(store, rows, "current_salary"),
    [store, rows],
  );

  /* --- Distributions ---------------------------------------------------- */

  const expValues = React.useMemo(
    () => valuesOf(store, rows, "experience_years", EXPERIENCE_SCALE).filter((v) => v <= 20),
    [store, rows],
  );
  const expBins = React.useMemo(
    () => histogram(expValues, 1, { unit: "y", max: 12 }),
    [expValues],
  );

  const salaryValues = React.useMemo(
    () =>
      valuesOf(store, rows, "current_salary", SALARY_SCALE).filter(
        (v) => v >= 10_000 && v <= 300_000,
      ),
    [store, rows],
  );
  const salaryBins = React.useMemo(
    () =>
      histogram(salaryValues, 20_000, { max: 300_000 }).map((b) => ({
        ...b,
        label: `${Math.round(b.from / 1000)}–${Math.round(b.to / 1000)}k`,
      })),
    [salaryValues],
  );

  /* --- Ordered band charts ---------------------------------------------- */

  const bandChart = React.useCallback(
    (field: DictField, order: string[]) => {
      const groups = groupMetrics(store, rows, field, { minApplications: 1 });
      const rank = new Map(order.map((k, i) => [k, i]));
      return groups
        .slice()
        .sort((a, b) => (rank.get(a.key) ?? 99) - (rank.get(b.key) ?? 99))
        .map((g) => ({
          label: g.key,
          value: g.metrics.applications,
          hires: g.metrics.hired,
          conversion: Number((g.metrics.overallConversion ?? 0).toFixed(2)),
        }));
    },
    [store, rows],
  );

  const experienceBands = React.useMemo(
    () => bandChart("experience_band", EXPERIENCE_BAND_ORDER),
    [bandChart],
  );
  const degreeBands = React.useMemo(() => bandChart("degree", DEGREE_ORDER), [bandChart]);
  const salaryBands = React.useMemo(
    () => bandChart("salary_band", SALARY_BAND_ORDER),
    [bandChart],
  );

  /* --- Profile leaderboard ---------------------------------------------- */

  const dimConfig = PROFILE_DIMS.find((d) => d.field === profileDim)!;
  const profileGroups = React.useMemo(
    () => groupMetrics(store, rows, profileDim, { minApplications: dimConfig.min }),
    [store, rows, profileDim, dimConfig.min],
  );

  const profileColumns = React.useMemo<MetricColumn<GroupRow>[]>(
    () => [
      { id: "key", header: dimConfig.label, value: (r) => r.key, align: "left", width: "24%" },
      { id: "apps", header: "Applications", value: (r) => r.metrics.applications, bar: true },
      { id: "pitched", header: "Pitches", value: (r) => r.metrics.pitched, hideBelow: "md" },
      {
        id: "pitchPass",
        header: "Pitch pass",
        help: "Share of sales pitches from this group marked SP+.",
        value: (r) => r.metrics.pitchPassRate,
        render: (r) => fmtPct(r.metrics.pitchPassRate, 1),
        band: "higher-better",
        hideBelow: "lg",
      },
      { id: "hired", header: "Hires", value: (r) => r.metrics.hired, bar: true },
      {
        id: "conversion",
        header: "App → Hire",
        help: "Share of this group's applications that became a hire.",
        value: (r) => r.metrics.overallConversion,
        render: (r) => fmtPct(r.metrics.overallConversion, 2),
        band: "higher-better",
      },
      {
        id: "experience",
        header: "Median exp.",
        value: (r) => r.metrics.experience.median,
        render: (r) =>
          r.metrics.experience.median != null ? fmtYears(r.metrics.experience.median) : "—",
        hideBelow: "xl",
      },
      // Compensation is only offered as a column to roles that may see it —
      // the alternative is a column of lock icons, which is noise.
      ...(seeSalary
        ? ([
            {
              id: "salary",
              header: "Median salary",
              help: "Median last-drawn salary among candidates in this group who disclosed one.",
              value: (r) => r.metrics.salary.median,
              render: (r) =>
                r.metrics.salary.median != null
                  ? fmtSalary(r.metrics.salary.median, true)
                  : "—",
              hideBelow: "xl",
            },
          ] as MetricColumn<GroupRow>[])
        : []),
    ],
    [dimConfig.label, seeSalary],
  );

  /* --- Quality vs volume scatter ---------------------------------------- */

  const scatter = React.useMemo(
    () =>
      profileGroups
        .filter((g) => g.metrics.overallConversion != null && g.metrics.applications >= dimConfig.min)
        .map((g) => ({
          label: g.key,
          x: g.metrics.applications,
          y: g.metrics.overallConversion ?? 0,
          size: Math.max(1, g.metrics.hired),
          meta: `${fmtInt(g.metrics.hired)} hires`,
        })),
    [profileGroups, dimConfig.min],
  );

  const medians = React.useMemo(() => {
    if (!scatter.length) return { x: undefined, y: undefined };
    const xs = scatter.map((p) => p.x).sort((a, b) => a - b);
    const ys = scatter.map((p) => p.y).sort((a, b) => a - b);
    return { x: xs[Math.floor(xs.length / 2)], y: ys[Math.floor(ys.length / 2)] };
  }, [scatter]);

  /* --- Salary of hires vs everyone -------------------------------------- */

  const hiredSalary = current.hiredSalary;
  const allSalary = current.salary;

  if (!rows.length) {
    return (
      <>
        <PageHeader title="Talent Insights" />
        <Panel>
          <EmptyState title="No applications in scope" description="Adjust the filters above." />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Talent Insights"
        description="The shape of the applicant pool — background, education, experience and pay expectation — measured against who actually converts."
        breadcrumb={[{ label: "Command Center", href: "/" }, { label: "Talent Insights" }]}
      />

      <Section>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="Unique candidates"
            value={current.candidates}
            format="int"
            delta={deltaOf((m) => m.candidates)}
            previous={previous?.candidates ?? null}
            accent="var(--g1)"
            definition="Distinct people behind the applications in scope, matched on phone number."
          />
          <MetricCard
            label="Re-applications"
            value={current.repeatApplications}
            format="int"
            polarity="neutral"
            accent="var(--g2)"
            definition="Applications from someone who had already applied before. A high rate means the market is small and being re-worked."
            footnote={`${fmtPct((current.repeatApplications / current.applications) * 100, 1)} of intake`}
          />
          <MetricCard
            label="Median experience"
            value={current.experience.median}
            format="years"
            accent="var(--series-2)"
            definition="Median prior experience across candidates who disclosed it."
            footnote={`${fmtPct(expCoverage.pct, 0)} of records disclose experience`}
          />
          <MetricCard
            label="Experience of hires"
            value={current.hiredExperience.median}
            format="years"
            accent="var(--q-top)"
            definition="Median prior experience among the candidates actually hired. Compare with the pool median to see whether CPML hires above or below its market."
          />
          {seeSalary ? (
            <MetricCard
              label="Median current salary"
              value={allSalary.median}
              format="salary"
              accent="var(--series-3)"
              definition="Median last-drawn salary across candidates who disclosed one."
              footnote={`${fmtPct(salaryCoverage.pct, 0)} of records disclose salary`}
            />
          ) : (
            <RestrictedCard label="Median current salary" />
          )}
          {seeSalary ? (
            <MetricCard
              label="Salary of hires"
              value={hiredSalary.median}
              format="salary"
              accent="var(--series-5)"
              definition="Median last-drawn salary of hired candidates. A gap against the pool median shows which end of the market converts."
              footnote={
                allSalary.median && hiredSalary.median
                  ? `${hiredSalary.median >= allSalary.median ? "Above" : "Below"} the pool median by ${fmtSalary(Math.abs(hiredSalary.median - allSalary.median), true)}`
                  : undefined
              }
            />
          ) : (
            <RestrictedCard label="Salary of hires" />
          )}
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={Users2}
          title="Who applies"
          description="Ordered bands take a single-hue ramp so the sequence reads in the colour, not just the axis."
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <ChartFrame
            title="Experience distribution"
            description="Applications by experience band"
            tableView={{
              columns: ["Band", "Applications", "Hires", "Conversion"],
              rows: experienceBands.map((b) => [b.label, b.value, b.hires, `${b.conversion}%`]),
            }}
            footnote={
              <CoverageNote
                known={expCoverage.known}
                total={expCoverage.total}
                what="experience"
              />
            }
          >
            <div className="p-2">
              <ColumnChart
                data={experienceBands}
                height={230}
                ordinal
                onBarClick={(d) => drillTo("experience_band", String(d.label))}
              />
            </div>
          </ChartFrame>

          <ChartFrame
            title="Education level"
            tableView={{
              columns: ["Level", "Applications", "Hires", "Conversion"],
              rows: degreeBands.map((b) => [b.label, b.value, b.hires, `${b.conversion}%`]),
            }}
          >
            <div className="p-2">
              <ColumnChart
                data={degreeBands}
                height={230}
                ordinal
                onBarClick={(d) => drillTo("degree", String(d.label))}
              />
            </div>
          </ChartFrame>

          <ChartFrame
            title="Current salary band"
            tableView={{
              columns: ["Band", "Applications", "Hires", "Conversion"],
              rows: salaryBands.map((b) => [b.label, b.value, b.hires, `${b.conversion}%`]),
            }}
            footnote={
              <CoverageNote
                known={salaryCoverage.known}
                total={salaryCoverage.total}
                what="a salary"
              />
            }
          >
            <div className="p-2">
              <ColumnChart
                data={salaryBands}
                height={230}
                ordinal
                onBarClick={(d) => drillTo("salary_band", String(d.label))}
              />
            </div>
          </ChartFrame>
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={Banknote}
          title="Distributions in detail"
          description="The band charts above bucket; these show the underlying shape."
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <ChartFrame
            title="Years of experience"
            description={`${fmtInt(expValues.length)} candidates who disclosed a figure`}
            tableView={{
              columns: ["Range", "Candidates"],
              rows: expBins.map((b) => [b.label, b.count]),
            }}
          >
            <div className="p-2">
              <Histogram
                bins={expBins}
                height={230}
                xLabel="Years of prior experience"
                median={current.experience.median ?? undefined}
              />
            </div>
          </ChartFrame>

          <ChartFrame
            title="Last drawn salary"
            description={`${fmtInt(salaryValues.length)} candidates who disclosed a figure`}
            tableView={{
              columns: ["Range", "Candidates"],
              rows: salaryBins.map((b) => [b.label, b.count]),
            }}
            footnote="Free-text salary entries were parsed from the source sheet: 'k' suffixes expanded, ranges taken at their midpoint, and figures outside PKR 10k–2M discarded as data-entry noise."
          >
            <div className="p-2">
              <Histogram
                bins={salaryBins}
                height={230}
                xLabel="Monthly salary (PKR)"
                median={allSalary.median ?? undefined}
              />
            </div>
          </ChartFrame>
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={Briefcase}
          title="What converts"
          description="Volume tells you where candidates come from; conversion tells you which of those sources are worth the effort."
          actions={
            <Segmented
              value={profileDim}
              onChange={setProfileDim}
              options={PROFILE_DIMS.map((d) => ({ value: d.field, label: d.label }))}
              aria-label="Profile dimension"
            />
          }
        />

        <div className="mb-3">
          <ChartFrame
            title={`${dimConfig.label} — volume against conversion`}
            description="Bubble size is hires. Dashed lines are medians; the top-right quadrant is where both volume and yield are above par."
            tableView={{
              columns: [dimConfig.label, "Applications", "App → Hire", "Hires"],
              rows: scatter.map((p) => [p.label, p.x, `${p.y.toFixed(2)}%`, p.size]),
            }}
          >
            <div className="p-2">
              <QuadrantScatter
                points={scatter}
                xLabel="Applications"
                yLabel="Application → hire %"
                yFormat={(v) => `${v.toFixed(1)}%`}
                xMedian={medians.x}
                yMedian={medians.y}
                height={330}
                onPointClick={(p) => drillTo(profileDim, p.label)}
                quadrantLabels={{
                  tl: "Niche · high yield",
                  tr: "Core · high yield",
                  bl: "Niche · low yield",
                  br: "Core · low yield",
                }}
              />
            </div>
          </ChartFrame>
        </div>

        <Panel className="overflow-hidden">
          <MetricTable
            rows={profileGroups}
            columns={profileColumns}
            rowKey={(r) => r.key}
            onRowClick={(r) => drillTo(profileDim, r.key)}
            defaultSort={{ id: "apps", dir: "desc" }}
            exportName={`cpml-talent-${profileDim}`}
            maxHeight={560}
            footer={`${fmtInt(profileGroups.length)} groups with at least ${dimConfig.min} applications`}
          />
        </Panel>
      </Section>

      <Section>
        <SectionHead
          icon={GraduationCap}
          title="Top feeders"
          description="The institutes and industries supplying the most candidates, and how well each converts."
        />
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <FeederPanel
            field="institute"
            title="Institutes"
            min={25}
            store={store}
            rows={rows}
            onDrill={drillTo}
          />
          <FeederPanel
            field="industry"
            title="Prior industries"
            min={30}
            store={store}
            rows={rows}
            onDrill={drillTo}
          />
        </div>
      </Section>
    </>
  );
}

function FeederPanel({
  field,
  title,
  min,
  store,
  rows,
  onDrill,
}: {
  field: DictField;
  title: string;
  min: number;
  store: ReturnType<typeof useStore>;
  rows: Uint32Array;
  onDrill: (field: DictField, value: string) => void;
}) {
  const groups = React.useMemo(
    () =>
      groupMetrics(store, rows, field, { minApplications: min })
        .sort((a, b) => b.metrics.applications - a.metrics.applications)
        .slice(0, 12),
    [store, rows, field, min],
  );

  return (
    <ChartFrame
      title={title}
      description={`Ranked by volume, showing hires and conversion. Minimum ${min} applications.`}
      tableView={{
        columns: [title, "Applications", "Hires", "Conversion"],
        rows: groups.map((g) => [
          g.key,
          g.metrics.applications,
          g.metrics.hired,
          fmtPct(g.metrics.overallConversion, 2),
        ]),
      }}
    >
      <RankedBars
        items={groups.map((g, i) => ({
          label: g.key,
          value: g.metrics.applications,
          color: ordinalColor(Math.min(i, 6), 7),
          columns: [
            fmtInt(g.metrics.hired),
            fmtPct(g.metrics.overallConversion, 2),
          ],
          onClick: () => onDrill(field, g.key),
        }))}
        format={fmtInt}
        columnHeaders={["Apps", "Hires", "Conv."]}
        labelWidth="34%"
      />
    </ChartFrame>
  );
}

export { ORDINAL_DOMAINS, statsOf };

/** KPI-card-shaped placeholder for a metric this role may not see. */
function RestrictedCard({ label }: { label: string }) {
  return (
    <div className="panel relative flex flex-col overflow-hidden p-4 pt-[18px]">
      <span aria-hidden className="accent-bar" style={{ background: "var(--line-2)" }} />
      <span className="eyebrow truncate">{label}</span>
      <div className="mt-3 flex flex-1 items-center">
        <Restricted field="salary" />
      </div>
    </div>
  );
}
