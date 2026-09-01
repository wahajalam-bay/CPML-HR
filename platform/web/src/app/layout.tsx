import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { AppProviders } from "@/components/layout/app-providers";
import { getSession } from "@/server/auth/session";

export const metadata: Metadata = {
  title: {
    default: "CPML HR",
    template: "%s · CPML HR",
  },
  description:
    "Recruitment analytics and operations for CPML — pipeline conversion, recruiter performance, sourcing yield and hiring velocity.",
  applicationName: "CPML HR",
  // The platform holds candidate personal data; it should never be indexed.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Rendered per request rather than prerendered at build time.
 *
 * The CSP in `middleware.ts` carries a per-request nonce, and Next can only
 * stamp that onto its bootstrap scripts while it is rendering the HTML — a
 * static shell produced at build time has no nonce to carry, so hydration is
 * blocked by our own policy. Authenticated views of personal data should not
 * be prerendered or shared-cached regardless.
 */
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1512" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // next-themes writes an inline script to set the theme class before first
  // paint. Under a nonce CSP that script needs the request's nonce, which
  // middleware puts on the forwarded headers.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  // Resolved here, above the providers, so the session provider is initialised
  // with the real identity rather than adopting it a render later. `getSession`
  // is request-cached, so the authenticated layout's own check costs no second
  // query.
  const session = await getSession();

  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="min-h-full">
        <AppProviders
          nonce={nonce}
          serverSession={
            session
              ? {
                  name: session.user.name,
                  email: session.user.email,
                  role: session.user.role,
                  recruiterKey: session.user.recruiterName,
                }
              : null
          }
        >
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
