/**
 * Load the canonical dataset into Postgres.
 *
 *   npm run db:seed              -- incremental (upsert on the source row key)
 *   npm run db:seed -- --reset   -- truncate the warehouse first
 *   npm run db:seed -- --admin you@bayut.sa --password '...'  -- bootstrap admin
 *
 * Reads `platform/data/canonical.jsonl`, produced by `etl/normalize.py`. The
 * ETL owns cleaning; this owns loading. Keeping them separate means a schema
 * change never requires re-parsing a 17 MB spreadsheet.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { loadLocalEnv } from "../src/server/db/env";
import { db } from "../src/server/db/client";
import {
  applications,
  businessUnits,
  candidates,
  interviewers,
  recruiters,
  roles,
  sources,
  users,
} from "../src/server/db/schema";
import { hashPassword, normaliseEmail } from "../src/server/auth/crypto";

/* -------------------------------------------------------------------------
 * Canonical record shape, as emitted by etl/normalize.py
 * ---------------------------------------------------------------------- */

interface CanonicalRecord {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  cnic: string | null;
  city: string | null;
  source: string | null;
  applied_role: string | null;
  drive: string | null;
  industry: string | null;
  experience_years: number | null;
  degree: string | null;
  institute: string | null;
  current_salary: number | null;
  recruiter: string | null;
  hiring_manager: string | null;
  team: string | null;
  screen_status: string | null;
  call_status: string | null;
  assessment_status: string | null;
  sp_status: string | null;
  manager_status: string | null;
  final_status: string | null;
  offer_status: string | null;
  outcome_status: string | null;
  applied_date: string | null;
  call_date: string | null;
  assessment_date: string | null;
  sp_date: string | null;
  manager_date: string | null;
  final_date: string | null;
  offer_date: string | null;
  planned_doj: string | null;
  actual_doj: string | null;
  last_activity: string | null;
  stage_reached: number;
  stage_passed: number;
  outcome: string;
  exit_stage: string | null;
  loss_category: string | null;
  loss_reason: string | null;
  remarks: string | null;
  d_to_call: number | null;
  d_call_to_assessment: number | null;
  d_assessment_to_sp: number | null;
  d_sp_to_manager: number | null;
  d_manager_to_final: number | null;
  d_final_to_offer: number | null;
  d_offer_to_join: number | null;
  time_to_hire: number | null;
  time_to_offer: number | null;
  doj_slip: number | null;
  days_idle: number | null;
  application_seq: number;
  is_repeat: boolean;
  candidate_key: string;
}

const STAGES = [
  "applied", "screened", "phone_screen", "assessment", "sales_pitch",
  "manager_interview", "final_interview", "offer", "joined",
] as const;

const SOURCE_CHANNEL: Record<string, string> = {
  LinkedIn: "Job Board",
  Indeed: "Job Board",
  Rozee: "Job Board",
  Breezy: "Job Board",
  Referral: "Referral",
  "Self Sourced": "Outbound",
  Telesales: "Outbound",
  "Open House": "Event",
  "Recruitment Drive": "Event",
  "Walk-In": "Walk-In",
};

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

const flag = (name: string) => process.argv.includes(`--${name}`);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/**
 * Stable identity for a source row, so a re-seed updates rather than
 * duplicates. Must match the key the Sheets sync computes.
 *
 * The natural tuple — who applied, when, for what — is NOT unique: 965 of the
 * 28,366 rows share one with another row, because a walk-in drive can log the
 * same person for the same role twice in a day. Keying on the tuple alone
 * silently dropped those on insert, so the warehouse held 27,401 applications
 * while the static dataset held 28,366, and the same metric computed two
 * different numbers depending on which posture you were in.
 *
 * `occurrence` is the ordinal within the group, assigned in source order. It
 * keeps the key stable across re-seeds — the rows arrive in the same order —
 * while letting genuine same-day repeats through as the separate applications
 * they are.
 */
async function rowKey(record: CanonicalRecord, occurrence: number): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256")
    .update(
      [
        record.phone ?? "",
        record.name,
        record.applied_date ?? "",
        record.applied_role ?? "",
        String(occurrence),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}

/** Insert-if-absent for a dimension, returning a name → id map. */
async function upsertDimension<T extends { id: number }>(
  table: typeof recruiters | typeof sources | typeof roles | typeof businessUnits | typeof interviewers,
  column: "name" | "title",
  values: { name: string; channel?: string | null }[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!values.length) return map;

  const rows = values.map((v) =>
    column === "title"
      ? { title: v.name }
      : v.channel !== undefined
        ? { name: v.name, channel: v.channel }
        : { name: v.name },
  );

  await db()
    .insert(table as never)
    .values(rows as never)
    .onConflictDoNothing();

  const existing = (await db().select().from(table as never)) as unknown as (T &
    Record<string, string>)[];
  for (const row of existing) {
    map.set(row[column], row.id);
  }
  return map;
}

/* -------------------------------------------------------------------------
 * Main
 * ---------------------------------------------------------------------- */

async function main() {
  // The client reads DATABASE_URL lazily, so this only has to happen before
  // the first query — but doing it first makes the failure below meaningful.
  loadLocalEnv();

  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Add it to .env.local, or export it before running.",
    );
    process.exit(1);
  }

  /* ---- Bootstrap admin ------------------------------------------------ */
  const adminEmail = arg("admin");
  if (adminEmail) {
    const password = arg("password");
    if (!password || password.length < 12) {
      console.error("--admin requires --password with at least 12 characters.");
      process.exit(1);
    }
    const passwordHash = await hashPassword(password);
    await db()
      .insert(users)
      .values({
        email: adminEmail,
        emailNormalised: normaliseEmail(adminEmail),
        name: arg("name") ?? "Administrator",
        passwordHash,
        role: "Admin",
        // Bootstrapped accounts skip verification: there is no one else to
        // approve them, and the operator running this already controls the
        // database.
        status: "active",
        emailVerifiedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.emailNormalised,
        set: { passwordHash, role: "Admin", status: "active", emailVerifiedAt: new Date() },
      });
    console.log(`✓ Admin account ready: ${adminEmail}`);
  }

  /* ---- Dataset -------------------------------------------------------- */
  const path = resolve(process.cwd(), "..", "data", "canonical.jsonl");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(
      `Could not read ${path}.\nRun the ETL first:  python ../etl/normalize.py`,
    );
    process.exit(adminEmail ? 0 : 1);
  }

  const records: CanonicalRecord[] = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CanonicalRecord);

  console.log(`Read ${records.length.toLocaleString()} records.`);

  if (flag("reset")) {
    console.log("Truncating the warehouse…");
    // RESTART IDENTITY so a re-seed produces the same ids; CASCADE because
    // applications reference every dimension.
    await db().execute(
      sql`truncate table ${applications}, ${candidates}, ${recruiters}, ${sources}, ${roles}, ${businessUnits}, ${interviewers} restart identity cascade`,
    );
  }

  /* ---- Dimensions ----------------------------------------------------- */
  const distinct = <K extends keyof CanonicalRecord>(key: K) =>
    [...new Set(records.map((r) => r[key]).filter(Boolean))] as string[];

  const recruiterMap = await upsertDimension(
    recruiters, "name",
    distinct("recruiter").map((name) => ({ name })),
  );
  const sourceMap = await upsertDimension(
    sources, "name",
    distinct("source").map((name) => ({ name, channel: SOURCE_CHANNEL[name] ?? null })),
  );
  const roleMap = await upsertDimension(
    roles, "title",
    distinct("applied_role").map((name) => ({ name })),
  );
  const unitMap = await upsertDimension(
    businessUnits, "name",
    distinct("team").map((name) => ({ name })),
  );
  const interviewerMap = await upsertDimension(
    interviewers, "name",
    distinct("hiring_manager").map((name) => ({ name })),
  );

  console.log(
    `✓ Dimensions: ${recruiterMap.size} recruiters, ${sourceMap.size} sources, ` +
      `${roleMap.size} roles, ${unitMap.size} units, ${interviewerMap.size} interviewers`,
  );

  /* ---- Candidates ------------------------------------------------------
     One row per person, not per application: roughly a fifth of the records
     are repeat applications, and collapsing the two would overstate the
     addressable market by that margin.                                     */
  const byKey = new Map<string, CanonicalRecord>();
  for (const record of records) {
    // Keep the richest version of each person — later records usually carry
    // more of the optional fields.
    const existing = byKey.get(record.candidate_key);
    if (!existing || (record.experience_years != null && existing.experience_years == null)) {
      byKey.set(record.candidate_key, record);
    }
  }

  const candidateRows = [...byKey.values()].map((r) => ({
    phone: r.phone,
    fullName: r.name,
    email: r.email,
    cnic: r.cnic,
    city: r.city,
    degree: r.degree,
    institute: r.institute,
    industry: r.industry,
    experienceYears: r.experience_years,
    lastSalary: r.current_salary,
  }));

  const CHUNK = 500;
  const candidateIds = new Map<string, number>();

  for (let i = 0; i < candidateRows.length; i += CHUNK) {
    const inserted = await db()
      .insert(candidates)
      .values(candidateRows.slice(i, i + CHUNK))
      .returning({ id: candidates.id, phone: candidates.phone, fullName: candidates.fullName });
    for (const row of inserted) {
      candidateIds.set(row.phone ?? `n:${row.fullName.toLowerCase()}`, row.id);
    }
    process.stdout.write(
      `\r  candidates ${Math.min(i + CHUNK, candidateRows.length).toLocaleString()}/${candidateRows.length.toLocaleString()}`,
    );
  }
  console.log(`\n✓ ${candidateIds.size.toLocaleString()} candidates`);

  /* ---- Applications ---------------------------------------------------- */
  const seenTuple = new Map<string, number>();
  const applicationRows = await Promise.all(
    records.map(async (r) => {
      const tuple = [r.phone ?? "", r.name, r.applied_date ?? "", r.applied_role ?? ""].join("|");
      const occurrence = seenTuple.get(tuple) ?? 0;
      seenTuple.set(tuple, occurrence + 1);
      return {
      sourceRowKey: await rowKey(r, occurrence),
      candidateId: candidateIds.get(r.candidate_key)!,
      recruiterId: r.recruiter ? (recruiterMap.get(r.recruiter) ?? null) : null,
      sourceId: r.source ? (sourceMap.get(r.source) ?? null) : null,
      roleId: r.applied_role ? (roleMap.get(r.applied_role) ?? null) : null,
      hiringManagerId: r.hiring_manager ? (interviewerMap.get(r.hiring_manager) ?? null) : null,
      businessUnitId: r.team ? (unitMap.get(r.team) ?? null) : null,
      appliedOn: r.applied_date!,
      stageReached: STAGES[r.stage_reached],
      stagePassedMask: r.stage_passed,
      outcome: r.outcome as (typeof applications.outcome.enumValues)[number],
      exitStage: r.exit_stage as (typeof applications.exitStage.enumValues)[number] | null,
      callOn: r.call_date,
      assessmentOn: r.assessment_date,
      salesPitchOn: r.sp_date,
      managerInterviewOn: r.manager_date,
      finalInterviewOn: r.final_date,
      offerOn: r.offer_date,
      plannedStartOn: r.planned_doj,
      actualStartOn: r.actual_doj,
      lastActivityOn: r.last_activity,
      screenStatus: r.screen_status,
      callStatus: r.call_status,
      assessmentStatus: r.assessment_status,
      salesPitchStatus: r.sp_status,
      managerStatus: r.manager_status,
      finalStatus: r.final_status,
      offerStatus: r.offer_status,
      finalDisposition: r.outcome_status,
      lossCategory: r.loss_category,
      lossReason: r.loss_reason,
      lossInferred: r.loss_reason === "Went Cold",
      daysToCall: r.d_to_call,
      daysCallToAssessment: r.d_call_to_assessment,
      daysAssessmentToPitch: r.d_assessment_to_sp,
      daysPitchToManager: r.d_sp_to_manager,
      daysManagerToFinal: r.d_manager_to_final,
      daysFinalToOffer: r.d_final_to_offer,
      daysOfferToJoin: r.d_offer_to_join,
      timeToOffer: r.time_to_offer,
      timeToHire: r.time_to_hire,
      startDateSlip: r.doj_slip,
      daysIdle: r.days_idle,
      applicationSeq: r.application_seq,
      isRepeat: r.is_repeat,
      campaign: r.drive,
      remarks: r.remarks,
      };
    }),
  );

  let written = 0;
  for (let i = 0; i < applicationRows.length; i += CHUNK) {
    const chunk = applicationRows.slice(i, i + CHUNK);
    await db()
      .insert(applications)
      .values(chunk)
      .onConflictDoNothing({ target: applications.sourceRowKey });
    written += chunk.length;
    process.stdout.write(
      `\r  applications ${written.toLocaleString()}/${applicationRows.length.toLocaleString()}`,
    );
  }
  console.log(`\n✓ ${written.toLocaleString()} applications`);

  const [check] = await db()
    .select({ total: sql<number>`count(*)::int` })
    .from(applications);
  console.log(`\nWarehouse now holds ${check.total.toLocaleString()} applications.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exit(1);
  });
