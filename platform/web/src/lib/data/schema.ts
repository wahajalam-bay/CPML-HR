/**
 * Canonical shape of the recruitment dataset.
 *
 * The browser holds the entire operation (28k applications x 54 columns) in a
 * dictionary-encoded columnar store. Every column is a typed array; every
 * string dimension is an integer index into a per-field dictionary. That is
 * what makes cross-filtering the whole dataset feel instant: a filter pass is
 * a handful of integer comparisons per row, not object property lookups.
 */

export const DICT_FIELDS = [
  "source",
  "channel",
  "recruiter",
  "applied_role",
  "hired_role",
  "industry",
  "degree",
  "institute",
  "city",
  "team",
  "hiring_manager",
  "final_interviewer",
  "director",
  "drive",
  "experience_band",
  "screen_status",
  "call_status",
  "assessment_status",
  "sp_status",
  "manager_status",
  "final_status",
  "offer_status",
  "outcome_status",
  "loss_category",
  "loss_reason",
  "exit_stage",
  "salary_band",
] as const;
export type DictField = (typeof DICT_FIELDS)[number];

export const DATE_FIELDS = [
  "applied_date",
  "call_date",
  "assessment_date",
  "sp_date",
  "manager_date",
  "final_date",
  "offer_date",
  "planned_doj",
  "actual_doj",
  "last_activity",
] as const;
export type DateField = (typeof DATE_FIELDS)[number];

export const NUM_FIELDS = [
  "experience_years",
  "current_salary",
  "d_to_call",
  "d_call_to_assessment",
  "d_assessment_to_sp",
  "d_sp_to_manager",
  "d_manager_to_final",
  "d_final_to_offer",
  "d_offer_to_join",
  "time_to_hire",
  "time_to_offer",
  "doj_slip",
  "days_idle",
] as const;
export type NumField = (typeof NUM_FIELDS)[number];

export const FLAG_FIELDS = [
  "stage_reached",
  "stage_passed",
  "outcome",
  "is_repeat",
] as const;
export type FlagField = (typeof FLAG_FIELDS)[number];

export type ColumnKey = DictField | DateField | NumField | FlagField;

export const NULL_NUM = -32768;
export const NULL_IDX = -1;

/* -------------------------------------------------------------------------
 * Pipeline
 * ---------------------------------------------------------------------- */

export const STAGES = [
  { key: "applied", label: "Applied", short: "Applied" },
  { key: "screened", label: "Screened", short: "Screen" },
  { key: "phone_screen", label: "Phone Screen", short: "Phone" },
  { key: "assessment", label: "Assessment", short: "Assess" },
  { key: "sales_pitch", label: "Sales Pitch", short: "Pitch" },
  { key: "manager_interview", label: "Manager Interview", short: "Manager" },
  { key: "final_interview", label: "Final Interview", short: "Final" },
  { key: "offer", label: "Offer", short: "Offer" },
  { key: "joined", label: "Joined", short: "Joined" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];
export const STAGE_COUNT = STAGES.length;
export const STAGE_INDEX = Object.fromEntries(
  STAGES.map((s, i) => [s.key, i]),
) as Record<StageKey, number>;

/** What each stage actually *is*, in the recruiter's own words. */
export const STAGE_DESCRIPTION: Record<StageKey, string> = {
  applied: "Candidate enters the system from a sourcing channel.",
  screened: "CV and eligibility criteria checked against the role.",
  phone_screen: "Recruiter phone conversation and qualification call.",
  assessment: "Structured assessment scheduled and completed.",
  sales_pitch: "Live sales-pitch evaluation — the core capability gate.",
  manager_interview: "In-person interview with the hiring business manager.",
  final_interview: "Final panel with the senior interviewer.",
  offer: "Offer placed with the candidate.",
  joined: "Candidate onboarded and in or through training.",
};

/** Which stage transition each duration column measures. */
export const STAGE_DURATION: Record<string, NumField> = {
  phone_screen: "d_to_call",
  assessment: "d_call_to_assessment",
  sales_pitch: "d_assessment_to_sp",
  manager_interview: "d_sp_to_manager",
  final_interview: "d_manager_to_final",
  offer: "d_final_to_offer",
  joined: "d_offer_to_join",
};

/** Stage → the date column recorded when the candidate entered it. */
export const STAGE_DATE: Partial<Record<StageKey, DateField>> = {
  applied: "applied_date",
  phone_screen: "call_date",
  assessment: "assessment_date",
  sales_pitch: "sp_date",
  manager_interview: "manager_date",
  final_interview: "final_date",
  offer: "offer_date",
  joined: "actual_doj",
};

/* -------------------------------------------------------------------------
 * Outcomes
 * ---------------------------------------------------------------------- */

export const OUTCOMES = [
  "In Process",
  "Hired",
  "Rejected",
  "Withdrawn",
  "Dropped Off",
  "Lapsed",
] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_INDEX = Object.fromEntries(
  OUTCOMES.map((o, i) => [o, i]),
) as Record<Outcome, number>;

export const OUTCOME_TONE: Record<Outcome, "good" | "warn" | "serious" | "critical" | "neutral"> = {
  Hired: "good",
  "In Process": "neutral",
  Rejected: "neutral",
  Withdrawn: "serious",
  "Dropped Off": "critical",
  Lapsed: "warn",
};

export const OUTCOME_MEANING: Record<Outcome, string> = {
  "In Process": "Live in the pipeline with recent activity.",
  Hired: "Onboarded or in training.",
  Rejected: "Declined by CPML at a specific stage.",
  Withdrawn: "Candidate stepped away or turned down the offer.",
  "Dropped Off": "Accepted an offer, then never started.",
  Lapsed: "No recorded activity for 45+ days — the pipeline went cold.",
};

/* -------------------------------------------------------------------------
 * Store
 * ---------------------------------------------------------------------- */

export interface StoreMeta {
  generatedAt: string;
  source: string;
  rowCount: number;
  epoch: string;
  dateMin: number;
  dateMax: number;
  horizon: number;
  stages: { key: string; label: string }[];
  outcomes: string[];
  experienceBands: string[];
  salaryBands: string[];
  salaryUnit: number;
  experienceUnit: number;
  nullNum: number;
  staleAfterDays: number;
  nulls: Record<string, number>;

  /* ---- Present only on a server-scoped payload ------------------------
     The dataset the session received is a slice. These say so, which lets the
     UI report "4,999 of 28,366" honestly without holding the other 23,367. */

  /** Rows in the full dataset, when this payload is a scoped subset of it. */
  scopedFrom?: number;
  /** The row scope the server applied. */
  scope?: { kind: "all" | "own-book" | "none"; recruiter?: string };
  /** Protected fields blanked before serialising. */
  withheldFields?: string[];
}

export interface RecruitmentStore {
  meta: StoreMeta;
  /** field → ordered list of distinct values (index 0 is the most frequent). */
  dicts: Record<DictField, string[]>;
  /** field → dense typed array, one entry per row. */
  cols: Record<ColumnKey, Int32Array>;
  names: string[];
  phones: string[];
  /** Lowercased "name phone" haystack, built once for global search. */
  searchIndex: string[];
  /** field → value → dictionary index, for O(1) filter compilation. */
  lookups: Record<DictField, Map<string, number>>;
}

/** Row identifiers into the columnar store. */
export type Selection = Uint32Array;

/* -------------------------------------------------------------------------
 * Human-facing labels for every dimension the UI can group or filter by
 * ---------------------------------------------------------------------- */

export interface DimensionSpec {
  field: DictField;
  label: string;
  /** Plural noun used in headings and empty states. */
  plural: string;
  /** Route segment for the dimension's own analytics page, if it has one. */
  route?: string;
  /** Show in the global filter bar. */
  filterable: boolean;
  /** Sensible cap when charting this dimension's long tail. */
  topN?: number;
}

export const DIMENSIONS: DimensionSpec[] = [
  { field: "recruiter", label: "Recruiter", plural: "Recruiters", route: "/recruiters", filterable: true },
  { field: "source", label: "Source", plural: "Sources", route: "/sources", filterable: true },
  { field: "channel", label: "Channel", plural: "Channels", filterable: true },
  { field: "applied_role", label: "Role Applied", plural: "Roles", route: "/roles", filterable: true },
  { field: "hired_role", label: "Role Hired", plural: "Hired Roles", filterable: false },
  { field: "team", label: "Business Unit", plural: "Business Units", route: "/business-units", filterable: true },
  { field: "hiring_manager", label: "Hiring Manager", plural: "Hiring Managers", route: "/interviewers", filterable: true, topN: 20 },
  { field: "director", label: "Director Panel", plural: "Directors", filterable: true },
  { field: "industry", label: "Prior Industry", plural: "Industries", filterable: true, topN: 18 },
  { field: "degree", label: "Education Level", plural: "Education Levels", filterable: true },
  { field: "institute", label: "Institute", plural: "Institutes", filterable: true, topN: 18 },
  { field: "experience_band", label: "Experience", plural: "Experience Bands", filterable: true },
  { field: "salary_band", label: "Current Salary", plural: "Salary Bands", filterable: true },
  { field: "city", label: "City", plural: "Cities", filterable: true },
  { field: "drive", label: "Campaign Type", plural: "Campaign Types", filterable: true },
  { field: "loss_category", label: "Loss Category", plural: "Loss Categories", route: "/attrition", filterable: true },
  { field: "loss_reason", label: "Loss Reason", plural: "Loss Reasons", filterable: true, topN: 16 },
  { field: "exit_stage", label: "Exit Stage", plural: "Exit Stages", filterable: false },
];

export const DIMENSION_BY_FIELD = Object.fromEntries(
  DIMENSIONS.map((d) => [d.field, d]),
) as Record<DictField, DimensionSpec>;

/** Experience bands in their natural order, not frequency order. */
export const EXPERIENCE_BAND_ORDER = [
  "Fresh",
  "0–2 yrs",
  "2–4 yrs",
  "4–6 yrs",
  "6–9 yrs",
  "9+ yrs",
];

export const SALARY_BAND_ORDER = [
  "< 40k",
  "40–60k",
  "60–80k",
  "80–100k",
  "100–150k",
  "150k+",
];

export const DEGREE_ORDER = ["Undergraduate", "Graduate", "Masters"];

/** Fields whose values have an inherent order the charts must respect. */
export const ORDINAL_DOMAINS: Partial<Record<DictField, string[]>> = {
  experience_band: EXPERIENCE_BAND_ORDER,
  salary_band: SALARY_BAND_ORDER,
  degree: DEGREE_ORDER,
};
