import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { ledgerHashRowSchema, parseLedgerId, parseOptionalFirstRow } from "@/domain/sql-rows.js";
import { ACTION_TYPE_TO_DB, LEDGER_STATUS_TO_DB, type LedgerId } from "@/domain/types.js";
import type { ActionLookupInput, LedgerWriteInput } from "@/services/types.js";

/**
 * Appends one row to `ledger_actions` and chains `previous_hash` → `current_hash`
 * for that wallet.
 *
 * @param params - Ledger fields including open transaction, balances, and status
 * @returns Inserted `ledger_actions.id`
 */
export async function writeLedger(params: LedgerWriteInput): Promise<LedgerId> {
  const {
    tx,
    walletId,
    txId,
    actionId,
    game,
    gameId,
    actionType,
    amount,
    balanceBefore,
    balanceAfter,
    status,
    originalActionId,
  } = params;

  const prevRows = await tx.execute(
    sql`SELECT current_hash FROM ledger_actions WHERE wallet_id = ${walletId} ORDER BY created_at DESC, id DESC LIMIT 1`,
  );
  const prevRow = parseOptionalFirstRow(ledgerHashRowSchema, prevRows);
  const prevHashBuf: Buffer = prevRow?.current_hash ?? Buffer.alloc(32, 0);

  const payload = JSON.stringify({
    txId,
    actionId,
    actionType,
    amount: amount.toString(),
    balanceBefore: balanceBefore.toString(),
    balanceAfter: balanceAfter.toString(),
    status,
  });
  const currentHash = createHash("sha256").update(prevHashBuf).update(payload).digest();

  const origSql = originalActionId ? sql`${originalActionId}::uuid` : sql`NULL`;
  const prevHexLiteral = sql.raw(`'\\x${prevHashBuf.toString("hex")}'::bytea`);
  const curHexLiteral = sql.raw(`'\\x${currentHash.toString("hex")}'::bytea`);

  const actionTypeDb = ACTION_TYPE_TO_DB[actionType];
  const statusDb = LEDGER_STATUS_TO_DB[status];

  const result = await tx.execute(
    sql`INSERT INTO ledger_actions
        (wallet_id, tx_id, action_id, game, game_id, action_type, amount, balance_before, balance_after, status, original_action_id, previous_hash, current_hash)
        VALUES (
          ${walletId},
          ${txId}::uuid,
          ${actionId}::uuid,
          ${game ?? null},
          ${gameId ?? null},
          ${actionTypeDb}::smallint,
          ${amount},
          ${balanceBefore},
          ${balanceAfter},
          ${statusDb}::smallint,
          ${origSql},
          ${prevHexLiteral},
          ${curHexLiteral}
        )
        RETURNING id`,
  );

  return parseLedgerId(result);
}

/**
 * Inserts the global idempotency record for an `action_id` (first write wins).
 * Stores payload hash and `tx_id` used for safe retries and audit joins.
 *
 * @param params - Lookup row keyed by `actionId` with ledger link and payload hash
 * @returns Resolves when the insert completes or conflicts are ignored
 */
export async function upsertActionLookup(params: ActionLookupInput): Promise<void> {
  const { tx, actionId, walletId, ledgerId, txId, actionType, status, payloadHash } = params;
  const hashHex = sql.raw(`'\\x${payloadHash.toString("hex")}'::bytea`);
  const actionTypeDb = ACTION_TYPE_TO_DB[actionType];
  const statusDb = LEDGER_STATUS_TO_DB[status];

  await tx.execute(
    sql`INSERT INTO action_lookup (action_id, wallet_id, ledger_id, tx_id, action_type, status, payload_hash, partition_hint)
        VALUES (
          ${actionId}::uuid,
          ${walletId},
          ${ledgerId},
          ${txId}::uuid,
          ${actionTypeDb}::smallint,
          ${statusDb}::smallint,
          ${hashHex},
          now()::timestamptz
        )
        ON CONFLICT (action_id) DO NOTHING`,
  );
}
