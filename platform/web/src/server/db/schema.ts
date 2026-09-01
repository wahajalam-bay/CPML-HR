/**
 * Database schema.
 *
 * Two halves that deliberately do not reference each other:
 *
 *   identity   — users, sessions, tokens, invitations, audit
 *   analytics  — the recruitment warehouse, one wide row per application
 *
 * A recruiter in `users` is linked to their book by NAME, not by a foreign key
 * into `recruiters`. The source sheet is hand-maintained and its names drift;
 * a hard FK would make a typo in a spreadsheet cell able to break a login.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/* =========================================================================
 * Enums
 * ========================================================================= */

export const roleEnum = pgEnum("role", [
  "Recruiter",
  "Recruitment Manager",
  "HR Director",
  "Admin",
  "Super Admin",
]);

export const userStatusEnum = pgEnum("user_status", [
  "pending",   // signed up, email not yet verified
  "active",
  "suspended", // disabled by an admin
  "locked",    // too many failed sign-ins
]);

export const stageEnum = pgEnum("stage", [
  "applied",
  "screened",
  "phone_screen",
  "assessment",
  "sales_pitch",
  "manager_interview",
  "final_interview",
  "offer",
  "joined",
]);

export const outcomeEnum = pgEnum("outcome", [
  "In Process",
  "Hired",
  "Rejected",
  "Withdrawn",
  "Dropped Off",
  "Lapsed",
]);

export const tokenPurposeEnum = pgEnum("token_purpose", [
  "email_verification",
  "password_reset",
]);

/* =========================================================================
 * Identity
 * ========================================================================= */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    email: varchar("email", { length: 255 }).notNull(),
    // Lower-cased at write time and uniquely indexed — without this,
    // "A@x.com" and "a@x.com" are two accounts, and one of them is a
    // duplicate-registration hole.
    emailNormalised: varchar("email_normalised", { length: 255 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    // Argon2id. Null only for accounts created by invitation that have not yet
    // set a password.
    passwordHash: text("password_hash"),
    role: roleEnum("role").notNull().default("Recruiter"),
    status: userStatusEnum("status").notNull().default("pending"),

    // Links a Recruiter account to the book it owns, matched on the name as it
    // appears in the source sheet.
    recruiterName: varchar("recruiter_name", { length: 120 }),

    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    // Reset on success; drives lockout.
    failedSignIns: smallint("failed_sign_ins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_users_email_normalised").on(t.emailNormalised),
    index("ix_users_role").on(t.role),
    index("ix_users_status").on(t.status),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 of the opaque cookie token. The plaintext token never touches
    // the database, so a database leak alone cannot be replayed as a session.
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Recorded to surface "signed in from a new device" and to let a user
    // revoke a specific session.
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("ux_sessions_token_hash").on(t.tokenHash),
    index("ix_sessions_user").on(t.userId),
    index("ix_sessions_expiry").on(t.expiresAt),
  ],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    purpose: tokenPurposeEnum("purpose").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Single use: set on redemption so a token in a mail archive is inert.
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_tokens_hash").on(t.tokenHash),
    index("ix_tokens_user_purpose").on(t.userId, t.purpose),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    emailNormalised: varchar("email_normalised", { length: 255 }).notNull(),
    role: roleEnum("role").notNull().default("Recruiter"),
    recruiterName: varchar("recruiter_name", { length: 120 }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_invitations_token").on(t.tokenHash),
    index("ix_invitations_email").on(t.emailNormalised),
  ],
);

/**
 * Rate limiting.
 *
 * Kept in Postgres rather than in memory because serverless functions do not
 * share memory — an in-process counter would reset on every cold start, which
 * is exactly the condition an attacker would hit anyway.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    // "<action>:<identifier>", e.g. "signin:a@b.com" or "signin-ip:1.2.3.4"
    key: varchar("key", { length: 200 }).primaryKey(),
    count: integer("count").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  },
  (t) => [index("ix_rate_limits_window").on(t.windowStartedAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Denormalised: an audit row must stay readable after the user is deleted.
    actorUserId: text("actor_user_id"),
    actorEmail: varchar("actor_email", { length: 255 }),
    actorRole: roleEnum("actor_role"),
    action: varchar("action", { length: 60 }).notNull(),
    resource: varchar("resource", { length: 200 }).notNull(),
    // Filter scope the action ran under, so an export can be reproduced.
    scope: jsonb("scope"),
    rowCount: integer("row_count"),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    outcome: varchar("outcome", { length: 20 }).notNull().default("success"),
  },
  (t) => [
    index("ix_audit_occurred").on(t.occurredAt),
    index("ix_audit_actor").on(t.actorEmail),
    index("ix_audit_action").on(t.action),
  ],
);

/* =========================================================================
 * Analytics warehouse
 * ========================================================================= */

export const recruiters = pgTable(
  "recruiters",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 120 }).notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [uniqueIndex("ux_recruiters_name").on(t.name)],
);

export const sources = pgTable(
  "sources",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 80 }).notNull(),
    channel: varchar("channel", { length: 40 }),
    monthlyCost: real("monthly_cost"),
  },
  (t) => [uniqueIndex("ux_sources_name").on(t.name)],
);

export const roles = pgTable(
  "roles",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    title: varchar("title", { length: 120 }).notNull(),
  },
  (t) => [uniqueIndex("ux_roles_title").on(t.title)],
);

export const businessUnits = pgTable(
  "business_units",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 120 }).notNull(),
  },
  (t) => [uniqueIndex("ux_business_units_name").on(t.name)],
);

export const interviewers = pgTable(
  "interviewers",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    name: varchar("name", { length: 120 }).notNull(),
  },
  (t) => [uniqueIndex("ux_interviewers_name").on(t.name)],
);

export const candidates = pgTable(
  "candidates",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    // The only reliable identity key in the source data: emails are largely
    // absent and names are far from unique.
    phone: varchar("phone", { length: 20 }),
    fullName: varchar("full_name", { length: 160 }).notNull(),
    email: varchar("email", { length: 255 }),
    cnic: varchar("cnic", { length: 20 }),
    city: varchar("city", { length: 80 }),
    degree: varchar("degree", { length: 40 }),
    institute: varchar("institute", { length: 160 }),
    industry: varchar("industry", { length: 80 }),
    experienceYears: real("experience_years"),
    lastSalary: integer("last_salary"),
  },
  (t) => [
    index("ix_candidates_phone").on(t.phone),
    index("ix_candidates_name").on(t.fullName),
    index("ix_candidates_profile").on(t.degree, t.industry),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    // Stable hash of the source row so re-syncs update rather than duplicate.
    sourceRowKey: varchar("source_row_key", { length: 64 }).notNull(),

    candidateId: integer("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    recruiterId: integer("recruiter_id").references(() => recruiters.id),
    sourceId: integer("source_id").references(() => sources.id),
    roleId: integer("role_id").references(() => roles.id),
    hiringManagerId: integer("hiring_manager_id").references(() => interviewers.id),
    businessUnitId: integer("business_unit_id").references(() => businessUnits.id),

    appliedOn: date("applied_on").notNull(),
    stageReached: stageEnum("stage_reached").notNull(),
    // Bitmask of cleared stages — one integer answers "did they pass stage N"
    // for every N, without a per-stage column or a join.
    stagePassedMask: integer("stage_passed_mask").notNull().default(0),
    outcome: outcomeEnum("outcome").notNull(),
    exitStage: stageEnum("exit_stage"),

    callOn: date("call_on"),
    assessmentOn: date("assessment_on"),
    salesPitchOn: date("sales_pitch_on"),
    managerInterviewOn: date("manager_interview_on"),
    finalInterviewOn: date("final_interview_on"),
    offerOn: date("offer_on"),
    plannedStartOn: date("planned_start_on"),
    actualStartOn: date("actual_start_on"),
    lastActivityOn: date("last_activity_on"),

    screenStatus: varchar("screen_status", { length: 40 }),
    callStatus: varchar("call_status", { length: 40 }),
    assessmentStatus: varchar("assessment_status", { length: 40 }),
    salesPitchStatus: varchar("sales_pitch_status", { length: 40 }),
    managerStatus: varchar("manager_status", { length: 40 }),
    finalStatus: varchar("final_status", { length: 40 }),
    offerStatus: varchar("offer_status", { length: 40 }),
    finalDisposition: varchar("final_disposition", { length: 60 }),

    lossCategory: varchar("loss_category", { length: 40 }),
    lossReason: varchar("loss_reason", { length: 120 }),
    // True when inferred from inactivity rather than recorded by a recruiter.
    lossInferred: boolean("loss_inferred").notNull().default(false),

    daysToCall: smallint("days_to_call"),
    daysCallToAssessment: smallint("days_call_to_assessment"),
    daysAssessmentToPitch: smallint("days_assessment_to_pitch"),
    daysPitchToManager: smallint("days_pitch_to_manager"),
    daysManagerToFinal: smallint("days_manager_to_final"),
    daysFinalToOffer: smallint("days_final_to_offer"),
    daysOfferToJoin: smallint("days_offer_to_join"),
    timeToOffer: smallint("time_to_offer"),
    timeToHire: smallint("time_to_hire"),
    startDateSlip: smallint("start_date_slip"),
    daysIdle: smallint("days_idle"),

    applicationSeq: smallint("application_seq").notNull().default(1),
    isRepeat: boolean("is_repeat").notNull().default(false),
    campaign: varchar("campaign", { length: 60 }),
    remarks: text("remarks"),

    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ux_applications_source_key").on(t.sourceRowKey),
    // The dominant access pattern is "a date window sliced by one dimension",
    // so every hot filter pairs with applied_on.
    index("ix_app_date_recruiter").on(t.appliedOn, t.recruiterId),
    index("ix_app_date_source").on(t.appliedOn, t.sourceId),
    index("ix_app_date_role").on(t.appliedOn, t.roleId),
    index("ix_app_date_outcome").on(t.appliedOn, t.outcome),
    index("ix_app_stage_outcome").on(t.stageReached, t.outcome),
    index("ix_app_candidate").on(t.candidateId),
  ],
);

export const syncRuns = pgTable("sync_runs", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  rowsRead: integer("rows_read").notNull().default(0),
  rowsWritten: integer("rows_written").notNull().default(0),
  rowsRejected: integer("rows_rejected").notNull().default(0),
  error: text("error"),
});

/* =========================================================================
 * Relations
 * ========================================================================= */

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  tokens: many(verificationTokens),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const applicationsRelations = relations(applications, ({ one }) => ({
  candidate: one(candidates, {
    fields: [applications.candidateId],
    references: [candidates.id],
  }),
  recruiter: one(recruiters, {
    fields: [applications.recruiterId],
    references: [recruiters.id],
  }),
  source: one(sources, { fields: [applications.sourceId], references: [sources.id] }),
  role: one(roles, { fields: [applications.roleId], references: [roles.id] }),
  businessUnit: one(businessUnits, {
    fields: [applications.businessUnitId],
    references: [businessUnits.id],
  }),
  hiringManager: one(interviewers, {
    fields: [applications.hiringManagerId],
    references: [interviewers.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Application = typeof applications.$inferSelect;
