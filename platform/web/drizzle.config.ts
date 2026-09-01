import { defineConfig } from "drizzle-kit";
import { loadLocalEnv } from "./src/server/db/env";

// drizzle-kit does not read .env.local; Next does. Without this a migration
// would run against an empty connection string rather than fail loudly.
loadLocalEnv();

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // Migrations are reviewed before they run: `drizzle-kit push` against a
  // production database is how a column gets dropped by accident.
  verbose: true,
  strict: true,
});
