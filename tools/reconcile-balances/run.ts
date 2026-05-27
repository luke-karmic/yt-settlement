/**
 * CLI runner for full-wallet ledger reconciliation (`pnpm reconcile`).
 */
import type { Logger } from "pino";
import { closeDb } from "@/db/client.js";
import {
  countProblemWallets,
  hasReconciliationFailures,
  reconcileAllWallets,
  reconcileWallet,
  reconcileWalletByUser,
  type WalletReconcileResult,
} from "@/services/ledger-reconciliation.js";
import { toWalletId } from "@/domain/types.js";
import { loadSimulatorEnv } from "../lib/simulator-env.js";
import { createToolLogger } from "../lib/tool-logger.js";

/** Flags parsed from `pnpm reconcile -- ...`. */
export type ReconcileRunOptions = {
  walletId?: string;
  userId?: string;
  currency: string;
  jsonOutput: boolean;
  strictExit: boolean;
};

/**
 * @param result - Wallet reconciliation outcome
 * @returns Snake_case action counts for JSON and structured logs
 */
function formatCounts(result: WalletReconcileResult): Record<string, number> {
  return {
    applied_bet: result.counts.appliedBet,
    applied_win: result.counts.appliedWin,
    applied_rollback: result.counts.appliedRollback,
    pre_rollback: result.counts.preRollback,
    noop: result.counts.noop,
    rolled_back: result.counts.rolledBack,
    other: result.counts.other,
  };
}

/**
 * @param result - Wallet reconciliation outcome
 * @returns JSON-serializable report (bigint fields as strings)
 */
function serializeResult(result: WalletReconcileResult): Record<string, unknown> {
  return {
    walletId: result.walletId.toString(),
    providerUserId: result.providerUserId,
    currency: result.currency,
    status: result.status,
    ledgerRowCount: result.ledgerRowCount,
    actionCounts: formatCounts(result),
    sumDelta: result.sumDelta.toString(),
    firstBalanceBefore: result.firstBalanceBefore?.toString() ?? null,
    lastBalanceAfter: result.lastBalanceAfter?.toString() ?? null,
    expectedBalance: result.expectedBalance?.toString() ?? null,
    walletBalance: result.walletBalance.toString(),
    drift: result.drift.toString(),
    firstLedgerAt: result.firstLedgerAt,
    lastLedgerAt: result.lastLedgerAt,
    chainBreakAtLedgerId: result.chainBreakAtLedgerId?.toString() ?? null,
    chainBreakDetail: result.chainBreakDetail,
  };
}

/**
 * @param log - Pino logger for tool output
 * @param result - Wallet reconciliation outcome
 */
function logResult(log: Logger, result: WalletReconcileResult): void {
  log.info(
    {
      walletId: result.walletId.toString(),
      userId: result.providerUserId,
      currency: result.currency,
      status: result.status,
      ledgerRowCount: result.ledgerRowCount,
      actionCounts: formatCounts(result),
      sumDelta: result.sumDelta.toString(),
      firstBalanceBefore: result.firstBalanceBefore?.toString() ?? null,
      lastBalanceAfter: result.lastBalanceAfter?.toString() ?? null,
      expectedBalance: result.expectedBalance?.toString() ?? null,
      walletBalance: result.walletBalance.toString(),
      drift: result.drift.toString(),
      firstLedgerAt: result.firstLedgerAt,
      lastLedgerAt: result.lastLedgerAt,
      chainBreakAtLedgerId: result.chainBreakAtLedgerId?.toString() ?? null,
      chainBreakDetail: result.chainBreakDetail,
    },
    "Wallet reconciliation",
  );
}

/**
 * Runs ledger replay reconciliation for one or all wallets and prints a summary.
 *
 * @param options - Wallet selector, output format, and exit-code behaviour
 * @returns Process exit code (`0` success, `1` on drift, chain break, or missing wallet)
 */
export async function runBalanceReconciliation(options: ReconcileRunOptions): Promise<number> {
  let results: WalletReconcileResult[];

  if (options.walletId) {
    const result = await reconcileWallet(toWalletId(BigInt(options.walletId)));
    if (!result) {
      console.error(`Wallet not found: id=${options.walletId}`);
      return 1;
    }
    results = [result];
  } else if (options.userId) {
    const result = await reconcileWalletByUser(options.userId, options.currency);
    if (!result) {
      console.error(`Wallet not found: user_id=${options.userId} currency=${options.currency}`);
      return 1;
    }
    results = [result];
  } else {
    results = await reconcileAllWallets();
  }

  const summary = countProblemWallets(results);

  if (options.jsonOutput) {
    console.log(JSON.stringify({ wallets: results.map(serializeResult), summary }, null, 2));
  } else {
    console.log(`Reconciliation pass: ${results.length} wallet(s)\n`);
    const log = createToolLogger(
      loadSimulatorEnv({
        ...process.env,
        LOG_PRETTY: process.env["LOG_PRETTY"] ?? (process.env["NODE_ENV"] === "development" ? "true" : "false"),
      }),
    );
    for (const result of results) {
      logResult(log, result);
    }
    console.log("Summary:");
    console.log(`  ok=${summary.ok}`);
    console.log(`  drift=${summary.drift}`);
    console.log(`  chain_break=${summary.chainBreak}`);
    console.log(`  no_ledger=${summary.noLedger} (funded wallet with zero ledger rows)`);
  }

  if (options.strictExit && hasReconciliationFailures(results)) {
    return 1;
  }
  return 0;
}

/**
 * Entry point for `tools/reconcile-balances.ts` — parses argv and runs reconciliation.
 *
 * @returns Resolves after closing the DB pool
 */
export async function main(): Promise<void> {
  loadSimulatorEnv(process.env);
  const args = process.argv.slice(2);

  function readArg(flag: string): string | undefined {
    const index = args.indexOf(flag);
    if (index === -1 || index + 1 >= args.length) return undefined;
    return args[index + 1];
  }

  const exitCode = await runBalanceReconciliation({
    walletId: readArg("--wallet-id"),
    userId: readArg("--user-id"),
    currency: readArg("--currency") ?? "USD",
    jsonOutput: args.includes("--json"),
    strictExit: !args.includes("--no-strict"),
  });

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
  await closeDb();
}
