import "server-only";

import { and, asc, count, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";
import { db } from "@/server/db/client";
import {
  applications,
  businessUnits,
  candidates,
  interviewers,
  recruiters,
  roles,
  sources,
} from "@/server/db/schema";
import type { Principal } from "@/server/rbac";

/**
 * Analytics queries.
 *
 * Every metric is defined once here, in SQL that mirrors the browser-side
 * definitions in `lib/data/metrics.ts`. A "hire" means the same thing in a
 * Postgres aggregate as it does in a React chart — which is the only way a
 * figure in a board report can be trusted to match the screen it came from.
 */

/* =========================================================================
 * Stage model — must match lib/data/schema.ts
 * ========================================================================= */

const STAGES = [
  "applied",
  "screened",
  "phone_screen",
  "assessment",
  "sales_pitch",
  "manager_interview",
  "final_interview",
  "offer",
  "joined",
] as const;

type Stage = (typeof STAGES)[number];

const STAGE_INDEX = Object.fromEntries(
  STAGES.map((s, i) => [s, i]),
) as Record<Stage, number>;

/** Candidates who entered `stage` or went further. */
function reached(stage: Stage): SQL {
  const allowed = STAGES.filter((s) => STAGE_INDEX[s] >= STAGE_INDEX[stage]);
  return inArray(applications.stageReached, allowed);
}

/** Candidates who cleared `stage`'s gate, read from the bitmask. */
function cleared(stage: Stage): SQL {
  const bit = 1 << STAGE_INDEX[stage];
  return sql`(${applications.stagePassedMask} & ${bit}) = ${bit}`;
}

const countWhere = (condition: SQL) =>
  sql<number>`count(*) filter (where ${condition})::int`;

/* =========================================================================
 * Filters
 * ========================================================================= */

export interface AnalyticsFilter {
  from?: string;
  to?: string;
  recruiters?: string[];
  sources?: string[];
  roles?: string[];
  businessUnits?: string[];
  hiringManagers?: string[];
  degrees?: string[];
  industries?: string[];
  outcomes?: string[];
  stageAtLeast?: Stage;
  stageExactly?: Stage;
  search?: string;
}

/**
 * Build the WHERE clause, applying the principal's row scope LAST so it
 * overrides anything the caller asked for.
 *
 * Order is the whole point: a scoped caller who names another recruiter in the
 * query gets their own book, not that recruiter's. Applying scope first and
 * letting the request narrow further would let `recruiters=[X]` widen past it.
 */
function buildWhere(filter: AnalyticsFilter, principal: Principal): SQL[] {
  const conditions: SQL[] = [];

  if (filter.from) conditions.push(gte(applications.appliedOn, filter.from));
  if (filter.to) conditions.push(lte(applications.appliedOn, filter.to));

  if (filter.sources?.length) conditions.push(inArray(sources.name, filter.sources));
  if (filter.roles?.length) conditions.push(inArray(roles.title, filter.roles));
  if (filter.businessUnits?.length) {
    conditions.push(inArray(businessUnits.name, filter.businessUnits));
  }
  if (filter.hiringManagers?.length) {
    conditions.push(inArray(interviewers.name, filter.hiringManagers));
  }
  if (filter.degrees?.length) conditions.push(inArray(candidates.degree, filter.degrees));
  if (filter.industries?.length) {
    conditions.push(inArray(candidates.industry, filter.industries));
  }
  if (filter.outcomes?.length) {
    conditions.push(
      inArray(
        applications.outcome,
        filter.outcomes as (typeof applications.outcome.enumValues)[number][],
      ),
    );
  }
  if (filter.stageAtLeast) conditions.push(reached(filter.stageAtLeast));
  if (filter.stageExactly) {
    conditions.push(eq(applications.stageReached, filter.stageExactly));
  }
  if (filter.search) {
    const needle = `%${filter.search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(${candidates.fullName}) like ${needle} or ${candidates.phone} like ${needle})`,
    );
  }

  // ---- Row scope. Applied last; overrides, never intersects. ----
  if (principal.scope.kind === "own-book") {
    conditions.push(eq(recruiters.name, principal.scope.recruiter));
  } else if (principal.scope.kind === "none") {
    // Identified as scoped but with no book mapped: match nothing rather than
    // falling through to everything.
    conditions.push(sql`false`);
  } else if (filter.recruiters?.length) {
    conditions.push(inArray(recruiters.name, filter.recruiters));
  }

  return conditions;
}

/**
 * The join set every query shares, so a filter can reference any dimension
 * without each caller re-declaring six joins.
 *
 * Takes the projection up front rather than being re-selected later: Drizzle's
 * builder is typed as a state machine, and `.select()` is only available
 * before `.from()`.
 */
function baseQuery(columns: SelectedFields) {
  // `$dynamic()` is applied immediately after `from()`: Drizzle's builder is a
  // typed state machine, and once the projection is a runtime-shaped
  // `SelectedFields` the conditional result types cannot resolve, which breaks
  // the join chain. The dynamic builder trades that inference for a shape the
  // callers assert themselves.
  return db()
    .select(columns)
    .from(applications)
    .$dynamic()
    .leftJoin(recruiters, eq(applications.recruiterId, recruiters.id))
    .leftJoin(sources, eq(applications.sourceId, sources.id))
    .leftJoin(roles, eq(applications.roleId, roles.id))
    .leftJoin(businessUnits, eq(applications.businessUnitId, businessUnits.id))
    .leftJoin(interviewers, eq(applications.hiringManagerId, interviewers.id))
    .innerJoin(candidates, eq(applications.candidateId, candidates.id));
}

/* =========================================================================
 * Metric expressions
 * ========================================================================= */

const metricColumns = {
  applications: sql<number>`count(*)::int`,
  candidates: sql<number>`count(distinct ${applications.candidateId})::int`,
  repeatApplications: countWhere(eq(applications.isRepeat, true)),

  contacted: countWhere(reached("phone_screen")),
  pitched: countWhere(reached("sales_pitch")),
  managerInterviews: countWhere(reached("manager_interview")),
  finalInterviews: countWhere(reached("final_interview")),
  offers: countWhere(reached("offer")),
  joined: countWhere(reached("joined")),

  screenEligible: countWhere(cleared("screened")),
  phoneQualified: countWhere(cleared("phone_screen")),
  pitchPassed: countWhere(cleared("sales_pitch")),
  managerSelected: countWhere(cleared("manager_interview")),
  offersAccepted: countWhere(cleared("offer")),

  hired: countWhere(eq(applications.outcome, "Hired")),
  inProcess: countWhere(eq(applications.outcome, "In Process")),
  rejected: countWhere(eq(applications.outcome, "Rejected")),
  withdrawn: countWhere(eq(applications.outcome, "Withdrawn")),
  droppedOff: countWhere(eq(applications.outcome, "Dropped Off")),
  lapsed: countWhere(eq(applications.outcome, "Lapsed")),

  // percentile_cont ignores NULLs, so these describe only the records that
  // actually carry the measurement.
  timeToHireMedian: sql<number | null>`percentile_cont(0.5) within group (order by ${applications.timeToHire})`,
  timeToHireP90: sql<number | null>`percentile_cont(0.9) within group (order by ${applications.timeToHire})`,
  timeToOfferMedian: sql<number | null>`percentile_cont(0.5) within group (order by ${applications.timeToOffer})`,
  daysToCallMedian: sql<number | null>`percentile_cont(0.5) within group (order by ${applications.daysToCall})`,
  offerToJoinMedian: sql<number | null>`percentile_cont(0.5) within group (order by ${applications.daysOfferToJoin})`,
  timeToHireMeasured: countWhere(sql`${applications.timeToHire} is not null`),
};

type RawMetrics = { [K in keyof typeof metricColumns]: number | null };

/** Turn raw counts into rate metrics, guarding every denominator. */
function derive(raw: RawMetrics) {
  const pct = (numerator: number | null, denominator: number | null) =>
    denominator ? Number((((numerator ?? 0) / denominator) * 100).toFixed(4)) : null;

  const applicationCount = raw.applications ?? 0;
  const hired = raw.hired ?? 0;

  return {
    ...raw,
    screenPassRate: pct(raw.screenEligible, raw.applications),
    phoneQualifyRate: pct(raw.phoneQualified, raw.contacted),
    pitchPassRate: pct(raw.pitchPassed, raw.pitched),
    managerSelectRate: pct(raw.managerSelected, raw.managerInterviews),
    offerAcceptRate: pct(raw.offersAccepted, raw.offers),
    // Denominated on offers PLACED: a few records carry a start date with no
    // acceptance logged, which pushes an accepted-offer denominator past 100%
    // in small groups.
    joinRate: pct(raw.joined, raw.offers),
    overallConversion: pct(raw.hired, raw.applications),
    noShowRate: pct(raw.droppedOff, raw.offersAccepted),
    lapseRate: pct(raw.lapsed, raw.applications),
    applicationsPerHire: hired ? Number((applicationCount / hired).toFixed(2)) : null,
    interviewsPerHire: hired
      ? Number((((raw.managerInterviews ?? 0) + (raw.finalInterviews ?? 0)) / hired).toFixed(2))
      : null,
  };
}

/* =========================================================================
 * Queries
 * ========================================================================= */

export async function summary(filter: AnalyticsFilter, principal: Principal) {
  const where = buildWhere(filter, principal);
  const [row] = await baseQuery(metricColumns).where(
    where.length ? and(...where) : undefined,
  );
  return derive(row as RawMetrics);
}

export async function funnel(filter: AnalyticsFilter, principal: Principal) {
  const where = buildWhere(filter, principal);

  const columns: Record<string, SQL> = {};
  for (const stage of STAGES) {
    columns[`entered_${stage}`] = countWhere(reached(stage));
    columns[`cleared_${stage}`] = countWhere(cleared(stage));
  }

  const [row] = await baseQuery(columns).where(
    where.length ? and(...where) : undefined,
  );

  const record = row as unknown as Record<string, number>;
  const intake = record.entered_applied ?? 0;

  return STAGES.map((stage, i) => {
    const entered = record[`entered_${stage}`] ?? 0;
    const clearedCount = record[`cleared_${stage}`] ?? 0;
    const next = i + 1 < STAGES.length ? (record[`entered_${STAGES[i + 1]}`] ?? 0) : null;
    return {
      stage,
      index: i,
      entered,
      cleared: clearedCount,
      lost: entered - (next ?? entered),
      passRate: entered ? Number(((clearedCount / entered) * 100).toFixed(2)) : null,
      stepConversion:
        next != null && entered ? Number(((next / entered) * 100).toFixed(2)) : null,
      cumulative: intake ? Number(((entered / intake) * 100).toFixed(2)) : null,
    };
  });
}

/** Dimensions the API may group by. A closed set — never interpolated. */
export const GROUPABLE = {
  recruiter: recruiters.name,
  source: sources.name,
  channel: sources.channel,
  role: roles.title,
  businessUnit: businessUnits.name,
  hiringManager: interviewers.name,
  degree: candidates.degree,
  institute: candidates.institute,
  industry: candidates.industry,
  city: candidates.city,
} as const;

export type Groupable = keyof typeof GROUPABLE;

export async function byDimension(
  dimension: Groupable,
  filter: AnalyticsFilter,
  principal: Principal,
  options: { minApplications?: number; limit?: number } = {},
) {
  const column = GROUPABLE[dimension];
  const where = buildWhere(filter, principal);
  where.push(sql`${column} is not null`);

  const rows = await baseQuery({ key: column, ...metricColumns })
    .where(and(...where))
    .groupBy(column)
    .having(sql`count(*) >= ${options.minApplications ?? 1}`)
    .orderBy(desc(sql`count(*)`))
    .limit(Math.min(options.limit ?? 200, 500));

  return (rows as Record<string, unknown>[]).map((row) => ({
    key: String(row.key),
    ...derive(row as unknown as RawMetrics),
  }));
}

export type Granularity = "day" | "week" | "month" | "quarter";

export async function timeseries(
  filter: AnalyticsFilter,
  principal: Principal,
  granularity: Granularity = "month",
) {
  const where = buildWhere(filter, principal);
  const bucket = sql<string>`date_trunc(${granularity}, ${applications.appliedOn})::date`;

  const rows = await baseQuery({ bucket, ...metricColumns })
    .where(where.length ? and(...where) : undefined)
    .groupBy(bucket)
    .orderBy(asc(bucket));

  return (rows as Record<string, unknown>[]).map((row) => ({
    bucket: String(row.bucket),
    ...derive(row as unknown as RawMetrics),
  }));
}

export async function lossBreakdown(
  filter: AnalyticsFilter,
  principal: Principal,
  includeInferred = false,
) {
  const where = buildWhere(filter, principal);
  where.push(sql`${applications.lossCategory} is not null`);
  // Inferred reasons outnumber recorded ones roughly nine to one; mixing them
  // buries every reason a recruiter could act on.
  if (!includeInferred) where.push(eq(applications.lossInferred, false));

  return baseQuery({
      category: applications.lossCategory,
      reason: applications.lossReason,
      exitStage: applications.exitStage,
      candidates: sql<number>`count(*)::int`,
    })
    .where(and(...where))
    .groupBy(applications.lossCategory, applications.lossReason, applications.exitStage)
    .orderBy(desc(sql`count(*)`));
}

/* =========================================================================
 * Records
 * ========================================================================= */

export async function listApplications(
  filter: AnalyticsFilter,
  principal: Principal,
  options: { offset?: number; limit?: number } = {},
) {
  const where = buildWhere(filter, principal);
  const limit = Math.min(options.limit ?? 100, 500);
  const offset = Math.max(options.offset ?? 0, 0);

  const [totalRow] = (await baseQuery({ total: count() }).where(
    where.length ? and(...where) : undefined,
  )) as { total: number }[];

  const rows = await baseQuery({
      id: applications.id,
      appliedOn: applications.appliedOn,
      stageReached: applications.stageReached,
      outcome: applications.outcome,
      fullName: candidates.fullName,
      phone: candidates.phone,
      email: candidates.email,
      cnic: candidates.cnic,
      degree: candidates.degree,
      institute: candidates.institute,
      industry: candidates.industry,
      experienceYears: candidates.experienceYears,
      salary: candidates.lastSalary,
      recruiter: recruiters.name,
      source: sources.name,
      role: roles.title,
      salesPitchStatus: applications.salesPitchStatus,
      offerStatus: applications.offerStatus,
      actualStartOn: applications.actualStartOn,
      timeToHire: applications.timeToHire,
      daysIdle: applications.daysIdle,
      lossCategory: applications.lossCategory,
      lossReason: applications.lossReason,
      remarks: applications.remarks,
    })
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(applications.appliedOn), desc(applications.id))
    .limit(limit)
    .offset(offset);

  return {
    total: totalRow?.total ?? 0,
    offset,
    limit,
    // Field-level redaction happens here, at the edge of the data layer, so no
    // route handler can forget it.
    items: (rows as Record<string, unknown>[]).map((row) => principal.redact(row)),
  };
}

/* =========================================================================
 * Metadata
 * ========================================================================= */

export async function meta(principal: Principal) {
  const where = buildWhere({}, principal);
  const [bounds] = await baseQuery({
    dateMin: sql<string | null>`min(${applications.appliedOn})`,
    dateMax: sql<string | null>`max(${applications.appliedOn})`,
    rowCount: count(),
  }).where(where.length ? and(...where) : undefined);

  return {
    ...bounds,
    stages: STAGES,
    groupable: Object.keys(GROUPABLE),
    role: principal.user.role,
    scope: principal.scope,
  };
}

export { STAGES };
