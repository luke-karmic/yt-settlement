import type { DbTransaction } from "@/db/types.js";
import type {
  DomainWallet,
  WalletId,
  LedgerId,
  TxId,
  ActionId,
  OriginalActionId,
  ActionType,
  LedgerStatus,
  Amount,
  Balance,
  CurrencyCode,
} from "@/domain/types.js";

/** Optional game attribution copied from the process request onto ledger rows. */
export interface GameContext {
  game?: string | undefined;
  gameId?: string | undefined;
}

/** Open transaction plus locked wallet — base context for action handlers. */
export interface WalletContext extends GameContext {
  tx: DbTransaction;
  wallet: DomainWallet;
}

/** Outcome of applying one action: new settlement id and wallet balance. */
export interface ActionApplyResult {
  txId: TxId;
  newBalance: Balance;
}

/** Inputs for appending one `ledger_actions` row and hash chain link. */
export interface LedgerWriteInput extends GameContext {
  tx: DbTransaction;
  walletId: WalletId;
  txId: TxId;
  actionId: ActionId;
  actionType: ActionType;
  amount: Amount;
  balanceBefore: Balance;
  balanceAfter: Balance;
  status: LedgerStatus;
  originalActionId?: OriginalActionId | undefined;
}

/** Inputs for inserting the global `action_lookup` idempotency row. */
export interface ActionLookupInput {
  tx: DbTransaction;
  actionId: ActionId;
  walletId: WalletId;
  ledgerId: LedgerId;
  txId: TxId;
  actionType: ActionType;
  status: LedgerStatus;
  payloadHash: Buffer;
}

/** Inputs for upserting one `rtp_hourly` bucket inside a settlement transaction. */
export interface UpdateRtpHourlyInput {
  tx: DbTransaction;
  walletId: WalletId;
  currency: CurrencyCode;
  actionType: ActionType;
  amount: Amount;
  isRollback: boolean;
}
