import {
  countProblemWallets,
  reconcileAllWallets,
} from "@/services/ledger-reconciliation.js";
import { logger } from "@/observability/logger.js";

/**
 * Runs a full-wallet ledger replay reconciliation pass and logs alerts for drift
 * or broken balance chains. Never mutates `wallets.balance`.
 *
 * @returns Resolves when every wallet has been checked
 */
export async function runSlidingReconciliation(): Promise<void> {
  const results = await reconcileAllWallets();
  const summary = countProblemWallets(results);

  for (const result of results) {
    if (result.status === "drift") {
      logger.error(
        {
          walletId: result.walletId.toString(),
          userId: result.providerUserId,
          expectedBalance: result.expectedBalance?.toString(),
          walletBalance: result.walletBalance.toString(),
          drift: result.drift.toString(),
          ledgerRowCount: result.ledgerRowCount,
        },
        "Wallet balance drift detected",
      );
    } else if (result.status === "chain_break") {
      logger.error(
        {
          walletId: result.walletId.toString(),
          userId: result.providerUserId,
          chainBreakAtLedgerId: result.chainBreakAtLedgerId?.toString(),
          chainBreakDetail: result.chainBreakDetail,
        },
        "Ledger balance chain break detected",
      );
    }
  }

  logger.info({ summary }, "Reconciliation pass complete — alerts only, no auto-fix");
}
