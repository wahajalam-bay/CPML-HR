import {
  NULL_NUM,
  OUTCOME_INDEX,
  STAGE_INDEX,
  type DictField,
  type RecruitmentStore,
  type Selection,
} from "./schema";
import {
  EXPERIENCE_SCALE,
  SALARY_SCALE,
  statsOf,
  type Stats,
} from "./query";

/* =========================================================================
 * The metric bundle
 *
 * Every page, table row and drill-down derives from this one function, so a
 * "hire" means exactly the same thing on the executive dashboard as it does
 * in a recruiter's profile. Adding a metric here makes it available
 * everywhere at once.
 * ========================================================================= */

export interface Metrics {
  /* Volume ------------------------------------------------------------- */
  applications: number;
  candidates: number;
  repeatApplications: number;

  /* Stage entry counts -------------------------------------------------- */
  screened: number;
  phoneScreened: number;
  assessed: number;
  pitched: number;
  managerInterviews: number;
  finalInterviews: number;
  offers: number;
  joined: number;

  /* Stage clearance counts ---------------------------------------------- */
  screenEligible: number;
  phoneQualified: number;
  assessmentPassed: number;
  pitchPassed: number;
  managerSelected: number;
  finalSelected: number;
  offersAccepted: number;

  /* Outcomes ------------------------------------------------------------ */
  inProcess: number;
  hired: number;
  rejected: number;
  withdrawn: number;
  droppedOff: number;
  lapsed: number;

  /* Interview load ------------------------------------------------------ */
  totalInterviews: number;

  /* Rates (percentages, 0–100) ------------------------------------------ */
  screenPassRate: number | null;
  phoneQualifyRate: number | null;
  pitchPassRate: number | null;
  managerSelectRate: number | null;
  finalSelectRate: number | null;
  offerAcceptRate: number | null;
  /**
   * Joined as a share of offers PLACED, not of offers accepted.
   *
   * Twenty candidates in the source sheet have a start date but no recorded
   * acceptance, so an accepted-offer denominator produces rates above 100% in
   * small groups. Offers placed is always a superset of joiners by
   * construction, so this figure is bounded and comparable.
   */
  joinRate: number | null;
  /** joined / applications — the number that actually matters. */
  overallConversion: number | null;
  /** applications needed per hire. */
  applicationsPerHire: number | null;
  interviewsPerHire: number | null;
  /** offers accepted but never started. */
  noShowRate: number | null;
  lapseRate: number | null;

  /* Velocity (days) ----------------------------------------------------- */
  timeToHire: Stats;
  timeToOffer: Stats;
  timeToFirstContact: Stats;
  offerToJoin: Stats;
  dojSlip: Stats;

  /* Candidate profile --------------------------------------------------- */
  experience: Stats;
  salary: Stats;
  hiredExperience: Stats;
  hiredSalary: Stats;
}

const ZERO_STATS: Stats = {
  count: 0,
  mean: null,
  p25: null,
  median: null,
  p75: null,
  p90: null,
  min: null,
  max: null,
};

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

/** Compute the full metric bundle for any selection of rows. */
export function computeMetrics(
  store: RecruitmentStore,
  rows: Selection,
): Metrics {
  const reached = store.cols.stage_reached;
  const passed = store.cols.stage_passed;
  const outcome = store.cols.outcome;
  const repeat = store.cols.is_repeat;

  const S = STAGE_INDEX;
  const counters = {
    screened: 0, phoneScreened: 0, assessed: 0, pitched: 0,
    managerInterviews: 0, finalInterviews: 0, offers: 0, joined: 0,
    screenEligible: 0, phoneQualified: 0, assessmentPassed: 0, pitchPassed: 0,
    managerSelected: 0, finalSelected: 0, offersAccepted: 0,
    inProcess: 0, hired: 0, rejected: 0, withdrawn: 0, droppedOff: 0, lapsed: 0,
    repeatApplications: 0,
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = reached[row];
    const p = passed[row];

    if (r >= S.screened) counters.screened++;
    if (r >= S.phone_screen) counters.phoneScreened++;
    if (r >= S.assessment) counters.assessed++;
    if (r >= S.sales_pitch) counters.pitched++;
    if (r >= S.manager_interview) counters.managerInterviews++;
    if (r >= S.final_interview) counters.finalInterviews++;
    if (r >= S.offer) counters.offers++;
    if (r >= S.joined) counters.joined++;

    if ((p >> S.screened) & 1) counters.screenEligible++;
    if ((p >> S.phone_screen) & 1) counters.phoneQualified++;
    if ((p >> S.assessment) & 1) counters.assessmentPassed++;
    if ((p >> S.sales_pitch) & 1) counters.pitchPassed++;
    if ((p >> S.manager_interview) & 1) counters.managerSelected++;
    if ((p >> S.final_interview) & 1) counters.finalSelected++;
    if ((p >> S.offer) & 1) counters.offersAccepted++;

    switch (outcome[row]) {
      case OUTCOME_INDEX["In Process"]: counters.inProcess++; break;
      case OUTCOME_INDEX.Hired: counters.hired++; break;
      case OUTCOME_INDEX.Rejected: counters.rejected++; break;
      case OUTCOME_INDEX.Withdrawn: counters.withdrawn++; break;
      case OUTCOME_INDEX["Dropped Off"]: counters.droppedOff++; break;
      case OUTCOME_INDEX.Lapsed: counters.lapsed++; break;
    }

    if (repeat[row] === 1) counters.repeatApplications++;
  }

  const applications = rows.length;
  const totalInterviews = counters.managerInterviews + counters.finalInterviews;

  const hiredRows = filterByOutcome(store, rows, OUTCOME_INDEX.Hired);

  return {
    applications,
    candidates: applications - counters.repeatApplications,
    repeatApplications: counters.repeatApplications,

    screened: counters.screened,
    phoneScreened: counters.phoneScreened,
    assessed: counters.assessed,
    pitched: counters.pitched,
    managerInterviews: counters.managerInterviews,
    finalInterviews: counters.finalInterviews,
    offers: counters.offers,
    joined: counters.joined,

    screenEligible: counters.screenEligible,
    phoneQualified: counters.phoneQualified,
    assessmentPassed: counters.assessmentPassed,
    pitchPassed: counters.pitchPassed,
    managerSelected: counters.managerSelected,
    finalSelected: counters.finalSelected,
    offersAccepted: counters.offersAccepted,

    inProcess: counters.inProcess,
    hired: counters.hired,
    rejected: counters.rejected,
    withdrawn: counters.withdrawn,
    droppedOff: counters.droppedOff,
    lapsed: counters.lapsed,

    totalInterviews,

    screenPassRate: rate(counters.screenEligible, counters.screened),
    phoneQualifyRate: rate(counters.phoneQualified, counters.phoneScreened),
    pitchPassRate: rate(counters.pitchPassed, counters.pitched),
    managerSelectRate: rate(counters.managerSelected, counters.managerInterviews),
    finalSelectRate: rate(counters.finalSelected, counters.finalInterviews),
    offerAcceptRate: rate(counters.offersAccepted, counters.offers),
    joinRate: rate(counters.joined, counters.offers),
    overallConversion: rate(counters.hired, applications),
    applicationsPerHire: counters.hired > 0 ? applications / counters.hired : null,
    interviewsPerHire: counters.hired > 0 ? totalInterviews / counters.hired : null,
    noShowRate: rate(counters.droppedOff, counters.offersAccepted),
    lapseRate: rate(counters.lapsed, applications),

    timeToHire: statsOf(store, rows, "time_to_hire"),
    timeToOffer: statsOf(store, rows, "time_to_offer"),
    timeToFirstContact: statsOf(store, rows, "d_to_call"),
    offerToJoin: statsOf(store, rows, "d_offer_to_join"),
    dojSlip: statsOf(store, rows, "doj_slip"),

    experience: statsOf(store, rows, "experience_years", EXPERIENCE_SCALE),
    salary: statsOf(store, rows, "current_salary", SALARY_SCALE),
    hiredExperience: hiredRows.length
      ? statsOf(store, hiredRows, "experience_years", EXPERIENCE_SCALE)
      : ZERO_STATS,
    hiredSalary: hiredRows.length
      ? statsOf(store, hiredRows, "current_salary", SALARY_SCALE)
      : ZERO_STATS,
  };
}

function filterByOutcome(
  store: RecruitmentStore,
  rows: Selection,
  outcomeIndex: number,
): Selection {
  const col = store.cols.outcome;
  const out = new Uint32Array(rows.length);
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (col[rows[i]] === outcomeIndex) out[n++] = rows[i];
  }
  return out.subarray(0, n);
}

/* =========================================================================
 * KPI catalogue
 *
 * A declarative registry so KPI cards, report builders and the command
 * palette all read from one definition rather than hard-coding labels.
 * ========================================================================= */

export type MetricFormat = "int" | "pct" | "days" | "ratio" | "salary" | "years";
/** Whether a rise in this metric is good, bad, or context-dependent. */
export type MetricPolarity = "higher-better" | "lower-better" | "neutral";

export interface MetricDef {
  id: string;
  label: string;
  /** One sentence: what this number actually counts. */
  definition: string;
  format: MetricFormat;
  polarity: MetricPolarity;
  get: (m: Metrics) => number | null;
  /** Operating target used for the variance indicator, where one exists. */
  target?: number;
  group: "Volume" | "Conversion" | "Velocity" | "Quality" | "Risk";
}

export const METRIC_CATALOGUE: MetricDef[] = [
  {
    id: "applications",
    label: "Applications",
    definition: "Application records in scope. A candidate who re-applies counts once per application.",
    format: "int", polarity: "neutral", group: "Volume",
    get: (m) => m.applications,
  },
  {
    id: "candidates",
    label: "Unique Candidates",
    definition: "Distinct people behind those applications, matched on phone number.",
    format: "int", polarity: "neutral", group: "Volume",
    get: (m) => m.candidates,
  },
  {
    id: "phoneScreened",
    label: "Contacted",
    definition: "Candidates a recruiter actually reached by phone.",
    format: "int", polarity: "higher-better", group: "Volume",
    get: (m) => m.phoneScreened,
  },
  {
    id: "pitched",
    label: "Sales Pitches",
    definition: "Candidates who sat the live sales-pitch evaluation.",
    format: "int", polarity: "higher-better", group: "Volume",
    get: (m) => m.pitched,
  },
  {
    id: "totalInterviews",
    label: "Interviews",
    definition: "Manager and final-panel interviews combined.",
    format: "int", polarity: "neutral", group: "Volume",
    get: (m) => m.totalInterviews,
  },
  {
    id: "offers",
    label: "Offers Placed",
    definition: "Offers extended to candidates.",
    format: "int", polarity: "higher-better", group: "Volume",
    get: (m) => m.offers,
  },
  {
    id: "hired",
    label: "Hires",
    definition: "Candidates onboarded or currently in training.",
    format: "int", polarity: "higher-better", group: "Volume",
    get: (m) => m.hired,
  },
  {
    id: "overallConversion",
    label: "Application → Hire",
    definition: "Share of all applications that ended in a hire.",
    format: "pct", polarity: "higher-better", group: "Conversion", target: 4.5,
    get: (m) => m.overallConversion,
  },
  {
    id: "screenPassRate",
    label: "Screen Pass Rate",
    definition: "Share of screened candidates judged eligible for the role.",
    format: "pct", polarity: "higher-better", group: "Conversion", target: 80,
    get: (m) => m.screenPassRate,
  },
  {
    id: "phoneQualifyRate",
    label: "Phone Qualify Rate",
    definition: "Share of contacted candidates who qualified on the call.",
    format: "pct", polarity: "higher-better", group: "Conversion", target: 40,
    get: (m) => m.phoneQualifyRate,
  },
  {
    id: "pitchPassRate",
    label: "Pitch Pass Rate",
    definition: "Share of sales pitches marked SP+ — the core capability gate.",
    format: "pct", polarity: "higher-better", group: "Conversion", target: 55,
    get: (m) => m.pitchPassRate,
  },
  {
    id: "managerSelectRate",
    label: "Manager Select Rate",
    definition: "Share of manager interviews that ended in a selection.",
    format: "pct", polarity: "higher-better", group: "Conversion", target: 45,
    get: (m) => m.managerSelectRate,
  },
  {
    id: "offerAcceptRate",
    label: "Offer Acceptance",
    definition: "Share of placed offers the candidate accepted.",
    format: "pct", polarity: "higher-better", group: "Conversion", target: 95,
    get: (m) => m.offerAcceptRate,
  },
  {
    id: "joinRate",
    label: "Offer → Join",
    definition:
      "Share of placed offers that turned into an actual start date. Measured against offers placed rather than offers accepted, because a handful of records carry a start date with no acceptance logged.",
    format: "pct", polarity: "higher-better", group: "Conversion", target: 92,
    get: (m) => m.joinRate,
  },
  {
    id: "applicationsPerHire",
    label: "Applications / Hire",
    definition: "How many applications the funnel consumes to produce one hire.",
    format: "ratio", polarity: "lower-better", group: "Quality", target: 22,
    get: (m) => m.applicationsPerHire,
  },
  {
    id: "interviewsPerHire",
    label: "Interviews / Hire",
    definition: "Interview load carried by the business per hire delivered.",
    format: "ratio", polarity: "lower-better", group: "Quality", target: 2.2,
    get: (m) => m.interviewsPerHire,
  },
  {
    id: "timeToHire",
    label: "Time to Hire",
    definition: "Median days from application to actual start date.",
    format: "days", polarity: "lower-better", group: "Velocity", target: 12,
    get: (m) => m.timeToHire.median,
  },
  {
    id: "timeToOffer",
    label: "Time to Offer",
    definition: "Median days from application to offer placement.",
    format: "days", polarity: "lower-better", group: "Velocity", target: 9,
    get: (m) => m.timeToOffer.median,
  },
  {
    id: "timeToFirstContact",
    label: "Time to First Contact",
    definition: "Median days between an application landing and the first call.",
    format: "days", polarity: "lower-better", group: "Velocity", target: 1,
    get: (m) => m.timeToFirstContact.median,
  },
  {
    id: "offerToJoin",
    label: "Offer → Join",
    definition: "Median days between offer acceptance and the candidate starting.",
    format: "days", polarity: "lower-better", group: "Velocity", target: 14,
    get: (m) => m.offerToJoin.median,
  },
  {
    id: "noShowRate",
    label: "Offer No-Show Rate",
    definition: "Accepted offers where the candidate never started. Pure wasted cost.",
    format: "pct", polarity: "lower-better", group: "Risk", target: 6,
    get: (m) => m.noShowRate,
  },
  {
    id: "lapseRate",
    label: "Pipeline Lapse Rate",
    definition: "Share of applications that went cold with no recorded activity for 45+ days.",
    format: "pct", polarity: "lower-better", group: "Risk", target: 35,
    get: (m) => m.lapseRate,
  },
  {
    id: "inProcess",
    label: "Live Pipeline",
    definition: "Applications with recent activity that are still progressing.",
    format: "int", polarity: "neutral", group: "Risk",
    get: (m) => m.inProcess,
  },
  {
    id: "experience",
    label: "Median Experience",
    definition: "Median prior experience of candidates in scope.",
    format: "years", polarity: "neutral", group: "Quality",
    get: (m) => m.experience.median,
  },
  {
    id: "hiredSalary",
    label: "Median Prior Salary (Hires)",
    definition: "Median last-drawn salary of the people actually hired.",
    format: "salary", polarity: "neutral", group: "Quality",
    get: (m) => m.hiredSalary.median,
  },
];

export const METRIC_BY_ID = Object.fromEntries(
  METRIC_CATALOGUE.map((m) => [m.id, m]),
) as Record<string, MetricDef>;

/* =========================================================================
 * Grouped metric tables (leaderboards)
 * ========================================================================= */

export interface GroupRow {
  key: string;
  index: number;
  rows: Selection;
  metrics: Metrics;
}

/** Compute the full metric bundle for every value of a dimension. */
export function groupMetrics(
  store: RecruitmentStore,
  rows: Selection,
  field: DictField,
  opts: { minApplications?: number } = {},
): GroupRow[] {
  const dict = store.dicts[field] ?? [];
  const col = store.cols[field];
  const members: number[][] = Array.from({ length: dict.length }, () => []);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const v = col[row];
    if (v >= 0) members[v].push(row);
  }

  const out: GroupRow[] = [];
  const min = opts.minApplications ?? 1;
  for (let i = 0; i < dict.length; i++) {
    if (members[i].length < min) continue;
    const sel = Uint32Array.from(members[i]);
    out.push({
      key: dict[i],
      index: i,
      rows: sel,
      metrics: computeMetrics(store, sel),
    });
  }
  return out.sort((a, b) => b.metrics.applications - a.metrics.applications);
}

/* =========================================================================
 * Scoring — a single comparable health number
 * ========================================================================= */

export interface HealthScore {
  score: number;
  band: "strong" | "healthy" | "watch" | "at-risk";
  contributions: { label: string; value: number | null; weight: number; scaled: number }[];
}

/**
 * Blend the metrics that actually describe recruiting health into one 0–100
 * figure. Weights favour delivered outcomes (hires, acceptance) over activity,
 * so volume alone can never carry a poor conversion record.
 */
export function healthScore(m: Metrics, baseline: Metrics): HealthScore {
  const parts: { label: string; value: number | null; weight: number; target: number | null }[] = [
    { label: "Application → Hire", value: m.overallConversion, weight: 30, target: baseline.overallConversion ?? 4.5 },
    { label: "Pitch Pass Rate", value: m.pitchPassRate, weight: 20, target: baseline.pitchPassRate ?? 53 },
    { label: "Offer Acceptance", value: m.offerAcceptRate, weight: 15, target: baseline.offerAcceptRate ?? 95 },
    { label: "Offer → Join", value: m.joinRate, weight: 15, target: baseline.joinRate ?? 92 },
    { label: "Time to Hire", value: invert(m.timeToHire.median), weight: 10, target: invert(baseline.timeToHire.median ?? 12) },
    { label: "Pipeline Lapse", value: invert(m.lapseRate), weight: 10, target: invert(baseline.lapseRate ?? 40) },
  ];

  let total = 0;
  let weightUsed = 0;
  const contributions = parts.map((p) => {
    if (p.value == null || !p.target) {
      return { label: p.label, value: p.value, weight: p.weight, scaled: 0 };
    }
    // 1.0 means "exactly at the organisation-wide baseline".
    const ratio = Math.min(1.6, Math.max(0, p.value / p.target));
    const scaled = (ratio / 1.6) * p.weight;
    total += scaled;
    weightUsed += p.weight;
    return { label: p.label, value: p.value, weight: p.weight, scaled };
  });

  const score = weightUsed ? Math.round((total / weightUsed) * 100) : 0;
  const band: HealthScore["band"] =
    score >= 72 ? "strong" : score >= 58 ? "healthy" : score >= 44 ? "watch" : "at-risk";
  return { score, band, contributions };
}

function invert(v: number | null): number | null {
  if (v == null || v <= 0) return null;
  return 100 / v;
}

/* =========================================================================
 * Distribution helpers
 * ========================================================================= */

export interface HistogramBin {
  label: string;
  from: number;
  to: number;
  count: number;
}

export function histogram(
  values: number[],
  binWidth: number,
  opts: { max?: number; unit?: string } = {},
): HistogramBin[] {
  if (!values.length) return [];
  const max = opts.max ?? Math.max(...values);
  const binCount = Math.max(1, Math.ceil(max / binWidth));
  const bins: HistogramBin[] = [];
  for (let i = 0; i < binCount; i++) {
    const from = i * binWidth;
    const to = from + binWidth;
    bins.push({
      label: `${from}–${to}${opts.unit ?? ""}`,
      from,
      to,
      count: 0,
    });
  }
  for (const v of values) {
    const idx = Math.min(binCount - 1, Math.floor(v / binWidth));
    if (idx >= 0) bins[idx].count++;
  }
  return bins;
}

/** Count non-null values of a numeric column — used for coverage warnings. */
export function coverage(
  store: RecruitmentStore,
  rows: Selection,
  field: Parameters<typeof statsOf>[2],
): { known: number; total: number; pct: number } {
  const col = store.cols[field];
  let known = 0;
  for (let i = 0; i < rows.length; i++) {
    if (col[rows[i]] !== NULL_NUM) known++;
  }
  return {
    known,
    total: rows.length,
    pct: rows.length ? (known / rows.length) * 100 : 0,
  };
}
