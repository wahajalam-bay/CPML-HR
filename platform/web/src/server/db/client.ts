import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import {
  drizzle as drizzlePostgres,
  type PostgresJsDatabase,
} from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Database client.
 *
 * Two drivers, chosen from the connection string rather than configured:
 *
 *   Neon (`*.neon.tech`)  → HTTP driver. Serverless functions are created and
 *                           destroyed per request, so a TCP pool that cannot
 *                           be reused is just latency plus a connection the
 *                           database has to reap. HTTP fits the model.
 *
 *   Anything else         → postgres.js over TCP. Covers local development,
 *                           Supabase, RDS, a container — anywhere the Neon
 *                           HTTP proxy does not exist. Capped at one
 *                           connection because the same per-request lifecycle
 *                           applies; a larger pool would exhaust the server's
 *                           slots under concurrency rather than queue.
 *
 * Set `DATABASE_DRIVER=neon|postgres` to override the detection.
 *
 * The client is created lazily so the app still builds and runs without a
 * database — the store falls back to the static payload, which is what makes a
 * preview deploy possible before Postgres is provisioned.
 */

/**
 * One type for both drivers. Their query-builder surfaces are identical; the
 * only real divergence is `transaction()`, which the HTTP driver cannot honour
 * — so nothing in this codebase uses it, and a lint rule would be the place to
 * keep it that way if that ever changes.
 */
export type Database = PostgresJsDatabase<typeof schema>;

let cached: Database | null = null;

function driverFor(url: string): "neon" | "postgres" {
  const override = process.env.DATABASE_DRIVER;
  if (override === "neon" || override === "postgres") return override;
  return /\.neon\.tech(?::|\/|$)/i.test(url) ? "neon" : "postgres";
}

function create(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Provision Postgres and add it to the environment, " +
        "or run with NEXT_PUBLIC_DATASET_MODE=client-full to use the static dataset.",
    );
  }

  if (driverFor(url) === "neon") {
    return drizzleNeon(neon(url), {
      schema,
      casing: "snake_case",
    }) as unknown as Database;
  }

  const client = postgres(url, {
    max: 1,
    // Local development and containers routinely have no certificate. Anything
    // reachable over the network must still present one.
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : "require",
    // Drizzle handles its own type coercion; postgres.js transforms would
    // double-convert.
    prepare: false,
  });
  return drizzlePostgres(client, { schema, casing: "snake_case" });
}

export function db() {
  if (!cached) cached = create();
  return cached;
}

/** True when a database is configured. Callers degrade rather than throw. */
export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export { schema };
