/**
 * Database fixtures for `security-test.mjs`.
 *
 *   npx tsx --conditions=react-server scripts/security-fixture.ts <command> [arg]
 *
 * The suite needs conditions that cannot be produced through the UI without
 * making the test about the UI instead of the invariant: an account suspended
 * mid-session, an account sitting at ten failed sign-ins, a session revoked out
 * from under a live cookie.
 *
 * Every account it touches is prefixed `sec-`. A stray invocation cannot
 * disturb a real one, and `cleanup` removes the lot.
 */

import { and, eq, like, sql } from "drizzle-orm";
import { loadLocalEnv } from "../src/server/db/env";
import { db } from "../src/server/db/client";
import { rateLimits, sessions, users } from "../src/server/db/schema";

const PREFIX = "sec-";

/** Guard: every mutation is restricted to the suite's own accounts. */
function ownAccountsOnly(email: string) {
  if (!email.startsWith(PREFIX)) {
    throw new Error(
      `Refusing to touch ${email}: the fixture only operates on accounts prefixed "${PREFIX}".`,
    );
  }
  return email;
}

const COMMANDS: Record<string, (arg?: string) => Promise<string>> = {
  async suspend(email = "sec-victim@bayut.sa") {
    ownAccountsOnly(email);
    await db()
      .update(users)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(eq(users.emailNormalised, email));
    // Suspension is meant to take effect now, not at expiry. The application
    // does this too; the fixture mirrors it so the test measures the read path.
    const [row] = await db().select({ id: users.id }).from(users).where(eq(users.emailNormalised, email));
    if (row) {
      await db()
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.userId, row.id));
    }
    return `suspended ${email}`;
  },

  async reinstate(email = "sec-victim@bayut.sa") {
    ownAccountsOnly(email);
    await db()
      .update(users)
      .set({ status: "active", failedSignIns: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.emailNormalised, email));
    return `reinstated ${email}`;
  },

  async delete(email = "sec-doomed@bayut.sa") {
    ownAccountsOnly(email);
    await db().delete(users).where(eq(users.emailNormalised, email));
    return `deleted ${email}`;
  },

  async revoke(email = "sec-victim@bayut.sa") {
    ownAccountsOnly(email);
    const [row] = await db().select({ id: users.id }).from(users).where(eq(users.emailNormalised, email));
    if (row) {
      await db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, row.id));
    }
    return `revoked every session for ${email}`;
  },

  async lock(email = "sec-lockout@bayut.sa") {
    ownAccountsOnly(email);
    await db()
      .update(users)
      .set({ failedSignIns: 10, lockedUntil: new Date(Date.now() + 900_000), updatedAt: new Date() })
      .where(eq(users.emailNormalised, email));
    return `locked ${email} for 15 minutes`;
  },

  async "reset-limits"() {
    // Clears the throttle for everyone: the suite runs dozens of sign-in
    // attempts and would otherwise spend most of its time rate-limited.
    await db().delete(rateLimits);
    await db()
      .update(users)
      .set({ failedSignIns: 0, lockedUntil: null })
      .where(like(users.emailNormalised, `${PREFIX}%`));
    return "rate limits cleared";
  },

  async "check-absent"(email = "uninvited@example.com") {
    const [row] = await db()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.emailNormalised, email));
    return row ? `present (id ${row.id})` : "absent";
  },

  async cleanup() {
    const removed = await db()
      .delete(users)
      .where(like(users.emailNormalised, `${PREFIX}%`))
      .returning({ email: users.email });
    await db().delete(rateLimits);
    return `removed ${removed.length} test account${removed.length === 1 ? "" : "s"}`;
  },

  async "session-count"(email = "sec-victim@bayut.sa") {
    const [row] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(users.emailNormalised, email), sql`${sessions.revokedAt} is null`));
    return `${row?.n ?? 0} live sessions`;
  },
};

async function main() {
  loadLocalEnv();
  const [command, arg] = process.argv.slice(2);
  const run = COMMANDS[command];
  if (!run) {
    console.error(`Unknown command "${command}". One of: ${Object.keys(COMMANDS).join(", ")}`);
    process.exit(1);
  }
  console.log(await run(arg));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
