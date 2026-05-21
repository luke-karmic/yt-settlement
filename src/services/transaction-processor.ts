import { sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db/client.js";
import type { DbTransaction } from "@/db/types.js";
import { parseOptionalFirstRow, rollbackIntentExistsRowSchema } from "@/domain/sql-rows.js";
import {
  ActionType,
  LedgerStatus,
  toActionId,
  toAmount,
  toCurrencyCode,
  toOriginalActionId,
  toProviderUserId,
  toTxId,
  type ActionId,
  type Amount,
  type DomainWallet,
} from "@/domain/types.js";
import type { Action } from "@/schemas/actions.js";
import { isBetAction, isRollbackAction, isWinAction } from "@/schemas/actions.js";
import type { ProcessRequest, ProcessResponse, Transaction } from "@/schemas/process.js";
import { applyBet } from "@/services/actions/bet.js";
import { applyRollback } from "@/services/actions/rollback.js";
import { applyWin } from "@/services/actions/win.js";
import { checkIdempotency } from "@/services/idempotency.js";
import { writeLedger, upsertActionLookup } from "@/services/ledger-writer.js";
import { computePayloadHash } from "@/services/payload-hash.js";
import type { ActionApplyResult, GameContext } from "@/services/types.js";
import { getWalletBalance, resolveWallet } from "@/services/wallet-resolver.js";

/**
 * Runs one settlement request in a single Postgres transaction: resolve wallet,
 * optionally apply each action (with per-action idempotency), return balances and tx ids.
 * HMAC is verified on the HTTP layer before this function is called.
 *
 * @param body - Validated process request (`user_id`, `currency`, optional `actions`)
 * @returns Current balance and per-action `tx_id` values (balance-only if no actions)
 */
export async function processRequest(body: ProcessRequest): Promise<ProcessResponse> {
  return db.transaction(async (tx) => {
    let wallet = await resolveWallet(
      tx,
      toProviderUserId(body.user_id),
      toCurrencyCode(body.currency),
    );

    const actions = body.actions ?? [];

    if (actions.length === 0) {
      return { balance: Number(wallet.balance) };
    }

    const transactions: Transaction[] = [];
    const gameContext: GameContext = { game: body.game, gameId: body.game_id };

    for (const action of actions) {
      const actionId = toActionId(action.action_id);
      const payloadHash = computePayloadHash(action);
      const idempotency = await checkIdempotency(tx, actionId, payloadHash);

      if (idempotency.kind === "replay") {
        transactions.push({ action_id: actionId, tx_id: idempotency.txId });
        continue;
      }

      wallet = { ...wallet, balance: await getWalletBalance(tx, wallet.id) };

      const { txId, newBalance } = await dispatchAction(tx, wallet, action, payloadHash, gameContext);

      wallet = { ...wallet, balance: newBalance };
      transactions.push({ action_id: actionId, tx_id: txId });
    }

    const finalBalance = await getWalletBalance(tx, wallet.id);

    return {
      game_id: body.game_id,
      transactions,
      balance: Number(finalBalance),
    };
  });
}

/**
 * Routes a validated action to bet, win, rollback, or NOOP when pre-rolled back.
 *
 * @param tx - Open DB transaction
 * @param wallet - Locked wallet row for this request
 * @param action - Single discriminated action from the request batch
 * @param payloadHash - Idempotency fingerprint for this action
 * @param gameContext - Optional game attribution from the request
 * @returns New settlement `tx_id` and wallet balance after this action
 */
async function dispatchAction(
  tx: DbTransaction,
  wallet: DomainWallet,
  action: Action,
  payloadHash: Buffer,
  gameContext: GameContext,
): Promise<ActionApplyResult> {
  const { game, gameId } = gameContext;

  if (isBetAction(action)) {
    if (await hasRollbackIntent(tx, toActionId(action.action_id))) {
      return applyNoop(
        tx,
        wallet,
        toActionId(action.action_id),
        toAmount(BigInt(action.amount)),
        payloadHash,
        gameContext,
        ActionType.BET,
      );
    }
    return applyBet({
      tx,
      wallet,
      actionId: toActionId(action.action_id),
      amount: toAmount(BigInt(action.amount)),
      payloadHash,
      game,
      gameId,
    });
  }

  if (isWinAction(action)) {
    if (await hasRollbackIntent(tx, toActionId(action.action_id))) {
      return applyNoop(
        tx,
        wallet,
        toActionId(action.action_id),
        toAmount(BigInt(action.amount)),
        payloadHash,
        gameContext,
        ActionType.WIN,
      );
    }
    return applyWin({
      tx,
      wallet,
      actionId: toActionId(action.action_id),
      amount: toAmount(BigInt(action.amount)),
      payloadHash,
      game,
      gameId,
    });
  }

  if (isRollbackAction(action)) {
    return applyRollback({
      tx,
      wallet,
      actionId: toActionId(action.action_id),
      originalActionId: toOriginalActionId(action.original_action_id),
      payloadHash,
      game,
      gameId,
    });
  }

  const _exhaustive: never = action;
  throw new Error(`Unhandled action: ${(_exhaustive as Action).action}`);
}

/**
 * @param tx - Open DB transaction
 * @param originalActionId - `action_id` of the bet/win that may be pre-rolled back
 * @returns `true` if `rollback_intents` contains a row for that original action
 */
async function hasRollbackIntent(tx: DbTransaction, originalActionId: ActionId): Promise<boolean> {
  const rows = await tx.execute(
    sql`SELECT rollback_action_id FROM rollback_intents WHERE original_action_id = ${originalActionId}::uuid`,
  );
  return parseOptionalFirstRow(rollbackIntentExistsRowSchema, rows) !== undefined;
}

/**
 * Records a NOOP ledger row and action_lookup entry without changing wallet balance.
 * Used when a bet/win is received after its original was pre-rolled back.
 *
 * @param tx - Open DB transaction
 * @param wallet - Locked wallet (balance unchanged)
 * @param actionId - Provider action UUID
 * @param amount - Declared action amount (audit only for NOOP)
 * @param payloadHash - Idempotency fingerprint
 * @param gameContext - Optional game attribution
 * @param actionType - `ActionType.BET` or `ActionType.WIN`
 * @returns Settlement `tx_id` and unchanged `newBalance`
 */
async function applyNoop(
  tx: DbTransaction,
  wallet: DomainWallet,
  actionId: ActionId,
  amount: Amount,
  payloadHash: Buffer,
  gameContext: GameContext,
  actionType: ActionType,
): Promise<ActionApplyResult> {
  const { game, gameId } = gameContext;
  const txId = toTxId(uuidv4());

  const ledgerId = await writeLedger({
    tx,
    walletId: wallet.id,
    txId,
    actionId,
    game,
    gameId,
    actionType,
    amount,
    balanceBefore: wallet.balance,
    balanceAfter: wallet.balance,
    status: LedgerStatus.NOOP,
  });

  await upsertActionLookup({
    tx,
    actionId,
    walletId: wallet.id,
    ledgerId,
    txId,
    actionType,
    status: LedgerStatus.NOOP,
    payloadHash,
  });

  return { txId, newBalance: wallet.balance };
}
