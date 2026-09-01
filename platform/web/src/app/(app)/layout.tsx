import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { RouteDenied } from "@/components/auth/guards";
import { getSession } from "@/server/auth/session";
import { hasDatabase } from "@/server/db/client";
import { canAccessPath, capabilityForPath } from "@/lib/auth/permissions";

/**
 * The authenticated area.
 *
 * Every dashboard route lives under this layout, so authentication is enforced
 * by the route's position in the tree rather than by each page remembering to
 * check. Middleware also gates these paths, but that is defence in depth — the
 * middleware runs on the edge without database access, so it can only see
 * whether a session cookie exists, not whether it is still valid. This is the
 * check that actually resolves the session.
 *
 * Authorisation is checked twice, deliberately:
 *
 *   here          — on a full page load, so a page the role may not open is
 *                   never rendered or sent. Without this the server streams the
 *                   whole page and the client blocks it after hydration, which
 *                   means the browser briefly paints a page the user is not
 *                   entitled to.
 *   `RouteGuard`  — on client-side navigation, which does not re-run a layout.
 *
 * Neither is redundant: this one cannot see a soft navigation, and that one
 * cannot stop markup from being sent.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Without a database there is nothing to authenticate against. Rather than
  // locking everyone out of a preview deploy, the app runs in its demo posture
  // and says so on the Access Control page.
  if (!hasDatabase()) return <AppShell>{children}</AppShell>;

  const headerList = await headers();
  const path = headerList.get("x-pathname") ?? "/";

  const session = await getSession();
  if (!session) redirect(`/signin?next=${encodeURIComponent(path)}`);

  if (!canAccessPath(session.user.role, path)) {
    return (
      <AppShell>
        <RouteDenied
          role={session.user.role}
          pathname={path}
          capability={capabilityForPath(path)}
        />
      </AppShell>
    );
  }

  // The identity itself is handed to the session provider by the root layout,
  // which sits above this one — the provider has to be initialised with it, not
  // corrected by a descendant after the fact.
  return <AppShell>{children}</AppShell>;
}
