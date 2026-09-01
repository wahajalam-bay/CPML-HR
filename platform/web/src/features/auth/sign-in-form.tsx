"use client";

import * as React from "react";
import { useActionState } from "react";
import { signIn } from "@/server/auth/actions";
import {
  AuthLink,
  AuthShell,
  Field,
  FormMessage,
  SubmitButton,
} from "./auth-shell";

export function SignInForm({ redirectTo }: { redirectTo?: string }) {
  const [result, formAction, pending] = useActionState(signIn, null);

  return (
    <AuthShell
      title="Sign in"
      subtitle="Access is limited to authorised CPML recruitment staff."
      footer={
        <>
          No account yet? <AuthLink href="/signup">Request access</AuthLink>
        </>
      }
    >
      <form action={formAction} noValidate>
        <FormMessage result={result} fields={["email", "password"]} />

        {redirectTo ? (
          <input type="hidden" name="redirectTo" value={redirectTo} />
        ) : null}

        <Field
          label="Work email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          error={result?.errors?.email}
        />

        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          error={result?.errors?.password}
        />

        <div className="-mt-1 mb-4 text-right">
          <AuthLink href="/forgot-password">Forgot your password?</AuthLink>
        </div>

        <SubmitButton pending={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
