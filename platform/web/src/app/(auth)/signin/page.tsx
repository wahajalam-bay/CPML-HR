import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "@/features/auth/sign-in-form";
import { getSession } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to CPML HR.",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // An already-signed-in user landing here is bounced straight through rather
  // than shown a form they do not need.
  if (await getSession()) redirect("/");

  const { next } = await searchParams;
  // Only relative paths survive: an absolute URL here would make the sign-in
  // page an open redirect.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;

  return <SignInForm redirectTo={safeNext} />;
}
