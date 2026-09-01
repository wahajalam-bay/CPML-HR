"use client";

import * as React from "react";
import Link from "next/link";
import { Activity, GitBranch, Radar, ShieldAlert, Users } from "lucide-react";
import { cn, fmtDays, fmtInt, fmtPct } from "@/lib/utils";
import { PageHeader, Section, SectionHead } from "@/components/layout/page-header";
import { Panel, Badge, BandBadge, EmptyState } from "@/components/ui/primitives";
import { ChartFrame, bandOf, ordinalColor, type Band } from "@/components/charts/chart-kit";
import { Heatmap } from "@/components/charts/heatmap";
import {
  useBaselineMetrics,
  useDimensionMetrics,
  useFunnel,
  useSelection,
} from "@/lib/hooks/use-analytics";
import { useStore } from "@/lib/providers/store-provider";
import { useFilters } from "@/lib/providers/filter-provider";
import { computeMetrics, healthScore, type Metrics } from "@/lib/data/metrics";
import type { DictField, RecruitmentStore, Selection } from "@/lib/data/schema";

/** Each scorecard family and the dimension it groups by. */
const FAMILIES: {
  field: DictField;
  title: string;
  entity: string;
  min: number;
  href?: string;
  /** Stated limitation of scoring this family, shown beside the section. */
  caveat?: string;
}[] = [
  { field: "recruiter", title: "Recruiter health", entity: "Recruiter", min: 40, href: "/recruiters" },
  { field: "source", title: "Source health", entity: "Source", min: 40, href: "/sources" },
  { field: "hiring_manager", title: "Interviewer health", entity: "Hiring manager", min: 20, href: "/interviewers", caveat: "A hiring manager only ever meets candidates the recruiting team has already screened, assessed and pitched. Their upstream rates are therefore near-perfect by construction — read the Select column, not the composite score." },
  { field: "applied_role", title: "Role health", entity: "Role", min: 20, href: "/roles" },
];

const RATE_MEASURES: { key: string; get: (m: Metrics) => number | null }[] = [
  { key: "Contact", get: (m) => (m.applications ? (m.phoneScreened / m.applications) * 100 : null) },
  { key: "Qualify", get: (m) => m.phoneQualifyRate },
  { key: "Pitch", get: (m) => m.pitchPassRate },
  { key: "Select", get: (m) => m.managerSelectRate },
  { key: "Accept", get: (m) => m.offerAcceptRate },
  { key: "Join", get: (m) => m.joinRate },
];

export function HealthScorecards() {
  const store = useStore();
  const { drillTo, patch } = useFilters();
  const rows = useSelection();
  const baseline = useBaselineMetrics();
  const funnel = useFunnel(rows);
  const overall = React.useMemo(() => computeMetrics(store, rows), [store, rows]);

  if (!rows.length) {
    return (
      <>
        <PageHeader title="Recruitment Health" />
        <Panel>
          <EmptyState title="No applications in scope" description="Adjust the filters above." />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Recruitment Health"
        description="Scorecards for every part of the operation, each measured against CPML's own all-time baseline rather than an invented target."
        breadcrumb={[{ label: "Command Center", href: "/" }, { label: "Recruitment Health" }]}
        actions={
          <Badge tone="outline" size="md">
            Baseline {fmtPct(baseline.overallConversion, 2)} app → hire across{" "}
            {fmtInt(baseline.applications)} records
          </Badge>
        }
      />

      {/* ================= Stage health ================= */}
      <Section>
        <SectionHead
          icon={GitBranch}
          title="Stage health"
          description="Each gate's throughput and wait time. A stage that is both slow and highly selective is where the pipeline is being throttled."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {funnel.slice(0, -1).map((stage, i) => {
            const carry = stage.stepConversion;
            const band: Band | null =
              carry == null
                ? null
                : carry >= 90 ? "top"
                  : carry >= 70 ? "good"
                    : carry >= 45 ? "mid"
                      : carry >= 30 ? "low"
                        : "critical";
            const lost = stage.entered - (funnel[i + 1]?.entered ?? stage.entered);
            return (
              <Panel key={stage.key} className="relative overflow-hidden p-4 pt-[18px]">
                <span
                  aria-hidden
                  className="accent-bar"
                  style={{ background: ordinalColor(i, funnel.length) }}
                />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="eyebrow">Stage {i + 1}</p>
                    <h3 className="truncate text-body font-bold text-ink">{stage.label}</h3>
                  </div>
                  <BandBadge band={band} showLabel={false} />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Cell label="Entered" value={fmtInt(stage.entered)} />
                  <Cell label="Carried on" value={fmtPct(carry, 1)} emphasis />
                  <Cell
                    label="Median wait"
                    value={stage.medianDays != null ? fmtDays(stage.medianDays, 1) : "—"}
                  />
                </div>

                <div className="mt-3">
                  <div className="flex h-2 overflow-hidden rounded-full bg-surface-3">
                    <span
                      className="transition-[width] duration-700"
                      style={{
                        width: `${Math.min(100, carry ?? 0)}%`,
                        background: ordinalColor(i, funnel.length),
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-micro leading-4 text-ink-4">
                    {fmtInt(lost)} candidates do not appear at the next stage.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => patch({ stageAtLeast: stage.index })}
                  className="mt-3 w-full rounded-[var(--r-xs)] border border-line py-1.5 text-label font-semibold text-g1 transition-colors hover:bg-g6"
                >
                  Inspect this stage
                </button>
              </Panel>
            );
          })}
        </div>
      </Section>

      {/* ================= Scorecard families ================= */}
      {FAMILIES.map((family) => (
        <ScorecardFamily
          key={family.field}
          family={family}
          rows={rows}
          baseline={baseline}
          onDrill={drillTo}
        />
      ))}

      {/* ================= Risk register ================= */}
      <Section>
        <SectionHead
          icon={ShieldAlert}
          title="Risk register"
          description="Concentration, dependency and data-quality risks visible in the current scope."
        />
        <RiskRegister store={store} rows={rows} metrics={overall} />
      </Section>
    </>
  );
}

/* =========================================================================
 * A scorecard family
 * ========================================================================= */

function ScorecardFamily({
  family,
  rows,
  baseline,
  onDrill,
}: {
  family: (typeof FAMILIES)[number];
  rows: Selection;
  baseline: Metrics;
  onDrill: (field: DictField, value: string) => void;
}) {
  const groups = useDimensionMetrics(rows, family.field, family.min);

  const scored = React.useMemo(
    () =>
      groups
        .map((g) => ({ group: g, health: healthScore(g.metrics, baseline) }))
        .sort((a, b) => b.health.score - a.health.score),
    [groups, baseline],
  );

  const quartiles = React.useMemo(() => {
    const values = scored.map((s) => s.health.score).sort((a, b) => a - b);
    if (!values.length) return null;
    const q = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))];
    return { q1: q(0.25), median: q(0.5), q3: q(0.75) };
  }, [scored]);

  const visible = React.useMemo(() => scored.slice(0, 12), [scored]);

  const heatCells = React.useMemo(() => {
    const cells: { row: string; col: string; value: number }[] = [];
    for (const s of visible) {
      for (const measure of RATE_MEASURES) {
        cells.push({
          row: s.group.key,
          col: measure.key,
          value: measure.get(s.group.metrics) ?? 0,
        });
      }
    }
    return cells;
  }, [visible]);

  if (!scored.length) return null;

  const FamilyIcon =
    family.field === "recruiter" ? Users : family.field === "source" ? Activity : Radar;

  return (
    <Section>
      <SectionHead
        icon={FamilyIcon}
        title={family.title}
        description={`${fmtInt(scored.length)} ${family.entity.toLowerCase()}s with at least ${family.min} applications. Bands compare each against the others on this list, not against an absolute standard.`}
        actions={
          family.href ? (
            <Link
              href={family.href}
              className="rounded-[5px] px-1.5 py-0.5 text-meta font-semibold text-g1 transition-colors hover:bg-g6"
            >
              Full analysis →
            </Link>
          ) : null
        }
      />

      {family.caveat ? (
        <p className="mb-3 rounded-[var(--r-xs)] border border-line bg-surface-2 px-3 py-2 text-label leading-[1.6] text-ink-3">
          {family.caveat}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:col-span-3">
          {scored.slice(0, 6).map((s) => {
            const band = quartiles ? bandOf(s.health.score, quartiles, "higher-better") : null;
            const color = band
              ? `var(--q-${band === "critical" ? "crit" : band})`
              : "var(--g3)";
            return (
              <button
                key={s.group.key}
                type="button"
                onClick={() => onDrill(family.field, s.group.key)}
                className="panel panel-interactive relative flex flex-col overflow-hidden p-3.5 pt-[17px] text-left"
              >
                <span aria-hidden className="accent-bar" style={{ background: color }} />
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-meta font-bold text-ink">
                    {s.group.key}
                  </p>
                  <BandBadge band={band} showLabel={false} />
                </div>
                <p className="mt-1.5 text-figure font-extrabold leading-none tabular-nums text-ink">
                  {s.health.score}
                </p>
                <p className="mt-1 text-micro text-ink-4">
                  {fmtInt(s.group.metrics.applications)} apps ·{" "}
                  {fmtInt(s.group.metrics.hired)} hires ·{" "}
                  {fmtPct(s.group.metrics.overallConversion, 2)}
                </p>
                <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className="transition-[width] duration-700"
                    style={{ width: `${Math.min(100, s.health.score)}%`, background: color }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        <ChartFrame
          title="Rate matrix"
          description="Every conversion gate side by side. A dark row is strong throughout; one pale cell in an otherwise dark row is a specific, fixable weakness."
          className="xl:col-span-2"
          tableView={{
            columns: [family.entity, ...RATE_MEASURES.map((m) => m.key)],
            rows: visible.map((s) => [
              s.group.key,
              ...RATE_MEASURES.map((m) => fmtPct(m.get(s.group.metrics), 0)),
            ]),
          }}
        >
          <div className="p-3">
            <Heatmap
              cells={heatCells}
              rows={visible.map((s) => s.group.key)}
              cols={RATE_MEASURES.map((m) => m.key)}
              valueFormat={(v) => v.toFixed(0)}
              legendLabel="Pass rate %"
              rowLabelWidth={112}
              height={392}
              onCellClick={(c) => onDrill(family.field, c.row)}
            />
          </div>
        </ChartFrame>
      </div>
    </Section>
  );
}

/* =========================================================================
 * Risk register
 * ========================================================================= */

interface Risk {
  id: string;
  title: string;
  detail: string;
  value: string;
  band: Band;
}

function RiskRegister({
  store,
  rows,
  metrics,
}: {
  store: RecruitmentStore;
  rows: Selection;
  metrics: Metrics;
}) {
  const risks = React.useMemo(() => {
    const out: Risk[] = [];

    const sources = concentrationOf(store, rows, "source");
    if (sources && sources.share > 60) {
      out.push({
        id: "source-concentration",
        title: `${sources.share.toFixed(0)}% of intake comes from ${sources.key}`,
        detail:
          "A single channel supplying most of the funnel is a single point of failure. A policy change, price rise or algorithm shift there would hit hiring immediately, with no bench to fall back on.",
        value: `${fmtInt(sources.count)} applications`,
        band: sources.share > 75 ? "critical" : "low",
      });
    }

    const recruiters = concentrationOf(store, rows, "recruiter");
    if (recruiters && recruiters.share > 20) {
      out.push({
        id: "recruiter-concentration",
        title: `${recruiters.key} carries ${recruiters.share.toFixed(0)}% of the pipeline`,
        detail:
          "Key-person dependency. If this recruiter is unavailable, that share of the pipeline stops moving and the candidates in it begin ageing the same week.",
        value: `${fmtInt(recruiters.count)} applications`,
        band: recruiters.share > 30 ? "low" : "mid",
      });
    }

    if (metrics.lapseRate != null && metrics.lapseRate > 30) {
      out.push({
        id: "recording",
        title: `${fmtPct(metrics.lapseRate, 0)} of applications end with no recorded outcome`,
        detail:
          "These candidates were sourced, screened and usually called, then stopped being worked with no reason captured. The cost is already spent — only the learning is missing, and that is the cheapest thing here to recover.",
        value: `${fmtInt(metrics.lapsed)} applications`,
        band: metrics.lapseRate > 45 ? "critical" : "low",
      });
    }

    if (metrics.droppedOff > 0) {
      out.push({
        id: "no-show",
        title: `${fmtInt(metrics.droppedOff)} candidates accepted an offer and never started`,
        detail:
          "The most expensive failure in the funnel: full sourcing, screening, assessment and interview cost incurred, a headcount gap left open, and a training cohort planned around someone who did not arrive.",
        value: `${fmtPct(metrics.noShowRate, 1)} of accepted offers`,
        band: (metrics.noShowRate ?? 0) > 10 ? "critical" : "low",
      });
    }

    if (metrics.hired > 0 && metrics.inProcess < metrics.hired * 2) {
      out.push({
        id: "thin-pipeline",
        title: "Live pipeline is thin against the recent hiring rate",
        detail:
          "Only a small multiple of recent hires is currently live and progressing. Without fresh intake, hiring output falls within one cycle — and sourcing lead time is longer than that.",
        value: `${fmtInt(metrics.inProcess)} live vs ${fmtInt(metrics.hired)} hires`,
        band: "mid",
      });
    }

    const repeatRate = metrics.applications
      ? (metrics.repeatApplications / metrics.applications) * 100
      : 0;
    if (repeatRate > 18) {
      out.push({
        id: "repeat-applicants",
        title: `${fmtPct(repeatRate, 0)} of applications are from people who already applied`,
        detail:
          "The same candidates are being re-sourced and re-screened. That is a sign the addressable market for this role in this city is close to saturated, and that fresh volume is getting harder to find.",
        value: `${fmtInt(metrics.repeatApplications)} re-applications`,
        band: repeatRate > 28 ? "low" : "mid",
      });
    }

    return out;
  }, [store, rows, metrics]);

  if (!risks.length) {
    return (
      <Panel>
        <EmptyState
          title="No structural risks flagged"
          description="Concentration, recording quality and offer conversion are all inside tolerance for the current scope."
          compact
        />
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {risks.map((risk) => (
        <Panel key={risk.id} className="relative overflow-hidden p-4 pt-[18px]">
          <span
            aria-hidden
            className="accent-bar"
            style={{ background: `var(--q-${risk.band === "critical" ? "crit" : risk.band})` }}
          />
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-body font-bold leading-snug text-ink">{risk.title}</h3>
            <BandBadge band={risk.band} />
          </div>
          <p className="mt-1.5 text-label leading-[1.6] text-ink-3">{risk.detail}</p>
          <p className="mt-2.5 text-meta font-bold tabular-nums text-ink-2">{risk.value}</p>
        </Panel>
      ))}
    </div>
  );
}

/** Largest single value of a dimension and the share of the selection it holds. */
function concentrationOf(
  store: RecruitmentStore,
  rows: Selection,
  field: DictField,
): { key: string; count: number; share: number } | null {
  const col = store.cols[field];
  const dict = store.dicts[field] ?? [];
  if (!dict.length) return null;

  const counts = new Int32Array(dict.length);
  let known = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = col[rows[i]];
    if (v >= 0) {
      counts[v]++;
      known++;
    }
  }
  if (!known) return null;

  let bestIdx = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[bestIdx]) bestIdx = i;
  return {
    key: dict[bestIdx],
    count: counts[bestIdx],
    share: (counts[bestIdx] / known) * 100,
  };
}

function Cell({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "tabular-nums",
          emphasis ? "text-lead font-extrabold text-ink" : "text-meta font-semibold text-ink-2",
        )}
      >
        {value}
      </p>
    </div>
  );
}
