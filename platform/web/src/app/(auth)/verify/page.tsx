import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { AuthShell } from "@/features/auth/auth-shell";
import { verifyEmail } from "@/server/auth/actions";

export const metadata: Metadata = {
  title: "Verify your email",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = await verifyEmail(token ?? "");

  return (
    <AuthShell title={result.ok ? "Email verified" : "Verification failed"}>
      <div className="flex flex-col items-center py-4 text-center">
        <span
          aria-hidden
          className={
            result.ok
              ? "mb-3 grid size-12 place-items-center rounded-full bg-good-soft text-good-ink"
              : "mb-3 grid size-12 place-items-center rounded-full bg-critical-soft text-critical-ink"
          }
        >
          {result.ok ? (
            <CheckCircle2 className="size-6" />
          ) : (
            <AlertCircle className="size-6" />
          )}
        </span>

        <p className="text-body leading-[1.6] text-ink-2">
          {result.notice ?? result.message}
        </p>

        <div className="mt-5 w-full">
          <Link
            href={result.ok ? "/signin" : "/signup"}
            className="flex h-10 w-full items-center justify-center rounded-[var(--r-xs)] text-body font-semibold text-white"
            style={{ background: "var(--grad-green)" }}
          >
            {result.ok ? "Sign in" : "Back to sign up"}
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
