/**
 * The two flows that leave the application and come back.
 *
 *   invitation      — an administrator invites, the invitee registers
 *   password reset  — a user who cannot sign in gets back in
 *
 * Both hinge on a single-use token delivered by email, and both are where
 * authentication systems tend to leak: an invitation redeemable against any
 * address, a reset token that works twice, a "check your inbox" that only
 * appears for addresses that exist.
 *
 *   node scripts/flows-test.mjs --log <server-log> [--base http://localhost:3000]
 *
 * With no RESEND_API_KEY the application prints what it would have sent to the
 * server log — deliberately, so a preview environment can complete a sign-up.
 * That is where the tokens come from here. Point `--log` at the file the server's
 * stdout is going to.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE = arg("base", "http://localhost:3000");
const LOG = arg("log", null);

if (!LOG) {
  console.error(
    "This suite reads invitation and reset links out of the server log.\n" +
      "Start the server with its output redirected, then:\n" +
      "  node scripts/flows-test.mjs --log path/to/server.log",
  );
  process.exit(2);
}

let failures = 0;
function record(group, check, pass, detail = "") {
  if (!pass) failures += 1;
  process.stdout.write(
    `${pass ? "  ok  " : "  FAIL"} ${group.padEnd(11)} ${check}${detail ? ` — ${detail}` : ""}\n`,
  );
}

/* -------------------------------------------------------------------------
 * Reading the mail out of the log
 * ---------------------------------------------------------------------- */

let logCursor = 0;

function markLog() {
  try {
    logCursor = readFileSync(LOG, "utf8").length;
  } catch {
    logCursor = 0;
  }
}

/**
 * The most recent link of a given kind since the last `markLog()`.
 *
 * Anchored to a cursor rather than searching the whole file, so a token from an
 * earlier step in the same run cannot be mistaken for the current one — which
 * would make a "the old token still works" test pass by using the new one.
 */
async function linkSinceMark(kind, { attempts = 20 } = {}) {
  // Whitespace-split rather than a regex: the prefix contains `?`, `/` and `.`,
  // and escaping all of that correctly is a bug waiting to happen for no
  // benefit — the log already puts each link on its own line.
  const prefix = `${BASE}/${kind}?`;

  for (let i = 0; i < attempts; i++) {
    let text = "";
    try {
      text = readFileSync(LOG, "utf8").slice(logCursor);
    } catch {
      /* not written yet */
    }
    const hits = text.split(/\s+/).filter((word) => word.startsWith(prefix));
    if (hits.length) return hits[hits.length - 1];
    // The action returns before the log flush lands, often enough to matter.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

/* -------------------------------------------------------------------------
 * Project scripts
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

const fixture = (command, arg2) =>
  tsx("scripts/security-fixture.ts", ...(arg2 ? [command, arg2] : [command]));

function provision(email, role, password, book) {
  const args = ["--create", email, "--role", role, "--password", password, "--name", `Flow ${role}`];
  if (book) args.push("--book", book);
  tsx("scripts/accounts.ts", ...args);
}

/* -------------------------------------------------------------------------
 * Browser
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

async function fresh() {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await Promise.race([
    page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 12_000 }),
    page.locator('[role="status"]').first().waitFor({ state: "visible", timeout: 12_000 }),
  ]).catch(() => {});
  return !new URL(page.url()).pathname.startsWith("/signin");
}

/* -------------------------------------------------------------------------
 * Accounts
 * ---------------------------------------------------------------------- */

const ADMIN = { email: "sec-flow-admin@bayut.sa", password: "flow-admin-passphrase-2026" };
const INVITEE = "sec-flow-invitee@bayut.sa";
const IMPOSTOR = "sec-flow-impostor@bayut.sa";
const RESETTER = { email: "sec-flow-reset@bayut.sa", password: "flow-reset-original-2026" };
const NEW_PASSWORD = "flow-reset-replacement-2026";

process.stdout.write("Provisioning…\n");
fixture("cleanup");
provision(ADMIN.email, "Admin", ADMIN.password);
provision(RESETTER.email, "Recruitment Manager", RESETTER.password);
fixture("reset-limits");

/* =========================================================================
 * 1 · Invitation
 * ========================================================================= */
{
  const { context, page } = await fresh();
  record("invite", "the administrator signs in", await signIn(page, ADMIN.email, ADMIN.password));

  await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  markLog();
  await page.getByRole("button", { name: /^Invite$/i }).click();
  await page.waitForTimeout(600);
  await page.fill("#invite-email", INVITEE);
  await page.selectOption("#invite-role", "Recruiter");
  await page.waitForTimeout(400);
  await page.selectOption("#invite-book", "Ahmed Ashiq");
  await page.getByRole("button", { name: /send invitation/i }).click();
  await page.waitForTimeout(3000);

  const listed = await page.locator("body").innerText();
  record("invite", "the invitation is listed as pending", listed.includes(INVITEE));

  const link = await linkSinceMark("signup");
  record("invite", "an invitation link was issued", Boolean(link), link ? "found" : "not in the log");
  await context.close();

  if (!link) {
    record("invite", "the rest of the invitation flow", false, "no link to follow");
  } else {
    const token = new URL(link).searchParams.get("invite");

    /* ---- The address is pinned to the invitation -------------------- */
    {
      const { context: c, page: p } = await fresh();
      await p.goto(link, { waitUntil: "domcontentloaded" });
      const emailField = p.locator('input[name="email"]');
      const value = await emailField.inputValue().catch(() => "");
      const readOnly = await emailField.evaluate((el) => el.readOnly || el.disabled).catch(() => false);
      record("invite", "the invited address is prefilled", value === INVITEE, value || "(empty)");
      record("invite", "and cannot be edited", readOnly === true);
      await c.close();
    }

    /* ---- Redeeming against another address must fail ---------------- */
    {
      const { context: c, page: p } = await fresh();
      // Straight to the form with a different address, bypassing the read-only
      // field — the server has to be the one refusing, not the input.
      await p.goto(`${BASE}/signup?invite=${encodeURIComponent(token)}`, {
        waitUntil: "domcontentloaded",
      });
      await p.evaluate(() => {
        const el = document.querySelector('input[name="email"]');
        if (el) {
          el.readOnly = false;
          el.disabled = false;
        }
      });
      await p.fill('input[name="name"]', "An Impostor");
      await p.fill('input[name="email"]', IMPOSTOR);
      await p.fill('input[name="password"]', "impostor-passphrase-2026");
      await p.click('button[type="submit"]');
      await p.waitForTimeout(3500);
      const body = await p.locator("body").innerText();
      record(
        "invite",
        "cannot be redeemed against another address",
        /different email address/i.test(body),
        body.slice(0, 90).replace(/\n/g, " "),
      );
      record("invite", "and that address has no account", fixture("check-absent", IMPOSTOR) === "absent");
      await c.close();
    }

    /* ---- Redeeming properly ----------------------------------------- */
    let verifyLink = null;
    {
      const { context: c, page: p } = await fresh();
      markLog();
      await p.goto(link, { waitUntil: "domcontentloaded" });
      await p.fill('input[name="name"]', "Invited Person");
      await p.fill('input[name="password"]', "invitee-passphrase-2026");
      await p.click('button[type="submit"]');
      await p.waitForTimeout(4000);
      const body = await p.locator("body").innerText();
      record("invite", "the invitation is accepted", !/invalid|expired/i.test(body), body.slice(0, 90).replace(/\n/g, " "));
      verifyLink = await linkSinceMark("verify");
      await c.close();
    }

    /* ---- The role came from the invitation, not the form ------------- */
    {
      if (verifyLink) {
        const { context: c, page: p } = await fresh();
        await p.goto(verifyLink, { waitUntil: "domcontentloaded" });
        await p.waitForTimeout(2500);
        await c.close();
      }

      const listing = tsx("scripts/accounts.ts", "--list");
      const block = listing.split("\n\n").find((b) => b.includes(INVITEE)) ?? "";
      record(
        "invite",
        "the account carries the invited role",
        /Recruiter\b/.test(block) && !/Recruitment Manager|Admin/.test(block),
        block.split("\n")[1]?.trim() ?? "not listed",
      );
      record(
        "invite",
        "and the invited book",
        /Ahmed Ashiq/.test(block),
        block.split("\n")[2]?.trim() ?? "",
      );
    }

    /* ---- The invitation is single-use -------------------------------- */
    {
      const { context: c, page: p } = await fresh();
      await p.goto(`${BASE}/signup?invite=${encodeURIComponent(token)}`, {
        waitUntil: "domcontentloaded",
      });
      await p.evaluate(() => {
        const el = document.querySelector('input[name="email"]');
        if (el) {
          el.readOnly = false;
          el.disabled = false;
        }
      });
      await p.fill('input[name="name"]', "Second Comer");
      await p.fill('input[name="email"]', "sec-flow-second@bayut.sa");
      await p.fill('input[name="password"]', "second-comer-passphrase");
      await p.click('button[type="submit"]');
      await p.waitForTimeout(3500);
      const body = await p.locator("body").innerText();
      record(
        "invite",
        "the invitation cannot be used twice",
        /invalid or has expired|by invitation|different email/i.test(body),
        body.slice(0, 90).replace(/\n/g, " "),
      );
      record(
        "invite",
        "and no second account was created",
        fixture("check-absent", "sec-flow-second@bayut.sa") === "absent",
      );
      await c.close();
    }

    /* ---- A forged invitation token ----------------------------------- */
    {
      const { context: c, page: p } = await fresh();
      await p.goto(`${BASE}/signup?invite=${"z".repeat(43)}`, { waitUntil: "domcontentloaded" });
      await p.fill('input[name="name"]', "Forger");
      await p.fill('input[name="email"]', "sec-flow-forger@bayut.sa");
      await p.fill('input[name="password"]', "forger-passphrase-2026");
      await p.click('button[type="submit"]');
      await p.waitForTimeout(3500);
      const body = await p.locator("body").innerText();
      record(
        "invite",
        "a forged invitation is refused",
        /invalid or has expired|by invitation/i.test(body),
        body.slice(0, 80).replace(/\n/g, " "),
      );
      record(
        "invite",
        "and creates no account",
        fixture("check-absent", "sec-flow-forger@bayut.sa") === "absent",
      );
      await c.close();
    }
  }
}

/* =========================================================================
 * 2 · Password reset
 * ========================================================================= */
{
  fixture("reset-limits");

  /* ---- Requesting one must not confirm the address ------------------ */
  const said = {};
  for (const [label, email] of [
    ["existing", RESETTER.email],
    ["unknown", "sec-flow-nobody@bayut.sa"],
  ]) {
    const { context, page } = await fresh();
    await page.goto(`${BASE}/forgot-password`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    if (label === "existing") markLog();
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3500);
    said[label] = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
    await context.close();
  }
  record(
    "reset",
    "the response is identical for a known and unknown address",
    said.existing === said.unknown,
    said.existing === said.unknown ? "identical" : "they differ",
  );

  const resetLink = await linkSinceMark("reset");
  record("reset", "a reset link was issued for the real account", Boolean(resetLink));

  if (!resetLink) {
    record("reset", "the rest of the reset flow", false, "no link to follow");
  } else {
    const token = new URL(resetLink).searchParams.get("token");

    /* ---- Two live sessions, to prove the sign-out-everywhere claim --- */
    const other = await fresh();
    record("reset", "a second device is signed in", await signIn(other.page, RESETTER.email, RESETTER.password));

    /* ---- A password below the minimum is refused -------------------- */
    {
      const { context: c, page: p } = await fresh();
      await p.goto(resetLink, { waitUntil: "domcontentloaded" });
      await p.fill('input[name="password"]', "short");
      await p.click('button[type="submit"]');
      await p.waitForTimeout(2500);
      const body = await p.locator("body").innerText();
      record("reset", "a too-short password is refused", /at least 12/i.test(body));
      await c.close();
    }

    /* ---- Setting a new password ------------------------------------- */
    {
      const { context: c, page: p } = await fresh();
      await p.goto(resetLink, { waitUntil: "domcontentloaded" });
      await p.fill('input[name="password"]', NEW_PASSWORD);
      await p.click('button[type="submit"]');
      await p.waitForTimeout(4000);
      const body = await p.locator("body").innerText();
      record(
        "reset",
        "the password is changed",
        !/invalid|expired|not valid/i.test(body),
        body.slice(0, 90).replace(/\n/g, " "),
      );
      await c.close();
    }

    /* ---- The old password stops working ----------------------------- */
    {
      fixture("reset-limits");
      const { context: c, page: p } = await fresh();
      record("reset", "the old password no longer works", !(await signIn(p, RESETTER.email, RESETTER.password)));
      await c.close();
    }

    {
      fixture("reset-limits");
      const { context: c, page: p } = await fresh();
      record("reset", "the new password works", await signIn(p, RESETTER.email, NEW_PASSWORD));
      await c.close();
    }

    /* ---- Other devices were signed out ------------------------------ */
    {
      await other.page.goto(`${BASE}/candidates`, { waitUntil: "domcontentloaded" });
      const landed = new URL(other.page.url()).pathname;
      record(
        "reset",
        "the other device was signed out",
        landed.startsWith("/signin"),
        `landed on ${landed}`,
      );
      await other.context.close();
    }

    /* ---- The token is single-use ------------------------------------ */
    {
      const { context: c, page: p } = await fresh();
      await p.goto(`${BASE}/reset?token=${encodeURIComponent(token)}`, {
        waitUntil: "domcontentloaded",
      });
      const body = await p.locator("body").innerText();
      const form = await p.locator('input[name="password"]').count();
      if (form) {
        await p.fill('input[name="password"]', "yet-another-passphrase-2026");
        await p.click('button[type="submit"]');
        await p.waitForTimeout(3500);
      }
      const after = await p.locator("body").innerText();
      record(
        "reset",
        "the token cannot be used twice",
        /invalid|expired|no longer/i.test(body + after),
        (form ? after : body).slice(0, 90).replace(/\n/g, " "),
      );
      await c.close();
    }

    /* ---- A forged token --------------------------------------------- */
    {
      const { context: c, page: p } = await fresh();
      await p.goto(`${BASE}/reset?token=${"q".repeat(43)}`, { waitUntil: "domcontentloaded" });
      const body = await p.locator("body").innerText();
      const form = await p.locator('input[name="password"]').count();
      if (form) {
        await p.fill('input[name="password"]', "forged-token-passphrase-2026");
        await p.click('button[type="submit"]');
        await p.waitForTimeout(3500);
      }
      const after = await p.locator("body").innerText();
      record("reset", "a forged token is refused", /invalid|expired|not valid/i.test(body + after));
      await c.close();
    }

    /* ---- Requests are throttled -------------------------------------
       The throttle is deliberately SILENT: saying "too many attempts" would
       confirm that this address is worth requesting, which is the enumeration
       oracle the uniform response exists to close. So the observable invariant
       is not the message — it is that the mail stops. The limit is 3 per
       identifier per 15 minutes; six requests must not produce six links. */
    {
      fixture("reset-limits");
      markLog();

      const messages = new Set();
      for (let i = 0; i < 6; i++) {
        const { context: c, page: p } = await fresh();
        await p.goto(`${BASE}/forgot-password`, { waitUntil: "domcontentloaded" });
        await p.fill('input[name="email"]', RESETTER.email);
        await p.click('button[type="submit"]');
        await p.waitForTimeout(1800);
        messages.add((await p.locator('[role="status"]').first().textContent().catch(() => "")).trim());
        await c.close();
      }

      // Give the last log write a moment to land.
      await new Promise((resolve) => setTimeout(resolve, 800));
      const emitted = readFileSync(LOG, "utf8")
        .slice(logCursor)
        .split(/\s+/)
        .filter((word) => word.startsWith(`${BASE}/reset?`)).length;

      record(
        "reset",
        "six requests do not send six links",
        emitted > 0 && emitted <= 3,
        `${emitted} link${emitted === 1 ? "" : "s"} sent`,
      );
      record(
        "reset",
        "and the throttle is silent, so it reveals nothing",
        messages.size === 1,
        `${messages.size} distinct message${messages.size === 1 ? "" : "s"}`,
      );
    }
  }
}

/* =========================================================================
 * Clean up
 * ========================================================================= */
await browser.close();
console.log(`\n${fixture("cleanup")}`);
console.log(failures ? `${failures} FAILED.` : "Both flows hold.");
process.exit(failures ? 1 : 0);
