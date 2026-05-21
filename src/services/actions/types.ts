import type { ActionId, OriginalActionId, Amount } from "@/domain/types.js";
import type { WalletContext, ActionApplyResult } from "@/services/types.js";

/** Shared context for bet, win, and rollback handlers (includes idempotency hash). */
export interface ActionExecutionContext extends WalletContext {
  actionId: ActionId;
  payloadHash: Buffer;
}

/** Context for bet and win handlers that debit or credit an amount. */
export interface AmountActionContext extends ActionExecutionContext {
  amount: Amount;
}

/** Context for rollback handlers targeting a prior `original_action_id`. */
export interface RollbackContext extends ActionExecutionContext {
  originalActionId: OriginalActionId;
}

/** Alias for the standard handler return type (`txId` + `newBalance`). */
export type ActionHandlerResult = ActionApplyResult;
