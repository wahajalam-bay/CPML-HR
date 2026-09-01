"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/auth/actions";

/**
 * Shared chrome and controls for the authentication flows.
 *
 * Kept together so every flow gets the same error placement, the same focus
 * behaviour and the same live-region announcements — the parts that are easy
 * to get subtly wrong once per page.
 */

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    /* The authenticated app opens onto a deep green header, so the front door
       is the whole field in that green rather than a pale page with a green
       accent — the same brand, met before sign-in instead of after it. The card
       stays on the app's own surface token, which keeps it white in light and
       dark-panel in dark without a second set of colours to maintain. */
    <div
      className="relative flex min-h-dvh items-center justify-center px-4 py-10"
      style={{ background: "var(--grad-hero)" }}
    >
      <div className="auth-field" aria-hidden />

      <div className="relative z-[1] w-full max-w-[420px]">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <span
            aria-hidden
            className="grid size-10 place-items-center rounded-[12px] text-[14px] font-extrabold text-[#063d24] shadow-[0_6px_16px_rgb(0_0_0/0.28),inset_0_0_0_1px_rgb(255_255_255/0.6)]"
            style={{ background: "linear-gradient(135deg,#fff,#d8f0e2)" }}
          >
            CP
          </span>
          <span>
            <span className="block text-lead font-extrabold leading-tight text-white">
              CPML HR
            </span>
            <span className="block text-micro font-semibold uppercase tracking-[0.6px] text-white/70">
              Recruitment Operations
            </span>
          </span>
        </div>

        <div className="panel overflow-hidden shadow-[0_24px_60px_-12px_rgb(0_0_0/0.45)]">
          <div className="border-b border-line px-6 py-5">
            <h1 className="text-title font-extrabold text-ink">{title}</h1>
            {subtitle ? (
              <p className="mt-1 text-meta leading-[1.6] text-ink-3">{subtitle}</p>
            ) : null}
          </div>
          <div className="px-6 py-5">{children}</div>
        </div>

        {/* The links inside the card sit on the panel and keep the green
            accent; this one sits on the green field, where that accent is
            invisible. Scoped here rather than in `AuthLink`, so the component
            stays correct in both places without a variant to remember. */}
        {footer ? (
          <div className="mt-4 text-center text-meta text-white/85 [&_a]:text-white [&_a]:underline-offset-2">
            {footer}
          </div>
        ) : null}

        <p className="mt-6 text-center text-micro leading-[1.6] text-white/72">
          This platform holds candidate personal data. Access is logged and
          reviewed. Bayut Saudi Arabia · Internal use only.
        </p>
      </div>
    </div>
  );
}

/* =========================================================================
 * Feedback
 * ========================================================================= */

/**
 * The form-level message.
 *
 * `fields` lists the inputs the form actually renders. Any field error keyed to
 * something not in that list is shown here instead, because otherwise it is
 * shown nowhere: a validation failure on a conditionally-rendered input makes
 * the form silently refuse to submit with no visible reason. Pass `fields` and
 * a whole class of dead-end failure becomes impossible.
 */
export function FormMessage({
  result,
  fields,
}: {
  result: ActionResult | null;
  fields?: string[];
}) {
  const orphaned = React.useMemo(() => {
    if (!result?.errors || !fields) return [];
    return Object.entries(result.errors)
      .filter(([key]) => !fields.includes(key))
      .map(([key, message]) => `${key}: ${message}`);
  }, [result?.errors, fields]);

  const fallback = orphaned.length ? orphaned.join(" · ") : undefined;
  if (!result || (!result.message && !result.notice && !fallback)) return null;
  const isError = !result.ok;

  return (
    // Announced to screen readers the moment it appears, which is the whole
    // point of an error that arrives after a submit.
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mb-4 flex items-start gap-2 rounded-[var(--r-xs)] border px-3 py-2.5 text-meta leading-[1.55]",
        isError
          ? "border-critical/30 bg-critical-soft text-critical-ink"
          : "border-good/30 bg-good-soft text-good-ink",
      )}
    >
      {isError ? (
        <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
      ) : (
        <CheckCircle2 className="mt-px size-4 shrink-0" aria-hidden />
      )}
      <span>{result.message ?? result.notice ?? fallback}</span>
    </div>
  );
}

/* =========================================================================
 * Fields
 * ========================================================================= */

export function Field({
  label,
  name,
  type = "text",
  error,
  hint,
  autoComplete,
  required = true,
  defaultValue,
  autoFocus,
  readOnly,
}: {
  label: string;
  name: string;
  type?: string;
  error?: string;
  hint?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
}) {
  const [revealed, setRevealed] = React.useState(false);
  const isPassword = type === "password";
  const id = `field-${name}`;
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-meta font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={isPassword && revealed ? "text" : type}
          required={required}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          autoFocus={autoFocus}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(
            "h-10 w-full rounded-[var(--r-xs)] border bg-surface px-3 text-body text-ink outline-none transition-colors",
            "placeholder:text-ink-4 focus-visible:border-accent",
            isPassword && "pr-10",
            readOnly && "bg-surface-2 text-ink-3",
            error ? "border-critical" : "border-line",
          )}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            // Toggling reveal is a legitimate accessibility affordance: it lets
            // someone verify a long passphrase they just typed.
            aria-label={revealed ? "Hide password" : "Show password"}
            className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-[5px] text-ink-4 transition-colors hover:text-ink-2"
          >
            {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-label text-critical-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-label leading-[1.5] text-ink-4">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SubmitButton({
  children,
  pending,
}: {
  children: React.ReactNode;
  pending: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "flex h-10 w-full items-center justify-center gap-2 rounded-[var(--r-xs)] text-body font-semibold text-white transition-all",
        "disabled:cursor-not-allowed disabled:opacity-70",
      )}
      style={{ background: "var(--grad-green)" }}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-g1 hover:underline">
      {children}
    </Link>
  );
}

/* =========================================================================
 * Password strength
 * ========================================================================= */

/**
 * A live strength read-out.
 *
 * Scores length first, because length is what actually resists cracking; the
 * variety checks are secondary nudges rather than gates. The form itself only
 * enforces a 12-character minimum — telling someone their passphrase is
 * "weak" because it lacks a symbol trains worse habits, not better ones.
 */
export function PasswordStrength({ value }: { value: string }) {
  const { score, label, tone } = React.useMemo(() => {
    if (!value) return { score: 0, label: "", tone: "" };
    let s = 0;
    if (value.length >= 12) s += 2;
    else if (value.length >= 8) s += 1;
    if (value.length >= 16) s += 1;
    if (value.length >= 20) s += 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) s += 0.5;
    if (/\d/.test(value)) s += 0.5;
    if (/[^A-Za-z0-9]/.test(value)) s += 0.5;

    if (s < 2) return { score: 1, label: "Too short", tone: "var(--q-crit)" };
    if (s < 3) return { score: 2, label: "Acceptable", tone: "var(--q-low)" };
    if (s < 4.5) return { score: 3, label: "Good", tone: "var(--q-mid)" };
    return { score: 4, label: "Strong", tone: "var(--q-good)" };
  }, [value]);

  if (!value) return null;

  return (
    <div className="-mt-2 mb-4">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ background: i <= score ? tone : "var(--surface-3)" }}
          />
        ))}
      </div>
      <p className="mt-1 text-label" style={{ color: tone }}>
        {label}
        {score < 2 ? " — use at least 12 characters" : null}
      </p>
    </div>
  );
}
