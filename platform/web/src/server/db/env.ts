/**
 * Load `.env.local` for code that runs outside Next.js.
 *
 * Next loads it automatically; drizzle-kit and the seed scripts do not, and a
 * migration that silently reads an empty DATABASE_URL is the kind of thing
 * that gets run against the wrong database. Explicit load, explicit failure.
 *
 * Values already in the environment win, so `DATABASE_URL=… npm run db:migrate`
 * still overrides the file — which is how you point a one-off command at
 * production without editing anything.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;

    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue; // comment, blank, or something we do not understand

      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue; // first definition wins

      const trimmed = rawValue.trim();
      const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed);
      process.env[key] = quoted ? quoted[2] : trimmed;
    }
  }
}
