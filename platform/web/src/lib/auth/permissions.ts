/**
 * The access-control model.
 *
 * One source of truth for every authorisation decision in the product. The
 * API mirrors this exact model in `api/app/core/security.py`; the two must be
 * changed together.
 *
 * ── Where enforcement actually happens ──────────────────────────────────
 *
 * Everything in this file is UX enforcement: it decides what a signed-in user
 * is shown and offered. It is NOT the security boundary. The role lives in the
 * browser, so a determined user can change it.
 *
 * The real boundary is the API. `/api/v1/*` re-derives the role from a signed
 * JWT and:
 *   • scopes rows       — a Recruiter's queries are rewritten to their own book
 *   • redacts fields    — restricted columns are removed from the payload
 *   • refuses actions   — exports and admin routes 403 on rank
 *
 * The corollary matters: the browser must never be handed data the signed-in
 * role may not see. `DATASET_MODE` below records which posture is in force, and
 * the app states it plainly in the UI rather than implying a guarantee it
 * cannot make.
 */

/* =========================================================================
 * Roles
 * ========================================================================= */

export const ROLES = [
  "Recruiter",
  "Recruitment Manager",
  "HR Director",
  "Admin",
  "Super Admin",
] as const;

export type Role = (typeof ROLES)[number];

/** Ascending authority. Used for inheritance and for "at least" checks. */
export const ROLE_RANK: Record<Role, number> = {
  Recruiter: 0,
  "Recruitment Manager": 1,
  "HR Director": 2,
  Admin: 3,
  "Super Admin": 4,
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  Recruiter:
    "Works a personal book of candidates. Sees their own pipeline and the contact details needed to run it — nothing across the wider team.",
  "Recruitment Manager":
    "Runs the recruiting team. Sees every recruiter's pipeline, compensation data needed for offer decisions, and can export reports.",
  "HR Director":
    "Accountable for the function. Adds identity documents, the full audit trail and organisation-wide reporting.",
  Admin:
    "Operates the platform. Adds access administration, data synchronisation control and retention settings.",
  "Super Admin":
    "Break-glass access. Everything Admin has, plus the ability to grant Admin and to read the raw ingestion log.",
};

/* =========================================================================
 * Capabilities
 *
 * Atomic, checkable permissions. Grouped by what they protect so a reviewer
 * can read the grant table and see the shape of a role at a glance.
 * ========================================================================= */

export const CAPABILITIES = [
  // ---- Pages ----------------------------------------------------------
  "page.command-center",
  "page.pipeline",
  "page.velocity",
  "page.attrition",
  "page.health",
  "page.recruiters",
  "page.recruiter-profile",
  "page.interviewers",
  "page.business-units",
  "page.sources",
  "page.talent",
  "page.roles",
  "page.candidates",
  "page.reports",
  "page.access-admin",
  "page.audit",

  // ---- Row scope ------------------------------------------------------
  /** See every recruiter's records, not just your own. */
  "data.all-recruiters",

  // ---- Fields ---------------------------------------------------------
  "field.phone",
  "field.email",
  "field.cnic",
  "field.salary",
  "field.remarks",

  // ---- Actions --------------------------------------------------------
  "action.export.csv",
  "action.export.excel",
  "action.export.pdf",
  "action.save-view",
  "action.switch-role",
  "action.sync-data",
  /**
   * Create an account outright — set the password, skip the email round-trip.
   *
   * Separate from `page.access-admin` because it is a materially different
   * power: inviting someone still requires them to control the mailbox, while
   * this mints working credentials on the spot. Splitting them means the grant
   * table shows who holds it, and an audit can ask why.
   */
  "action.create-user",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Capabilities granted at each rank. A role inherits everything from every
 * lower rank, so each entry lists only what that rank ADDS. Reading the table
 * top to bottom is reading the escalation path.
 */
const GRANTS: Record<Role, Capability[]> = {
  Recruiter: [
    "page.command-center",
    "page.pipeline",
    "page.sources",
    "page.talent",
    "page.candidates",
    // Contact details are the recruiter's working tools — without them they
    // cannot do the job the rest of the platform measures.
    "field.phone",
    "field.email",
    "action.save-view",
  ],

  "Recruitment Manager": [
    "page.velocity",
    "page.attrition",
    "page.health",
    "page.recruiters",
    "page.recruiter-profile",
    "page.interviewers",
    "page.business-units",
    "page.roles",
    "page.reports",
    // Managers compare across the team; that is the job.
    "data.all-recruiters",
    // Needed to judge whether an offer is competitive.
    "field.salary",
    "field.remarks",
    "action.export.csv",
    "action.export.excel",
    "action.export.pdf",
  ],

  "HR Director": [
    "page.audit",
    // Identity documents: a compliance need, not an operational one.
    "field.cnic",
  ],

  Admin: [
    "page.access-admin",
    "action.create-user",
    "action.sync-data",
    "action.switch-role",
  ],

  "Super Admin": [],
};

/** Fully expanded capability set per role, resolved once at module load. */
export const ROLE_CAPABILITIES: Record<Role, ReadonlySet<Capability>> = (() => {
  const resolved = {} as Record<Role, Set<Capability>>;
  const ordered = [...ROLES].sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);
  const accumulated = new Set<Capability>();
  for (const role of ordered) {
    for (const capability of GRANTS[role]) accumulated.add(capability);
    resolved[role] = new Set(accumulated);
  }
  return resolved;
})();

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function canAll(role: Role, capabilities: Capability[]): boolean {
  return capabilities.every((c) => can(role, c));
}

/** The lowest role that holds a capability — used to explain a denial. */
export function requiredRoleFor(capability: Capability): Role | null {
  const ordered = [...ROLES].sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);
  return ordered.find((role) => can(role, capability)) ?? null;
}

/* =========================================================================
 * Page policy
 *
 * Route → the capability that opens it. Matched longest-prefix-first so
 * `/recruiters/Sara Khan` resolves to the profile policy rather than the list
 * policy, and an unmapped route fails closed.
 * ========================================================================= */

const PAGE_POLICY: { prefix: string; capability: Capability }[] = [
  { prefix: "/admin/users", capability: "page.access-admin" },
  { prefix: "/recruiters/", capability: "page.recruiter-profile" },
  { prefix: "/recruiters", capability: "page.recruiters" },
  { prefix: "/pipeline", capability: "page.pipeline" },
  { prefix: "/velocity", capability: "page.velocity" },
  { prefix: "/attrition", capability: "page.attrition" },
  { prefix: "/health", capability: "page.health" },
  { prefix: "/interviewers", capability: "page.interviewers" },
  { prefix: "/business-units", capability: "page.business-units" },
  { prefix: "/sources", capability: "page.sources" },
  { prefix: "/talent", capability: "page.talent" },
  { prefix: "/roles", capability: "page.roles" },
  { prefix: "/candidates", capability: "page.candidates" },
  { prefix: "/reports", capability: "page.reports" },
  { prefix: "/admin/access", capability: "page.access-admin" },
  { prefix: "/admin/audit", capability: "page.audit" },
  { prefix: "/", capability: "page.command-center" },
];

export function capabilityForPath(pathname: string): Capability {
  // Longest prefix wins, so nested routes are never shadowed by their parent.
  const match = [...PAGE_POLICY]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((policy) =>
      policy.prefix === "/" ? pathname === "/" : pathname.startsWith(policy.prefix),
    );
  // Unmapped routes fail closed: a new page is inaccessible until someone
  // decides who should see it.
  return match?.capability ?? "page.access-admin";
}

export function canAccessPath(role: Role, pathname: string): boolean {
  return can(role, capabilityForPath(pathname));
}

/* =========================================================================
 * Field policy
 * ========================================================================= */

/**
 * Data fields that carry a restriction, and why. The reason is surfaced in the
 * UI wherever a value is withheld — a bare "Restricted" invites a support
 * ticket; an explained one does not.
 */
export const PROTECTED_FIELDS = {
  phone: {
    capability: "field.phone" as Capability,
    label: "Phone number",
    reason: "Direct contact details are limited to people who run outreach.",
  },
  email: {
    capability: "field.email" as Capability,
    label: "Email address",
    reason: "Direct contact details are limited to people who run outreach.",
  },
  cnic: {
    capability: "field.cnic" as Capability,
    label: "National identity number",
    reason: "Government identity documents are restricted to HR Director and above.",
  },
  salary: {
    capability: "field.salary" as Capability,
    label: "Compensation",
    reason: "Salary history is restricted to roles that make offer decisions.",
  },
  remarks: {
    capability: "field.remarks" as Capability,
    label: "Recruiter notes",
    reason: "Free-text notes can contain unstructured personal information.",
  },
} as const;

export type ProtectedField = keyof typeof PROTECTED_FIELDS;

export function canSeeField(role: Role, field: ProtectedField | string): boolean {
  const policy = PROTECTED_FIELDS[field as ProtectedField];
  // Unprotected fields are open by default; protection is opt-in and explicit.
  return policy ? can(role, policy.capability) : true;
}

/**
 * Strip protected keys a role may not see.
 *
 * Keys are REMOVED rather than set to null: an explicit null is
 * indistinguishable from "the source sheet had no value here", and that
 * ambiguity would silently corrupt any coverage statistic computed downstream.
 */
export function redact<T extends Record<string, unknown>>(
  payload: T,
  role: Role,
): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (canSeeField(role, key)) out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

/* =========================================================================
 * Row scope
 * ========================================================================= */

export type RowScope =
  | { kind: "all" }
  | { kind: "own-book"; recruiter: string }
  /** Identified as a recruiter-level user but with no book mapped to them. */
  | { kind: "none"; reason: string };

/**
 * Which records a session may see at all.
 *
 * A Recruiter is scoped to the book they own. This is applied before any
 * user-chosen filter, so it cannot be widened from the UI — clearing filters
 * returns a Recruiter to their own book, never to the whole dataset.
 */
export function rowScopeFor(role: Role, recruiterKey: string | null): RowScope {
  if (can(role, "data.all-recruiters")) return { kind: "all" };
  if (recruiterKey) return { kind: "own-book", recruiter: recruiterKey };
  return {
    kind: "none",
    reason:
      "This account is a Recruiter but is not linked to a recruiter record in the dataset, so it has no book to show.",
  };
}

/* =========================================================================
 * Dataset posture
 * ========================================================================= */

export type DatasetMode = "client-full" | "server-scoped";

/**
 * How the dataset reaches the browser.
 *
 * `client-full`   — the whole columnar store is shipped and scoping is applied
 *                   in the browser. Fast and fully offline-capable, but the
 *                   payload contains records the current role may not see, so
 *                   client-side scoping is presentation only.
 * `server-scoped` — the store is fetched from an authenticated endpoint that
 *                   returns only what the role may see. The only posture in
 *                   which client-side scoping is also a security boundary.
 *
 * Set from the environment so a deployment cannot be in the permissive mode by
 * accident, and so the UI can say which one is in force.
 */
export const DATASET_MODE: DatasetMode =
  (process.env.NEXT_PUBLIC_DATASET_MODE as DatasetMode) === "server-scoped"
    ? "server-scoped"
    : "client-full";

export const DATASET_MODE_NOTE: Record<DatasetMode, string> = {
  "client-full":
    "The full dataset is loaded in the browser and role scoping is applied on top of it. Access rules here govern what is shown, not what was delivered — treat this build as an analytics preview, not as a control on who can reach the underlying records.",
  "server-scoped":
    "The dataset is fetched per session from an authenticated endpoint that returns only the records and fields this role may see. Row scoping and field redaction are enforced before the data leaves the server.",
};

/* =========================================================================
 * Audit
 * ========================================================================= */

/** Actions worth recording. Reads of personal data and anything that leaves. */
export const AUDITED_ACTIONS = [
  "session.role-changed",
  "access.denied",
  "record.viewed",
  "field.revealed",
  "export.csv",
  "export.excel",
  "export.pdf",
  "export.print",
  "view.saved",
] as const;

export type AuditAction = (typeof AUDITED_ACTIONS)[number];

export interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  role: Role;
  action: AuditAction;
  resource: string;
  /** Filter scope the action ran under, so an export can be reproduced. */
  scope?: string;
  rowCount?: number;
}
