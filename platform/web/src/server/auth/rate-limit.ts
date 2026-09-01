import "server-only";

import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { rateLimits } from "@/server/db/schema";

/**
 * Rate limiting.
 *
 * Backed by Postgres rather than process memory: serverless functions do not
 * share memory, so an in-process counter resets on every cold start — which is
 * precisely the state a burst of traffic produces. A shared counter is the only
 * one that means anything here.
 *
 * The single UPSERT is the whole mechanism. Doing this as read-then-write would
 * race under concurrency, and the race is in the attacker's favour.
 */

export interface RateLimitRule {
  /** Attempts permitted inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** How long to lock out once the limit is exceeded. */
  blockSeconds: number;
}

/**
 * Per-account and per-IP limits are deliberately different numbers.
 *
 * They defend against different attacks and they have different blast radii.
 * Per-account is tight: five attempts on one address in five minutes is already
 * far more than a person who knows their password needs, and the only cost of
 * being wrong is to that one account.
 *
 * Per-IP cannot be that tight. This is an internal tool, so an entire office
 * arrives from one NAT address — at a limit of five, the sixth colleague to
 * sign in during a Monday morning is locked out for fifteen minutes by their
 * co-workers' successful logins. That is an outage, not a control.
 *
 * The per-IP limit exists to stop one host spraying many accounts, which is a
 * volume attack; a shared office egress never reaches sixty sign-ins in five
 * minutes, and a credential-stuffing run passes it in seconds. The per-account
 * limit and the lockout are what protect an individual account.
 */
export const RULES = {
  signIn: { limit: 5, windowSeconds: 300, blockSeconds: 900 },
  signInPerIp: { limit: 60, windowSeconds: 300, blockSeconds: 900 },
  // Sign-up and reset are throttled mainly to stop mailbox flooding.
  signUp: { limit: 3, windowSeconds: 3600, blockSeconds: 3600 },
  signUpPerIp: { limit: 20, windowSeconds: 3600, blockSeconds: 3600 },
  passwordReset: { limit: 3, windowSeconds: 900, blockSeconds: 1800 },
  passwordResetPerIp: { limit: 20, windowSeconds: 900, blockSeconds: 1800 },
  emailVerification: { limit: 5, windowSeconds: 900, blockSeconds: 900 },
  // Generous: this guards the analytics API against runaway clients, not abuse.
  api: { limit: 240, windowSeconds: 60, blockSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the caller may try again. Zero when allowed. */
  retryAfter: number;
}

/**
 * Consume one unit against `key`.
 *
 * Failures are permissive: if the rate-limit table is unreachable, requests are
 * allowed through. An outage in the limiter should degrade throttling, not take
 * authentication offline entirely.
 */
export async function consume(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - rule.windowSeconds * 1000);

  try {
    const [row] = await db()
      .insert(rateLimits)
      .values({ key, count: 1, windowStartedAt: now })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          // Reset the counter when the previous window has expired, otherwise
          // increment it. Expressed as SQL so the whole thing is one atomic
          // statement rather than a read-modify-write race.
          count: sql`CASE
            WHEN ${rateLimits.windowStartedAt} < ${windowStart.toISOString()}
            THEN 1
            ELSE ${rateLimits.count} + 1
          END`,
          windowStartedAt: sql`CASE
            WHEN ${rateLimits.windowStartedAt} < ${windowStart.toISOString()}
            THEN ${now.toISOString()}::timestamptz
            ELSE ${rateLimits.windowStartedAt}
          END`,
        },
      })
      .returning();

    if (row.blockedUntil && row.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil((row.blockedUntil.getTime() - now.getTime()) / 1000),
      };
    }

    if (row.count > rule.limit) {
      const blockedUntil = new Date(now.getTime() + rule.blockSeconds * 1000);
      await db()
        .update(rateLimits)
        .set({ blockedUntil })
        .where(eq(rateLimits.key, key));
      return { allowed: false, remaining: 0, retryAfter: rule.blockSeconds };
    }

    return {
      allowed: true,
      remaining: Math.max(0, rule.limit - row.count),
      retryAfter: 0,
    };
  } catch {
    return { allowed: true, remaining: rule.limit, retryAfter: 0 };
  }
}

/** Clear a counter after a legitimate success, so one typo is not punished. */
export async function reset(key: string): Promise<void> {
  try {
    await db().delete(rateLimits).where(eq(rateLimits.key, key));
  } catch {
    /* the counter expires on its own */
  }
}

/** Housekeeping for the cron job — drops windows nothing will read again. */
export async function pruneExpired(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  try {
    const deleted = await db()
      .delete(rateLimits)
      .where(
        and(
          lt(rateLimits.windowStartedAt, cutoff),
          sql`(${rateLimits.blockedUntil} IS NULL OR ${rateLimits.blockedUntil} < now())`,
        ),
      )
      .returning({ key: rateLimits.key });
    return deleted.length;
  } catch {
    return 0;
  }
}

/**
 * Client address, taken from the first hop of the forwarding chain.
 *
 * Only trustworthy because Vercel overwrites `x-forwarded-for` at the edge. On
 * a platform that passes the header through unmodified this value is
 * attacker-controlled, and IP-keyed limits would need a different source.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
