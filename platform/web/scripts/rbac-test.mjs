/**
 * Behavioural RBAC test.
 *
 * Drives a real browser, sets each role the way the app itself does, and
 * asserts what that role can actually reach and see. This is the check that
 * matters: a permission table that type-checks proves nothing about whether a
 * page is reachable by URL.
 *
 *   node scripts/rbac-test.mjs [--base http://localhost:3000]
 */
import { chromium } from "playwright";

const argIndex = process.argv.indexOf("--base");
const BASE = argIndex >= 0 ? process.argv[argIndex + 1] : "http://localhost:3000";
const SESSION_KEY = "cpml.session.v2";

/** role → { allowed: paths that must render, denied: paths that must be blocked } */
const EXPECTATIONS = {
  Recruiter: {
    // Bound to a real book, so the scoped session has records to show.
    recruiterKey: "Sara Khan",
    allowed: ["/", "/pipeline", "/sources", "/talent", "/candidates"],
    denied: ["/health", "/velocity", "/attrition", "/recruiters", "/reports", "/admin/access"],
    salaryVisible: false,
    exportVisible: false,
    // Row scope must hold: no other recruiter may appear in their explorer.
    scopedTo: "Sara Khan",
  },
  "Recruitment Manager": {
    allowed: ["/", "/pipeline", "/velocity", "/attrition", "/health", "/recruiters", "/reports"],
    denied: ["/admin/access"],
    salaryVisible: true,
    exportVisible: true,
  },
  "HR Director": {
    allowed: ["/", "/health", "/recruiters", "/reports"],
    denied: ["/admin/access"],
    salaryVisible: true,
    exportVisible: true,
  },
  Admin: {
    allowed: ["/", "/health", "/reports", "/admin/access"],
    denied: [],
    salaryVisible: true,
    exportVisible: true,
  },
};

const DENIED_MARKER = "This page is not available to your role";

/** High-volume recruiters, used to prove a scoped session cannot see them. */
const OTHER_RECRUITERS = ["Ahmed Ashiq", "Kiran Zubair", "Muaaz Alam", "Yazal"];

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

/**
 * This suite drives the DEMO posture.
 *
 * It seeds a role into local storage exactly as the in-app role switcher does,
 * which is only meaningful when there is no database to authenticate against.
 * Against a server-scoped instance the app correctly ignores that value — the
 * role comes out of the session cookie — so every expectation here would fail
 * for the right reason, which is the most misleading kind of red.
 *
 * So: detect the posture and point at the suite that fits it.
 */
{
  /* node:http rather than fetch: undici keeps its connection pool alive, and
     calling process.exit with one open trips a libuv assertion on Windows that
     reads as a crash in the test output. */
  const { get } = await import("node:http");
  const probe = await new Promise((resolve) => {
    const req = get(
      `${BASE}/`,
      { agent: false, headers: { connection: "close" } },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location ?? "" });
      },
    );
    req.on("error", () => resolve(null));
    req.end();
  });

  const requiresAuth =
    probe && probe.status >= 300 && probe.status < 400 && probe.location.includes("/signin");

  if (requiresAuth) {
    console.log(
      `${BASE} requires authentication, so this suite does not apply to it.\n\n` +
        "This one tests the demo posture: it sets a role in local storage the way\n" +
        "the in-app switcher does. With a database configured the role comes from\n" +
        "the session cookie instead, and local storage is correctly ignored.\n\n" +
        "Run the suite that signs in for real:\n" +
        "  npm run test:accounts\n" +
        "  npm run test:create-user\n\n" +
        "Or start a demo instance with no DATABASE_URL and point this at it.",
    );
    process.exit(0);
  }
}

const browser = await launch();
const results = [];
let failures = 0;

function record(role, check, pass, detail = "") {
  results.push({ role, check, pass, detail });
  if (!pass) failures++;
  // Streamed rather than buffered: a run that stalls should still show how far
  // it got, and where.
  console.log(`${pass ? "PASS" : "FAIL"}  ${role.padEnd(20)} ${check}${detail ? `  [${detail}]` : ""}`);
}

for (const [role, expect] of Object.entries(EXPECTATIONS)) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  // Seed the session exactly as the app persists it, before any script runs.
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [
      SESSION_KEY,
      JSON.stringify({ role, recruiterKey: expect.recruiterKey ?? null }),
    ],
  );

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const settle = async (path) => {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // Either the dataset finished hydrating, or the guard already refused the
    // page — a denied route never loads data, so waiting for the store would
    // burn the full timeout on every negative case.
    await page
      .waitForFunction(
        (marker) => {
          const text = document.body.innerText;
          return text.includes(marker) || !text.includes("Loading 28,366 application records");
        },
        DENIED_MARKER,
        { timeout: 30_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(400);
    return page.innerText("body");
  };

  for (const path of expect.allowed) {
    const body = await settle(path);
    record(role, `can open ${path}`, !body.includes(DENIED_MARKER));
  }

  for (const path of expect.denied) {
    const body = await settle(path);
    record(role, `is blocked from ${path}`, body.includes(DENIED_MARKER));
  }

  const explorer = await settle("/candidates");

  // Row-level. The single most important assertion here: a scoped session must
  // not be able to see another recruiter's records, even by asking for them.
  if (expect.scopedTo) {
    const others = OTHER_RECRUITERS.filter((r) => r !== expect.scopedTo);
    const leaked = others.filter((r) => explorer.includes(r));
    record(
      role,
      `explorer shows only ${expect.scopedTo}'s book`,
      leaked.length === 0,
      leaked.length ? `leaked ${leaked.join(", ")}` : "",
    );
    record(role, "scope banner is shown", explorer.includes("Scoped to your own book"));

    // And it must survive an explicit attempt to widen it from the URL.
    const widened = await settle(
      `/candidates?rec=${encodeURIComponent(others[0])}`,
    );
    record(
      role,
      "cannot widen scope via the URL filter",
      !widened.includes(others[0]) || widened.includes("No applications match"),
      `tried ${others[0]}`,
    );
  }

  // Action-level: is the Excel export offered? Checked BEFORE any dialog is
  // opened — Radix traps focus and marks the rest of the page inert, which
  // would hide this button from the accessibility tree.
  const exportShown = await page.getByRole("button", { name: /^Excel$/ }).count();
  record(
    role,
    `Excel export ${expect.exportVisible ? "offered" : "withheld"}`,
    (exportShown > 0) === expect.exportVisible,
  );

  // Nav must not advertise what the role cannot open.
  const navLinks = await page.locator("nav[aria-label='Primary'] a").allInnerTexts();
  const advertisesAdmin = navLinks.some((t) => t.includes("Access Control"));
  record(
    role,
    "sidebar hides Access Control unless permitted",
    advertisesAdmin === expect.allowed.includes("/admin/access"),
  );

  // Field-level, last: the compensation column is permitted-but-not-default,
  // so the question is whether the column menu OFFERS it. Checking the
  // rendered header would only measure the default column set, which is a UX
  // choice rather than a permission.
  await page.getByRole("button", { name: /^Columns/ }).click();
  await page.waitForTimeout(400);
  const salaryOffered =
    (await page.getByRole("menuitemcheckbox", { name: /Current salary/i }).count()) > 0;
  record(
    role,
    `compensation column ${expect.salaryVisible ? "offered" : "withheld"} in column menu`,
    salaryOffered === expect.salaryVisible,
    `saw ${salaryOffered}`,
  );

  record(role, "no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  await context.close();
}

await browser.close();

const width = Math.max(...results.map((r) => r.check.length)) + 2;
let currentRole = "";
for (const r of results) {
  if (r.role !== currentRole) {
    currentRole = r.role;
    console.log(`\n${currentRole}`);
  }
  console.log(
    `  ${r.pass ? "PASS" : "FAIL"}  ${r.check.padEnd(width)}${r.detail ? ` ${r.detail}` : ""}`,
  );
}
console.log(
  `\n${results.length - failures}/${results.length} checks passed` +
    (failures ? ` — ${failures} FAILED` : ""),
);
process.exit(failures ? 1 : 0);
