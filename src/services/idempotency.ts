import { sql } from "drizzle-orm";
import { IdempotencyConflictError } from "@/domain/errors.js";
import { actionLookupRowSchema, parseFirstRow, parsePayloadHash } from "@/domain/sql-rows.js";
import type { ActionId, TxId } from "@/domain/types.js";
import { toTxId } from "@/domain/types.js";
import type { DbTransaction } from "@/db/types.js";

/**
 * Result of looking up a global `action_id` before applying settlement.
 * - `{ kind: "miss" }` — not seen before; apply the action.
 * - `{ kind: "replay", txId }` — safe retry; reuse `txId`, skip apply.
 */
export type IdempotencyCheck =
  | { readonly kind: "miss" }
  | { readonly kind: "replay"; readonly txId: TxId };

/**
 * Enforces exactly-once semantics per `action_id` inside the current DB transaction.
 *
 * @param tx - Open Drizzle/Postgres transaction for the process request
 * @param actionId - Provider-supplied UUID for this action (global primary key)
 * @param payloadHash - `computePayloadHash(action)` for semantic equality checks
 * @returns `miss` or `replay` with the stored settlement `tx_id`
 * @throws {IdempotencyConflictError} When `action_id` exists with a different payload hash
 */
export async function checkIdempotency(
  tx: DbTransaction,
  actionId: ActionId,
  payloadHash: Buffer,
): Promise<IdempotencyCheck> {
  const rows = await tx.execute(
    sql`SELECT tx_id, payload_hash FROM action_lookup WHERE action_id = ${actionId}`,
  );

  if (rows.length === 0) {
    return { kind: "miss" };
  }

  const row = parseFirstRow(actionLookupRowSchema, rows);
  const storedBuf = parsePayloadHash(row.payload_hash);

  if (!storedBuf.equals(payloadHash)) {
    throw new IdempotencyConflictError(actionId);
  }

  return { kind: "replay", txId: toTxId(row.tx_id) };
}
