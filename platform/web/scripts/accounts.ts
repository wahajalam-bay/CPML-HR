/**
 * Provision accounts.
 *
 *   npm run accounts -- --demo-set          three accounts, one per access tier
 *   npm run accounts -- --list              who exists and what they can reach
 *   npm run accounts -- --create you@x.com --role Admin --password '…' --name '…'
 *
 * This is the bootstrap path: it runs against the database directly, so it
 * works before any account exists. Everything it does can also be done from
 * Administration → Users once one administrator is in place, and that is the
 * route to use day to day — it audits who created whom.
 *
 * Passwords are hashed with the same Argon2id parameters the application uses.
 * Nothing here stores or logs one in the clear beyond echoing what you passed
 * in, so treat the terminal output accordingly.
 */

import { asc, eq, sql } from "drizzle-orm";
import { loadLocalEnv } from "../src/server/db/env";
import { db } from "../src/server/db/client";
import { applications, recruiters, users } from "../src/server/db/schema";
import { hashPassword, normaliseEmail } from "../src/server/auth/crypto";
import {
  ROLES,
  ROLE_CAPABILITIES,
  ROLE_DESCRIPTION,
  rowScopeFor,
  type Role,
} from "../src/lib/auth/permissions";

const flag = (name: string) => process.argv.includes(`--${name}`);
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/* -------------------------------------------------------------------------
 * Provisioning
 * ---------------------------------------------------------------------- */

interface Spec {
  email: string;
  name: string;
  role: Role;
  password: string;
  /** Recruiter name in the dataset. Required for Recruiter, ignored otherwise. */
  recruiterName?: string;
}

async function provision(spec: Spec): Promise<"created" | "updated"> {
  const normalised = normaliseEmail(spec.email);
  const passwordHash = await hashPassword(spec.password);
  const recruiterName = spec.role === "Recruiter" ? (spec.recruiterName ?? null) : null;

  if (spec.role === "Recruiter" && !recruiterName) {
    throw new Error(
      `${spec.email}: a Recruiter account needs --book, otherwise it is scoped to nothing and shows no records.`,
    );
  }

  const [existing] = await db()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.emailNormalised, normalised))
    .limit(1);

  const values = {
    email: spec.email,
    emailNormalised: normalised,
    name: spec.name,
    passwordHash,
    role: spec.role,
    recruiterName,
    // Active and verified: whoever runs this already controls the database, so
    // an email round-trip proves nothing that has not already been proven.
    status: "active" as const,
    emailVerifiedAt: new Date(),
    failedSignIns: 0,
    lockedUntil: null,
    updatedAt: new Date(),
  };

  await db()
    .insert(users)
    .values(values)
    .onConflictDoUpdate({ target: users.emailNormalised, set: values });

  return existing ? "updated" : "created";
}

/* -------------------------------------------------------------------------
 * The demo set
 *
 * One account per tier of access, chosen so the difference between them is
 * visible rather than theoretical:
 *
 *   Recruiter           — one book, no cross-team pages, no exports, no salary
 *   Recruitment Manager — every book, exports, salary and notes
 *   Admin               — the above plus access administration and user creation
 * ---------------------------------------------------------------------- */

/** The recruiter with the largest book, so the scoped account is not thin. */
async function busiestRecruiter(): Promise<string | null> {
  const [row] = await db()
    .select({
      name: recruiters.name,
      total: sql<number>`count(${applications.id})::int`,
    })
    .from(recruiters)
    .leftJoin(applications, eq(applications.recruiterId, recruiters.id))
    .groupBy(recruiters.name)
    .orderBy(sql`count(${applications.id}) desc`)
    .limit(1);
  return row?.name ?? null;
}

async function demoSet() {
  const book = await busiestRecruiter();
  if (!book) {
    throw new Error(
      "No recruiters in the dataset. Run the seed first: npm run db:seed -- --reset",
    );
  }

  const specs: Spec[] = [
    {
      email: "recruiter@bayut.sa",
      name: "Limited Access",
      role: "Recruiter",
      password: "recruiter-limited-2026",
      recruiterName: book,
    },
    {
      email: "manager@bayut.sa",
      name: "Medium Access",
      role: "Recruitment Manager",
      password: "manager-medium-2026",
    },
    {
      email: "admin@bayut.sa",
      name: "Full Access",
      role: "Admin",
      password: "admin-full-access-2026",
    },
  ];

  console.log("Provisioning three accounts.\n");

  for (const spec of specs) {
    const outcome = await provision(spec);
    const scope = rowScopeFor(spec.role, spec.recruiterName ?? null);

    console.log(`${outcome === "created" ? "+" : "~"} ${spec.email}`);
    console.log(`    password  ${spec.password}`);
    console.log(`    role      ${spec.role}`);
    console.log(
      `    scope     ${
        scope.kind === "all"
          ? "every record"
          : scope.kind === "own-book"
            ? `${scope.recruiter}'s book only`
            : "nothing"
      }`,
    );
    console.log(`    ${ROLE_DESCRIPTION[spec.role]}\n`);
  }

  console.log(
    "Change these passwords, or delete the accounts, before this reaches real users.\n" +
      "They are written in a script in the repository, which makes them public.",
  );
}

/* -------------------------------------------------------------------------
 * Listing
 * ---------------------------------------------------------------------- */

async function list() {
  const rows = await db()
    .select({
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      recruiterName: users.recruiterName,
      lastSignInAt: users.lastSignInAt,
    })
    .from(users)
    .orderBy(asc(users.email));

  if (!rows.length) {
    console.log("No accounts. Run: npm run accounts -- --demo-set");
    return;
  }

  for (const row of rows) {
    const scope = rowScopeFor(row.role as Role, row.recruiterName);
    const pages = [...ROLE_CAPABILITIES[row.role as Role]].filter((c) =>
      c.startsWith("page."),
    ).length;

    console.log(`${row.email}`);
    console.log(`    ${row.name} · ${row.role} · ${row.status}`);
    console.log(
      `    ${pages} pages · ${
        scope.kind === "all"
          ? "every record"
          : scope.kind === "own-book"
            ? `${scope.recruiter}'s book`
            : "no records (unmapped)"
      }`,
    );
    console.log(
      `    last signed in ${
        row.lastSignInAt ? row.lastSignInAt.toISOString().slice(0, 16).replace("T", " ") : "never"
      }\n`,
    );
  }
}

/* -------------------------------------------------------------------------
 * Main
 * ---------------------------------------------------------------------- */

async function main() {
  loadLocalEnv();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Start Postgres with `npm run db:dev`.");
    process.exit(1);
  }

  if (flag("list")) return list();
  if (flag("demo-set")) return demoSet();

  const email = arg("create");
  if (email) {
    const role = (arg("role") ?? "Recruiter") as Role;
    if (!ROLES.includes(role)) {
      console.error(`Unknown role "${role}". One of: ${ROLES.join(", ")}`);
      process.exit(1);
    }
    const password = arg("password");
    if (!password || password.length < 12) {
      console.error("--password is required and must be at least 12 characters.");
      process.exit(1);
    }
    const outcome = await provision({
      email,
      name: arg("name") ?? email.split("@")[0],
      role,
      password,
      recruiterName: arg("book"),
    });
    console.log(`${outcome === "created" ? "Created" : "Updated"} ${email} as ${role}.`);
    return;
  }

  console.log(
    "Usage:\n" +
      "  npm run accounts -- --demo-set\n" +
      "  npm run accounts -- --list\n" +
      "  npm run accounts -- --create you@bayut.sa --role Admin --password '…' --name '…'\n" +
      "  npm run accounts -- --create r@bayut.sa --role Recruiter --book 'Sara Khan' --password '…'\n",
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
