"use client";

import { fmtDay, fmtDays, fmtInt, fmtPct, fmtSalary, fmtYears } from "@/lib/utils";
import { buildFunnel, statsOf, timeSeries } from "@/lib/data/query";
import { computeMetrics, groupMetrics, type Metrics } from "@/lib/data/metrics";
import { STAGES, type DictField, type RecruitmentStore, type Selection } from "@/lib/data/schema";
import type { PdfSection, Sheet } from "@/lib/export/exporters";

/**
 * Report content builders.
 *
 * One builder per report produces both the PDF sections and the Excel sheets
 * from the same numbers, so a figure can never differ between the two formats
 * for the same scope.
 */

export interface ReportContext {
  store: RecruitmentStore;
  rows: Selection;
  metrics: Metrics;
  scope: string;
}

export interface ReportDefinition {
  id: string;
  title: string;
  /** What question this report answers, in one sentence. */
  purpose: string;
  audience: string;
  build: (ctx: ReportContext) => { pdf: PdfSection[]; excel: Sheet[] };
}

/* -------------------------------------------------------------------------
 * Shared fragments
 * ---------------------------------------------------------------------- */

function headlineFacts(m: Metrics): { label: string; value: string }[] {
  return [
    { label: "Applications received", value: fmtInt(m.applications) },
    { label: "Unique candidates", value: fmtInt(m.candidates) },
    { label: "Candidates contacted", value: fmtInt(m.phoneScreened) },
    { label: "Sales pitches conducted", value: fmtInt(m.pitched) },
    { label: "Interviews conducted", value: fmtInt(m.totalInterviews) },
    { label: "Offers placed", value: fmtInt(m.offers) },
    { label: "Offers accepted", value: `${fmtInt(m.offersAccepted)} (${fmtPct(m.offerAcceptRate, 1)})` },
    { label: "Candidates joined", value: fmtInt(m.hired) },
    { label: "Application to hire", value: fmtPct(m.overallConversion, 2) },
    { label: "Applications per hire", value: m.applicationsPerHire != null ? m.applicationsPerHire.toFixed(0) : "—" },
    { label: "Median time to hire", value: fmtDays(m.timeToHire.median, 1) },
    { label: "Median time to offer", value: fmtDays(m.timeToOffer.median, 1) },
    { label: "Offer no-shows", value: `${fmtInt(m.droppedOff)} (${fmtPct(m.noShowRate, 1)})` },
    { label: "Pipeline gone cold", value: `${fmtInt(m.lapsed)} (${fmtPct(m.lapseRate, 1)})` },
  ];
}

function funnelTable(store: RecruitmentStore, rows: Selection) {
  const stages = buildFunnel(store, rows);
  return {
    headers: ["Stage", "Entered", "Cleared", "Pass rate", "Carried to next", "Share of intake"],
    rows: stages.map((s) => [
      s.label,
      fmtInt(s.entered),
      fmtInt(s.cleared),
      s.passRate != null ? fmtPct(s.passRate, 1) : "—",
      s.stepConversion != null ? fmtPct(s.stepConversion, 1) : "—",
      fmtPct(s.cumulative, 1),
    ]),
  };
}

function dimensionTable(
  store: RecruitmentStore,
  rows: Selection,
  field: DictField,
  label: string,
  min: number,
) {
  const groups = groupMetrics(store, rows, field, { minApplications: min });
  return {
    headers: [label, "Applications", "Contacted", "Pitches", "Offers", "Hires", "App → Hire", "Time to hire"],
    rows: groups.map((g) => [
      g.key,
      fmtInt(g.metrics.applications),
      fmtInt(g.metrics.phoneScreened),
      fmtInt(g.metrics.pitched),
      fmtInt(g.metrics.offers),
      fmtInt(g.metrics.hired),
      fmtPct(g.metrics.overallConversion, 2),
      fmtDays(g.metrics.timeToHire.median, 1),
    ]),
    raw: groups,
  };
}

function monthlyTable(store: RecruitmentStore, rows: Selection) {
  const points = timeSeries(store, rows, "applied_date", "month");
  return {
    headers: ["Month", "Applications", "Contacted", "Pitches", "Offers", "Hires", "App → Hire"],
    rows: points.map((p) => {
      const m = computeMetrics(store, p.rows);
      return [
        p.key,
        fmtInt(m.applications),
        fmtInt(m.phoneScreened),
        fmtInt(m.pitched),
        fmtInt(m.offers),
        fmtInt(m.hired),
        fmtPct(m.overallConversion, 2),
      ];
    }),
  };
}

/* -------------------------------------------------------------------------
 * Report catalogue
 * ---------------------------------------------------------------------- */

export const REPORTS: ReportDefinition[] = [
  {
    id: "executive",
    title: "Executive Summary",
    purpose:
      "The state of the recruitment operation on one page — volume, conversion, velocity and the risks worth a leadership conversation.",
    audience: "CHRO · HR Director · Board",
    build: ({ store, rows, metrics, scope }) => {
      const funnel = funnelTable(store, rows);
      const months = monthlyTable(store, rows);
      const recruiters = dimensionTable(store, rows, "recruiter", "Recruiter", 40);
      const sources = dimensionTable(store, rows, "source", "Source", 20);

      const worst = buildFunnel(store, rows)
        .slice(0, -1)
        .filter((s) => s.stepConversion != null)
        .sort((a, b) => (a.stepConversion ?? 0) - (b.stepConversion ?? 0))[0];

      return {
        pdf: [
          {
            title: "Headline numbers",
            subtitle: scope,
            facts: headlineFacts(metrics),
          },
          {
            title: "Pipeline conversion",
            note: worst
              ? `The tightest gate in this period is ${worst.label}, carrying ${fmtPct(worst.stepConversion, 1)} of its candidates through to the next stage. Every point of improvement there is worth more than a point anywhere else in the funnel, because it compounds across every subsequent stage.`
              : undefined,
            ...funnel,
          },
          { title: "Month by month", ...months },
          { title: "Recruiter performance", ...recruiters },
          { title: "Source performance", ...sources },
        ],
        excel: [
          {
            name: "Summary",
            headers: ["Measure", "Value"],
            rows: headlineFacts(metrics).map((f) => [f.label, f.value]),
          },
          { name: "Funnel", headers: funnel.headers, rows: funnel.rows },
          { name: "Monthly", headers: months.headers, rows: months.rows },
          { name: "Recruiters", headers: recruiters.headers, rows: recruiters.rows },
          { name: "Sources", headers: sources.headers, rows: sources.rows },
        ],
      };
    },
  },

  {
    id: "recruiter",
    title: "Recruiter Performance",
    purpose:
      "Individual productivity and quality for every recruiter, with the conversion rates behind the headline numbers.",
    audience: "Recruitment Manager · HR Director",
    build: ({ store, rows, scope }) => {
      const groups = groupMetrics(store, rows, "recruiter", { minApplications: 1 });
      const detail = {
        headers: [
          "Recruiter", "Applications", "Contacted", "Contact rate", "Qualified",
          "Pitches", "Pitch pass", "Interviews", "Offers", "Accepted", "Hires",
          "App → Hire", "Apps per hire", "To first call", "Time to hire", "Gone cold",
        ],
        rows: groups.map((g) => {
          const m = g.metrics;
          return [
            g.key,
            fmtInt(m.applications),
            fmtInt(m.phoneScreened),
            fmtPct(m.applications ? (m.phoneScreened / m.applications) * 100 : null, 1),
            fmtInt(m.phoneQualified),
            fmtInt(m.pitched),
            fmtPct(m.pitchPassRate, 1),
            fmtInt(m.totalInterviews),
            fmtInt(m.offers),
            fmtInt(m.offersAccepted),
            fmtInt(m.hired),
            fmtPct(m.overallConversion, 2),
            m.applicationsPerHire != null ? m.applicationsPerHire.toFixed(0) : "—",
            fmtDays(m.timeToFirstContact.median, 1),
            fmtDays(m.timeToHire.median, 1),
            fmtPct(m.lapseRate, 1),
          ];
        }),
      };

      return {
        pdf: [
          {
            title: "Recruiter scorecard",
            subtitle: scope,
            note: "Application volume is assigned per record, so a recruiter inheriting a colleague's pipeline carries those applications too. Conversion is the fairer comparison; volume is context for it.",
            ...detail,
          },
        ],
        excel: [{ name: "Recruiters", headers: detail.headers, rows: detail.rows }],
      };
    },
  },

  {
    id: "pipeline",
    title: "Pipeline & Conversion",
    purpose:
      "Stage-by-stage conversion with the cohort view showing whether the funnel is improving month over month.",
    audience: "Recruitment Manager · HR Director",
    build: ({ store, rows, scope }) => {
      const funnel = funnelTable(store, rows);
      const points = timeSeries(store, rows, "applied_date", "month");
      const cohort = {
        headers: ["Intake month", "Size", ...STAGES.slice(1).map((s) => s.label)],
        rows: points.map((p) => {
          const stages = buildFunnel(store, p.rows);
          const size = stages[0]?.entered ?? 0;
          return [
            p.key,
            fmtInt(size),
            ...stages.slice(1).map((s) => (size ? fmtPct((s.entered / size) * 100, 1) : "—")),
          ];
        }),
      };
      const durations = {
        headers: ["Hand-off", "Measured", "p25", "Median", "p75", "p90"],
        rows: [
          ["Application → first call", "d_to_call"],
          ["Call → assessment", "d_call_to_assessment"],
          ["Assessment → sales pitch", "d_assessment_to_sp"],
          ["Pitch → manager interview", "d_sp_to_manager"],
          ["Manager → final interview", "d_manager_to_final"],
          ["Final interview → offer", "d_final_to_offer"],
          ["Offer → start date", "d_offer_to_join"],
        ].map(([label, field]) => {
          const s = statsOf(store, rows, field as never);
          return [
            label,
            fmtInt(s.count),
            fmtDays(s.p25, 1),
            fmtDays(s.median, 1),
            fmtDays(s.p75, 1),
            fmtDays(s.p90, 1),
          ];
        }),
      };

      return {
        pdf: [
          { title: "Funnel", subtitle: scope, ...funnel },
          {
            title: "Cohort progression",
            note: "Each row is one intake month followed through the funnel. Reading down a column shows whether conversion at that stage is improving over time.",
            ...cohort,
          },
          {
            title: "Hand-off durations",
            note: "The p90 column is the number worth managing. A median of zero with a p90 of three weeks means most candidates move instantly and a minority are left waiting.",
            ...durations,
          },
        ],
        excel: [
          { name: "Funnel", headers: funnel.headers, rows: funnel.rows },
          { name: "Cohorts", headers: cohort.headers, rows: cohort.rows },
          { name: "Durations", headers: durations.headers, rows: durations.rows },
        ],
      };
    },
  },

  {
    id: "source",
    title: "Sourcing Effectiveness",
    purpose:
      "Which channels produce hires rather than applications, and what each one costs the team in effort.",
    audience: "Recruitment Manager · Talent Acquisition",
    build: ({ store, rows, scope }) => {
      const sources = dimensionTable(store, rows, "source", "Source", 1);
      const channels = dimensionTable(store, rows, "channel", "Channel", 1);
      return {
        pdf: [
          {
            title: "Channel performance",
            subtitle: scope,
            note: "Read the application-to-hire column against the application column: the channel supplying the most volume is rarely the one supplying the most hires per unit of recruiter effort.",
            ...sources,
          },
          { title: "By channel family", ...channels },
        ],
        excel: [
          { name: "Sources", headers: sources.headers, rows: sources.rows },
          { name: "Channels", headers: channels.headers, rows: channels.rows },
        ],
      };
    },
  },

  {
    id: "loss",
    title: "Loss & Attrition",
    purpose:
      "Every recorded reason candidates leave the funnel, attributed to the stage it happened at.",
    audience: "Recruitment Manager · HR Director",
    build: ({ store, rows, metrics, scope }) => {
      const categories = groupMetrics(store, rows, "loss_category", { minApplications: 1 });
      const reasons = groupMetrics(store, rows, "loss_reason", { minApplications: 1 })
        .filter((g) => g.key !== "Went Cold")
        .sort((a, b) => b.metrics.applications - a.metrics.applications);

      const recorded = categories
        .filter((c) => c.key !== "Contactability")
        .reduce((s, c) => s + c.metrics.applications, 0);

      const catTable = {
        headers: ["Category", "Candidates", "Share of recorded"],
        rows: categories
          .filter((c) => c.key !== "Contactability")
          .map((c) => [
            c.key,
            fmtInt(c.metrics.applications),
            fmtPct(recorded ? (c.metrics.applications / recorded) * 100 : null, 1),
          ]),
      };

      const reasonTable = {
        headers: ["Reason", "Candidates", "Share of recorded"],
        rows: reasons.map((r) => [
          r.key,
          fmtInt(r.metrics.applications),
          fmtPct(recorded ? (r.metrics.applications / recorded) * 100 : null, 1),
        ]),
      };

      return {
        pdf: [
          {
            title: "Outcomes",
            subtitle: scope,
            facts: [
              { label: "Rejected by CPML", value: fmtInt(metrics.rejected) },
              { label: "Withdrew or declined", value: fmtInt(metrics.withdrawn) },
              { label: "Accepted then never started", value: fmtInt(metrics.droppedOff) },
              { label: "Went cold with no reason recorded", value: fmtInt(metrics.lapsed) },
              { label: "Still live in the pipeline", value: fmtInt(metrics.inProcess) },
              { label: "Hired", value: fmtInt(metrics.hired) },
            ],
            note: `${fmtInt(metrics.lapsed)} applications ended with no reason recorded at all. They are excluded from the tables below, because attributing a cause to silence would drown out the ${fmtInt(recorded)} losses a recruiter actually explained. Closing that recording gap is the cheapest improvement available to the team.`,
          },
          { title: "Loss categories", ...catTable },
          { title: "Specific reasons", ...reasonTable },
        ],
        excel: [
          { name: "Categories", headers: catTable.headers, rows: catTable.rows },
          { name: "Reasons", headers: reasonTable.headers, rows: reasonTable.rows },
        ],
      };
    },
  },

  {
    id: "talent",
    title: "Talent Market",
    purpose:
      "The shape of the applicant pool — background, education, experience and pay — against who actually converts.",
    audience: "HR Director · Compensation",
    build: ({ store, rows, metrics, scope }) => {
      const industries = dimensionTable(store, rows, "industry", "Prior industry", 30);
      const institutes = dimensionTable(store, rows, "institute", "Institute", 25);
      const experience = dimensionTable(store, rows, "experience_band", "Experience", 1);
      const education = dimensionTable(store, rows, "degree", "Education", 1);

      return {
        pdf: [
          {
            title: "Candidate profile",
            subtitle: scope,
            facts: [
              { label: "Unique candidates", value: fmtInt(metrics.candidates) },
              { label: "Re-applications", value: fmtInt(metrics.repeatApplications) },
              { label: "Median experience (pool)", value: metrics.experience.median != null ? fmtYears(metrics.experience.median) : "—" },
              { label: "Median experience (hires)", value: metrics.hiredExperience.median != null ? fmtYears(metrics.hiredExperience.median) : "—" },
              { label: "Median current salary (pool)", value: metrics.salary.median != null ? fmtSalary(metrics.salary.median) : "—" },
              { label: "Median current salary (hires)", value: metrics.hiredSalary.median != null ? fmtSalary(metrics.hiredSalary.median) : "—" },
            ],
            note: "Experience and salary are disclosed on only part of the dataset; the medians describe the candidates who provided a figure, not the whole pool.",
          },
          { title: "By experience band", ...experience },
          { title: "By education level", ...education },
          { title: "Top prior industries", ...industries },
          { title: "Top institutes", ...institutes },
        ],
        excel: [
          { name: "Experience", headers: experience.headers, rows: experience.rows },
          { name: "Education", headers: education.headers, rows: education.rows },
          { name: "Industries", headers: industries.headers, rows: industries.rows },
          { name: "Institutes", headers: institutes.headers, rows: institutes.rows },
        ],
      };
    },
  },
];

export const REPORT_BY_ID = Object.fromEntries(REPORTS.map((r) => [r.id, r]));

/** Human-readable description of the filter scope a report was run under. */
export function describeScope(
  store: RecruitmentStore,
  filters: { from: number | null; to: number | null; dims: Record<string, string[] | undefined> },
  rowCount: number,
): string {
  const parts: string[] = [];
  const from = filters.from ?? store.meta.dateMin;
  const to = filters.to ?? store.meta.horizon;
  parts.push(`${fmtDay(from)} to ${fmtDay(to)}`);
  for (const [field, values] of Object.entries(filters.dims)) {
    if (values?.length) parts.push(`${field.replace(/_/g, " ")}: ${values.join(", ")}`);
  }
  parts.push(`${fmtInt(rowCount)} of ${fmtInt(store.meta.rowCount)} application records`);
  return parts.join(" · ");
}
