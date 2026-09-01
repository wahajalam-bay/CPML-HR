"use server";

import { revalidatePath } from "next/cache";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import {
  invitations,
  recruiters,
  sessions,
  users,
  verificationTokens,
} from "@/server/db/schema";
import {
  generateToken,
  hashPassword,
  hashToken,
  normaliseEmail,
} from "@/server/auth/crypto";
import { revokeAllSessions } from "@/server/auth/session";
import { invitationEmail, passwordResetEmail, sendMail } from "@/server/email";
import { recordAudit, requireCapability } from "@/server/rbac";
import { ROLES, ROLE_RANK, type Role } from "@/lib/auth/permissions";
import type { ActionResult } from "@/server/auth/actions";

/**
 * User administration.
 *
 * Every action re-checks the capability server-side. The UI already hides
 * these controls from anyone below Admin, but hiding a button is not a
 * permission check — a server action is a public endpoint with a generated
 * name, and it has to defend itself.
 *
 * The privilege-escalation guard runs through all of them: an administrator
 * may never grant a role above their own, and may never act on an account that
 * outranks them. Without that, "Admin" is effectively "Super Admin" for anyone
 * who can find the endpoint.
 */

const roleSchema = z.enum(ROLES);

function assertCanAssign(actor: Role, target: Role) {
  if (ROLE_RANK[target] > ROLE_RANK[actor]) {
    throw new Error(
      `You cannot grant ${target} — it is above your own access level.`,
    );
  }
}

/* -------------------------------------------------------------------------
 * Listing
 * ---------------------------------------------------------------------- */

export async function listUsers() {
  await requireCapability("page.access-admin");

  return db()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      recruiterName: users.recruiterName,
      lastSignInAt: users.lastSignInAt,
      createdAt: users.createdAt,
      emailVerifiedAt: users.emailVerifiedAt,
      failedSignIns: users.failedSignIns,
      lockedUntil: users.lockedUntil,
      activeSessions: sql<number>`(
        select count(*)::int from ${sessions}
        where ${sessions.userId} = ${users.id}
          and ${sessions.revokedAt} is null
          and ${sessions.expiresAt} > now()
      )`,
    })
    .from(users)
    .orderBy(desc(users.createdAt));
}

export async function listInvitations() {
  await requireCapability("page.access-admin");

  return db()
    .select({
      id: invitations.id,
      email: invitations.emailNormalised,
      role: invitations.role,
      recruiterName: invitations.recruiterName,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      createdAt: invitations.createdAt,
    })
    .from(invitations)
    .where(isNull(invitations.revokedAt))
    .orderBy(desc(invitations.createdAt))
    .limit(50);
}

/**
 * Recruiter names as they appear in the dataset.
 *
 * A Recruiter account is linked to its book by name, so the value has to match
 * the source sheet exactly. Offering the real list turns a silently-empty
 * account — the most confusing failure this platform has — into a choice that
 * cannot be got wrong.
 */
export async function listRecruiterNames(): Promise<string[]> {
  await requireCapability("page.access-admin");
  const rows = await db()
    .select({ name: recruiters.name })
    .from(recruiters)
    .orderBy(recruiters.name);
  return rows.map((r) => r.name);
}

/* -------------------------------------------------------------------------
 * Direct creation
 *
 * The invitation flow is the better default — it proves the person controls
 * the mailbox, and the password is never known to anyone but them. This exists
 * because two situations make that flow unusable:
 *
 *   • no outbound mail is configured (previews, an air-gapped install)
 *   • the account is for a shared function or a demonstration
 *
 * So the power is real and it is separated behind its own capability, the
 * password is never stored or logged in the clear, and the audit entry records
 * that this route was taken rather than the invitation one.
 * ---------------------------------------------------------------------- */

const createUserSchema = z.object({
  email: z.string().trim().email("That does not look like an email address."),
  name: z.string().trim().min(2, "Enter the person's name.").max(160),
  role: roleSchema,
  recruiterName: z.string().trim().max(120).optional(),
  // Same rule as sign-up: length is what correlates with strength, so it does
  // the work rather than a composition rule that produces `Password1!`.
  password: z
    .string()
    .min(12, "Use at least 12 characters — a passphrase is easiest to remember.")
    .max(200),
  requirePasswordChange: z.boolean().default(false),
});

export async function createUser(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const principal = await requireCapability("action.create-user");

    const parsed = createUserSchema.safeParse({
      email: formData.get("email"),
      name: formData.get("name"),
      role: formData.get("role"),
      recruiterName: formData.get("recruiterName") || undefined,
      password: formData.get("password"),
      requirePasswordChange: formData.get("requirePasswordChange") === "on",
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message };
    }

    const { email, name, role, password, requirePasswordChange } = parsed.data;
    assertCanAssign(principal.user.role, role);

    // A Recruiter with no book sees nothing at all. Better to refuse than to
    // hand over an account that silently shows an empty platform.
    const recruiterName = role === "Recruiter" ? (parsed.data.recruiterName ?? null) : null;
    if (role === "Recruiter" && !recruiterName) {
      return {
        ok: false,
        message:
          "A Recruiter account needs the recruiter name from the source sheet, otherwise it has no book and will show nothing.",
      };
    }

    const normalised = normaliseEmail(email);
    const [existing] = await db()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.emailNormalised, normalised))
      .limit(1);
    if (existing) {
      // Enumeration is not a concern here: the caller is an authenticated
      // administrator who can already list every account.
      return { ok: false, message: "That address already has an account." };
    }

    const [created] = await db()
      .insert(users)
      .values({
        email,
        emailNormalised: normalised,
        name,
        passwordHash: await hashPassword(password),
        role,
        recruiterName,
        // Active immediately, and verified: an administrator vouching for the
        // address in person is a stronger signal than a clicked link, and
        // leaving it `pending` would block a sign-in nobody could unblock
        // without mail.
        status: "active",
        emailVerifiedAt: new Date(),
      })
      .returning({ id: users.id });

    if (requirePasswordChange) {
      // A reset token rather than a flag on the row: it expires, it is
      // single-use, and it runs through the same path a self-service reset
      // does — no second way to set a password to keep correct.
      const token = generateToken();
      await db().insert(verificationTokens).values({
        userId: created.id,
        purpose: "password_reset",
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      });
      await sendMail(passwordResetEmail(email, name, token));
    }

    await recordAudit(principal, "admin.user-created", normalised, {
      scope: { role, recruiterName, method: "direct" },
    });

    revalidatePath("/admin/users");
    return {
      ok: true,
      notice: `${email} can sign in now as ${role}.${
        requirePasswordChange ? " They have been sent a link to set their own password." : ""
      }`,
    };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

/**
 * Set someone's password directly.
 *
 * The recovery path for an account whose owner cannot receive mail. Every
 * session is ended, because the point of a password change is that whoever had
 * the old one no longer has access.
 */
export async function setUserPassword(
  userId: string,
  password: string,
): Promise<ActionResult> {
  try {
    const principal = await requireCapability("action.create-user");

    if (password.length < 12) {
      return { ok: false, message: "Use at least 12 characters." };
    }

    const [target] = await db()
      .select({ role: users.role, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) return { ok: false, message: "No such user." };
    assertCanAssign(principal.user.role, target.role as Role);

    await db()
      .update(users)
      .set({
        passwordHash: await hashPassword(password),
        failedSignIns: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await revokeAllSessions(userId);
    await recordAudit(principal, "admin.password-set", target.email);
    revalidatePath("/admin/users");
    return {
      ok: true,
      notice: `Password set for ${target.email}. They have been signed out everywhere.`,
    };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

/**
 * Delete an account.
 *
 * Sessions, tokens and invitations cascade with the row. The audit log does
 * not — it records the email as text precisely so the trail survives the
 * account, which is the whole point of having one.
 */
export async function deleteUser(userId: string): Promise<ActionResult> {
  try {
    const principal = await requireCapability("action.create-user");

    if (userId === principal.user.id) {
      return { ok: false, message: "You cannot delete your own account." };
    }

    const [target] = await db()
      .select({ role: users.role, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) return { ok: false, message: "No such user." };
    assertCanAssign(principal.user.role, target.role as Role);

    await db().delete(users).where(eq(users.id, userId));

    await recordAudit(principal, "admin.user-deleted", target.email, {
      scope: { role: target.role },
    });
    revalidatePath("/admin/users");
    return { ok: true, notice: `${target.email} has been removed.` };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

/* -------------------------------------------------------------------------
 * Invitations
 * ---------------------------------------------------------------------- */

const inviteSchema = z.object({
  email: z.string().trim().email("That does not look like an email address."),
  role: roleSchema,
  recruiterName: z.string().trim().max(120).optional(),
});

export async function inviteUser(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const principal = await requireCapability("page.access-admin");

    const parsed = inviteSchema.safeParse({
      email: formData.get("email"),
      role: formData.get("role"),
      recruiterName: formData.get("recruiterName") || undefined,
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message };
    }

    assertCanAssign(principal.user.role, parsed.data.role);

    const normalised = normaliseEmail(parsed.data.email);

    const [existing] = await db()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.emailNormalised, normalised))
      .limit(1);
    if (existing) {
      return { ok: false, message: "That address already has an account." };
    }

    const token = generateToken();
    await db().insert(invitations).values({
      emailNormalised: normalised,
      role: parsed.data.role,
      recruiterName: parsed.data.recruiterName ?? null,
      tokenHash: hashToken(token),
      invitedByUserId: principal.user.id,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });

    await sendMail(
      invitationEmail(parsed.data.email, principal.user.name, parsed.data.role, token),
    );
    await recordAudit(principal, "admin.user-invited", normalised, {
      scope: { role: parsed.data.role },
    });

    revalidatePath("/admin/users");
    return {
      ok: true,
      notice: `Invitation sent to ${parsed.data.email}. It expires in 7 days.`,
    };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

export async function revokeInvitation(id: string): Promise<ActionResult> {
  try {
    const principal = await requireCapability("page.access-admin");
    await db()
      .update(invitations)
      .set({ revokedAt: new Date() })
      .where(eq(invitations.id, id));
    await recordAudit(principal, "admin.invite-revoked", id);
    revalidatePath("/admin/users");
    return { ok: true, notice: "Invitation revoked." };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

/* -------------------------------------------------------------------------
 * Account changes
 * ---------------------------------------------------------------------- */

export async function setUserRole(
  userId: string,
  role: Role,
  recruiterName: string | null,
): Promise<ActionResult> {
  try {
    const principal = await requireCapability("page.access-admin");
    assertCanAssign(principal.user.role, role);

    const [target] = await db()
      .select({ role: users.role, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) return { ok: false, message: "No such user." };

    // Cannot act on someone who outranks you, even to demote them.
    assertCanAssign(principal.user.role, target.role as Role);

    if (userId === principal.user.id && ROLE_RANK[role] < ROLE_RANK[principal.user.role]) {
      return {
        ok: false,
        message:
          "You cannot demote your own account — ask another administrator, so the platform is never left without one.",
      };
    }

    await db()
      .update(users)
      .set({
        role,
        // A role that is not scoped to a book must not keep a stale link.
        recruiterName: role === "Recruiter" ? recruiterName : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // The role lives in the session's user record, but any cached principal in
    // flight should be discarded — ending sessions is the unambiguous way.
    await revokeAllSessions(userId);

    await recordAudit(principal, "admin.role-changed", target.email, {
      scope: { from: target.role, to: role, recruiterName },
    });
    revalidatePath("/admin/users");
    return {
      ok: true,
      notice: `${target.email} is now ${role}. They have been signed out and will pick up the new access on their next sign-in.`,
    };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

export async function setUserStatus(
  userId: string,
  status: "active" | "suspended",
): Promise<ActionResult> {
  try {
    const principal = await requireCapability("page.access-admin");

    if (userId === principal.user.id) {
      return { ok: false, message: "You cannot suspend your own account." };
    }

    const [target] = await db()
      .select({ role: users.role, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) return { ok: false, message: "No such user." };
    assertCanAssign(principal.user.role, target.role as Role);

    await db()
      .update(users)
      .set({
        status,
        // Suspension should take effect now, not when the cookie expires.
        ...(status === "suspended" ? {} : { failedSignIns: 0, lockedUntil: null }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    if (status === "suspended") await revokeAllSessions(userId);

    await recordAudit(principal, `admin.user-${status}`, target.email);
    revalidatePath("/admin/users");
    return {
      ok: true,
      notice:
        status === "suspended"
          ? `${target.email} has been suspended and signed out everywhere.`
          : `${target.email} has been reinstated.`,
    };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

export async function revokeUserSessions(userId: string): Promise<ActionResult> {
  try {
    const principal = await requireCapability("page.access-admin");
    const [target] = await db()
      .select({ role: users.role, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!target) return { ok: false, message: "No such user." };
    assertCanAssign(principal.user.role, target.role as Role);

    await revokeAllSessions(userId);
    await recordAudit(principal, "admin.sessions-revoked", target.email);
    revalidatePath("/admin/users");
    return { ok: true, notice: `Signed ${target.email} out of every device.` };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

export async function unlockUser(userId: string): Promise<ActionResult> {
  try {
    const principal = await requireCapability("page.access-admin");
    await db()
      .update(users)
      .set({ failedSignIns: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await recordAudit(principal, "admin.user-unlocked", userId);
    revalidatePath("/admin/users");
    return { ok: true, notice: "Account unlocked." };
  } catch (error) {
    return { ok: false, message: message(error) };
  }
}

/* -------------------------------------------------------------------------
 * Audit
 * ---------------------------------------------------------------------- */

export async function listAuditLog(limit = 200) {
  await requireCapability("page.audit");
  const { auditLog } = await import("@/server/db/schema");

  return db()
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.occurredAt))
    .limit(Math.min(limit, 500));
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */

function message(error: unknown): string {
  if (error instanceof Error) {
    // Authorisation and escalation messages are written for the user and are
    // safe to surface. Anything else could carry driver or schema detail.
    if (
      error.name === "AuthorizationError" ||
      error.message.startsWith("You cannot")
    ) {
      return error.message;
    }
  }
  console.error("Admin action failed:", error);
  return "That change could not be applied. Try again shortly.";
}
