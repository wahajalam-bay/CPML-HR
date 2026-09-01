import "server-only";

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { sessions, users, type User } from "@/server/db/schema";
import { generateToken, hashToken } from "./crypto";
import { clientIp } from "./rate-limit";
import type { Role } from "@/lib/auth/permissions";

/**
 * Session management.
 *
 * Opaque random tokens in an httpOnly cookie, with the session record in
 * Postgres — deliberately not a self-contained JWT. The dashboard needs
 * revocation that takes effect immediately: an administrator suspending an
 * account, or a user signing out everywhere, has to end the session *now*, and
 * a stateless token stays valid until it expires no matter what the database
 * says.
 *
 * The cost is one indexed lookup per request, which on Neon's HTTP driver is a
 * few milliseconds. That is the right trade for an internal tool holding
 * personal data.
 */

const COOKIE_NAME = "cpml_session";
const SESSION_TTL_DAYS = 7;
/** Sliding window: only rewrite the expiry when it is inside this margin. */
const REFRESH_WITHIN_DAYS = 1;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  recruiterName: string | null;
  status: User["status"];
}

export interface ActiveSession {
  sessionId: string;
  user: SessionUser;
}

/* -------------------------------------------------------------------------
 * Creation
 * ---------------------------------------------------------------------- */

export async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  const headerList = await headers();

  await db().insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    userAgent: headerList.get("user-agent")?.slice(0, 500) ?? null,
    ipAddress: clientIp(headerList),
  });

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,          // unreachable from JavaScript, so XSS cannot lift it
    secure: process.env.NODE_ENV === "production",
    // Lax rather than Strict: Strict would drop the cookie on any inbound link,
    // so a user following a shared dashboard URL would land signed out. Lax
    // still blocks cross-site POSTs, which is the CSRF vector that matters.
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

/* -------------------------------------------------------------------------
 * Reading
 * ---------------------------------------------------------------------- */

/**
 * The current session, or null.
 *
 * Wrapped in React's `cache` so a request that checks authorisation in the
 * layout, a page and three server components performs one database read rather
 * than five.
 */
export const getSession = cache(async (): Promise<ActiveSession | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const rows = await db()
      .select({
        sessionId: sessions.id,
        expiresAt: sessions.expiresAt,
        userId: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        recruiterName: users.recruiterName,
        status: users.status,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          gt(sessions.expiresAt, new Date()),
          isNull(sessions.revokedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    // An account suspended or locked mid-session loses access on its next
    // request, without waiting for the cookie to expire.
    if (row.status !== "active") return null;

    // Sliding expiry, written only when close to lapsing — updating on every
    // request would mean a write per page view for no benefit.
    const remainingMs = row.expiresAt.getTime() - Date.now();
    if (remainingMs < REFRESH_WITHIN_DAYS * 86_400_000) {
      const extended = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
      await db()
        .update(sessions)
        .set({ expiresAt: extended, lastSeenAt: new Date() })
        .where(eq(sessions.id, row.sessionId));
    }

    return {
      sessionId: row.sessionId,
      user: {
        id: row.userId,
        email: row.email,
        name: row.name,
        role: row.role as Role,
        recruiterName: row.recruiterName,
        status: row.status,
      },
    };
  } catch {
    // No database, or it is unreachable. Treated as signed out rather than as
    // an error page — the caller decides how to degrade.
    return null;
  }
});

/** The signed-in user, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  return (await getSession())?.user ?? null;
}

/* -------------------------------------------------------------------------
 * Destruction
 * ---------------------------------------------------------------------- */

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;

  if (token) {
    try {
      await db()
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.tokenHash, hashToken(token)));
    } catch {
      /* clearing the cookie is what the user actually observes */
    }
  }
  store.delete(COOKIE_NAME);
}

/** Sign out everywhere — used after a password change. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function revokeSession(sessionId: string, userId: string): Promise<void> {
  await db()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
}

/** Sessions a user can review and revoke individually. */
export async function listSessions(userId: string) {
  return db()
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(sql`${sessions.lastSeenAt} desc`);
}

/** Housekeeping for the cron job. */
export async function pruneSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const deleted = await db()
    .delete(sessions)
    .where(
      or(lt(sessions.expiresAt, new Date()), lt(sessions.revokedAt, cutoff)),
    )
    .returning({ id: sessions.id });
  return deleted.length;
}

export { COOKIE_NAME };
