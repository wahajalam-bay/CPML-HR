"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  KeyRound,
  Lock,
  LogOut,
  MailPlus,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn, fmtInt } from "@/lib/utils";
import { PageHeader, Section, SectionHead } from "@/components/layout/page-header";
import { Panel, Badge, EmptyState } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger, Hint } from "@/components/ui/overlays";
import { FormMessage } from "@/features/auth/auth-shell";
import {
  createUser,
  deleteUser,
  inviteUser,
  revokeInvitation,
  revokeUserSessions,
  setUserPassword,
  setUserRole,
  setUserStatus,
  unlockUser,
} from "@/server/admin/actions";
import {
  ROLES,
  ROLE_DESCRIPTION,
  ROLE_RANK,
  type Role,
} from "@/lib/auth/permissions";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: "pending" | "active" | "suspended" | "locked";
  recruiterName: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  emailVerifiedAt: string | null;
  failedSignIns: number;
  lockedUntil: string | null;
  activeSessions: number;
}

interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  recruiterName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

const STATUS_TONE = {
  active: "good",
  pending: "warn",
  suspended: "critical",
  locked: "serious",
} as const;

export function UserAdministration({
  users,
  invitations,
  recruiterNames,
  actorRole,
  actorId,
  canCreate,
}: {
  users: UserRow[];
  invitations: InvitationRow[];
  /** Recruiter names in the dataset, so a book can be picked rather than typed. */
  recruiterNames: string[];
  /** The signed-in administrator, so the UI can hide what the server will refuse. */
  actorRole: Role;
  actorId: string;
  canCreate: boolean;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  const run = React.useCallback(
    async (key: string, action: () => Promise<{ ok: boolean; notice?: string; message?: string }>) => {
      setBusy(key);
      try {
        const result = await action();
        if (result.ok) toast.success(result.notice ?? "Done");
        else toast.error(result.message ?? "That did not work");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const pending = invitations.filter((i) => !i.acceptedAt);
  const counts = React.useMemo(() => {
    const byRole = new Map<Role, number>();
    for (const u of users) byRole.set(u.role, (byRole.get(u.role) ?? 0) + 1);
    return {
      byRole,
      active: users.filter((u) => u.status === "active").length,
      awaiting: users.filter((u) => u.status === "pending").length,
      suspended: users.filter((u) => u.status === "suspended").length,
      sessions: users.reduce((s, u) => s + u.activeSessions, 0),
    };
  }, [users]);

  return (
    <>
      <PageHeader
        title="Users"
        description="Create or invite people, assign roles and books, reset passwords, suspend accounts and end sessions."
        breadcrumb={[
          { label: "Command Center", href: "/" },
          { label: "Access Control", href: "/admin/access" },
          { label: "Users" },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <InviteDialog recruiterNames={recruiterNames} />
            {canCreate ? <CreateUserDialog recruiterNames={recruiterNames} /> : null}
          </div>
        }
      />

      <Section>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Active accounts" value={counts.active} icon={<Users className="size-4" />} />
          <Stat label="Awaiting verification" value={counts.awaiting} icon={<MailPlus className="size-4" />} tone={counts.awaiting ? "warn" : undefined} />
          <Stat label="Suspended" value={counts.suspended} icon={<Lock className="size-4" />} tone={counts.suspended ? "critical" : undefined} />
          <Stat label="Live sessions" value={counts.sessions} icon={<ShieldCheck className="size-4" />} />
        </div>
      </Section>

      <Section>
        <SectionHead
          icon={UserCog}
          title="Accounts"
          description="Changing a role or suspending an account signs that person out immediately — the new access applies on their next sign-in."
        />
        <Panel className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-meta">
              <thead>
                <tr className="border-b border-line bg-g6">
                  <th scope="col" className="px-3 py-2 text-left col-head">Person</th>
                  <th scope="col" className="px-3 py-2 text-left col-head">Role</th>
                  <th scope="col" className="px-3 py-2 text-left col-head">Book</th>
                  <th scope="col" className="px-3 py-2 text-left col-head">Status</th>
                  <th scope="col" className="px-3 py-2 text-right col-head">Sessions</th>
                  <th scope="col" className="px-3 py-2 text-left col-head">Last seen</th>
                  <th scope="col" className="px-3 py-2 text-right col-head">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user, i) => (
                  <tr
                    key={user.id}
                    className={cn(
                      "border-b border-line last:border-0",
                      i % 2 === 1 && "bg-surface-2/45",
                    )}
                  >
                    <td className="px-3 py-2">
                      <p className="font-semibold text-ink">{user.name}</p>
                      <p className="text-label text-ink-3">{user.email}</p>
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={user.role}
                        disabled={busy === user.id}
                        onChange={(e) =>
                          run(user.id, () =>
                            setUserRole(user.id, e.target.value as Role, user.recruiterName),
                          )
                        }
                        aria-label={`Role for ${user.email}`}
                        className="h-7 rounded-[var(--r-xs)] border border-line bg-surface px-1.5 text-meta text-ink"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-ink-3">
                      {user.role === "Recruiter" ? (
                        user.recruiterName ?? (
                          <Hint content="A Recruiter with no book mapped sees no records at all. Set the recruiter name to match the source sheet.">
                            <span className="cursor-help text-serious-ink">Not linked</span>
                          </Hint>
                        )
                      ) : (
                        <span className="text-ink-4">All records</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[user.status]}>{user.status}</Badge>
                      {user.lockedUntil && new Date(user.lockedUntil) > new Date() ? (
                        <Badge tone="serious" className="ml-1">
                          locked
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                      {user.activeSessions}
                    </td>
                    <td className="px-3 py-2 text-label text-ink-3">
                      {user.lastSignInAt
                        ? new Date(user.lastSignInAt).toLocaleString("en-GB")
                        : "Never"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {canCreate && ROLE_RANK[user.role] <= ROLE_RANK[actorRole] ? (
                          <SetPasswordDialog
                            userId={user.id}
                            email={user.email}
                            disabled={busy === user.id}
                          />
                        ) : null}
                        {user.lockedUntil && new Date(user.lockedUntil) > new Date() ? (
                          <Hint content="Clear the failed sign-in lock">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Unlock ${user.email}`}
                              disabled={busy === user.id}
                              onClick={() => run(user.id, () => unlockUser(user.id))}
                            >
                              <KeyRound />
                            </Button>
                          </Hint>
                        ) : null}
                        {user.activeSessions > 0 ? (
                          <Hint content="Sign this person out of every device">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Revoke sessions for ${user.email}`}
                              disabled={busy === user.id}
                              onClick={() => run(user.id, () => revokeUserSessions(user.id))}
                            >
                              <LogOut />
                            </Button>
                          </Hint>
                        ) : null}
                        <Hint
                          content={
                            user.status === "suspended"
                              ? "Reinstate this account"
                              : "Suspend and sign out immediately"
                          }
                        >
                          <Button
                            variant={user.status === "suspended" ? "default" : "ghost"}
                            size="xs"
                            disabled={busy === user.id}
                            onClick={() =>
                              run(user.id, () =>
                                setUserStatus(
                                  user.id,
                                  user.status === "suspended" ? "active" : "suspended",
                                ),
                              )
                            }
                          >
                            {user.status === "suspended" ? "Reinstate" : "Suspend"}
                          </Button>
                        </Hint>
                        {canCreate &&
                        user.id !== actorId &&
                        ROLE_RANK[user.role] <= ROLE_RANK[actorRole] ? (
                          <Hint content="Delete this account permanently. The audit trail survives it.">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Delete ${user.email}`}
                              disabled={busy === user.id}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Delete ${user.email}? This cannot be undone. Suspending is reversible and is usually what you want.`,
                                  )
                                ) {
                                  return;
                                }
                                void run(user.id, () => deleteUser(user.id));
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </Hint>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="border-t border-line px-3.5 py-2 text-micro text-ink-4">
            {fmtInt(users.length)} accounts. You cannot grant a role above your own, act on
            an account that outranks you, or demote yourself.
          </footer>
        </Panel>
      </Section>

      <Section>
        <SectionHead
          icon={MailPlus}
          title="Pending invitations"
          description="Invitations expire after 7 days and can only be redeemed by the address they were issued to."
        />
        <Panel className="overflow-hidden">
          {pending.length === 0 ? (
            <EmptyState
              icon={<MailPlus />}
              title="No invitations outstanding"
              description="Invite someone to have them set their own password, or create an account outright if there is no mailbox to send to."
              compact
            />
          ) : (
            <table className="w-full border-collapse text-meta">
              <thead>
                <tr className="border-b border-line bg-g6">
                  <th scope="col" className="px-3 py-2 text-left col-head">Email</th>
                  <th scope="col" className="px-3 py-2 text-left col-head">Role</th>
                  <th scope="col" className="px-3 py-2 text-left col-head">Expires</th>
                  <th scope="col" className="px-3 py-2 text-right col-head">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((invite, i) => {
                  const expired = new Date(invite.expiresAt) < new Date();
                  return (
                    <tr
                      key={invite.id}
                      className={cn(
                        "border-b border-line last:border-0",
                        i % 2 === 1 && "bg-surface-2/45",
                      )}
                    >
                      <td className="px-3 py-2 font-semibold text-ink">{invite.email}</td>
                      <td className="px-3 py-2 text-ink-2">{invite.role}</td>
                      <td className="px-3 py-2">
                        {expired ? (
                          <Badge tone="critical">Expired</Badge>
                        ) : (
                          <span className="text-ink-3">
                            {new Date(invite.expiresAt).toLocaleDateString("en-GB")}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Revoke invitation for ${invite.email}`}
                          disabled={busy === invite.id}
                          onClick={() => run(invite.id, () => revokeInvitation(invite.id))}
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </Section>
    </>
  );
}

/* =========================================================================
 * Shared form parts
 *
 * The invite and create forms ask for the same things and mean the same things
 * by them. Sharing the fields keeps a change to the role explanation or the
 * book warning from landing in one dialog and not the other.
 * ========================================================================= */

const INPUT =
  "h-10 w-full rounded-[var(--r-xs)] border border-line bg-surface px-3 text-body text-ink outline-none focus-visible:border-accent";

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-meta font-semibold text-ink" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-label leading-[1.55] text-ink-4">{children}</p>;
}

function RoleField({
  idPrefix,
  role,
  onRoleChange,
}: {
  idPrefix: string;
  role: Role;
  onRoleChange: (role: Role) => void;
}) {
  return (
    <>
      <Label htmlFor={`${idPrefix}-role`}>Role</Label>
      <select
        id={`${idPrefix}-role`}
        name="role"
        value={role}
        onChange={(e) => onRoleChange(e.target.value as Role)}
        className="mb-1.5 h-10 w-full rounded-[var(--r-xs)] border border-line bg-surface px-2 text-body text-ink"
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      <Note>{ROLE_DESCRIPTION[role]}</Note>
    </>
  );
}

/**
 * The book a Recruiter account is scoped to.
 *
 * A select over the real recruiter names rather than a text field: the link is
 * matched on the name exactly as the source sheet spells it, and a typo
 * produces an account that shows nothing with no error to explain why.
 */
function BookField({
  idPrefix,
  recruiterNames,
}: {
  idPrefix: string;
  recruiterNames: string[];
}) {
  return (
    <>
      <Label htmlFor={`${idPrefix}-book`}>Recruiter book</Label>
      {recruiterNames.length ? (
        <select
          id={`${idPrefix}-book`}
          name="recruiterName"
          required
          defaultValue=""
          className="mb-1.5 h-10 w-full rounded-[var(--r-xs)] border border-line bg-surface px-2 text-body text-ink"
        >
          <option value="" disabled>
            Choose a recruiter…
          </option>
          {recruiterNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      ) : (
        <input
          id={`${idPrefix}-book`}
          name="recruiterName"
          required
          className={INPUT}
          placeholder="e.g. Sara Khan"
        />
      )}
      <Note>
        The records this account will see. A Recruiter is scoped to one book and
        cannot widen past it — clearing every filter returns them to it rather
        than to the whole dataset.
      </Note>
    </>
  );
}

/* =========================================================================
 * Invite dialog
 * ========================================================================= */

function InviteDialog({ recruiterNames }: { recruiterNames: string[] }) {
  const [result, formAction, pending] = useActionState(inviteUser, null);
  const [role, setRole] = React.useState<Role>("Recruiter");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <MailPlus />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Invite someone"
        description="They receive a link to set their own password. The invitation is bound to this address and expires in 7 days."
      >
        <form action={formAction} className="p-4">
          <FormMessage result={result} fields={["email", "role", "recruiterName"]} />

          <Label htmlFor="invite-email">Work email</Label>
          <input id="invite-email" name="email" type="email" required autoFocus className={INPUT} />
          <div className="mb-4" />

          <RoleField idPrefix="invite" role={role} onRoleChange={setRole} />

          {role === "Recruiter" ? (
            <BookField idPrefix="invite" recruiterNames={recruiterNames} />
          ) : null}

          <Button variant="primary" size="lg" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Send invitation"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* =========================================================================
 * Create dialog
 *
 * Invitation is the better default and stays the primary path. This exists for
 * when it cannot work: no outbound mail, a shared function account, or a
 * demonstration. The trade is explicit in the dialog rather than implied.
 * ========================================================================= */

function CreateUserDialog({ recruiterNames }: { recruiterNames: string[] }) {
  const [result, formAction, pending] = useActionState(createUser, null);
  const [role, setRole] = React.useState<Role>("Recruiter");
  const [password, setPassword] = React.useState("");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="primary" size="sm">
          <UserPlus />
          Create account
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Create an account"
        description="Sets the password yourself and activates the account immediately — no email required. Use an invitation instead where you can: it proves the person controls the mailbox and nobody else ever knows their password."
      >
        <form action={formAction} className="p-4">
          <FormMessage
            result={result}
            fields={["name", "email", "role", "recruiterName", "password"]}
          />

          <Label htmlFor="create-name">Full name</Label>
          <input id="create-name" name="name" required autoFocus className={INPUT} />
          <div className="mb-4" />

          <Label htmlFor="create-email">Work email</Label>
          <input id="create-email" name="email" type="email" required className={INPUT} />
          <Note>This is the sign-in identifier. It cannot be changed afterwards.</Note>

          <RoleField idPrefix="create" role={role} onRoleChange={setRole} />

          {role === "Recruiter" ? (
            <BookField idPrefix="create" recruiterNames={recruiterNames} />
          ) : null}

          <Label htmlFor="create-password">Initial password</Label>
          <div className="flex gap-2">
            <input
              id="create-password"
              name="password"
              type="text"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              // Shown rather than masked: you have to be able to read it to
              // pass it on, and masking a value you chose protects nothing.
              className={cn(INPUT, "font-mono text-meta")}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => setPassword(suggestPassphrase())}
            >
              Suggest
            </Button>
          </div>
          <Note>
            At least 12 characters. Length is what makes a password hard to
            crack, so a memorable phrase beats a short scramble.
          </Note>

          <label className="mb-4 flex items-start gap-2 text-label leading-[1.55] text-ink-2">
            <input
              type="checkbox"
              name="requirePasswordChange"
              defaultChecked
              className="mt-0.5 size-3.5 accent-[var(--g1)]"
            />
            <span>
              Also send them a link to set their own password. Recommended — it
              means the password you just typed stops being a shared secret.
            </span>
          </label>

          <Button variant="primary" size="lg" className="w-full" disabled={pending}>
            {pending ? "Creating…" : "Create account"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* =========================================================================
 * Set password
 * ========================================================================= */

function SetPasswordDialog({
  userId,
  email,
  disabled,
}: {
  userId: string;
  email: string;
  disabled: boolean;
}) {
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await setUserPassword(userId, password);
    setBusy(false);
    if (result.ok) {
      toast.success(result.notice ?? "Done");
      setPassword("");
      setOpen(false);
    } else {
      toast.error(result.message ?? "That did not work");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Hint content="Set a password for this account">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Set password for ${email}`}
            disabled={disabled}
          >
            <KeyRound />
          </Button>
        </Hint>
      </DialogTrigger>
      <DialogContent
        title="Set a password"
        description={`For ${email}. Every session ends immediately — whoever held the old password loses access, which is the point.`}
      >
        <form onSubmit={submit} className="p-4">
          <Label htmlFor={`pw-${userId}`}>New password</Label>
          <div className="flex gap-2">
            <input
              id={`pw-${userId}`}
              type="text"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(INPUT, "font-mono text-meta")}
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => setPassword(suggestPassphrase())}
            >
              Suggest
            </Button>
          </div>
          <Note>At least 12 characters.</Note>

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={busy || password.length < 12}
          >
            {busy ? "Setting…" : "Set password"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A readable passphrase.
 *
 * Four words from a small list plus digits: long enough to be strong, short
 * enough to read down a phone. Uses the Web Crypto RNG rather than
 * `Math.random`, which is seeded predictably and has no business generating
 * anything anyone signs in with.
 */
function suggestPassphrase(): string {
  const words = [
    "amber", "anchor", "basalt", "beacon", "cedar", "cobalt", "copper", "coral",
    "delta", "ember", "falcon", "garnet", "harbour", "indigo", "ivory", "jasper",
    "kestrel", "lantern", "marble", "meadow", "nickel", "onyx", "orchid", "pewter",
    "quartz", "ridge", "saffron", "silver", "summit", "thistle", "topaz", "willow",
  ];
  const bytes = new Uint32Array(5);
  crypto.getRandomValues(bytes);
  const picked = [...bytes.slice(0, 4)].map((n) => words[n % words.length]);
  return `${picked.join("-")}-${(bytes[4] % 90) + 10}`;
}

function Stat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "warn" | "critical";
}) {
  return (
    <Panel className="relative overflow-hidden p-4 pt-[18px]">
      <span
        aria-hidden
        className="accent-bar"
        style={{
          background:
            tone === "critical" ? "var(--q-crit)" : tone === "warn" ? "var(--q-low)" : "var(--g1)",
        }}
      />
      <div className="flex items-start justify-between">
        <span className="eyebrow">{label}</span>
        <span className="text-ink-4">{icon}</span>
      </div>
      <p className="mt-2 text-figure font-extrabold leading-none tabular-nums text-ink">
        {fmtInt(value)}
      </p>
    </Panel>
  );
}


