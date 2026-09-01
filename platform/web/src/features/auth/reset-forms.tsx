"use client";

import * as React from "react";
import { useActionState } from "react";
import { MailCheck, ShieldCheck } from "lucide-react";
import {
  confirmPasswordReset,
  requestPasswordReset,
} from "@/server/auth/actions";
import {
  AuthLink,
  AuthShell,
  Field,
  FormMessage,
  PasswordStrength,
  SubmitButton,
} from "./auth-shell";

/* =========================================================================
 * Request a reset link
 * ========================================================================= */

export function ForgotPasswordForm() {
  const [result, formAction, pending] = useActionState(requestPasswordReset, null);

  // The response is identical whether or not the address is registered — this
  // screen must not become an account-enumeration oracle.
  if (result?.ok && result.notice) {
    return (
      <AuthShell title="Check your email">
        <div className="flex flex-col items-center py-4 text-center">
          <span
            aria-hidden
            className="mb-3 grid size-12 place-items-center rounded-full bg-g6 text-g1"
          >
            <MailCheck className="size-6" />
          </span>
          <p className="text-body leading-[1.6] text-ink-2">{result.notice}</p>
          <p className="mt-4 text-meta text-ink-4">
            <AuthLink href="/signin">Back to sign in</AuthLink>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your work email and we will send a link to set a new password."
      footer={
        <>
          Remembered it? <AuthLink href="/signin">Sign in</AuthLink>
        </>
      }
    >
      <form action={formAction} noValidate>
        <FormMessage result={result} fields={["email"]} />
        <Field
          label="Work email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          error={result?.errors?.email}
        />
        <SubmitButton pending={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

/* =========================================================================
 * Choose a new password
 * ========================================================================= */

export function ResetPasswordForm({ token }: { token: string }) {
  const [result, formAction, pending] = useActionState(confirmPasswordReset, null);
  const [password, setPassword] = React.useState("");

  if (result?.ok && result.notice) {
    return (
      <AuthShell title="Password updated">
        <div className="flex flex-col items-center py-4 text-center">
          <span
            aria-hidden
            className="mb-3 grid size-12 place-items-center rounded-full bg-good-soft text-good-ink"
          >
            <ShieldCheck className="size-6" />
          </span>
          <p className="text-body leading-[1.6] text-ink-2">{result.notice}</p>
          <div className="mt-5 w-full">
            <a
              href="/signin"
              className="flex h-10 w-full items-center justify-center rounded-[var(--r-xs)] text-body font-semibold text-white"
              style={{ background: "var(--grad-green)" }}
            >
              Sign in
            </a>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Setting a new password signs you out of every other device."
    >
      <form action={formAction} noValidate>
        <FormMessage result={result} fields={["password", "token"]} />
        <input type="hidden" name="token" value={token} />

        <div onChange={(e) => setPassword((e.target as HTMLInputElement).value)}>
          <Field
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            hint="At least 12 characters."
            error={result?.errors?.password}
          />
        </div>
        <PasswordStrength value={password} />

        <SubmitButton pending={pending}>
          {pending ? "Updating…" : "Update password"}
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
