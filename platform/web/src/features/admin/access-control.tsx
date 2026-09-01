"use client";

import * as React from "react";
import {
  Check,
  Database,
  EyeOff,
  FileDown,
  History,
  Layers,
  Minus,
  ShieldCheck,
  Trash2,
  UserCheck,
} from "lucide-react";
import { cn, fmtInt } from "@/lib/utils";
import { PageHeader, Section, SectionHead } from "@/components/layout/page-header";
import { Panel, PanelHeader, Badge, EmptyState, Segmented } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/overlays";
import { useSession } from "@/lib/providers/session-provider";
import {
  CAPABILITIES,
  DATASET_MODE,
  DATASET_MODE_NOTE,
  PROTECTED_FIELDS,
  ROLES,
  ROLE_CAPABILITIES,
  ROLE_DESCRIPTION,
  ROLE_RANK,
  can,
  requiredRoleFor,
  type Capability,
} from "@/lib/auth/permissions";

/** Capability groups, in the order a reviewer would want to read them. */
const GROUPS: { id: string; label: string; description: string; prefix: string }[] = [
  {
    id: "page",
    label: "Pages",
    description: "Which screens a role may open. Enforced on the route, not just in the sidebar.",
    prefix: "page.",
  },
  {
    id: "data",
    label: "Row scope",
    description: "Which records a role may see at all, before any filter they choose.",
    prefix: "data.",
  },
  {
    id: "field",
    label: "Fields",
    description: "Which columns of personal and compensation data are visible.",
    prefix: "field.",
  },
  {
    id: "action",
    label: "Actions",
    description: "What a role may do, as distinct from what it may see.",
    prefix: "action.",
  },
];

const CAPABILITY_LABEL: Partial<Record<Capability, string>> = {
  "page.command-center": "Command Center",
  "page.pipeline": "Pipeline",
  "page.velocity": "Velocity & Aging",
  "page.attrition": "Loss Analysis",
  "page.health": "Recruitment Health",
  "page.recruiters": "Recruiters",
  "page.recruiter-profile": "Recruiter profile",
  "page.interviewers": "Interviewers",
  "page.business-units": "Business Units",
  "page.sources": "Sources",
  "page.talent": "Talent Insights",
  "page.roles": "Roles",
  "page.candidates": "Candidate Explorer",
  "page.reports": "Reports",
  "page.access-admin": "Access Control",
  "page.audit": "Audit log",
  "data.all-recruiters": "All recruiters' records",
  "field.phone": "Phone number",
  "field.email": "Email address",
  "field.cnic": "National identity number",
  "field.salary": "Compensation history",
  "field.remarks": "Recruiter notes",
  "action.export.csv": "Export CSV",
  "action.export.excel": "Export Excel",
  "action.export.pdf": "Export PDF",
  "action.save-view": "Save filter views",
  "action.switch-role": "Change role",
  "action.sync-data": "Trigger data sync",
};

export function AccessControl() {
  const { session, auditLog, clearAuditLog } = useSession();
  const [group, setGroup] = React.useState("page");

  const activeGroup = GROUPS.find((g) => g.id === group)!;
  const capabilities = React.useMemo(
    () => CAPABILITIES.filter((c) => c.startsWith(activeGroup.prefix)),
    [activeGroup.prefix],
  );

  const orderedRoles = React.useMemo(
    () => [...ROLES].sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]),
    [],
  );

  return (
    <>
      <PageHeader
        title="Access Control"
        description="The complete permission model. Every authorisation decision in the product resolves against this table."
        breadcrumb={[{ label: "Command Center", href: "/" }, { label: "Access Control" }]}
        actions={
          <Badge tone={session.simulated ? "warn" : "good"} size="md">
            <span aria-hidden>{session.simulated ? "▽" : "▲"}</span>
            {session.simulated ? "Simulated role" : "Role issued by API"}
          </Badge>
        }
      />

      {/* ================= Enforcement posture ================= */}
      <Section>
        <Panel className="relative overflow-hidden p-4 pt-[18px]">
          <span
            aria-hidden
            className="accent-bar"
            style={{
              background: DATASET_MODE === "server-scoped" ? "var(--q-good)" : "var(--q-low)",
            }}
          />
          <div className="flex flex-wrap items-start gap-3">
            <span
              aria-hidden
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-[9px]",
                DATASET_MODE === "server-scoped"
                  ? "bg-good-soft text-good-ink"
                  : "bg-warn-soft text-warn-ink",
              )}
            >
              <Database className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-body font-bold text-ink">
                Enforcement posture:{" "}
                {DATASET_MODE === "server-scoped" ? "server-scoped" : "client-full"}
              </h3>
              <p className="mt-1 max-w-4xl text-label leading-[1.6] text-ink-3">
                {DATASET_MODE_NOTE[DATASET_MODE]}
              </p>
              {/* Posture-specific, because the two say opposite things. The
                  client-full text used to render in both, which meant this page
                  announced "server-scoped" in the heading and then told the
                  reader to switch to server-scoped in the paragraph beneath —
                  the least useful place in the product to be wrong. */}
              <p className="mt-2 max-w-4xl text-label leading-[1.6] text-ink-4">
                {DATASET_MODE === "server-scoped" ? (
                  <>
                    The rules below are applied twice: in the browser to decide what is
                    shown, and on the server to decide what is delivered. The server does
                    not trust the browser&apos;s copy — it re-derives the role from the
                    session cookie, rewrites a scoped query to its own book, and drops
                    restricted fields before serialising. Changing the role held in this
                    browser would rearrange the interface and nothing else; the data it
                    could reveal was never sent.
                  </>
                ) : (
                  <>
                    The rules below are enforced in the browser for what is shown, and
                    again by the API for what is delivered. Only the API check is a
                    security boundary — the role in this session lives in the browser and
                    a determined user can change it. Set{" "}
                    <code className="text-ink-3">NEXT_PUBLIC_DATASET_MODE=server-scoped</code>{" "}
                    and point the store at the authenticated endpoint to make the two
                    agree.
                  </>
                )}
              </p>
            </div>
          </div>
        </Panel>
      </Section>

      {/* ================= Roles ================= */}
      <Section>
        <SectionHead
          icon={UserCheck}
          title="Roles"
          description="Each role inherits everything from the role beneath it, so the list is an escalation path."
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {orderedRoles.map((role) => {
            const held = ROLE_CAPABILITIES[role].size;
            const isCurrent = role === session.role;
            return (
              <Panel
                key={role}
                className={cn(
                  "relative flex flex-col overflow-hidden p-4 pt-[18px]",
                  isCurrent && "panel-selected",
                )}
              >
                <span
                  aria-hidden
                  className="accent-bar"
                  style={{ background: isCurrent ? "var(--g1)" : "var(--line-2)" }}
                />
                <div className="flex items-start justify-between gap-2">
                  <p className="eyebrow">Rank {ROLE_RANK[role]}</p>
                  {isCurrent ? <Badge tone="accent">You</Badge> : null}
                </div>
                <h3 className="mt-1 text-body font-bold text-ink">{role}</h3>
                <p className="mt-1.5 flex-1 text-label leading-[1.6] text-ink-3">
                  {ROLE_DESCRIPTION[role]}
                </p>
                <p className="mt-2.5 text-meta font-bold tabular-nums text-ink-2">
                  {held} of {CAPABILITIES.length} permissions
                </p>
                <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <span
                    className="transition-[width] duration-700"
                    style={{
                      width: `${(held / CAPABILITIES.length) * 100}%`,
                      background: isCurrent ? "var(--g1)" : "var(--g4)",
                    }}
                  />
                </div>
              </Panel>
            );
          })}
        </div>
      </Section>

      {/* ================= Matrix ================= */}
      <Section>
        <SectionHead
          icon={Layers}
          title="Permission matrix"
          description={activeGroup.description}
          actions={
            <Segmented
              value={group}
              onChange={setGroup}
              options={GROUPS.map((g) => ({ value: g.id, label: g.label }))}
              aria-label="Permission group"
            />
          }
        />
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-meta">
              <thead>
                <tr className="border-b border-line bg-g6">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-g6 px-3 py-2 text-left col-head"
                  >
                    Permission
                  </th>
                  {orderedRoles.map((role) => (
                    <th
                      key={role}
                      scope="col"
                      className={cn(
                        "px-3 py-2 text-center col-head whitespace-nowrap",
                        role === session.role && "bg-accent-soft",
                      )}
                    >
                      {role}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {capabilities.map((capability, i) => {
                  const required = requiredRoleFor(capability);
                  return (
                    <tr
                      key={capability}
                      className={cn(
                        "border-b border-line last:border-0",
                        i % 2 === 1 && "bg-surface-2/45",
                      )}
                    >
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-semibold text-ink"
                      >
                        <span className="flex flex-col">
                          <span>{CAPABILITY_LABEL[capability] ?? capability}</span>
                          <span className="font-mono text-micro font-normal text-ink-4">
                            {capability}
                          </span>
                        </span>
                      </th>
                      {orderedRoles.map((role) => {
                        const granted = can(role, capability);
                        const isFirstGrant = required === role;
                        return (
                          <td
                            key={role}
                            className={cn(
                              "px-3 py-1.5 text-center",
                              role === session.role && "bg-accent-soft/50",
                            )}
                          >
                            {granted ? (
                              <Hint
                                content={
                                  isFirstGrant
                                    ? `First granted at ${role}.`
                                    : `Inherited from ${required}.`
                                }
                              >
                                <span
                                  className={cn(
                                    "inline-grid size-5 place-items-center rounded-full",
                                    isFirstGrant
                                      ? "bg-good text-white"
                                      : "bg-good-soft text-good-ink",
                                  )}
                                >
                                  <Check className="size-3" strokeWidth={3} />
                                  <span className="sr-only">
                                    Granted{isFirstGrant ? " (first granted here)" : " (inherited)"}
                                  </span>
                                </span>
                              </Hint>
                            ) : (
                              <span className="inline-grid size-5 place-items-center text-ink-4">
                                <Minus className="size-3" />
                                <span className="sr-only">Not granted</span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="flex flex-wrap items-center gap-4 border-t border-line px-3.5 py-2 text-micro text-ink-4">
            <span className="flex items-center gap-1.5">
              <span className="inline-grid size-4 place-items-center rounded-full bg-good text-white">
                <Check className="size-2.5" strokeWidth={3} />
              </span>
              First granted at this role
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-grid size-4 place-items-center rounded-full bg-good-soft text-good-ink">
                <Check className="size-2.5" strokeWidth={3} />
              </span>
              Inherited from below
            </span>
            <span className="flex items-center gap-1.5">
              <Minus className="size-3" />
              Not granted
            </span>
          </footer>
        </Panel>
      </Section>

      {/* ================= Protected fields ================= */}
      <Section>
        <SectionHead
          icon={EyeOff}
          title="Protected fields"
          description="Restricted values are removed from the payload, not blanked — a blank cell would read as 'no data recorded', which is a different fact."
        />
        <Panel className="overflow-hidden">
          <table className="w-full border-collapse text-meta">
            <thead>
              <tr className="border-b border-line bg-g6">
                <th scope="col" className="px-3 py-2 text-left col-head">Field</th>
                <th scope="col" className="px-3 py-2 text-left col-head">Minimum role</th>
                <th scope="col" className="px-3 py-2 text-left col-head">Why it is restricted</th>
                <th scope="col" className="px-3 py-2 text-center col-head">Your access</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(PROTECTED_FIELDS).map(([field, policy], i) => {
                const required = requiredRoleFor(policy.capability);
                const granted = can(session.role, policy.capability);
                return (
                  <tr
                    key={field}
                    className={cn(
                      "border-b border-line last:border-0",
                      i % 2 === 1 && "bg-surface-2/45",
                    )}
                  >
                    <td className="px-3 py-2 font-semibold text-ink">{policy.label}</td>
                    <td className="px-3 py-2 text-ink-2">{required ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-3">{policy.reason}</td>
                    <td className="px-3 py-2 text-center">
                      <Badge tone={granted ? "good" : "warn"}>
                        <span aria-hidden>{granted ? "▲" : "▽"}</span>
                        {granted ? "Visible" : "Restricted"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </Section>

      {/* ================= Audit ================= */}
      <Section>
        <SectionHead
          icon={History}
          title="Access log"
          description="Reads of personal data, denied attempts and anything that left the platform."
          actions={
            auditLog.length ? (
              <Button variant="ghost" size="sm" onClick={clearAuditLog}>
                <Trash2 />
                Clear local log
              </Button>
            ) : null
          }
        />
        <Panel className="overflow-hidden">
          <PanelHeader
            title={`${fmtInt(auditLog.length)} recorded this session`}
            description="This is the browser's mirror. The API keeps the authoritative, immutable record."
            actions={
              <Badge tone="outline">
                <ShieldCheck className="size-3" />
                Retained 400 days server-side
              </Badge>
            }
          />
          {auditLog.length === 0 ? (
            <EmptyState
              icon={<History />}
              title="Nothing recorded yet"
              description="Open a candidate record, run an export, or try a page your role cannot reach — each of those appears here."
              compact
            />
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full border-collapse text-meta">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-line bg-g6">
                    <th scope="col" className="px-3 py-1.5 text-left col-head">When</th>
                    <th scope="col" className="px-3 py-1.5 text-left col-head">Actor</th>
                    <th scope="col" className="px-3 py-1.5 text-left col-head">Role</th>
                    <th scope="col" className="px-3 py-1.5 text-left col-head">Action</th>
                    <th scope="col" className="px-3 py-1.5 text-left col-head">Resource</th>
                    <th scope="col" className="px-3 py-1.5 text-right col-head">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((entry, i) => (
                    <tr
                      key={entry.id}
                      className={cn(
                        "border-b border-line last:border-0",
                        i % 2 === 1 && "bg-surface-2/45",
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-ink-3">
                        {new Date(entry.at).toLocaleString("en-GB")}
                      </td>
                      <td className="px-3 py-1.5 text-ink-2">{entry.actor}</td>
                      <td className="px-3 py-1.5 text-ink-3">{entry.role}</td>
                      <td className="px-3 py-1.5">
                        <Badge tone={toneFor(entry.action)}>{entry.action}</Badge>
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-1.5 text-ink-2" title={entry.resource}>
                        {entry.resource}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-ink-3">
                        {entry.rowCount != null ? fmtInt(entry.rowCount) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </Section>

      {/* ================= Export controls ================= */}
      <Section>
        <SectionHead
          icon={FileDown}
          title="What leaves the platform"
          description="Exports carry the same field restrictions as the screen, and every one is logged."
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Note
            title="Columns follow the role"
            body="An export contains exactly the columns the role may see. A Recruiter exporting the candidate list gets no compensation column — it is absent from the file, not blanked in it."
          />
          <Note
            title="Row scope follows the session"
            body="A scoped user exports their own book. Clearing every filter first does not widen the file, because scope is applied before the filter, not after it."
          />
          <Note
            title="Exports are capped and logged"
            body="Twenty thousand rows per file, with the count stated when it truncates. Every export writes an audit row naming the actor, the scope and the row count."
          />
        </div>
      </Section>
    </>
  );
}

function toneFor(action: string) {
  if (action === "access.denied") return "critical" as const;
  if (action.startsWith("export.")) return "warn" as const;
  if (action === "session.role-changed") return "info" as const;
  return "neutral" as const;
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <Panel className="p-4">
      <h3 className="text-meta font-bold text-ink">{title}</h3>
      <p className="mt-1.5 text-label leading-[1.6] text-ink-3">{body}</p>
    </Panel>
  );
}
