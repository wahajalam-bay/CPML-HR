"use client";

import * as React from "react";
import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { signUp } from "@/server/auth/actions";
import {
  AuthLink,
  AuthShell,
  Field,
  FormMessage,
  PasswordStrength,
  SubmitButton,
} from "./auth-shell";

export function SignUpForm({
  invite,
  invitedEmail,
}: {
  invite?: string;
  invitedEmail?: string;
}) {
  const [result, formAction, pending] = useActionState(signUp, null);
  const [password, setPassword] = React.useState("");

  // Once the verification mail is away there is nothing left to do on this
  // screen, and leaving the form up invites a second submission.
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
            Already verified? <AuthLink href="/signin">Sign in</AuthLink>
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={invite ? "Accept your invitation" : "Request access"}
      subtitle={
        invite
          ? "Set a password to activate your account."
          : "Sign-up is restricted to approved company domains. Everyone else needs an invitation from an administrator."
      }
      footer={
        <>
          Already have an account? <AuthLink href="/signin">Sign in</AuthLink>
        </>
      }
    >
      <form action={formAction} noValidate>
        <FormMessage result={result} fields={["name", "email", "password"]} />

        {invite ? <input type="hidden" name="invite" value={invite} /> : null}

        <Field
          label="Full name"
          name="name"
          autoComplete="name"
          autoFocus={!invite}
          error={result?.errors?.name}
        />

        <Field
          label="Work email"
          name="email"
          type="email"
          autoComplete="username"
          defaultValue={invitedEmail}
          // An invitation is issued to one address; letting it be edited would
          // let the link be redeemed by someone else.
          readOnly={Boolean(invitedEmail)}
          hint={invitedEmail ? "This invitation was issued to this address." : undefined}
          error={result?.errors?.email}
        />

        <div onChange={(e) => setPassword((e.target as HTMLInputElement).value)}>
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters. A memorable passphrase beats a short complicated one."
            error={result?.errors?.password}
          />
        </div>
        <PasswordStrength value={password} />

        <SubmitButton pending={pending}>
          {pending ? "Creating account…" : invite ? "Activate account" : "Create account"}
        </SubmitButton>

        <p className="mt-4 text-label leading-[1.6] text-ink-4">
          This platform holds candidate personal data. Your access level determines
          which records and fields you can see, and every export is logged.
        </p>
      </form>
    </AuthShell>
  );
}
