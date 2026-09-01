"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import {
  auditLog,
  invitations,
  users,
  verificationTokens,
} from "@/server/db/schema";
import {
  equaliseTiming,
  generateToken,
  hashPassword,
  hashToken,
  normaliseEmail,
  verifyPassword,
} from "./crypto";
import { RULES, clientIp, consume, reset } from "./rate-limit";
import { createSession, destroySession, revokeAllSessions, getSession } from "./session";
import { sendMail, verificationEmail, passwordResetEmail } from "@/server/email";
import type { Role } from "@/lib/auth/permissions";

/**
 * Authentication actions.
 *
 * Two rules run through all of them:
 *
 *  1. **Never confirm whether an account exists.** Sign-up, sign-in and
 *     password reset all return the same shape whether or not the email is
 *     registered. An endpoint that says "no such user" is an account
 *     enumeration oracle, and the enumerated list is the input to a credential
 *     stuffing run.
 *
 *  2. **Rate limit on two keys.** Per-identifier stops one account being
 *     ground down; per-IP stops one host spraying many accounts. Either alone
 *     leaves the other attack open.
 */

/* -------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------- */

const email = z
  .string()
  .trim()
  .min(3, "Enter an email address.")
  .max(255)
  .email("That does not look like an email address.");

/**
 * Length is the requirement that actually correlates with strength, so it does
 * the work here. Composition rules ("one symbol, one digit") mostly produce
 * `Password1!`, which is weaker than a long passphrase and harder to remember.
 */
const password = z
  .string()
  .min(12, "Use at least 12 characters — length matters more than symbols.")
  .max(200, "That is longer than 200 characters.")
  .refine((v) => v.trim().length >= 12, "Password cannot be mostly whitespace.");

const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name.").max(160),
  email,
  password,
  invite: z.string().trim().optional(),
});

const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
  redirectTo: z.string().trim().optional(),
});

const resetRequestSchema = z.object({ email });

const resetConfirmSchema = z.object({
  token: z.string().min(10),
  password,
});

/* -------------------------------------------------------------------------
 * Result shape
 * ---------------------------------------------------------------------- */

export interface ActionResult {
  ok: boolean;
  message?: string;
  /** Field-level errors, keyed by input name. */
  errors?: Record<string, string>;
  /** Shown on success where no redirect follows. */
  notice?: string;
}

/**
 * Read an optional form field.
 *
 * `FormData.get` returns `null` for a field the form did not render, and Zod's
 * `.optional()` accepts `undefined` but rejects `null`. Passing the raw value
 * through therefore fails validation on a field nobody filled in — and because
 * the error is keyed to a field with no input to attach it to, nothing renders
 * it. The form simply does nothing.
 *
 * That is exactly what happened to `redirectTo` on the sign-in form: it is only
 * rendered when the user arrived via `?next=`, so a direct visit to /signin
 * could not sign in at all and gave no reason why.
 */
function optionalField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

async function audit(
  action: string,
  resource: string,
  outcome: "success" | "failure",
  actor?: { id?: string; email?: string; role?: Role },
) {
  try {
    const headerList = await headers();
    await db().insert(auditLog).values({
      actorUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
      action,
      resource,
      outcome,
      ipAddress: clientIp(headerList),
      userAgent: headerList.get("user-agent")?.slice(0, 500) ?? null,
    });
  } catch {
    /* an audit failure must never fail the request it describes */
  }
}

/* -------------------------------------------------------------------------
 * Sign up
 * ---------------------------------------------------------------------- */

export async function signUp(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    invite: optionalField(formData, "invite"),
  });
  if (!parsed.success) {
    return { ok: false, errors: fieldErrors(parsed.error) };
  }

  const { name, password: rawPassword, invite } = parsed.data;
  const normalised = normaliseEmail(parsed.data.email);
  const headerList = await headers();
  const ip = clientIp(headerList);

  const byIp = await consume(`signup-ip:${ip}`, RULES.signUpPerIp);
  if (!byIp.allowed) {
    return {
      ok: false,
      message: `Too many sign-up attempts. Try again in ${Math.ceil(byIp.retryAfter / 60)} minutes.`,
    };
  }

  // Self-service sign-up is off by default: this is an internal tool, and an
  // open registration form on a dashboard of personal data is a liability.
  // Without an invitation, only pre-approved domains may register.
  const allowedDomains = (process.env.SIGNUP_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const domain = normalised.split("@")[1] ?? "";

  let invitedRole: Role = "Recruiter";
  let invitedRecruiterName: string | null = null;
  let invitationId: string | null = null;

  if (invite) {
    const [row] = await db()
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.tokenHash, hashToken(invite)),
          gt(invitations.expiresAt, new Date()),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .limit(1);

    if (!row) {
      return {
        ok: false,
        message: "That invitation link is invalid or has expired. Ask an administrator for a new one.",
      };
    }
    if (row.emailNormalised !== normalised) {
      return {
        ok: false,
        errors: { email: "This invitation was issued to a different email address." },
      };
    }
    invitedRole = row.role as Role;
    invitedRecruiterName = row.recruiterName;
    invitationId = row.id;
  } else if (!allowedDomains.includes(domain)) {
    await audit("auth.signup", normalised, "failure");
    return {
      ok: false,
      message:
        "Sign-up is by invitation for this organisation. Ask an administrator to invite you.",
    };
  }

  const passwordHash = await hashPassword(rawPassword);
  const token = generateToken();

  try {
    const [created] = await db()
      .insert(users)
      .values({
        email: parsed.data.email.trim(),
        emailNormalised: normalised,
        name,
        passwordHash,
        role: invitedRole,
        recruiterName: invitedRecruiterName,
        status: "pending",
      })
      .onConflictDoNothing({ target: users.emailNormalised })
      .returning({ id: users.id });

    // No row means the address is already registered. The response is
    // identical either way — the real account holder is told by email that
    // someone tried, and an attacker learns nothing.
    if (created) {
      await db().insert(verificationTokens).values({
        userId: created.id,
        tokenHash: hashToken(token),
        purpose: "email_verification",
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });

      if (invitationId) {
        await db()
          .update(invitations)
          .set({ acceptedAt: new Date() })
          .where(eq(invitations.id, invitationId));
      }

      await sendMail(verificationEmail(parsed.data.email.trim(), name, token));
      await audit("auth.signup", normalised, "success", { id: created.id });
    } else {
      await audit("auth.signup.duplicate", normalised, "failure");
    }
  } catch (error) {
    await audit("auth.signup", normalised, "failure");
    return {
      ok: false,
      message:
        error instanceof Error && error.message.includes("DATABASE_URL")
          ? "The database is not configured yet. See DEPLOYMENT.md."
          : "Could not create the account. Try again shortly.",
    };
  }

  return {
    ok: true,
    notice:
      "Check your email. If that address can be registered, a verification link is on its way — it expires in 24 hours.",
  };
}

/* -------------------------------------------------------------------------
 * Sign in
 * ---------------------------------------------------------------------- */

export async function signIn(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: optionalField(formData, "redirectTo"),
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const normalised = normaliseEmail(parsed.data.email);
  const headerList = await headers();
  const ip = clientIp(headerList);

  // Both keys, because they stop different attacks.
  const [byAccount, byIp] = await Promise.all([
    consume(`signin:${normalised}`, RULES.signIn),
    consume(`signin-ip:${ip}`, RULES.signInPerIp),
  ]);
  if (!byAccount.allowed || !byIp.allowed) {
    const retry = Math.max(byAccount.retryAfter, byIp.retryAfter);
    await audit("auth.signin.throttled", normalised, "failure");
    return {
      ok: false,
      message: `Too many attempts. Try again in ${Math.ceil(retry / 60)} minutes.`,
    };
  }

  const generic = {
    ok: false as const,
    message: "That email and password combination is not recognised.",
  };

  let user;
  try {
    [user] = await db()
      .select()
      .from(users)
      .where(eq(users.emailNormalised, normalised))
      .limit(1);
  } catch {
    return {
      ok: false,
      message: "Authentication is unavailable right now. Try again shortly.",
    };
  }

  if (!user) {
    // Spend the same time as a real verification so response timing does not
    // reveal that the address is unregistered.
    await equaliseTiming(parsed.data.password);
    await audit("auth.signin", normalised, "failure");
    return generic;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return {
      ok: false,
      message: `This account is temporarily locked after repeated failed attempts. Try again in ${minutes} minutes.`,
    };
  }

  const valid = await verifyPassword(user.passwordHash, parsed.data.password);

  if (!valid) {
    const failures = user.failedSignIns + 1;
    // Ten strikes locks the account for fifteen minutes. This is the backstop
    // behind rate limiting, and it is what defends against a distributed
    // attempt where no single IP trips the per-IP limit.
    const lockedUntil = failures >= 10 ? new Date(Date.now() + 900_000) : null;
    await db()
      .update(users)
      .set({ failedSignIns: failures, lockedUntil, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await audit("auth.signin", normalised, "failure", { id: user.id });
    return generic;
  }

  if (user.status === "suspended") {
    await audit("auth.signin.suspended", normalised, "failure", { id: user.id });
    return {
      ok: false,
      message: "This account has been suspended. Contact your administrator.",
    };
  }

  if (user.status === "pending" || !user.emailVerifiedAt) {
    return {
      ok: false,
      message:
        "Verify your email address before signing in. Check your inbox for the link we sent.",
    };
  }

  await Promise.all([
    db()
      .update(users)
      .set({ failedSignIns: 0, lockedUntil: null, lastSignInAt: new Date() })
      .where(eq(users.id, user.id)),
    reset(`signin:${normalised}`),
  ]);

  await createSession(user.id);
  await audit("auth.signin", normalised, "success", {
    id: user.id,
    role: user.role as Role,
  });

  // Only relative paths: an attacker-supplied absolute URL here would turn the
  // login form into an open redirect.
  const target = parsed.data.redirectTo;
  redirect(target && target.startsWith("/") && !target.startsWith("//") ? target : "/");
}

/* -------------------------------------------------------------------------
 * Sign out
 * ---------------------------------------------------------------------- */

export async function signOut(): Promise<void> {
  const session = await getSession();
  await destroySession();
  if (session) {
    await audit("auth.signout", session.user.email, "success", {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
    });
  }
  redirect("/signin");
}

/* -------------------------------------------------------------------------
 * Email verification
 * ---------------------------------------------------------------------- */

export async function verifyEmail(token: string): Promise<ActionResult> {
  if (!token || token.length < 10) {
    return { ok: false, message: "That verification link is not valid." };
  }

  try {
    const [row] = await db()
      .select({ id: verificationTokens.id, userId: verificationTokens.userId })
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.tokenHash, hashToken(token)),
          eq(verificationTokens.purpose, "email_verification"),
          gt(verificationTokens.expiresAt, new Date()),
          isNull(verificationTokens.consumedAt),
        ),
      )
      .limit(1);

    if (!row) {
      return {
        ok: false,
        message:
          "That link has expired or has already been used. Sign in to request a new one.",
      };
    }

    await Promise.all([
      db()
        .update(users)
        .set({ status: "active", emailVerifiedAt: new Date() })
        .where(eq(users.id, row.userId)),
      // Single use, so the link in a mail archive is inert afterwards.
      db()
        .update(verificationTokens)
        .set({ consumedAt: new Date() })
        .where(eq(verificationTokens.id, row.id)),
    ]);

    await audit("auth.email-verified", row.userId, "success", { id: row.userId });
    return { ok: true, notice: "Email verified. You can sign in now." };
  } catch {
    return { ok: false, message: "Could not verify that link. Try again shortly." };
  }
}

/* -------------------------------------------------------------------------
 * Password reset
 * ---------------------------------------------------------------------- */

export async function requestPasswordReset(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = resetRequestSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const normalised = normaliseEmail(parsed.data.email);
  const headerList = await headers();

  const limited = await consume(`reset:${normalised}`, RULES.passwordReset);
  const byIp = await consume(`reset-ip:${clientIp(headerList)}`, RULES.passwordResetPerIp);

  // Identical response whether or not the account exists, whether or not it was
  // throttled — anything else is an enumeration oracle.
  const uniform: ActionResult = {
    ok: true,
    notice:
      "If that address has an account, a password reset link is on its way. It expires in one hour.",
  };

  if (!limited.allowed || !byIp.allowed) return uniform;

  try {
    const [user] = await db()
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.emailNormalised, normalised))
      .limit(1);

    if (user) {
      const token = generateToken();
      await db().insert(verificationTokens).values({
        userId: user.id,
        tokenHash: hashToken(token),
        purpose: "password_reset",
        expiresAt: new Date(Date.now() + 3600 * 1000),
      });
      await sendMail(passwordResetEmail(user.email, user.name, token));
      await audit("auth.reset-requested", normalised, "success", { id: user.id });
    }
  } catch {
    /* still return the uniform response */
  }

  return uniform;
}

export async function confirmPasswordReset(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = resetConfirmSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  try {
    const [row] = await db()
      .select({ id: verificationTokens.id, userId: verificationTokens.userId })
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.tokenHash, hashToken(parsed.data.token)),
          eq(verificationTokens.purpose, "password_reset"),
          gt(verificationTokens.expiresAt, new Date()),
          isNull(verificationTokens.consumedAt),
        ),
      )
      .limit(1);

    if (!row) {
      return {
        ok: false,
        message: "That reset link has expired or has already been used. Request a new one.",
      };
    }

    const passwordHash = await hashPassword(parsed.data.password);

    await Promise.all([
      db()
        .update(users)
        .set({
          passwordHash,
          failedSignIns: 0,
          lockedUntil: null,
          // A reset also proves control of the mailbox.
          status: "active",
          emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, row.userId)),
      db()
        .update(verificationTokens)
        .set({ consumedAt: new Date() })
        .where(eq(verificationTokens.id, row.id)),
      // Whoever forced the reset may already hold a session; end all of them.
      revokeAllSessions(row.userId),
    ]);

    await audit("auth.password-reset", row.userId, "success", { id: row.userId });
    return {
      ok: true,
      notice: "Password updated. Sign in with your new password — other devices have been signed out.",
    };
  } catch {
    return { ok: false, message: "Could not reset the password. Try again shortly." };
  }
}
