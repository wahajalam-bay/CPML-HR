import "server-only";

import { headers } from "next/headers";
import { db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { getCurrentUser, type SessionUser } from "@/server/auth/session";
import { clientIp } from "@/server/auth/rate-limit";
import {
  can,
  canSeeField,
  redact,
  rowScopeFor,
  type Capability,
  type RowScope,
} from "@/lib/auth/permissions";

/**
 * Server-side authorisation.
 *
 * Deliberately imports the SAME permission model the browser uses
 * (`lib/auth/permissions.ts`). One definition, two enforcement points: the
 * client decides what to render, this decides what to serve. If they ever
 * disagree, the bug is a divergence in one file rather than a hunt across two
 * implementations.
 *
 * The rule that matters: nothing in the browser is a security boundary. This
 * is.
 */

/**
 * A malformed request, as distinct from a forbidden one.
 *
 * Filter parsing used to throw `AuthorizationError` with a 403, which told the
 * caller their credentials were the problem when in fact their date format was.
 * A client cannot act on that: 403 says "stop asking", 400 says "ask again
 * properly". The message is written for a person and is safe to return.
 */
export class ValidationError extends Error {
  readonly status = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 403,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export interface Principal {
  user: SessionUser;
  scope: RowScope;
  can: (capability: Capability) => boolean;
  canSeeField: (field: string) => boolean;
  /** Strip fields this principal may not see. */
  redact: <T extends Record<string, unknown>>(payload: T) => Partial<T>;
}

/**
 * Resolve the caller, or throw.
 *
 * Every data-serving route handler starts here. Returning null and letting the
 * caller decide would make "forgot to check" a silent hole; throwing makes it
 * a 401.
 */
export async function requirePrincipal(): Promise<Principal> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthorizationError("Authentication required.", 401);
  }
  return principalFor(user);
}

export function principalFor(user: SessionUser): Principal {
  const scope = rowScopeFor(user.role, user.recruiterName);
  return {
    user,
    scope,
    can: (capability) => can(user.role, capability),
    canSeeField: (field) => canSeeField(user.role, field),
    redact: (payload) => redact(payload, user.role),
  };
}

/** Resolve the caller and assert a capability in one step. */
export async function requireCapability(
  capability: Capability,
): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!principal.can(capability)) {
    throw new AuthorizationError(
      `This action requires the "${capability}" permission. ` +
        `You are signed in as ${principal.user.role}.`,
    );
  }
  return principal;
}

/* -------------------------------------------------------------------------
 * Audit
 * ---------------------------------------------------------------------- */

export async function recordAudit(
  principal: Principal,
  action: string,
  resource: string,
  detail?: { scope?: unknown; rowCount?: number; outcome?: "success" | "failure" },
): Promise<void> {
  try {
    const headerList = await headers();
    await db().insert(auditLog).values({
      actorUserId: principal.user.id,
      actorEmail: principal.user.email,
      actorRole: principal.user.role,
      action,
      resource: resource.slice(0, 200),
      scope: detail?.scope ?? null,
      rowCount: detail?.rowCount ?? null,
      outcome: detail?.outcome ?? "success",
      ipAddress: clientIp(headerList),
      userAgent: headerList.get("user-agent")?.slice(0, 500) ?? null,
    });
  } catch {
    // An audit write must never fail the request it describes. A lost line is
    // a problem; a 500 on a dashboard because the audit table was locked is a
    // worse one.
  }
}

/* -------------------------------------------------------------------------
 * Error responses
 * ---------------------------------------------------------------------- */

/**
 * Turn a thrown error into a response.
 *
 * Authorisation errors carry their message through because it tells the user
 * something actionable. Everything else is flattened to a generic string —
 * a stack trace or a driver message in an API response is reconnaissance.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ValidationError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof AuthorizationError) {
    return Response.json(
      { error: error.message },
      {
        status: error.status,
        headers: error.status === 401 ? { "WWW-Authenticate": "Session" } : undefined,
      },
    );
  }

  console.error("Unhandled API error:", error);
  return Response.json(
    { error: "The request could not be completed. Try again shortly." },
    { status: 500 },
  );
}
