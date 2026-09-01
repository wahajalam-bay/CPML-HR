import type { NextRequest } from "next/server";
import { pruneExpired } from "@/server/auth/rate-limit";
import { pruneSessions } from "@/server/auth/session";
import { hasDatabase } from "@/server/db/client";
import { safeEqual } from "@/server/auth/crypto";

/**
 * Scheduled maintenance.
 *
 * Invoked by Vercel Cron (see vercel.json). Clears expired sessions and
 * rate-limit windows — rows nothing will read again, which otherwise grow
 * without bound and slow the indexes that authentication depends on.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Vercel signs cron invocations with CRON_SECRET. Without this check the
  // endpoint is a public button that deletes sessions.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorised." }, { status: 401 });
  }

  if (!hasDatabase()) {
    return Response.json({ skipped: "No database configured." });
  }

  const startedAt = Date.now();
  const results: Record<string, number | string> = {};

  try {
    results.sessionsPruned = await pruneSessions();
  } catch (error) {
    results.sessionsPruned = `failed: ${error instanceof Error ? error.message : error}`;
  }

  try {
    results.rateLimitsPruned = await pruneExpired();
  } catch (error) {
    results.rateLimitsPruned = `failed: ${error instanceof Error ? error.message : error}`;
  }

  return Response.json({
    ok: true,
    durationMs: Date.now() - startedAt,
    ...results,
  });
}
