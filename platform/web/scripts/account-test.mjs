/**
 * End-to-end account test.
 *
 * Signs in through the real form as each provisioned account and asserts what
 * that session can actually reach. This differs from `rbac-test.mjs` in the way
 * that matters: that one sets a role in local storage the way the demo role
 * switcher does, so it proves the UI honours a role. This one proves the
 * *server* honours a session — the password is checked, the cookie is issued,
 * and the role comes back out of the database rather than out of the browser.
 *
 *   node scripts/account-test.mjs [--base http://localhost:3000]
 *
 * The distinction is the whole point of `server-scoped` mode. A test that can
 * pass while the session is forged is not testing authorisation.
 */
import { chromium } from "playwright";

const argIndex = process.argv.indexOf("--base");
const BASE = argIndex >= 0 ? process.argv[argIndex + 1] : "http://localhost:3000";

const DENIED_MARKER = "This page is not available to your role";

const ACCOUNTS = [
  {
    label: "Limited",
    email: "recruiter@bayut.sa",
    password: "recruiter-limited-2026",
    role: "Recruiter",
    book: "Ahmed Ashiq",
    allowed: ["/", "/pipeline", "/sources", "/talent", "/candidates"],
    denied: [
      "/health",
      "/velocity",
      "/attrition",
      "/recruiters",
      "/interviewers",
      "/business-units",
      "/roles",
      "/reports",
      "/admin/access",
      "/admin/users",
    ],
    canExport: false,
    canAdmin: false,
    canCreateUsers: false,
    // What the /api/v1/store payload must look like for this session.
    payload: { rows: 4999, recruiters: 1, withheld: ["salary"] },
  },
  {
    label: "Medium",
    email: "manager@bayut.sa",
    password: "manager-medium-2026",
    role: "Recruitment Manager",
    book: null,
    allowed: [
      "/",
      "/pipeline",
      "/velocity",
      "/attrition",
      "/health",
      "/recruiters",
      "/interviewers",
      "/business-units",
      "/roles",
      "/sources",
      "/talent",
      "/candidates",
      "/reports",
    ],
    denied: ["/admin/access", "/admin/users"],
    canExport: true,
    canAdmin: false,
    canCreateUsers: false,
    payload: { rows: 28366, recruiters: 17, withheld: [] },
  },
  {
    label: "Full",
    email: "admin@bayut.sa",
    password: "admin-full-access-2026",
    role: "Admin",
    book: null,
    allowed: [
      "/",
      "/pipeline",
      "/velocity",
      "/attrition",
      "/health",
      "/recruiters",
      "/interviewers",
      "/business-units",
      "/roles",
      "/sources",
      "/talent",
      "/candidates",
      "/reports",
      "/admin/access",
      "/admin/users",
    ],
    denied: [],
    canExport: true,
    canAdmin: true,
    canCreateUsers: true,
    payload: { rows: 28366, recruiters: 17, withheld: [] },
  },
];

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
const results = [];
let failures = 0;

function record(who, check, pass, detail = "") {
  results.push({ who, check, pass, detail });
  if (!pass) failures += 1;
  process.stdout.write(
    `${pass ? "  ok  " : "  FAIL"} ${who.padEnd(8)} ${check}${detail ? ` — ${detail}` : ""}\n`,
  );
}

async function signIn(page, account) {
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', account.email);
  await page.fill('input[name="password"]', account.password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 20_000 }),
    page.click('button[type="submit"]'),
  ]);
}

for (const account of ACCOUNTS) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  /* ---- Sign-in ------------------------------------------------------ */
  try {
    await signIn(page, account);
    record(account.label, `signs in as ${account.email}`, true);
  } catch (error) {
    record(account.label, `signs in as ${account.email}`, false, String(error).slice(0, 120));
    await context.close();
    continue;
  }

  // The session cookie must not be readable from script. An XSS that can read
  // it does not need the password.
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name.includes("session"));
  record(
    account.label,
    "session cookie is httpOnly + SameSite",
    Boolean(session?.httpOnly) && session?.sameSite === "Lax",
    session ? `httpOnly=${session.httpOnly} sameSite=${session.sameSite}` : "no cookie found",
  );

  /* ---- Role as the server reports it -------------------------------- */
  const shown = await page
    .locator("[data-role-label]")
    .first()
    .textContent()
    .catch(() => null);
  if (shown !== null) {
    record(
      account.label,
      `server reports role ${account.role}`,
      shown.trim() === account.role,
      `showed "${shown.trim()}"`,
    );
  }

  /* ---- Pages that must open ----------------------------------------- */
  for (const path of account.allowed) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    const body = await page.locator("body").innerText();
    record(
      account.label,
      `opens ${path}`,
      !body.includes(DENIED_MARKER) && body.trim().length > 200,
      body.includes(DENIED_MARKER) ? "blocked" : undefined,
    );
  }

  /* ---- Pages that must be refused ----------------------------------- */
  for (const path of account.denied) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    const body = await page.locator("body").innerText();
    const blocked = body.includes(DENIED_MARKER) || !page.url().includes(path);
    record(account.label, `is refused ${path}`, blocked, blocked ? undefined : "rendered");
  }

  /* ---- What the server actually delivered ----------------------------
     The decisive check. Everything above is about what the UI shows; this is
     about what left the server. In `server-scoped` mode the payload itself must
     be the slice — a UI that displays 4,999 records having downloaded 28,366
     has not scoped anything. */
  {
    const res = await page.request.get(`${BASE}/api/v1/store`);
    const body = await res.json();
    const expected = account.payload;

    record(
      account.label,
      `is delivered ${expected.rows.toLocaleString()} rows`,
      body.meta.rowCount === expected.rows,
      `got ${body.meta.rowCount?.toLocaleString()} of ${body.meta.scopedFrom?.toLocaleString()}`,
    );

    const dict = body.dicts.recruiter ?? [];
    const col = body.cols.recruiter;
    const indices = Array.isArray(col) ? col : [];
    const distinct = [...new Set(indices.filter((i) => i >= 0))];
    record(
      account.label,
      `payload contains ${expected.recruiters} recruiter${expected.recruiters === 1 ? "" : "s"}`,
      distinct.length === expected.recruiters,
      distinct.length <= 3 ? distinct.map((i) => dict[i]).join(", ") : `${distinct.length} recruiters`,
    );

    record(
      account.label,
      expected.withheld.length
        ? `has ${expected.withheld.join(", ")} withheld from the payload`
        : "receives every field",
      JSON.stringify((body.meta.withheldFields ?? []).sort()) ===
        JSON.stringify([...expected.withheld].sort()),
      JSON.stringify(body.meta.withheldFields ?? []),
    );

    // A withheld column must be absent, not zeroed: a zero salary is a salary,
    // and it would corrupt every average computed from the column.
    if (expected.withheld.includes("salary")) {
      const salary = body.cols.current_salary;
      const values = Array.isArray(salary) ? salary.filter((v) => v !== -32768) : salary.v;
      record(
        account.label,
        "withheld salary carries no values",
        values.length === 0,
        `${values.length} values present`,
      );
    }
  }

  /* ---- Row scope in the UI, and that it cannot be widened ------------- */
  await page.goto(`${BASE}/candidates`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  if (account.book) {
    const scoped = await page.locator("body").innerText();
    record(
      account.label,
      "says it is scoped to one book",
      scoped.includes(account.book) && /Scoped to your own book/i.test(scoped),
      scoped.includes(account.book) ? undefined : "no scope banner",
    );

    // Naming another recruiter in the URL must not widen the scope. This is the
    // attack the row-scope rule exists to stop.
    await page.goto(`${BASE}/candidates?rec=${encodeURIComponent("Kiran Zubair")}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(3000);
    const forced = await page.locator("body").innerText();
    record(
      account.label,
      "cannot widen scope from the URL",
      !forced.includes("Kiran Zubair") && forced.includes(account.book),
      forced.includes("Kiran Zubair") ? "the foreign filter was honoured" : "scope held",
    );
  }

  /* ---- Export --------------------------------------------------------
     A role without the capability should see WHY, not a blank space — an absent
     button generates a support ticket, an explained one does not. So the check
     is for a working control versus the explanation, not for presence. */
  {
    const body = await page.locator("body").innerText();
    const explained = /Export needs/i.test(body);
    const working = await page
      .getByRole("button", { name: /^(CSV|Excel)$/i })
      .first()
      .isVisible()
      .catch(() => false);

    record(
      account.label,
      account.canExport ? "can export" : "is told why it cannot export",
      account.canExport ? working : explained && !working,
      `working=${working} explained=${explained}`,
    );
  }

  /* ---- User creation ------------------------------------------------- */
  if (account.canAdmin) {
    await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const createVisible = await page
      .getByRole("button", { name: /create account/i })
      .first()
      .isVisible()
      .catch(() => false);
    record(
      account.label,
      account.canCreateUsers ? "can create accounts" : "cannot create accounts",
      createVisible === account.canCreateUsers,
    );

    const inviteVisible = await page
      .getByRole("button", { name: /^invite$/i })
      .first()
      .isVisible()
      .catch(() => false);
    record(account.label, "can invite", inviteVisible);

    // All three accounts must be listed, or the page is not showing the truth.
    const body = await page.locator("body").innerText();
    const listed = ACCOUNTS.filter((a) => body.includes(a.email));
    record(
      account.label,
      "lists every account",
      listed.length === ACCOUNTS.length,
      `${listed.length}/${ACCOUNTS.length}`,
    );
  }

  /* ---- Sign out ends the session ------------------------------------ */
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  record(
    account.label,
    "renders without console errors",
    consoleErrors.length === 0,
    consoleErrors.slice(0, 2).join(" | ").slice(0, 160),
  );

  await context.close();
}

/* ---- Anonymous ------------------------------------------------------- */
{
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const path of ["/", "/candidates", "/admin/users"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    const atSignIn = page.url().includes("/signin");
    record("Anon", `is sent to sign-in from ${path}`, atSignIn, page.url());
  }

  // `maxRedirects: 0` matters: following a redirect to the HTML sign-in page
  // yields HTTP 200, which reads as success. The API must refuse in its own
  // protocol.
  const api = await page.request.get(`${BASE}/api/v1/meta`, { maxRedirects: 0 });
  record("Anon", "API refuses anonymous callers", api.status() === 401, `HTTP ${api.status()}`);

  await context.close();
}

/* ---- Wrong password -------------------------------------------------- */
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', "admin@bayut.sa");
  await page.fill('input[name="password"]', "definitely-not-the-password");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  const stillOnSignIn = page.url().includes("/signin");
  record("Wrong pw", "is refused", stillOnSignIn, page.url());

  // The failure message must not distinguish a bad password from a missing
  // account, or it enumerates who has one.
  const body = await page.locator("body").innerText();
  const leaks = /no such (user|account)|not registered|user not found|unknown email/i.test(body);
  record("Wrong pw", "does not reveal whether the account exists", !leaks);

  await context.close();
}

await browser.close();

console.log(
  `\n${results.length - failures}/${results.length} checks passed.` +
    (failures ? ` ${failures} FAILED.` : ""),
);
process.exit(failures ? 1 : 0);
