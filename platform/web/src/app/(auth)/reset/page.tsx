import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/features/auth/reset-forms";
import { AuthShell } from "@/features/auth/auth-shell";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthShell
        title="Link incomplete"
        subtitle="This reset link is missing its token. It may have been truncated by an email client."
      >
        <Link
          href="/forgot-password"
          className="flex h-10 w-full items-center justify-center rounded-[var(--r-xs)] text-body font-semibold text-white"
          style={{ background: "var(--grad-green)" }}
        >
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  // The token is validated when the form is submitted, not here: checking it
  // on page load would consume the single-use record before the user has
  // typed anything.
  return <ResetPasswordForm token={token} />;
}
