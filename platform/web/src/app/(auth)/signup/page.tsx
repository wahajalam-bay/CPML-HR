import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { SignUpForm } from "@/features/auth/sign-up-form";
import { getSession } from "@/server/auth/session";
import { db, hasDatabase } from "@/server/db/client";
import { invitations } from "@/server/db/schema";
import { hashToken } from "@/server/auth/crypto";

export const metadata: Metadata = {
  title: "Request access",
  description: "Request access to CPML HR.",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  if (await getSession()) redirect("/");

  const { invite } = await searchParams;
  let invitedEmail: string | undefined;

  // Resolve the invitation server-side so the address is pinned and read-only
  // in the form. Taking it from the query string instead would let the link be
  // redeemed against any address.
  if (invite && hasDatabase()) {
    try {
      const [row] = await db()
        .select({ emailNormalised: invitations.emailNormalised })
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
      invitedEmail = row?.emailNormalised;
    } catch {
      /* an unresolvable invite simply falls back to the open form */
    }
  }

  return <SignUpForm invite={invite} invitedEmail={invitedEmail} />;
}
