import { sql } from "drizzle-orm";
import { parseWalletBalance, parseWalletSqlRow } from "@/domain/sql-rows.js";
import type { DbTransaction } from "@/db/types.js";
import type { DomainWallet, ProviderUserId, CurrencyCode, WalletId, Balance } from "@/domain/types.js";

/**
 * Ensures a wallet row exists for `(provider_user_id, currency)` and locks it
 * with `FOR UPDATE` for the rest of the transaction.
 *
 * @param tx - Open DB transaction
 * @param providerUserId - API `user_id` (opaque provider wallet key)
 * @param currency - ISO-style currency code from the request
 * @returns Locked wallet row (created with balance `0` if new)
 */
export async function resolveWallet(
  tx: DbTransaction,
  providerUserId: ProviderUserId,
  currency: CurrencyCode,
): Promise<DomainWallet> {
  await tx.execute(
    sql`INSERT INTO wallets (provider_user_id, currency, balance)
        VALUES (${providerUserId}, ${currency}, 0)
        ON CONFLICT (provider_user_id, currency) DO NOTHING`,
  );

  const rows = await tx.execute(
    sql`SELECT id, provider_user_id, currency, balance, created_at, updated_at
        FROM wallets
        WHERE provider_user_id = ${providerUserId} AND currency = ${currency}
        FOR UPDATE`,
  );

  if (rows.length === 0) {
    throw new Error("Wallet not found after upsert");
  }

  return parseWalletSqlRow(rows);
}

/**
 * Reads the current wallet balance from `wallets` (caller should hold `FOR UPDATE` when needed).
 *
 * @param tx - Open DB transaction
 * @param walletId - Primary key of the wallet row
 * @returns Authoritative `wallets.balance` in smallest currency units
 */
export async function getWalletBalance(tx: DbTransaction, walletId: WalletId): Promise<Balance> {
  const rows = await tx.execute(sql`SELECT balance FROM wallets WHERE id = ${walletId}`);
  return parseWalletBalance(rows);
}
