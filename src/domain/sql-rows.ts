import { z } from "zod";
import {
  actionTypeFromDb,
  ledgerStatusFromDb,
  toWalletId,
  toLedgerId,
  toBalance,
  toCurrencyCode,
  toProviderUserId,
  type ActionType,
  type LedgerStatus,
  type DomainWallet,
  type WalletId,
  type LedgerId,
  type Amount,
  type Balance,
  toAmount,
} from "@/domain/types.js";
import type { RtpUserEntry } from "@/schemas/rtp.js";

const numericSchema = z.union([z.string(), z.number(), z.bigint()]);

/** Zod shape for `SELECT balance FROM wallets` rows. */
export const walletBalanceRowSchema = z.object({
  balance: numericSchema,
});

/** Zod shape for locked `wallets` rows returned by `resolveWallet`. */
export const walletSqlRowSchema = z.object({
  id: numericSchema,
  provider_user_id: z.string(),
  currency: z.string(),
  balance: numericSchema,
  created_at: z.union([z.string(), z.date()]),
  updated_at: z.union([z.string(), z.date()]),
});

/** Zod shape for `rollback_intents` existence probes. */
export const rollbackIntentExistsRowSchema = z.object({
  rollback_action_id: z.string().uuid(),
});

/** Zod shape for `INSERT ... RETURNING id` on `ledger_actions`. */
export const ledgerIdRowSchema = z.object({
  id: numericSchema,
});

/** Zod shape for the latest `current_hash` in a wallet's ledger chain. */
export const ledgerHashRowSchema = z.object({
  current_hash: z.instanceof(Buffer).nullable(),
});

/** Zod shape for `action_lookup` idempotency reads. */
export const actionLookupRowSchema = z.object({
  tx_id: z.string().uuid(),
  payload_hash: z.union([z.instanceof(Buffer), z.string()]),
});

/** Zod shape for rollback joins against `action_lookup` + `ledger_actions`. */
export const originalActionRowSchema = z.object({
  tx_id: z.string().uuid(),
  action_type: z.number().int(),
  status: z.number().int(),
  wallet_id: numericSchema,
  amount: numericSchema,
  balance_before: numericSchema,
  balance_after: numericSchema,
});

/** Zod shape for RTP aggregation query result rows. */
export const rtpAggregateRowSchema = z.object({
  user_id: z.string().optional(),
  currency: z.string(),
  rounds: numericSchema,
  total_bet: numericSchema,
  total_win: numericSchema,
  rollback_bet: numericSchema,
  rollback_win: numericSchema,
});

/** Zod shape for `COUNT(*)` style RTP pagination queries. */
export const countRowSchema = z.object({
  total: numericSchema,
});

/**
 * @param value - Numeric column from Postgres (`bigint`, `numeric`, or string)
 * @returns JavaScript `bigint`
 */
export function toBigInt(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

/**
 * @param value - Numeric column safe for JS `number` (counts, pagination)
 * @returns JavaScript `number`
 */
export function toNumber(value: string | number | bigint): number {
  return typeof value === "number" ? value : Number(value);
}

/**
 * Parses and validates the first row of a raw SQL result set.
 *
 * @param schema - Zod schema for one row
 * @param rows - `tx.execute` result rows
 * @returns Parsed row
 * @throws {Error} When `rows` is empty
 * @throws {z.ZodError} When the row does not match `schema`
 */
export function parseFirstRow<T extends z.ZodType>(
  schema: T,
  rows: readonly unknown[],
): z.infer<T> {
  const row = rows[0];
  if (row === undefined) {
    throw new Error("Expected at least one SQL row");
  }
  return schema.parse(row);
}

/**
 * Parses the first row when present; otherwise returns `undefined`.
 *
 * @param schema - Zod schema for one row
 * @param rows - `tx.execute` result rows
 * @returns Parsed row or `undefined`
 * @throws {z.ZodError} When a present row does not match `schema`
 */
export function parseOptionalFirstRow<T extends z.ZodType>(
  schema: T,
  rows: readonly unknown[],
): z.infer<T> | undefined {
  const row = rows[0];
  return row === undefined ? undefined : schema.parse(row);
}

/**
 * Normalizes `payload_hash` from Postgres (`bytea` Buffer or hex string).
 *
 * @param value - Buffer or hex-encoded hash from SQL
 * @returns 32-byte digest buffer
 */
export function parsePayloadHash(value: Buffer | string): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "hex");
}

/** Parsed original action row used by rollback handling. */
export interface OriginalActionRow {
  txId: string;
  actionType: ActionType;
  status: LedgerStatus;
  walletId: WalletId;
  amount: Amount;
  balanceBefore: Balance;
  balanceAfter: Balance;
}

/**
 * @param rows - SQL rows from the rollback original-action lookup
 * @returns Branded domain fields for rollback logic
 * @throws {Error} When `rows` is empty
 * @throws {z.ZodError} When the row shape is invalid
 */
export function parseOriginalActionRow(rows: readonly unknown[]): OriginalActionRow {
  const row = parseFirstRow(originalActionRowSchema, rows);
  return {
    txId: row.tx_id,
    actionType: actionTypeFromDb(row.action_type),
    status: ledgerStatusFromDb(row.status),
    walletId: toWalletId(toBigInt(row.wallet_id)),
    amount: toAmount(toBigInt(row.amount)),
    balanceBefore: toBalance(toBigInt(row.balance_before)),
    balanceAfter: toBalance(toBigInt(row.balance_after)),
  };
}

/**
 * @param rows - SQL rows from wallet `FOR UPDATE` select
 * @returns {@link DomainWallet}
 * @throws {Error} When `rows` is empty
 */
export function parseWalletSqlRow(rows: readonly unknown[]): DomainWallet {
  const row = parseFirstRow(walletSqlRowSchema, rows);
  return {
    id: toWalletId(toBigInt(row.id)),
    providerUserId: toProviderUserId(row.provider_user_id),
    currency: toCurrencyCode(row.currency),
    balance: toBalance(toBigInt(row.balance)),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
  };
}

/**
 * @param rows - SQL rows with a single `balance` column
 * @returns Branded wallet balance
 * @throws {Error} When `rows` is empty
 */
export function parseWalletBalance(rows: readonly unknown[]): Balance {
  return toBalance(toBigInt(parseFirstRow(walletBalanceRowSchema, rows).balance));
}

/**
 * @param rows - `RETURNING id` rows from ledger insert
 * @returns Branded ledger row id
 * @throws {Error} When `rows` is empty
 */
export function parseLedgerId(rows: readonly unknown[]): LedgerId {
  return toLedgerId(toBigInt(parseFirstRow(ledgerIdRowSchema, rows).id));
}

/**
 * Maps one RTP SQL aggregate row to the public API shape (computes `rtp` percent).
 *
 * @param row - Validated aggregate row from `rtpAggregateRowSchema`
 * @param userId - Provider user id, or `"casino"` for casino-wide totals
 * @returns RTP entry with nullable `rtp` when `total_bet` is zero
 */
export function mapRtpAggregateRow(
  row: z.infer<typeof rtpAggregateRowSchema>,
  userId: string,
): RtpUserEntry {
  const totalBet = toNumber(row.total_bet);
  const totalWin = toNumber(row.total_win);
  const rollbackBet = toNumber(row.rollback_bet);
  const rollbackWin = toNumber(row.rollback_win);
  const netBet = totalBet - rollbackBet;
  const netWin = totalWin - rollbackWin;
  const rtp = netBet > 0 ? (netWin / netBet) * 100 : null;

  return {
    user_id: userId,
    currency: row.currency,
    rounds: toNumber(row.rounds),
    total_bet: totalBet,
    total_win: totalWin,
    rollback_bet: rollbackBet,
    rollback_win: rollbackWin,
    rtp,
  };
}
