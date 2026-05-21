/** Applies all SQL files under `drizzle/` to the database configured by `DATABASE_URL`. */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "@/config/index.js";
import { logger } from "@/observability/logger.js";

const sql = postgres(env.DATABASE_URL, { max: 1 });
const db = drizzle(sql);

await migrate(db, { migrationsFolder: "./drizzle" });
logger.info("Migrations applied successfully");
await sql.end();
