import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema/index.js";
import { env } from "@/config/index.js";
import type { Database } from "@/db/types.js";

const sql = postgres(env.DATABASE_URL, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 10,
});

/** Shared Drizzle client for routes, workers, and `processRequest` transactions. */
export const db: Database = drizzle(sql, { schema });

/**
 * Probes Postgres with `SELECT 1` for health checks.
 *
 * @returns `true` when the pool can run a query; `false` on connection errors
 */
export async function checkDbHealth(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Closes the underlying `postgres.js` pool (graceful shutdown).
 *
 * @returns Resolves when all connections are ended
 */
export async function closeDb(): Promise<void> {
  await sql.end();
}
