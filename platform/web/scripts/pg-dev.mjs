/**
 * A local Postgres for development, with nothing to install by hand.
 *
 *   npm run db:dev
 *   → postgresql://postgres:postgres@127.0.0.1:5433/postgres
 *
 * `embedded-postgres` ships the real PostgreSQL binaries as an npm package and
 * runs them as a child process under the current user — no service, no Docker,
 * no administrator rights. It is a genuine server, so it accepts connections
 * and closes them the way the app expects; an in-process WASM Postgres does
 * not, which is why this is not PGlite.
 *
 * Cluster data lives in `.pgdata/` (gitignored). Delete that directory to
 * start over.
 *
 * Development only. Production uses Neon or any managed Postgres through the
 * same DATABASE_URL — see DEPLOYMENT.md.
 */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.PGDEV_PORT ?? 5433);
const DIR = resolve(process.cwd(), ".pgdata");
const FRESH = process.argv.includes("--fresh");

if (FRESH && existsSync(DIR)) {
  console.log("Removing the existing cluster…");
  rmSync(DIR, { recursive: true, force: true });
}

const initialised = existsSync(resolve(DIR, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: DIR,
  user: "postgres",
  password: "postgres",
  port: PORT,
  // `createPostgresUser` runs `groupadd`/`useradd` to create an OS account for
  // the server. That is a Linux convention and requires root; on Windows the
  // binaries run happily as the current user.
  createPostgresUser: process.platform === "linux",
  persistent: true,
  // initdb on Windows otherwise inherits the system codepage — WIN1252 here —
  // and every Arabic or Urdu candidate name in the dataset fails to insert
  // with "character has no equivalent in encoding". UTF-8 is the only correct
  // choice for this data, and matches what the managed providers give you.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (!initialised) {
  console.log("Initialising a new cluster (first run only)…");
  await pg.initialise();
}

await pg.start();

console.log(`Postgres ${initialised ? "started" : "created and started"} on 127.0.0.1:${PORT}`);
console.log(`DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres"`);
console.log(`Cluster: ${DIR}`);
console.log("Ctrl-C to stop.");

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    // A cluster killed mid-write recovers on next start, but a clean stop
    // skips that recovery and keeps the log honest about why it shut down.
    await pg.stop().catch(() => {});
    process.exit(0);
  });
}
