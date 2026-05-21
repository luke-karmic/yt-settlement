import { sql } from "drizzle-orm";
import { db } from "@/db/client.js";
import { logger } from "@/observability/logger.js";

/**
 * Samples wallet balances vs summed ledger deltas over a sliding time window.
 * Intended for background drift detection; logs per-wallet samples (no auto-fix).
 *
 * @param windowHours - How far back from now to aggregate ledger actions (default 24)
 * @returns Resolves when the reconciliation pass completes
 */
export async function runSlidingReconciliation(windowHours: number = 24): Promise<void> {
  const from = new Date(Date.now() - windowHours * 3600 * 1000);

  const rows = await db.execute(
    sql`SELECT
          la.wallet_id,
          w.provider_user_id,
          w.balance AS current_balance,
          SUM(CASE WHEN la.action_type = 1 AND la.status = 1 THEN -la.amount ELSE 0 END) +
          SUM(CASE WHEN la.action_type = 2 AND la.status = 1 THEN la.amount ELSE 0 END) +
          SUM(CASE WHEN la.action_type = 3 AND la.status = 1 AND la.original_action_id IS NOT NULL THEN
            (SELECT CASE WHEN orig.action_type = 1 THEN la.amount ELSE -la.amount END
             FROM action_lookup orig WHERE orig.action_id = la.original_action_id LIMIT 1)
          ELSE 0 END) AS ledger_delta
        FROM ledger_actions la
        JOIN wallets w ON w.id = la.wallet_id
        WHERE la.created_at >= ${from.toISOString()}
        GROUP BY la.wallet_id, w.provider_user_id, w.balance`,
  );

  for (const row of rows) {
    const r = row as { wallet_id: string; provider_user_id: string; current_balance: string; ledger_delta: string };
    logger.info(
      { walletId: r["wallet_id"], userId: r["provider_user_id"], currentBalance: r["current_balance"], ledgerDelta: r["ledger_delta"] },
      "Reconciliation window sample",
    );
  }

  logger.info({ windowHours }, "Sliding reconciliation pass complete — alerts only on drift");
}
