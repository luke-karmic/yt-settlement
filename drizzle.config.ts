/**
 * Drizzle Kit config: TypeScript schema lives in `src/db/schema`, generated SQL
 * migrations are written to `drizzle/` (run via `pnpm db:generate` / `pnpm db:migrate`).
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgres://yeet:yeet@localhost:5433/yeet_dev",
  },
});
