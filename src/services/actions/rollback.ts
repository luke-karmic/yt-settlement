import { sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { InsufficientFundsError, InvalidRollbackError } from "@/domain/errors.js";
import { parseOriginalActionRow, parseWalletBalance } from "@/domain/sql-rows.js";
import { ActionType, LedgerStatus, LEDGER_STATUS_TO_DB, toAmount, toTxId } from "@/domain/types.js";
import { writeLedger, upsertActionLookup } from "@/services/ledger-writer.js";
import { updateRtpHourly } from "@/services/rtp-aggregator.js";
import type { ActionHandlerResult, RollbackContext } from "@/services/actions/types.js";

/**
 * Reverses a prior bet or win, or records pre-rollback when the original action
 * has not arrived yet. Updates action_lookup status and RTP rollback counters.
 *
 * @param params - Rollback context including `originalActionId`
 * @returns Settlement `txId` and wallet balance after apply (unchanged for pre-rollback)
 * @throws {InvalidRollbackError} When rollback is not allowed
 * @throws {InsufficientFundsError} When reversing a win would over-debit the wallet
 */
export async function applyRollback(params: RollbackContext): Promise<ActionHandlerResult> {
  const { tx, wallet, actionId, originalActionId, payloadHash, game, gameId } = params;

  const originalRows = await tx.execute(
    sql`SELECT al.tx_id, al.action_type, al.status, al.wallet_id,
               la.amount, la.balance_before, la.balance_after
        FROM action_lookup al
        LEFT JOIN ledger_actions la ON la.action_id = al.action_id AND la.wallet_id = al.wallet_id
        WHERE al.action_id = ${originalActionId}::uuid`,
  );

  if (originalRows.length === 0) {
    return applyPreRollback(params);
  }

  const original = parseOriginalActionRow(originalRows);

  if (original.walletId !== wallet.id) {
    throw new InvalidRollbackError("Original action belongs to a different wallet");
  }

  if (original.status === LedgerStatus.ROLLED_BACK) {
    throw new InvalidRollbackError("Action already rolled back");
  }

  if (original.status === LedgerStatus.NOOP) {
    const txId = toTxId(uuidv4());
    const ledgerId = await writeLedger({
      tx,
      walletId: wallet.id,
      txId,
      actionId,
      game,
      gameId,
      actionType: ActionType.ROLLBACK,
      amount: original.amount,
      balanceBefore: wallet.balance,
      balanceAfter: wallet.balance,
      status: LedgerStatus.APPLIED,
      originalActionId,
    });
    await upsertActionLookup({
      tx,
      actionId,
      walletId: wallet.id,
      ledgerId,
      txId,
      actionType: ActionType.ROLLBACK,
      status: LedgerStatus.APPLIED,
      payloadHash,
    });
    return { txId, newBalance: wallet.balance };
  }

  const { amount, actionType: originalType } = original;
  let newBalance;

  if (originalType === ActionType.BET) {
    const result = await tx.execute(
      sql`UPDATE wallets SET balance = balance + ${amount}, updated_at = now()
          WHERE id = ${wallet.id} RETURNING balance`,
    );
    newBalance = parseWalletBalance(result);
  } else if (originalType === ActionType.WIN) {
    const result = await tx.execute(
      sql`UPDATE wallets SET balance = balance - ${amount}, updated_at = now()
          WHERE id = ${wallet.id} AND balance >= ${amount}
          RETURNING balance`,
    );
    if (result.length === 0) {
      throw new InsufficientFundsError();
    }
    newBalance = parseWalletBalance(result);
  } else {
    throw new InvalidRollbackError("Cannot rollback a rollback");
  }

  await tx.execute(
    sql`UPDATE action_lookup SET status = ${LEDGER_STATUS_TO_DB[LedgerStatus.ROLLED_BACK]} WHERE action_id = ${originalActionId}::uuid`,
  );

  const txId = toTxId(uuidv4());
  const ledgerId = await writeLedger({
    tx,
    walletId: wallet.id,
    txId,
    actionId,
    game,
    gameId,
    actionType: ActionType.ROLLBACK,
    amount,
    balanceBefore: wallet.balance,
    balanceAfter: newBalance,
    status: LedgerStatus.APPLIED,
    originalActionId,
  });

  await upsertActionLookup({
    tx,
    actionId,
    walletId: wallet.id,
    ledgerId,
    txId,
    actionType: ActionType.ROLLBACK,
    status: LedgerStatus.APPLIED,
    payloadHash,
  });

  await updateRtpHourly({
    tx,
    walletId: wallet.id,
    currency: wallet.currency,
    actionType: originalType,
    amount,
    isRollback: true,
  });

  return { txId, newBalance };
}

/**
 * @param params - Rollback context with `originalActionId` not yet seen in lookup
 * @returns Settlement `txId` and unchanged wallet balance
 */
async function applyPreRollback(params: RollbackContext): Promise<ActionHandlerResult> {
  const { tx, wallet, actionId, originalActionId, payloadHash, game, gameId } = params;

  await tx.execute(
    sql`INSERT INTO rollback_intents (original_action_id, rollback_action_id, wallet_id)
        VALUES (${originalActionId}::uuid, ${actionId}::uuid, ${wallet.id})
        ON CONFLICT (original_action_id) DO NOTHING`,
  );

  const txId = toTxId(uuidv4());
  const ledgerId = await writeLedger({
    tx,
    walletId: wallet.id,
    txId,
    actionId,
    game,
    gameId,
    actionType: ActionType.ROLLBACK,
    amount: toAmount(0n),
    balanceBefore: wallet.balance,
    balanceAfter: wallet.balance,
    status: LedgerStatus.PRE_ROLLBACK,
    originalActionId,
  });

  await upsertActionLookup({
    tx,
    actionId,
    walletId: wallet.id,
    ledgerId,
    txId,
    actionType: ActionType.ROLLBACK,
    status: LedgerStatus.PRE_ROLLBACK,
    payloadHash,
  });

  return { txId, newBalance: wallet.balance };
}
