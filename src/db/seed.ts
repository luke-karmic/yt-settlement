import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { ulid } from "ulid";
import { env } from "@/config/index.js";
import { logger } from "@/observability/logger.js";

const ACCEPTANCE_USER = "8|USDT|USD";
const ACCEPTANCE_BALANCE = 74322001n;

async function ensureWallet(
  sql: postgres.Sql,
  providerUserId: string,
  currency: string,
  initialBalance: bigint,
): Promise<void> {
  const balance = initialBalance.toString();
  await sql`
    INSERT INTO wallets (provider_user_id, currency, balance)
    VALUES (${providerUserId}, ${currency}, ${balance}::bigint)
    ON CONFLICT (provider_user_id, currency)
    DO UPDATE SET balance = ${balance}::bigint, updated_at = now()
  `;
}

const sql = postgres(env.DATABASE_URL, { max: 5 });

await ensureWallet(sql, ACCEPTANCE_USER, "USD", ACCEPTANCE_BALANCE);
logger.info(
  { userId: ACCEPTANCE_USER, currency: "USD", balance: Number(ACCEPTANCE_BALANCE) },
  "Seeded acceptance wallet",
);

const k6Wallets: Array<{ userId: string; currency: string }> = [
  { userId: ACCEPTANCE_USER, currency: "USD" },
];

const simCount = parseInt(process.env["K6_WALLETS"] ?? "20", 10);
for (let i = 0; i < simCount; i++) {
  const userId = ulid();
  const balance = BigInt(Math.floor(Math.random() * 10_000_000) + 1_000_000);
  await ensureWallet(sql, userId, "USD", balance);
  k6Wallets.push({ userId, currency: "USD" });
}
logger.info({ count: simCount }, "Seeded simulation wallets");

if (process.env["SKIP_K6_MANIFEST"] !== "true") {
  const k6Dir = join(dirname(fileURLToPath(import.meta.url)), "../../k6");
  writeFileSync(join(k6Dir, "wallets.json"), JSON.stringify(k6Wallets, null, 2));
  logger.info({ path: "k6/wallets.json", wallets: k6Wallets.length }, "Wrote k6 wallet manifest");
}

await sql.end();
