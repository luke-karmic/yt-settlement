import { sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { InsufficientFundsError } from "@/domain/errors.js";
import { parseWalletBalance } from "@/domain/sql-rows.js";
import { ActionType, LedgerStatus, toTxId } from "@/domain/types.js";
import { writeLedger, upsertActionLookup } from "@/services/ledger-writer.js";
import { updateRtpHourly } from "@/services/rtp-aggregator.js";
import type { AmountActionContext, ActionHandlerResult } from "@/services/actions/types.js";

/**
 * Debits the wallet atomically (balance check in SQL), writes ledger + idempotency row,
 * and increments RTP hourly bet totals.
 *
 * @param params - Transaction, wallet, action id, amount, payload hash, optional game fields
 * @returns Settlement `txId` and wallet balance after debit
 * @throws {InsufficientFundsError} When `balance < amount`
 */
export async function applyBet(params: AmountActionContext): Promise<ActionHandlerResult> {
  const { tx, wallet, actionId, amount, payloadHash, game, gameId } = params;

  const result = await tx.execute(
    sql`UPDATE wallets SET balance = balance - ${amount}, updated_at = now()
        WHERE id = ${wallet.id} AND balance >= ${amount}
        RETURNING balance`,
  );

  if (result.length === 0) {
    throw new InsufficientFundsError();
  }

  const balanceAfter = parseWalletBalance(result);
  const txId = toTxId(uuidv4());

  const ledgerId = await writeLedger({
    tx,
    walletId: wallet.id,
    txId,
    actionId,
    game,
    gameId,
    actionType: ActionType.BET,
    amount,
    balanceBefore: wallet.balance,
    balanceAfter,
    status: LedgerStatus.APPLIED,
  });

  await upsertActionLookup({
    tx,
    actionId,
    walletId: wallet.id,
    ledgerId,
    txId,
    actionType: ActionType.BET,
    status: LedgerStatus.APPLIED,
    payloadHash,
  });

  await updateRtpHourly({
    tx,
    walletId: wallet.id,
    currency: wallet.currency,
    actionType: ActionType.BET,
    amount,
    isRollback: false,
  });

  return { txId, newBalance: balanceAfter };
}
