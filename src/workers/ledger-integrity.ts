import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "@/db/client.js";
import { logger } from "@/observability/logger.js";

/**
 * Verifies per-wallet ledger hash chaining for rows created after `fromDate`.
 * Logs errors when `previous_hash` or recomputed `current_hash` does not match.
 *
 * @param walletId - Wallet to scan
 * @param fromDate - Only rows with `created_at >= fromDate` are checked
 * @returns Resolves after logging OK or per-row chain break alerts
 */
export async function runLedgerIntegrityCheck(walletId: bigint, fromDate: Date): Promise<void> {
  const rows = await db.execute(
    sql`SELECT id, tx_id, action_id, amount, balance_before, balance_after, status, previous_hash, current_hash
        FROM ledger_actions
        WHERE wallet_id = ${walletId} AND created_at >= ${fromDate.toISOString()}
        ORDER BY created_at ASC, id ASC`,
  );

  let prevHash: Buffer = Buffer.alloc(32, 0);
  let alertCount = 0;

  for (const row of rows) {
    const r = row as {
      tx_id: string; action_id: string; action_type: number;
      amount: string; balance_before: string; balance_after: string; status: number;
      previous_hash: Buffer | null; current_hash: Buffer | null;
    };

    const storedPrev = r["previous_hash"] ?? Buffer.alloc(32, 0);
    if (!storedPrev.equals(prevHash)) {
      logger.error({ walletId, txId: r["tx_id"] }, "Ledger hash chain break: previous_hash mismatch");
      alertCount++;
    }

    const payload = JSON.stringify({
      txId: r["tx_id"], actionId: r["action_id"],
      amount: r["amount"], balanceBefore: r["balance_before"],
      balanceAfter: r["balance_after"], status: r["status"],
    });
    const expected = createHash("sha256").update(prevHash).update(payload).digest();
    const storedCurrent = r["current_hash"] ?? Buffer.alloc(0);
    if (!expected.equals(storedCurrent)) {
      logger.error({ walletId, txId: r["tx_id"] }, "Ledger hash chain break: current_hash mismatch");
      alertCount++;
    }

    prevHash = storedCurrent.length === 32 ? storedCurrent : prevHash;
  }

  if (alertCount === 0) {
    logger.info({ walletId }, "Ledger integrity OK");
  }
}
