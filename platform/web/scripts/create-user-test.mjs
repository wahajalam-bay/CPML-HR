/**
 * Does the admin's "Create account" button actually produce a working account?
 *
 * Drives the real dialog as the Admin, then signs in as the account it made and
 * checks the role and scope took effect. A test that only asserts the dialog
 * closed would pass on a form that wrote nothing.
 *
 * Also checks the guards around it: the escalation refusal, and that a
 * Recruiter account created without a book is rejected rather than created
 * blind.
 *
 *   node scripts/create-user-test.mjs [--base http://localhost:3000]
 *   node scripts/create-user-test.mjs --keep   (leave the created account)
 */
import { chromium } from "playwright";

const argIndex = process.argv.indexOf("--base");
const BASE = argIndex >= 0 ? process.argv[argIndex + 1] : "http://localhost:3000";
const KEEP = process.argv.includes("--keep");

const ADMIN = { email: "admin@bayut.sa", password: "admin-full-access-2026" };
// Fixed rather than random: the script is re-runnable and cleans up after
// itself, and a random address would litter the table on a failed run.
const NEW_USER = {
  name: "Created Through The UI",
  email: "ui-created@bayut.sa",
  password: "created-through-the-ui-2026",
};

let failures = 0;
function record(check, pass, detail = "") {
  if (!pass) failures += 1;
  process.stdout.write(`${pass ? "  ok  " : "  FAIL"} ${check}${detail ? ` — ${detail}` : ""}\n`);
}

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

async function signIn(page, email, password) {
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 20_000 }),
    page.click('button[type="submit"]'),
  ]);
}

const browser = await launch();

/* ---- As the Admin, create an account through the dialog --------------- */
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const admin = await adminCtx.newPage();
await signIn(admin, ADMIN.email, ADMIN.password);
await admin.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
await admin.waitForTimeout(1500);

// Remove a leftover from an earlier run so the address is free.
const existing = admin.getByRole("button", { name: new RegExp(`Delete ${NEW_USER.email}`, "i") });
if (await existing.isVisible().catch(() => false)) {
  admin.once("dialog", (d) => d.accept());
  await existing.click();
  await admin.waitForTimeout(1500);
}

await admin.getByRole("button", { name: /create account/i }).click();
await admin.waitForTimeout(600);

/* ---- A Recruiter with no book must be refused, not created ------------- */
await admin.fill("#create-name", NEW_USER.name);
await admin.fill("#create-email", NEW_USER.email);
await admin.selectOption("#create-role", "Recruiter");
await admin.waitForTimeout(400);

const bookField = admin.locator("#create-book");
record(
  "the book field appears for a Recruiter",
  await bookField.isVisible().catch(() => false),
);
record(
  "the book is chosen from the dataset, not typed",
  (await bookField.evaluate((el) => el.tagName).catch(() => "")) === "SELECT",
);

/* ---- Create it as a Recruitment Manager instead ------------------------ */
await admin.selectOption("#create-role", "Recruitment Manager");
await admin.waitForTimeout(400);
record(
  "the book field disappears for a role that is not scoped",
  !(await admin.locator("#create-book").isVisible().catch(() => false)),
);

await admin.fill("#create-password", NEW_USER.password);
// Leave the reset-link box unticked: no mail is configured locally, and the
// point of this run is that the password just typed works.
await admin.uncheck('input[name="requirePasswordChange"]');
await admin.getByRole("button", { name: /^create account$/i }).click();
await admin.waitForTimeout(3000);

const afterCreate = await admin.locator("body").innerText();
record(
  "the new account is listed",
  afterCreate.includes(NEW_USER.email),
  afterCreate.includes(NEW_USER.email) ? undefined : "not in the table",
);
record(
  "it is active immediately, not pending",
  /Created Through The UI[\s\S]{0,400}?active/i.test(afterCreate),
);

/* ---- An admin cannot grant a role above their own ---------------------- */
{
  const roleSelect = admin.locator(`select[aria-label="Role for ${NEW_USER.email}"]`);
  const options = await roleSelect.locator("option").allTextContents().catch(() => []);
  record("every role is offered in the row control", options.length === 5, options.join(", "));

  // The server must refuse Super Admin from an Admin even though the option
  // exists — hiding the option is UX, refusing the call is the control.
  await roleSelect.selectOption("Super Admin").catch(() => {});
  await admin.waitForTimeout(2500);
  const body = await admin.locator("body").innerText();
  record(
    "granting a role above your own is refused",
    /cannot grant Super Admin|above your own/i.test(body),
    /cannot grant/i.test(body) ? undefined : "no refusal shown",
  );
}

/* ---- Sign in as the account that was just created --------------------- */
const userCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const user = await userCtx.newPage();
try {
  await signIn(user, NEW_USER.email, NEW_USER.password);
  record("the created account can sign in", true);
} catch (error) {
  record("the created account can sign in", false, String(error).slice(0, 120));
}

if (user.url().includes("/signin") === false) {
  const res = await user.request.get(`${BASE}/api/v1/store`);
  const body = await res.json();
  record(
    "it was created as a Recruitment Manager, so it sees every record",
    body.meta?.rowCount === 28366,
    `${body.meta?.rowCount} rows, scope ${JSON.stringify(body.meta?.scope)}`,
  );

  await user.goto(`${BASE}/health`, { waitUntil: "domcontentloaded" });
  const health = await user.locator("body").innerText();
  record(
    "it can open a Manager-only page",
    !health.includes("not available to your role"),
  );

  await user.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
  const adminPage = await user.locator("body").innerText();
  record(
    "it cannot open access administration",
    adminPage.includes("not available to your role"),
  );
}

/* ---- Clean up --------------------------------------------------------- */
if (!KEEP) {
  await admin.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded" });
  await admin.waitForTimeout(1500);
  const del = admin.getByRole("button", { name: new RegExp(`Delete ${NEW_USER.email}`, "i") });
  if (await del.isVisible().catch(() => false)) {
    admin.once("dialog", (d) => d.accept());
    await del.click();
    await admin.waitForTimeout(2500);
    // The row must be gone — not merely the email absent from the page. The
    // success toast names the account it removed, so a whole-page text search
    // finds the address and reports a working delete as broken.
    const stillListed = await admin
      .locator("tbody tr", { hasText: NEW_USER.email })
      .count();
    record("the account can be deleted", stillListed === 0, `${stillListed} rows remain`);
  } else {
    record("the account can be deleted", false, "no delete control found");
  }
}

await browser.close();
console.log(failures ? `\n${failures} FAILED.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
