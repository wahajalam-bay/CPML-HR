/**
 * Security invariants.
 *
 * Every claim the platform makes about itself, written as something an attacker
 * would try. The other suites check that the right people can do the right
 * things; this checks that the wrong people cannot, and that the mechanisms
 * meant to stop them actually fire.
 *
 *   node scripts/security-test.mjs [--base http://localhost:3000]
 *
 * Needs a server-scoped instance with a database. It provisions and removes its
 * own throwaway accounts — all prefixed `sec-` — so a failure never leaves the
 * real ones in a strange state.
 *
 * ── Two clients, on purpose ─────────────────────────────────────────────
 *
 * Raw HTTP for the attacks: `fetch` follows redirects, and a redirect to the
 * sign-in page that resolves to 200 is precisely the bug this suite exists to
 * catch. Redirects have to stay visible.
 *
 * A browser only for going through the sign-in form. Next addresses Server
 * Actions through React's Flight encoding, and hand-rolling that would test my
 * reconstruction of an internal protocol rather than the application. So the
 * browser signs in, the cookie is handed to the raw client, and everything
 * afterwards is unmediated.
 */

import { request as httpRequest } from "node:http";
import { gunzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const baseIndex = process.argv.indexOf("--base");
const BASE = baseIndex >= 0 ? process.argv[baseIndex + 1] : "http://localhost:3000";
const ORIGIN = new URL(BASE).origin;

let failures = 0;
const skipped = [];

function record(group, check, pass, detail = "") {
  if (!pass) failures += 1;
  process.stdout.write(
    `${pass ? "  ok  " : "  FAIL"} ${group.padEnd(12)} ${check}${detail ? ` — ${detail}` : ""}\n`,
  );
}

function note(group, check, why) {
  skipped.push(`${group}: ${check} — ${why}`);
  process.stdout.write(`  skip ${group.padEnd(12)} ${check} — ${why}\n`);
}

/* -------------------------------------------------------------------------
 * Raw HTTP
 * ---------------------------------------------------------------------- */

function http(method, path, { headers = {}, body = null, cookie = null } = {}) {
  const url = new URL(path, BASE);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        agent: false,
        headers: {
          connection: "close",
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          /* node:http does not decompress, unlike fetch. The store endpoint
             declares Content-Encoding: gzip, so without this its body is
             binary and `json()` silently returns null — which would make every
             assertion about the payload pass by reading undefined. */
          let raw = Buffer.concat(chunks);
          if (res.headers["content-encoding"] === "gzip" && raw.length) {
            try {
              raw = gunzipSync(raw);
            } catch {
              /* leave it as-is; the assertion will report what it sees */
            }
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: raw.toString("utf8"),
            json() {
              try {
                return JSON.parse(this.body);
              } catch {
                return null;
              }
            },
          });
        });
      },
    );
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

const get = (path, cookie) => http("GET", path, { cookie });

/* -------------------------------------------------------------------------
 * Project scripts
 *
 * Straight to `node`, with no shell and no npx: a shell would join arguments
 * without quoting them, so "Recruitment Manager" would arrive as two and be
 * rejected — and without a shell, Node 24 refuses to spawn `npx.cmd` at all
 * (EINVAL), having blocked .cmd execution outside a shell.
 * ---------------------------------------------------------------------- */

function tsx(script, ...args) {
  return execFileSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", script, ...args],
    { stdio: "pipe", shell: false },
  )
    .toString()
    .trim();
}

const fixture = (command, arg) =>
  tsx("scripts/security-fixture.ts", ...(arg ? [command, arg] : [command]));

function provision(email, role, password, book) {
  const args = ["--create", email, "--role", role, "--password", password, "--name", `Security ${role}`];
  if (book) args.push("--book", book);
  tsx("scripts/accounts.ts", ...args);
}

/* -------------------------------------------------------------------------
 * Browser-mediated sign-in
 * ---------------------------------------------------------------------- */

async function launch() {
  for (const opts of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await chromium.launch(opts);
    } catch {
      /* next candidate */
    }
  }
  throw new Error("No usable Chromium found.");
}

const browser = await launch();

/**
 * Attempt a sign-in and report what happened.
 *
 * Returns the session cookie on success and the on-page message on failure, so
 * the same helper serves both "get me a session" and "what does a refusal say".
 */
async function attemptSignIn(email, password, { next } = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const path = next ? `/signin?next=${encodeURIComponent(next)}` : "/signin";
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);

  /* Time the server round trip, not the navigation.
     Waiting for the URL to change measures the timeout on every failed attempt,
     so both branches of the enumeration test came back at exactly the timeout
     and "matched" — a test that cannot fail. The POST response is the thing the
     server actually controls. */
  const responsePromise = page
    .waitForResponse(
      (r) => r.request().method() === "POST" && r.url().startsWith(`${BASE}/signin`),
      { timeout: 20_000 },
    )
    .catch(() => null);

  const started = Date.now();
  await page.click('button[type="submit"]');
  await responsePromise;
  const elapsed = Date.now() - started;

  // Then settle: either we navigated away, or the form rendered its refusal.
  await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 8_000 }),
    page.locator('[role="status"]').first().waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => {});

  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === "cpml_session");
  const url = new URL(page.url());
  const message = await page.locator('[role="status"]').first().textContent().catch(() => null);
  const bodyText = await page.locator("body").innerText().catch(() => "");

  await context.close();
  return {
    ok: Boolean(session),
    cookie: session ? `${session.name}=${session.value}` : null,
    session,
    landedOn: url.pathname + url.search,
    message: (message ?? "").trim(),
    bodyText,
    elapsed,
  };
}

/* -------------------------------------------------------------------------
 * Accounts
 * ---------------------------------------------------------------------- */

const VICTIM = { email: "sec-victim@bayut.sa", password: "security-victim-passphrase" };
const SCOPED = { email: "sec-scoped@bayut.sa", password: "security-scoped-passphrase" };
const DOOMED = { email: "sec-doomed@bayut.sa", password: "security-doomed-passphrase" };
const LOCKED = { email: "sec-lockout@bayut.sa", password: "security-lockout-passphrase" };

process.stdout.write("Provisioning throwaway accounts…\n");
provision(VICTIM.email, "Recruitment Manager", VICTIM.password);
provision(SCOPED.email, "Recruiter", SCOPED.password, "Ahmed Ashiq");
provision(DOOMED.email, "Recruitment Manager", DOOMED.password);
provision(LOCKED.email, "Recruiter", LOCKED.password, "Ahmed Ashiq");
fixture("reset-limits");

/* =========================================================================
 * 1 · Headers
 * ========================================================================= */
{
  const res = await get("/signin");
  const h = res.headers;
  const csp = h["content-security-policy"] ?? "";

  record("headers", "sets a Content-Security-Policy", Boolean(csp));
  record("headers", "no unsafe-inline on scripts", !/script-src[^;]*'unsafe-inline'/.test(csp));
  record("headers", "no unsafe-eval in production", !/script-src[^;]*'unsafe-eval'/.test(csp));
  record("headers", "uses a per-request nonce", /script-src[^;]*'nonce-/.test(csp));
  record("headers", "object-src is none", /object-src 'none'/.test(csp));
  record("headers", "base-uri is locked down", /base-uri 'self'/.test(csp));
  record("headers", "form-action is locked down", /form-action 'self'/.test(csp));

  const nonceOf = (r) => /'nonce-([^']+)'/.exec(r.headers["content-security-policy"] ?? "")?.[1];
  record("headers", "the nonce differs per request", nonceOf(res) !== nonceOf(await get("/signin")));

  record(
    "headers",
    "denies framing",
    /DENY/i.test(h["x-frame-options"] ?? "") || /frame-ancestors 'none'/.test(csp),
  );
  record("headers", "nosniff", h["x-content-type-options"] === "nosniff");
  record("headers", "sends a Referrer-Policy", Boolean(h["referrer-policy"]));
  record("headers", "does not advertise the framework", !("x-powered-by" in h));
  record(
    "headers",
    "the sign-in page is not cached",
    /no-store/.test(h["cache-control"] ?? ""),
    h["cache-control"] ?? "(none)",
  );

  if (BASE.startsWith("https://")) {
    record("headers", "sends HSTS", Boolean(h["strict-transport-security"]));
  } else {
    note("headers", "HSTS", "meaningless over plain HTTP; check it on the deployed URL");
  }
}

/* =========================================================================
 * 2 · The session cookie
 * ========================================================================= */
let victim = await attemptSignIn(VICTIM.email, VICTIM.password);
{
  record("session", "a valid password signs in", victim.ok, victim.landedOn);
  record("session", "the cookie is HttpOnly", victim.session?.httpOnly === true);
  record("session", "the cookie is SameSite=Lax", victim.session?.sameSite === "Lax");
  record("session", "the cookie is scoped to the site", victim.session?.path === "/");
  record("session", "the cookie expires", (victim.session?.expires ?? -1) > 0);

  const authed = await get("/api/v1/meta", victim.cookie);
  record("session", "the session authenticates the API", authed.status === 200, `HTTP ${authed.status}`);

  const forged = await get("/api/v1/meta", `cpml_session=${"a".repeat(43)}`);
  record("session", "a forged token is refused", forged.status === 401, `HTTP ${forged.status}`);

  // A prefix match would make the token brute-forceable one character at a time.
  const truncated = await get("/api/v1/meta", victim.cookie.slice(0, -6));
  record("session", "a truncated token is refused", truncated.status === 401, `HTTP ${truncated.status}`);

  const empty = await get("/api/v1/meta", "cpml_session=");
  record("session", "an empty token is refused", empty.status === 401, `HTTP ${empty.status}`);
}

/* =========================================================================
 * 3 · Revocation is immediate
 *
 * The reason sessions are rows rather than self-contained tokens. If a
 * suspension only bites at expiry, the control is decorative.
 * ========================================================================= */
{
  record("revocation", "works before suspension", (await get("/api/v1/meta", victim.cookie)).status === 200);

  fixture("suspend", VICTIM.email);

  const api = await get("/api/v1/meta", victim.cookie);
  record("revocation", "suspension kills the live session at once", api.status === 401, `HTTP ${api.status}`);

  const page = await get("/candidates", victim.cookie);
  record(
    "revocation",
    "and the pages with it",
    page.status >= 300 && page.status < 400 && (page.headers.location ?? "").includes("/signin"),
    `HTTP ${page.status}`,
  );

  const retry = await attemptSignIn(VICTIM.email, VICTIM.password);
  record(
    "revocation",
    "a suspended account cannot sign back in",
    !retry.ok && /suspended/i.test(retry.message + retry.bodyText),
    retry.message || retry.landedOn,
  );

  fixture("reinstate", VICTIM.email);
  victim = await attemptSignIn(VICTIM.email, VICTIM.password);
  record("revocation", "reinstating restores access", victim.ok);

  // Revoking sessions without touching the account must bite immediately too.
  const before = victim.cookie;
  fixture("revoke", VICTIM.email);
  const replayed = await get("/api/v1/meta", before);
  record("revocation", "a revoked token cannot be replayed", replayed.status === 401, `HTTP ${replayed.status}`);

  victim = await attemptSignIn(VICTIM.email, VICTIM.password);
  record("revocation", "and a fresh sign-in still works afterwards", victim.ok);

  /* ---- A stale cookie must not trap the user ------------------------
     The dead-session case is the common one — a reset elsewhere, an admin
     revoking sessions, an expiry — and the cookie survives all of them. If
     middleware bounces cookie-bearing requests away from /signin while the
     layout bounces session-less requests towards it, the two chase each other
     and the browser gives up. The user cannot reach the form to fix it. */
  {
    const stale = victim.cookie;
    fixture("revoke", VICTIM.email);

    let path = "/candidates";
    let hops = 0;
    let landed = null;
    while (hops < 8) {
      const res = await get(path, stale);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.location ?? "";
        path = location.startsWith("http") ? new URL(location).pathname + new URL(location).search : location;
        hops += 1;
        continue;
      }
      landed = { path, status: res.status };
      break;
    }

    record(
      "revocation",
      "a stale cookie leads to the sign-in page, not a redirect loop",
      landed !== null && landed.path.startsWith("/signin"),
      landed ? `${landed.path} after ${hops} hop${hops === 1 ? "" : "s"}` : `still looping after ${hops} hops`,
    );

    victim = await attemptSignIn(VICTIM.email, VICTIM.password);
    record("revocation", "and signing in from there works", victim.ok);
  }
}

/* =========================================================================
 * 4 · Deleting an account invalidates its session
 * ========================================================================= */
{
  const doomed = await attemptSignIn(DOOMED.email, DOOMED.password);
  record("deletion", "the account works before deletion", (await get("/api/v1/meta", doomed.cookie)).status === 200);

  fixture("delete", DOOMED.email);

  const after = await get("/api/v1/meta", doomed.cookie);
  record("deletion", "the session dies with the account", after.status === 401, `HTTP ${after.status}`);
}

/* =========================================================================
 * 5 · Throttling and lockout
 * ========================================================================= */
{
  fixture("reset-limits");

  let throttledAt = null;
  for (let attempt = 1; attempt <= 8 && throttledAt === null; attempt++) {
    const res = await attemptSignIn(LOCKED.email, "definitely-the-wrong-password");
    if (/too many attempts/i.test(res.message + res.bodyText)) throttledAt = attempt;
  }
  record(
    "throttling",
    "repeated wrong passwords are throttled",
    throttledAt !== null,
    throttledAt ? `at attempt ${throttledAt}` : "never throttled in 8 attempts",
  );

  const throttled = await attemptSignIn(LOCKED.email, "another-wrong-password");
  record(
    "throttling",
    "the throttle message does not confirm the account",
    !/no such|not found|incorrect password for/i.test(throttled.message + throttled.bodyText),
  );

  /* The per-account limiter fires before the counter can reach ten, which is
     correct — the lockout is the backstop for a distributed attempt spread
     across IPs, where no single IP trips the limiter. Assert it directly. */
  fixture("reset-limits");
  fixture("lock", LOCKED.email);
  const whileLocked = await attemptSignIn(LOCKED.email, LOCKED.password);
  record(
    "throttling",
    "a locked account refuses the correct password",
    !whileLocked.ok && /locked/i.test(whileLocked.message + whileLocked.bodyText),
    whileLocked.message,
  );

  fixture("reset-limits");
  const unlocked = await attemptSignIn(LOCKED.email, LOCKED.password);
  record("throttling", "unlocking restores sign-in", unlocked.ok);
}

/* =========================================================================
 * 6 · Enumeration
 * ========================================================================= */
{
  fixture("reset-limits");

  const unknown = await attemptSignIn("definitely-nobody@bayut.sa", "some-password-here");
  const known = await attemptSignIn(VICTIM.email, "the-wrong-password-here");

  record(
    "enumeration",
    "unknown and known give the same message",
    unknown.message === known.message && unknown.message.length > 0,
    `"${unknown.message}" vs "${known.message}"`,
  );
  record(
    "enumeration",
    "no wording reveals whether an account exists",
    !/no such (user|account)|not registered|user not found|unknown email|no account with/i.test(
      unknown.bodyText + known.bodyText,
    ),
  );

  /* Timing. Argon2id dominates both paths — the unknown-account branch verifies
     against a dummy hash for exactly this reason — so the difference should sit
     inside the noise of a local request. */
  const samples = [];
  for (let i = 0; i < 3; i++) {
    fixture("reset-limits");
    const u = await attemptSignIn(`sec-nobody-${i}@bayut.sa`, "a-password-for-timing");
    const k = await attemptSignIn(VICTIM.email, "a-password-for-timing");
    samples.push({ unknown: u.elapsed, known: k.elapsed });
  }
  const mean = (key) => samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
  const ratio = mean("unknown") / mean("known");
  record(
    "enumeration",
    "response time does not distinguish them",
    ratio > 0.55 && ratio < 1.8,
    `unknown ${mean("unknown").toFixed(0)}ms vs known ${mean("known").toFixed(0)}ms`,
  );
}

/* =========================================================================
 * 7 · Sign-up policy
 * ========================================================================= */
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="name"]', "Uninvited Person");
  await page.fill('input[name="email"]', "uninvited@example.com");
  await page.fill('input[name="password"]', "a-long-enough-passphrase");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(4000);
  const body = await page.locator("body").innerText();
  await context.close();

  record("signup", "self-registration is refused without an invitation", /by invitation/i.test(body));
  const state = fixture("check-absent", "uninvited@example.com");
  record("signup", "and no account was created", state === "absent", state);
}

/* =========================================================================
 * 8 · CSRF
 *
 * Checked at the HTTP layer: the middleware rejects on the origin/host mismatch
 * before any action runs, so a well-formed action body is unnecessary.
 * ========================================================================= */
{
  const form = "email=a%40b.com&password=whatever";
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    "content-length": Buffer.byteLength(form),
  };

  const hostile = await http("POST", "/signin", {
    headers: { ...headers, origin: "https://evil.example.com" },
    body: form,
  });
  record("csrf", "a cross-origin mutation is rejected", hostile.status === 403, `HTTP ${hostile.status}`);

  const sameSite = await http("POST", "/signin", {
    headers: { ...headers, origin: ORIGIN },
    body: form,
  });
  record("csrf", "a same-origin mutation is not", sameSite.status !== 403, `HTTP ${sameSite.status}`);

  const authedHostile = await http("POST", "/admin/users", {
    headers: { ...headers, origin: "https://evil.example.com" },
    body: form,
    cookie: victim.cookie,
  });
  record(
    "csrf",
    "the authenticated area is protected too",
    authedHostile.status === 403,
    `HTTP ${authedHostile.status}`,
  );
}

/* =========================================================================
 * 9 · Open redirect
 * ========================================================================= */
{
  const hostile = [
    "https://evil.example.com",
    "//evil.example.com",
    "/\\evil.example.com",
    "https:/evil.example.com",
    "javascript:alert(1)",
  ];

  for (const next of hostile) {
    fixture("reset-limits");
    const res = await attemptSignIn(VICTIM.email, VICTIM.password, { next });
    const escaped =
      /^https?:\/\//i.test(res.landedOn) || res.landedOn.includes("evil.example.com");
    record("redirect", `will not follow ${next}`, !escaped, `landed on ${res.landedOn}`);
  }

  // A legitimate relative target must still work, or the guard is too blunt.
  fixture("reset-limits");
  const legit = await attemptSignIn(VICTIM.email, VICTIM.password, { next: "/reports" });
  record("redirect", "an internal target is honoured", legit.landedOn === "/reports", legit.landedOn);
}

/* =========================================================================
 * 10 · Row scope and field redaction on every endpoint
 * ========================================================================= */
{
  fixture("reset-limits");
  const scoped = await attemptSignIn(SCOPED.email, SCOPED.password);
  record("scope", "the scoped account signs in", scoped.ok);

  const own = (await get("/api/v1/meta", scoped.cookie)).json();
  record("scope", "meta reports only its own rows", own?.rowCount === 4999, `${own?.rowCount} rows`);

  /* Widening is tested against `summary`, not `meta`.
     `meta` deliberately ignores filters — it reports the bounds of the dataset
     so a date picker can be populated — so "the count did not change" there
     proves nothing about whether a filter was honoured. `summary` applies every
     filter, which makes it the endpoint where a widening attempt would show. */
  const baseline = (await get("/api/v1/analytics/summary", scoped.cookie)).json();
  record(
    "scope",
    "summary is scoped to its own book",
    baseline?.applications === 4999,
    `${baseline?.applications} applications`,
  );

  for (const [label, query] of [
    ["a single foreign recruiter", "recruiter=Kiran%20Zubair"],
    ["several foreign recruiters", "recruiter=Kiran%20Zubair~Muaaz%20Alam"],
    ["a foreign recruiter plus its own", "recruiter=Kiran%20Zubair~Ahmed%20Ashiq"],
  ]) {
    const widened = (await get(`/api/v1/analytics/summary?${query}`, scoped.cookie)).json();
    record(
      "scope",
      `cannot widen with ${label}`,
      widened?.applications === 4999,
      `${widened?.applications} applications`,
    );
  }

  // A filter the scope permits must still work, or scoping has become a wall
  // rather than a boundary.
  const narrowed = (
    await get("/api/v1/analytics/summary?outcome=Hired", scoped.cookie)
  ).json();
  record(
    "scope",
    "a filter within scope still narrows",
    narrowed?.applications > 0 && narrowed.applications < 4999,
    `${narrowed?.applications} applications`,
  );

  const rows = (await get("/api/v1/applications?limit=200&recruiter=Kiran%20Zubair", scoped.cookie)).json();
  const seen = [...new Set((rows?.items ?? []).map((r) => r.recruiter))];
  record(
    "scope",
    "the records endpoint returns only its own book",
    seen.length === 1 && seen[0] === "Ahmed Ashiq",
    seen.join(", ") || "no rows",
  );

  const grouped = (await get("/api/v1/analytics/by/recruiter", scoped.cookie)).json();
  const groups = (Array.isArray(grouped) ? grouped : (grouped?.rows ?? [])).map(
    (r) => r.key ?? r.label ?? r.name ?? r.recruiter,
  );
  record(
    "scope",
    "grouping by recruiter cannot enumerate the team",
    groups.length <= 1,
    groups.join(", ") || "empty",
  );

  const funnel = (await get("/api/v1/analytics/funnel", scoped.cookie)).json();
  const appliedStage = (Array.isArray(funnel) ? funnel : []).find((s) => s.stage === "applied");
  record(
    "scope",
    "the funnel is scoped as well",
    appliedStage?.entered === 4999,
    `applied entered = ${appliedStage?.entered}`,
  );

  /* ---- The payload must not carry the org chart ----------------------
     Row scoping removes the rows, but the dictionaries are shared across the
     whole dataset — so a scoped payload could still name every recruiter,
     hiring manager, interviewer and director in the company, none of whom
     appears in any row it was given. */
  {
    const payload = (await get("/api/v1/store", scoped.cookie)).json();
    const dictSize = (field) => (payload?.dicts?.[field] ?? []).length;

    record(
      "roster",
      "the payload names one recruiter, not the whole team",
      dictSize("recruiter") === 1,
      `${dictSize("recruiter")} names`,
    );
    record(
      "roster",
      "and only the interviewers this book actually met",
      dictSize("hiring_manager") > 0 && dictSize("hiring_manager") < 123,
      `${dictSize("hiring_manager")} of 123 hiring managers`,
    );
    record(
      "roster",
      "and no directors it never dealt with",
      dictSize("director") <= 4,
      `${dictSize("director")} of 4 directors`,
    );

    // The taxonomies stay whole on purpose — chart legends and colour
    // assignments have to mean the same thing for every role.
    record(
      "roster",
      "the source taxonomy is left intact",
      dictSize("source") === 10,
      `${dictSize("source")} sources`,
    );

    // Compaction has to remap the columns too, or every label is now wrong.
    const recruiterCol = payload?.cols?.recruiter;
    const indices = Array.isArray(recruiterCol) ? recruiterCol : [];
    const inRange = indices.every((i) => i < dictSize("recruiter"));
    record("roster", "the remapped indices stay in range", inRange);

    const unscoped = (await get("/api/v1/store", victim.cookie)).json();
    record(
      "roster",
      "an unscoped role still sees every recruiter",
      (unscoped?.dicts?.recruiter ?? []).length === 17,
      `${(unscoped?.dicts?.recruiter ?? []).length} names`,
    );
  }

  /* ---- Field redaction on the JSON records --------------------------- */
  const first = (rows?.items ?? [])[0] ?? {};
  record("redaction", "a Recruiter sees phone — their working tool", "phone" in first);
  record("redaction", "a Recruiter does not see salary", !("salary" in first));
  record("redaction", "a Recruiter does not see the identity number", !("cnic" in first));
  record("redaction", "a Recruiter does not see recruiter notes", !("remarks" in first));

  const managerRows = (await get("/api/v1/applications?limit=5", victim.cookie)).json();
  const managerFirst = (managerRows?.items ?? [])[0] ?? {};
  record("redaction", "a Manager does see salary", "salary" in managerFirst);
  record("redaction", "a Manager still does not see the identity number", !("cnic" in managerFirst));

  /* ---- Pages ---------------------------------------------------------- */
  for (const path of ["/admin/users", "/admin/access", "/health", "/reports"]) {
    const res = await get(path, scoped.cookie);
    const denied =
      res.body.includes("not available to your role") || (res.status >= 300 && res.status < 400);
    record("scope", `a Recruiter is refused ${path}`, denied, `HTTP ${res.status}`);
  }
}

/* =========================================================================
 * 11 · Input validation
 * ========================================================================= */
{
  const cases = [
    ["a SQL fragment in search", "/api/v1/applications?search=%27%29%3B+drop+table+applications%3B--"],
    ["a SQL fragment in a filter", "/api/v1/meta?recruiter=%27+or+1%3D1+--"],
    ["a malformed date", "/api/v1/meta?from=not-a-date"],
    ["an impossible date", "/api/v1/meta?from=9999-99-99"],
    ["an unknown outcome", "/api/v1/meta?outcome=Nonsense"],
    ["an unknown stage", "/api/v1/meta?stageAtLeast=teleported"],
    ["a traversal in the dimension", "/api/v1/analytics/by/..%2F..%2Fetc%2Fpasswd"],
    ["an unknown granularity", "/api/v1/analytics/timeseries?granularity=century"],
    ["a negative offset", "/api/v1/applications?offset=-500"],
    ["an enormous limit", "/api/v1/applications?limit=999999"],
    ["a non-numeric limit", "/api/v1/applications?limit=abc"],
    ["NaN as an offset", "/api/v1/applications?offset=NaN"],
    ["an oversized search term", `/api/v1/applications?search=${"x".repeat(5000)}`],
    [
      "too many filter values",
      `/api/v1/meta?recruiter=${Array.from({ length: 200 }, (_, i) => `r${i}`).join("~")}`,
    ],
    ["a null byte", "/api/v1/meta?recruiter=%00"],
    ["an unknown endpoint", "/api/v1/there-is-no-such-thing"],
    ["a script tag in search", "/api/v1/applications?search=%3Cscript%3Ealert(1)%3C%2Fscript%3E"],
  ];

  for (const [label, path] of cases) {
    const res = await get(path, victim.cookie);
    record("validation", `survives ${label}`, res.status < 500, `HTTP ${res.status}`);

    const payload = JSON.stringify(res.json() ?? res.body);
    const leaks = /at Object\.|node_modules|drizzle|PostgresError|\bselect\b[^"]*\bfrom\b|\.ts:\d+/i.test(
      payload,
    );
    record("validation", `${label} leaks no internals`, !leaks, leaks ? payload.slice(0, 120) : "");
  }

  const intact = (await get("/api/v1/meta", victim.cookie)).json();
  record("validation", "the dataset survived all of that", intact?.rowCount === 28366, `${intact?.rowCount} rows`);
}

/* =========================================================================
 * 12 · The maintenance cron
 * ========================================================================= */
{
  const bare = await get("/api/cron/maintenance");
  record("cron", "refuses an unsigned call", bare.status === 401, `HTTP ${bare.status}`);

  const wrong = await http("GET", "/api/cron/maintenance", {
    headers: { authorization: "Bearer definitely-not-the-secret" },
  });
  record("cron", "refuses a wrong secret", wrong.status === 401, `HTTP ${wrong.status}`);

  const asUser = await get("/api/cron/maintenance", victim.cookie);
  record("cron", "a signed-in user cannot trigger it", asUser.status === 401, `HTTP ${asUser.status}`);
}

/* =========================================================================
 * 13 · Anonymous access
 * ========================================================================= */
{
  for (const path of [
    "/api/v1/meta",
    "/api/v1/store",
    "/api/v1/applications",
    "/api/v1/analytics/summary",
    "/api/v1/analytics/funnel",
    "/api/v1/analytics/timeseries",
    "/api/v1/analytics/losses",
    "/api/v1/analytics/by/recruiter",
  ]) {
    const res = await get(path);
    record("anonymous", `${path} → 401`, res.status === 401, `HTTP ${res.status}`);
  }

  for (const path of [
    "/",
    "/candidates",
    "/reports",
    "/admin/users",
    "/admin/access",
    "/recruiters/Ahmed%20Ashiq",
  ]) {
    const res = await get(path);
    const bounced =
      res.status >= 300 && res.status < 400 && (res.headers.location ?? "").includes("/signin");
    record("anonymous", `${path} bounces to sign-in`, bounced, `HTTP ${res.status}`);
  }

  // One URL must not bypass every control above.
  const staticStore = await get("/data/store.gz");
  record(
    "anonymous",
    "the static dataset is not served anonymously",
    staticStore.status !== 200,
    `HTTP ${staticStore.status}`,
  );
}

/* =========================================================================
 * Clean up
 * ========================================================================= */
await browser.close();
console.log(`\n${fixture("cleanup")}`);

if (skipped.length) {
  console.log(`${skipped.length} skipped:`);
  for (const s of skipped) console.log(`  · ${s}`);
}

console.log(failures ? `\n${failures} FAILED.` : "\nAll security invariants hold.");
process.exit(failures ? 1 : 0);
