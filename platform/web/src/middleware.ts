import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware: content security policy, route gating, and CSRF origin
 * checks.
 *
 * The session check here is deliberately shallow — it only asks whether a
 * session cookie is present. Middleware runs on the edge without database
 * access, so it cannot know whether the session is still valid, revoked, or
 * belongs to a suspended account. That resolution happens in the authenticated
 * layout, which is the real gate. This exists to bounce obviously-anonymous
 * traffic before it reaches a function, not to authorise anyone.
 */

const SESSION_COOKIE = "cpml_session";

/** Reachable without a session. */
const PUBLIC_PATHS = [
  "/signin",
  "/signup",
  "/forgot-password",
  "/reset",
  "/verify",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const apiOrigin = process.env.NEXT_PUBLIC_API_ORIGIN ?? "";
  const authEnabled = Boolean(process.env.DATABASE_URL);
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  /* ---- The static dataset ----------------------------------------------
     `/public/data/store.gz` is the whole dataset as a build artefact: 28,366
     candidate records, names and phone numbers included. Next serves anything
     under /public without consulting a route handler, so with authentication on
     it was reachable by URL with no session at all — one request that bypassed
     the row scoping, the field redaction, the audit log and the sign-in page
     together.

     In `client-full` mode this file IS the delivery mechanism and must stay
     public. In `server-scoped` mode nothing legitimate requests it: the browser
     fetches `/api/v1/store`, which scopes and redacts first. So it is gated on
     the same flag as everything else, and refused outright rather than
     redirected — it is a data file, not a page. */
  if (pathname.startsWith("/data/")) {
    if (authEnabled && !hasSession) {
      return new NextResponse("Authentication required.", {
        status: 401,
        headers: { "cache-control": "private, no-store" },
      });
    }
    // A session is present, so let it through — but never into a shared cache,
    // and never for a request that only smells like a browser navigation.
    const response = NextResponse.next();
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("vary", "cookie");
    return response;
  }

  /* ---- CSRF: origin must match host on state-changing requests ---------
     Server Actions and API mutations arrive as POST. SameSite=Lax already
     blocks the classic cross-site form post, but this closes the gap for
     clients that do not enforce it and for any same-site subdomain takeover. */
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin && host) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost !== host) {
        return new NextResponse("Cross-origin request rejected.", { status: 403 });
      }
    }
  }

  /* ---- Route gating ----------------------------------------------------
     `authEnabled` gates only when a database is configured. Without one there
     is nothing to authenticate against, and the app runs in its demo posture
     rather than redirecting every visitor to a sign-in form that cannot work. */
  if (authEnabled && !hasSession && !isPublic(pathname)) {
    /* An API caller cannot act on a redirect to an HTML form. Worse, a client
       that follows redirects by default gets HTTP 200 and a page of markup,
       which reads as success — so an anonymous request would look authorised.
       Refuse in the protocol the caller is speaking. */
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401, headers: { "www-authenticate": "Session" } },
      );
    }

    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  /* There is deliberately NO redirect away from /signin for a request that
     carries a session cookie.

     It looks like an obvious courtesy — a signed-in user has no use for the
     sign-in page — but middleware cannot tell a valid session from a stale
     cookie, and the stale case is common: a password reset elsewhere, an
     administrator revoking sessions, a suspension, an expiry. All of those
     leave the cookie in place and the session dead.

     With the redirect, that user was trapped. The layout resolves the session,
     finds nothing, and redirects to /signin; middleware sees the cookie and
     redirects back; the browser gives up with ERR_TOO_MANY_REDIRECTS. They
     could not reach the sign-in form to fix it without clearing cookies by
     hand.

     `/signin` and `/signup` both resolve the session themselves and redirect a
     genuinely signed-in visitor to `/`. That check has database access, so it
     is the one qualified to make this decision. */

  /* ---- Content Security Policy -----------------------------------------
     Next injects inline bootstrap and hydration scripts, so a bare
     `script-src 'self'` blocks the app from starting. The alternatives are
     'unsafe-inline', which defeats the point of a script policy, or a
     per-request nonce — this does the latter. Next reads the nonce back off
     the request header and stamps it onto every script tag it renders. */
  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' is dev-only — Fast Refresh and the error overlay need it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: ${isDev ? "'unsafe-eval'" : ""}`,
    // Attribute styles cannot carry a nonce, and Tailwind plus the chart
    // layers set computed widths and colours inline.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}${isDev ? " ws: wss:" : ""}`,
    // Exports are handed to the browser as blobs.
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ]
    .filter(Boolean)
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  // So the authenticated layout can build an accurate `?next=` on redirect.
  headers.set("x-pathname", pathname);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next's own immutable build output.
     *
     * `/data/` was excluded here on the reasoning that a static payload gains
     * nothing from a per-request nonce — true, but it also meant the dataset
     * was served without ever passing the session gate. It is included now and
     * handled first, before any of the CSP work.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
