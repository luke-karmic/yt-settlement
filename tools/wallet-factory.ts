import { ulid } from "ulid";
import type postgres from "postgres";

export function createPlayerId(): string {
  return ulid();
}

export type ToolSql = postgres.Sql;

export async function ensureWallet(
  sql: ToolSql,
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
