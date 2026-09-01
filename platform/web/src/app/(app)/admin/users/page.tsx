import type { Metadata } from "next";
import { UserAdministration } from "@/features/admin/user-administration";
import {
  listInvitations,
  listRecruiterNames,
  listUsers,
} from "@/server/admin/actions";
import { hasDatabase } from "@/server/db/client";
import { requireCapability } from "@/server/rbac";
import { Panel, EmptyState } from "@/components/ui/primitives";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = {
  title: "Users",
  description: "Create and invite people, assign roles, suspend accounts and revoke sessions.",
};

export default async function Page() {
  if (!hasDatabase()) {
    return (
      <>
        <PageHeader
          title="Users"
          breadcrumb={[
            { label: "Command Center", href: "/" },
            { label: "Access Control", href: "/admin/access" },
            { label: "Users" },
          ]}
        />
        <Panel>
          <EmptyState
            title="No database configured"
            description="User accounts need Postgres. Set DATABASE_URL, run the migration, then bootstrap an administrator — see DEPLOYMENT.md."
          />
        </Panel>
      </>
    );
  }

  // Both queries assert the capability themselves; the page does not have to
  // be trusted to have checked. This resolves the caller so the UI can hide
  // controls the server would refuse — a courtesy, not the check.
  const [principal, users, invitations, recruiterNames] = await Promise.all([
    requireCapability("page.access-admin"),
    listUsers(),
    listInvitations(),
    listRecruiterNames(),
  ]);

  return (
    <UserAdministration
      actorId={principal.user.id}
      actorRole={principal.user.role}
      canCreate={principal.can("action.create-user")}
      recruiterNames={recruiterNames}
      users={users.map((u) => ({
        ...u,
        lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
        emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null,
        lockedUntil: u.lockedUntil?.toISOString() ?? null,
      }))}
      invitations={invitations.map((i) => ({
        ...i,
        expiresAt: i.expiresAt.toISOString(),
        acceptedAt: i.acceptedAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
      }))}
    />
  );
}
