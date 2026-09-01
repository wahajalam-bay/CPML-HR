"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { EyeOff, Lock, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/overlays";
import { useSession } from "@/lib/providers/session-provider";
import {
  PROTECTED_FIELDS,
  ROLE_DESCRIPTION,
  capabilityForPath,
  requiredRoleFor,
  type Capability,
  type ProtectedField,
  type Role,
} from "@/lib/auth/permissions";

/* =========================================================================
 * Route guard
 * ========================================================================= */

/**
 * Blocks a page the current role may not open.
 *
 * Wraps the whole content area, so a route is protected by existing rather
 * than by remembering to add a check to it — the sidebar hiding a link is a
 * courtesy, not a control, and direct URLs have to be handled.
 */
export function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can, session, audit } = useSession();
  const capability = capabilityForPath(pathname);
  const allowed = can(capability);

  // Recorded once per denied path, not on every render.
  const recorded = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (allowed) return;
    if (recorded.current === pathname) return;
    recorded.current = pathname;
    audit("access.denied", pathname);
  }, [allowed, pathname, audit]);

  if (allowed) return <>{children}</>;

  return <RouteDenied role={session.role} pathname={pathname} capability={capability} />;
}

/**
 * The denial itself, as a plain presentational component.
 *
 * Rendered by the authenticated layout on a full page load and by `RouteGuard`
 * on a client-side navigation. Sharing it means the two paths cannot drift into
 * telling the user different things about the same refusal.
 */
export function RouteDenied({
  role,
  pathname,
  capability,
}: {
  role: Role;
  pathname: string;
  capability: Capability;
}) {
  const required = requiredRoleFor(capability);

  return (
    <Panel className="relative overflow-hidden">
      <span aria-hidden className="accent-bar" style={{ background: "var(--q-low)" }} />
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <span
          aria-hidden
          className="mb-3 grid size-11 place-items-center rounded-[13px] bg-warn-soft text-warn-ink"
        >
          <Lock className="size-5" />
        </span>
        <h1 className="text-title font-extrabold text-ink">
          This page is not available to your role
        </h1>
        <p className="mt-2 max-w-xl text-body leading-[1.6] text-ink-3">
          You are signed in as <strong className="text-ink">{role}</strong>.
          {required ? (
            <>
              {" "}
              Opening <strong className="text-ink">{pathname}</strong> requires{" "}
              <strong className="text-ink">{required}</strong> access or above.
            </>
          ) : null}
        </p>
        <p className="mt-2 max-w-xl text-label leading-[1.6] text-ink-4">
          {required ? ROLE_DESCRIPTION[required] : null}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="primary" size="md" asChild>
            <Link href="/">Back to the Command Center</Link>
          </Button>
          <Button variant="default" size="md" asChild>
            <Link href="/admin/access">See what each role can do</Link>
          </Button>
        </div>
        <p className="mt-5 text-micro text-ink-4">
          This attempt has been recorded in the access log.
        </p>
      </div>
    </Panel>
  );
}

/* =========================================================================
 * Capability gate
 * ========================================================================= */

/**
 * Renders `children` only when the role holds `capability`.
 *
 * Default is to render nothing: an action a user cannot take is usually better
 * absent than present-and-disabled. Pass `fallback` where the absence would be
 * confusing — a missing export button on a reports page, for instance.
 */
export function Can({
  capability,
  children,
  fallback = null,
}: {
  capability: Capability;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { can } = useSession();
  return <>{can(capability) ? children : fallback}</>;
}

/* =========================================================================
 * Field guard
 * ========================================================================= */

/**
 * A value the role may not see.
 *
 * Shows a lock with the reason rather than an em dash: a blank cell reads as
 * "no data recorded", which is a different and misleading fact.
 */
export function Restricted({
  field,
  className,
  compact = false,
}: {
  field: ProtectedField;
  className?: string;
  compact?: boolean;
}) {
  const policy = PROTECTED_FIELDS[field];
  const required = requiredRoleFor(policy.capability);

  return (
    <Hint
      content={
        <span className="block">
          <span className="block font-medium text-ink">{policy.label} is restricted</span>
          <span className="mt-0.5 block text-ink-3">{policy.reason}</span>
          {required ? (
            <span className="mt-1 block text-ink-4">Requires {required} or above.</span>
          ) : null}
        </span>
      }
    >
      <span
        className={cn(
          "inline-flex items-center gap-1 text-ink-4",
          compact ? "text-micro" : "text-label",
          className,
        )}
      >
        <EyeOff className={compact ? "size-2.5" : "size-3"} aria-hidden />
        <span className="sr-only">{policy.label} restricted for your role. </span>
        <span aria-hidden>Restricted</span>
      </span>
    </Hint>
  );
}

/**
 * Renders a protected value, or the restricted placeholder.
 *
 * The single call site for every piece of protected data in the UI, so a new
 * surface cannot forget the check — it either uses this or it does not render
 * the field.
 */
export function ProtectedValue({
  field,
  children,
  compact = false,
  className,
}: {
  field: ProtectedField;
  children: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const { canSeeField } = useSession();
  if (!canSeeField(field)) {
    return <Restricted field={field} compact={compact} className={className} />;
  }
  return <>{children}</>;
}

/* =========================================================================
 * Scope banner
 * ========================================================================= */

/**
 * States plainly when the visible data is narrower than the dataset.
 *
 * A recruiter looking at a conversion rate needs to know whether it is theirs
 * or the team's; showing a scoped number without saying so invites exactly the
 * wrong conclusion.
 */
export function ScopeBanner({ className }: { className?: string }) {
  const { scope, session } = useSession();
  if (scope.kind === "all") return null;

  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center gap-2 rounded-[var(--r-md)] border border-accent-line bg-accent-soft px-3.5 py-2.5",
        className,
      )}
      role="status"
    >
      <ShieldAlert className="size-4 shrink-0 text-g1" aria-hidden />
      {scope.kind === "own-book" ? (
        <p className="text-meta text-ink-2">
          <strong className="font-bold text-ink">Scoped to your own book.</strong> As{" "}
          {session.role}, every figure on this page covers the{" "}
          <strong className="text-ink">{scope.recruiter}</strong> pipeline only — not
          the wider team. Clearing filters returns you here, not to the full dataset.
        </p>
      ) : (
        <p className="text-meta text-ink-2">
          <strong className="font-bold text-ink">No records in scope.</strong>{" "}
          {scope.reason}
        </p>
      )}
    </div>
  );
}
