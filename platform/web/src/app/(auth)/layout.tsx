/**
 * The unauthenticated area.
 *
 * Deliberately bare — no sidebar, no filter bar, no dataset load. A sign-in
 * page that pulls a 552 KB payload of candidate records before the user has
 * proven who they are would be both slow and wrong.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className="min-h-dvh bg-plane">{children}</main>;
}
