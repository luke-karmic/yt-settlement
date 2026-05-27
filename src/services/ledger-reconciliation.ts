/**
 * Full-wallet ledger replay reconciliation: walks `ledger_actions` in order,
 * verifies the balance chain, and compares the final balance to `wallets.balance`.
 * Alert-only — never mutates wallet balances.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db/client.js";
import {
  parseOptionalFirstRow,
  parseReconcileLedgerRows,
  parseReconcileWalletRow,
  reconcileWalletRowSchema,
  type ReconcileLedgerRow,
  type ReconcileWalletRow,
} from "@/domain/sql-rows.js";
import {
  ActionType,
  LedgerStatus,
  actionTypeFromDb,
  ledgerStatusFromDb,
  type LedgerId,
  type WalletId,
} from "@/domain/types.js";

/** Outcome of comparing a replayed ledger balance to `wallets.balance`. */
export type ReconcileStatus = "ok" | "drift" | "no_ledger" | "chain_break";

/** Per-status action counts observed during ledger replay for one wallet. */
export interface LedgerActionCounts {
  appliedBet: number;
  appliedWin: number;
  appliedRollback: number;
  preRollback: number;
  noop: number;
  rolledBack: number;
  other: number;
}

/** Result of replaying ledger rows without loading the wallet projection. */
export interface LedgerReplayResult {
  expectedBalance: bigint | null;
  sumDelta: bigint;
  counts: LedgerActionCounts;
  chainBreakAtLedgerId: LedgerId | null;
  chainBreakDetail: string | null;
}

/** Full reconciliation report for one wallet (replay + comparison to projection). */
export interface WalletReconcileResult {
  walletId: WalletId;
  providerUserId: string;
  currency: string;
  walletBalance: bigint;
  expectedBalance: bigint | null;
  drift: bigint;
  status: ReconcileStatus;
  ledgerRowCount: number;
  counts: LedgerActionCounts;
  sumDelta: bigint;
  firstLedgerAt: string | null;
  lastLedgerAt: string | null;
  firstBalanceBefore: bigint | null;
  lastBalanceAfter: bigint | null;
  chainBreakAtLedgerId: LedgerId | null;
  chainBreakDetail: string | null;
}

/**
 * @returns Zeroed action counters for a new replay pass
 */
function emptyCounts(): LedgerActionCounts {
  return {
    appliedBet: 0,
    appliedWin: 0,
    appliedRollback: 0,
    preRollback: 0,
    noop: 0,
    rolledBack: 0,
    other: 0,
  };
}

/**
 * @param counts - Mutable counter bag updated in place
 * @param actionType - `ledger_actions.action_type` smallint
 * @param status - `ledger_actions.status` smallint
 */
function incrementCount(counts: LedgerActionCounts, actionType: number, status: number): void {
  const type = actionTypeFromDb(actionType);
  const ledgerStatus = ledgerStatusFromDb(status);

  if (ledgerStatus === LedgerStatus.APPLIED && type === ActionType.BET) {
    counts.appliedBet++;
    return;
  }
  if (ledgerStatus === LedgerStatus.APPLIED && type === ActionType.WIN) {
    counts.appliedWin++;
    return;
  }
  if (ledgerStatus === LedgerStatus.APPLIED && type === ActionType.ROLLBACK) {
    counts.appliedRollback++;
    return;
  }
  if (ledgerStatus === LedgerStatus.PRE_ROLLBACK) {
    counts.preRollback++;
    return;
  }
  if (ledgerStatus === LedgerStatus.NOOP) {
    counts.noop++;
    return;
  }
  if (ledgerStatus === LedgerStatus.ROLLED_BACK) {
    counts.rolledBack++;
    return;
  }
  counts.other++;
}

/**
 * @param value - Postgres `timestamptz` as `Date` or ISO string
 * @returns ISO-8601 timestamp for CLI and log output
 */
function formatTimestamp(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

/**
 * Replays ledger rows in chronological order and derives expected balance from the chain.
 *
 * @param rows - Ledger actions ordered by `created_at`, then `id`
 * @returns Expected balance, action counts, and optional chain-break metadata
 */
export function replayWalletLedger(rows: readonly ReconcileLedgerRow[]): LedgerReplayResult {
  const counts = emptyCounts();
  if (rows.length === 0) {
    return {
      expectedBalance: null,
      sumDelta: 0n,
      counts,
      chainBreakAtLedgerId: null,
      chainBreakDetail: null,
    };
  }

  let running: bigint | null = null;
  let sumDelta = 0n;
  let chainBreakAtLedgerId: LedgerId | null = null;
  let chainBreakDetail: string | null = null;

  for (const row of rows) {
    incrementCount(counts, row.actionType, row.status);

    const balanceBefore = row.balanceBefore;
    const balanceAfter = row.balanceAfter;
    const delta = balanceAfter - balanceBefore;

    if (running === null) {
      running = balanceBefore;
    } else if (running !== balanceBefore) {
      chainBreakAtLedgerId = row.id;
      chainBreakDetail = `expected balance_before ${running.toString()}, got ${balanceBefore.toString()}`;
      break;
    }

    sumDelta += delta;
    running = balanceAfter;
  }

  return {
    expectedBalance: running,
    sumDelta,
    counts,
    chainBreakAtLedgerId,
    chainBreakDetail,
  };
}

/**
 * Combines wallet projection, ledger replay, and drift status for one wallet.
 *
 * @param wallet - Current `wallets` row
 * @param rows - All ledger actions for that wallet, time-ordered
 * @returns Reconciliation report including counts, balances, and status
 */
function buildResult(wallet: ReconcileWalletRow, rows: readonly ReconcileLedgerRow[]): WalletReconcileResult {
  const walletBalance = wallet.balance;
  const replay = replayWalletLedger(rows);

  const first = rows[0];
  const last = rows[rows.length - 1];

  let status: ReconcileStatus;
  let expectedBalance: bigint | null = replay.expectedBalance;
  let drift: bigint;

  if (rows.length === 0) {
    status = walletBalance === 0n ? "ok" : "no_ledger";
    expectedBalance = walletBalance;
    drift = 0n;
  } else if (replay.chainBreakAtLedgerId !== null) {
    status = "chain_break";
    drift = walletBalance - (replay.expectedBalance ?? 0n);
  } else {
    drift = walletBalance - (replay.expectedBalance ?? 0n);
    status = drift === 0n ? "ok" : "drift";
  }

  return {
    walletId: wallet.id,
    providerUserId: wallet.providerUserId,
    currency: wallet.currency,
    walletBalance,
    expectedBalance,
    drift,
    status,
    ledgerRowCount: rows.length,
    counts: replay.counts,
    sumDelta: replay.sumDelta,
    firstLedgerAt: first ? formatTimestamp(first.createdAt) : null,
    lastLedgerAt: last ? formatTimestamp(last.createdAt) : null,
    firstBalanceBefore: first ? first.balanceBefore : null,
    lastBalanceAfter: last ? last.balanceAfter : null,
    chainBreakAtLedgerId: replay.chainBreakAtLedgerId,
    chainBreakDetail: replay.chainBreakDetail,
  };
}

/**
 * @param walletId - `wallets.id`
 * @returns Parsed wallet row, or `undefined` when not found
 */
async function fetchWallet(walletId: WalletId): Promise<ReconcileWalletRow | undefined> {
  const rows = await db.execute(
    sql`SELECT id, provider_user_id, currency, balance::text AS balance
        FROM wallets WHERE id = ${walletId}`,
  );
  const row = parseOptionalFirstRow(reconcileWalletRowSchema, rows);
  return row === undefined ? undefined : parseReconcileWalletRow(row);
}

/**
 * @param providerUserId - API `user_id` (`wallets.provider_user_id`)
 * @param currency - Wallet currency code
 * @returns Parsed wallet row, or `undefined` when not found
 */
async function fetchWalletByUser(providerUserId: string, currency: string): Promise<ReconcileWalletRow | undefined> {
  const rows = await db.execute(
    sql`SELECT id, provider_user_id, currency, balance::text AS balance
        FROM wallets
        WHERE provider_user_id = ${providerUserId} AND currency = ${currency}`,
  );
  const row = parseOptionalFirstRow(reconcileWalletRowSchema, rows);
  return row === undefined ? undefined : parseReconcileWalletRow(row);
}

/**
 * @param walletId - `wallets.id`
 * @returns Ledger rows ordered for chronological replay
 */
async function fetchLedgerRows(walletId: WalletId): Promise<ReconcileLedgerRow[]> {
  const rows = await db.execute(
    sql`SELECT id, action_type, status, amount::text AS amount,
               balance_before::text AS balance_before,
               balance_after::text AS balance_after,
               created_at
        FROM ledger_actions
        WHERE wallet_id = ${walletId}
        ORDER BY created_at ASC, id ASC`,
  );
  return parseReconcileLedgerRows(rows);
}

/**
 * Reconciles one wallet by full ledger replay against `wallets.balance`.
 *
 * @param walletId - Primary key of the wallet row
 * @returns Reconciliation summary, or `null` when the wallet does not exist
 */
export async function reconcileWallet(walletId: WalletId): Promise<WalletReconcileResult | null> {
  const wallet = await fetchWallet(walletId);
  if (!wallet) return null;
  const ledgerRows = await fetchLedgerRows(walletId);
  return buildResult(wallet, ledgerRows);
}

/**
 * Reconciles one wallet by provider user id and currency.
 *
 * @param providerUserId - API `user_id` (maps to `provider_user_id`)
 * @param currency - Wallet currency code
 * @returns Reconciliation summary, or `null` when the wallet does not exist
 */
export async function reconcileWalletByUser(
  providerUserId: string,
  currency: string,
): Promise<WalletReconcileResult | null> {
  const wallet = await fetchWalletByUser(providerUserId, currency);
  if (!wallet) return null;
  const ledgerRows = await fetchLedgerRows(wallet.id);
  return buildResult(wallet, ledgerRows);
}

/**
 * Reconciles every wallet in the database (full ledger replay per wallet).
 *
 * @returns One result per wallet row, ordered by wallet id
 */
export async function reconcileAllWallets(): Promise<WalletReconcileResult[]> {
  const wallets = await db.execute(
    sql`SELECT id, provider_user_id, currency, balance::text AS balance
        FROM wallets
        ORDER BY id`,
  );

  const results: WalletReconcileResult[] = [];
  for (const raw of wallets) {
    const wallet = parseReconcileWalletRow(raw);
    const ledgerRows = await fetchLedgerRows(wallet.id);
    results.push(buildResult(wallet, ledgerRows));
  }
  return results;
}

/** Aggregated counts from a reconciliation pass, keyed by {@link ReconcileStatus}. */
export interface ReconcileSummaryCounts {
  drift: number;
  chainBreak: number;
  noLedger: number;
  ok: number;
}

/**
 * @param results - Output of {@link reconcileAllWallets} or single-wallet reconcile
 * @returns Counts by status for summary logging and exit codes
 */
export function countProblemWallets(results: readonly WalletReconcileResult[]): ReconcileSummaryCounts {
  let drift = 0;
  let chainBreak = 0;
  let noLedger = 0;
  let ok = 0;

  for (const r of results) {
    if (r.status === "drift") drift++;
    else if (r.status === "chain_break") chainBreak++;
    else if (r.status === "no_ledger") noLedger++;
    else ok++;
  }

  return { drift, chainBreak, noLedger, ok };
}

/**
 * @param results - Wallet reconciliation results
 * @returns `true` when any wallet has balance drift or a broken ledger chain
 */
export function hasReconciliationFailures(results: readonly WalletReconcileResult[]): boolean {
  const summary = countProblemWallets(results);
  return summary.drift > 0 || summary.chainBreak > 0;
}
