/**
 * Screenshot harness.
 *
 * Loads each route in a real browser, waits for the columnar dataset to
 * hydrate and the charts to lay out, and fails loudly on any console error or
 * unhandled rejection — so a page that "renders" but throws never passes
 * silently.
 *
 *   node scripts/shoot.mjs [route ...] [--dark] [--out DIR] [--width N]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
// Flags that consume the following argument — its value must not be mistaken
// for a route, or the run ends with a bogus "cannot navigate" failure.
const VALUED_FLAGS = new Set(["--out", "--width", "--role", "--book", "--email", "--password"]);
const consumed = new Set();
argv.forEach((a, i) => {
  if (VALUED_FLAGS.has(a)) consumed.add(i + 1);
});
const routes = argv.filter((a, i) => !a.startsWith("--") && !consumed.has(i));
const getFlag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = getFlag("out", path.resolve("../../.shots"));
const WIDTH = Number(getFlag("width", 1600));
const DARK = flags.has("--dark");
const TARGETS = routes.length ? routes : ["/"];

mkdirSync(OUT, { recursive: true });

// Prefer Playwright's own build; fall back to the system Chrome/Edge so this
// works without a separate ~150MB browser download.
async function launch() {
  for (const opts of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try {
      return await chromium.launch(opts);
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("No usable Chromium found. Run: npx playwright install chromium");
}

const ROLE = getFlag("role", null);
const EMAIL = getFlag("email", null);
const PASSWORD = getFlag("password", null);

const browser = await launch();
const context = await browser.newContext({
  viewport: { width: WIDTH, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: DARK ? "dark" : "light",
});

/**
 * Establish an identity before capturing anything.
 *
 * Two ways, for the two postures:
 *
 *   --email / --password  signs in through the real form. Required against a
 *                         server-scoped instance, where the role comes from the
 *                         session cookie and local storage is ignored.
 *   --role / --book       seeds local storage the way the demo role switcher
 *                         does. Only meaningful with no database configured.
 */
if (EMAIL && PASSWORD) {
  const page = await context.newPage();
  await page.goto(`${BASE}/signin`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/signin"), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]).catch(() => {
    throw new Error(`Could not sign in as ${EMAIL}. Check the password, or the account's status.`);
  });
  await page.close();
  console.log(`signed in as ${EMAIL}`);
} else if (ROLE) {
  const BOOK = getFlag("book", null);
  await context.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ["cpml.session.v2", JSON.stringify({ role: ROLE, recruiterKey: BOOK })],
  );
}

let failed = 0;

for (const route of TARGETS) {
  const page = await context.newPage();
  const problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));

  const url = `${BASE}${route}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });

    if (DARK) {
      await page.evaluate(() => {
        document.documentElement.classList.add("dark");
        try { localStorage.setItem("theme", "dark"); } catch {}
      });
    }

    // The shell shows skeletons until the dataset is hydrated; the record
    // counter in the filter bar is the first thing that proves real data.
    await page
      .waitForFunction(
        () => !document.body.innerText.includes("Loading 28,366 application records"),
        { timeout: 60_000 },
      )
      .catch(() => problems.push("dataset never finished loading"));

    await page.waitForTimeout(2200); // chart layout + count-up animations
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);

    const name = (route === "/" ? "home" : route.replace(/^\//, "").replace(/[/?=&]/g, "-")) +
      (DARK ? "-dark" : "");
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });

    const status = problems.length ? `FAIL (${problems.length})` : "ok";
    console.log(`${status.padEnd(9)} ${route.padEnd(26)} -> ${file}`);
    for (const p of problems.slice(0, 6)) console.log(`            ${p}`);
    if (problems.length) failed++;
  } catch (err) {
    console.log(`ERROR     ${route} :: ${err.message}`);
    failed++;
  } finally {
    await page.close();
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
