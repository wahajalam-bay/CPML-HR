"use client";

import * as React from "react";
import {
  AUDITED_ACTIONS,
  DATASET_MODE,
  ROLES,
  ROLE_CAPABILITIES,
  can,
  canAccessPath,
  canSeeField,
  rowScopeFor,
  type AuditAction,
  type AuditEntry,
  type Capability,
  type ProtectedField,
  type Role,
  type RowScope,
} from "@/lib/auth/permissions";

/**
 * Session, authorisation and audit.
 *
 * With a database configured, the identity and role are resolved server-side
 * from the session cookie and passed in as `serverSession`. Without one, the
 * app runs in its demo posture and the role is chosen in the UI — which is what
 * `simulated` records.
 *
 * This provider is the single place the UI reads identity from, so the two
 * postures differ in one file rather than in every guard in the app.
 */

export interface Session {
  name: string;
  email: string;
  role: Role;
  /** Recruiter name in the dataset, when this user owns a book. */
  recruiterKey: string | null;
  /** True when the role was chosen in the UI rather than issued by the API. */
  simulated: boolean;
  /**
   * True only when the server resolved this identity from a session cookie.
   *
   * Distinct from `!simulated`: in `server-scoped` mode an anonymous visitor is
   * also not simulated — there is no role switcher — so `!simulated` says
   * nothing about whether anyone is signed in. Anything that must not run
   * without a session tests this.
   */
  authenticated: boolean;
}

interface SessionContextValue {
  session: Session;
  roles: readonly Role[];
  /** Records this session may see, before any user-chosen filter. */
  scope: RowScope;
  capabilities: ReadonlySet<Capability>;
  can: (capability: Capability) => boolean;
  canSeeField: (field: ProtectedField | string) => boolean;
  canAccessPath: (pathname: string) => boolean;
  setRole: (role: Role, recruiterKey?: string | null) => void;
  /** Append to the audit trail. No-ops for actions the model does not audit. */
  audit: (
    action: AuditAction,
    resource: string,
    detail?: { scope?: string; rowCount?: number },
  ) => void;
  auditLog: AuditEntry[];
  clearAuditLog: () => void;
}

/**
 * The identity used when no server session was resolved — the demo posture,
 * where there is no database to authenticate against and the role switcher is
 * the point.
 */
const DEFAULT_SESSION: Session = {
  name: "Muhammad Ashhad",
  email: "muhammad.ashhad@bayut.sa",
  role: "HR Director",
  recruiterKey: null,
  simulated: DATASET_MODE === "client-full",
  authenticated: false,
};

/** What the server resolved from the session cookie, if anything. */
export interface ServerSession {
  name: string;
  email: string;
  role: Role;
  recruiterKey: string | null;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

const ROLE_KEY = "cpml.session.v2";
const AUDIT_KEY = "cpml.audit.v1";
/** Kept small: this mirror is for the in-app viewer, the API holds the record. */
const AUDIT_LIMIT = 500;

/**
 * `serverSession` is the identity the server resolved from the session cookie.
 *
 * It becomes the provider's INITIAL state rather than being applied afterwards.
 * The earlier design bridged it in from a descendant, which meant either an
 * effect — letting one frame paint with the default identity, potentially
 * showing data the real role is not entitled to — or a setState during another
 * component's render, which React explicitly forbids and may discard.
 * Initialising from it has neither problem: the very first render is correct.
 */
export function SessionProvider({
  children,
  serverSession,
}: {
  children: React.ReactNode;
  serverSession?: ServerSession | null;
}) {
  const [session, setSession] = React.useState<Session>(() =>
    serverSession
      ? { ...serverSession, simulated: false, authenticated: true }
      : DEFAULT_SESSION,
  );
  const [auditLog, setAuditLog] = React.useState<AuditEntry[]>([]);

  // A sign-in or sign-out changes the identity without remounting the provider.
  const identity = serverSession
    ? `${serverSession.email}|${serverSession.role}|${serverSession.recruiterKey ?? ""}`
    : null;
  React.useEffect(() => {
    setSession((prev) =>
      serverSession
        ? { ...serverSession, simulated: false, authenticated: true }
        : prev.simulated
          ? prev
          : DEFAULT_SESSION,
    );
    // `identity` is the value that actually changed; `serverSession` is a new
    // object on every server render and would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(ROLE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<Session>;
        if (stored.role && (ROLES as readonly string[]).includes(stored.role)) {
          setSession((s) =>
            // A real, server-issued session always wins. Without this guard the
            // stored demo role would overwrite it a tick after mount, and a
            // Recruiter could promote themselves by editing local storage.
            s.simulated
              ? {
                  ...s,
                  role: stored.role as Role,
                  recruiterKey: stored.recruiterKey ?? null,
                }
              : s,
          );
        }
      }
      const storedLog = localStorage.getItem(AUDIT_KEY);
      if (storedLog) setAuditLog(JSON.parse(storedLog) as AuditEntry[]);
    } catch {
      /* storage unavailable — session falls back to the default role */
    }
  }, []);

  const audit = React.useCallback<SessionContextValue["audit"]>(
    (action, resource, detail) => {
      if (!(AUDITED_ACTIONS as readonly string[]).includes(action)) return;
      setAuditLog((previous) => {
        const entry: AuditEntry = {
          // Monotonic within a session and unique enough for a client mirror;
          // the server assigns the authoritative id.
          id: `${Date.now()}-${previous.length}`,
          at: Date.now(),
          actor: session.email,
          role: session.role,
          action,
          resource,
          scope: detail?.scope,
          rowCount: detail?.rowCount,
        };
        const next = [entry, ...previous].slice(0, AUDIT_LIMIT);
        try {
          localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
        } catch {
          /* ignore — the in-memory log still serves this session */
        }
        return next;
      });
    },
    [session.email, session.role],
  );

  const setRole = React.useCallback(
    (role: Role, recruiterKey: string | null = null) => {
      setSession((s) => {
        // Role switching is a demo affordance. Under a real session the role
        // comes from the signed cookie, and changing it here would only
        // desynchronise the UI from what the server will actually authorise.
        if (!s.simulated) return s;
        const next = { ...s, role, recruiterKey };
        try {
          localStorage.setItem(
            ROLE_KEY,
            JSON.stringify({ role, recruiterKey }),
          );
        } catch {
          /* ignore */
        }
        return next;
      });
      audit("session.role-changed", role);
    },
    [audit],
  );

  const clearAuditLog = React.useCallback(() => {
    setAuditLog([]);
    try {
      localStorage.removeItem(AUDIT_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = React.useMemo<SessionContextValue>(() => {
    const capabilities = ROLE_CAPABILITIES[session.role];
    return {
      session,
      roles: ROLES,
      scope: rowScopeFor(session.role, session.recruiterKey),
      capabilities,
      can: (capability) => can(session.role, capability),
      canSeeField: (field) => canSeeField(session.role, field),
      canAccessPath: (pathname) => canAccessPath(session.role, pathname),
      setRole,
      audit,
      auditLog,
      clearAuditLog,
    };
  }, [session, setRole, audit, auditLog, clearAuditLog]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/** Convenience for a single capability check inside a component. */
export function useCan(capability: Capability): boolean {
  return useSession().can(capability);
}
