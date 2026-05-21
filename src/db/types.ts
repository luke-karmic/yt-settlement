import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema/index.js";

/** Drizzle schema module type (all table definitions). */
export type AppSchema = typeof schema;

/** Application database handle (pooled `postgres.js` + Drizzle). */
export type Database = PostgresJsDatabase<AppSchema>;

/** Transaction scope passed through settlement and action handlers. */
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
