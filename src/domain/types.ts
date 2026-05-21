declare const __brand: unique symbol;
type Brand<B> = { readonly [__brand]: B };

/** Wallet primary key from `wallets.id`. */
export type WalletId = bigint & Brand<"WalletId">;
/** Ledger row primary key from `ledger_actions.id`. */
export type LedgerId = bigint & Brand<"LedgerId">;
/** Monetary delta for a single action (smallest currency unit). */
export type Amount   = bigint & Brand<"Amount">;
/** Wallet balance in smallest currency units. */
export type Balance  = bigint & Brand<"Balance">;

/** Settlement transaction UUID stored in ledger and idempotency tables. */
export type TxId             = string & Brand<"TxId">;
/** Provider-supplied action UUID (global idempotency key). */
export type ActionId         = string & Brand<"ActionId">;
/** `action_id` of the bet or win being rolled back. */
export type OriginalActionId = string & Brand<"OriginalActionId">;
/** ISO-style currency code from API requests. */
export type CurrencyCode     = string & Brand<"CurrencyCode">;
/** Opaque provider user id (`user_id` on the wire). */
export type ProviderUserId   = string & Brand<"ProviderUserId">;

/** @param n - Raw bigint from SQL */
export const toWalletId         = (n: bigint): WalletId         => n as WalletId;
/** @param n - Raw bigint from SQL */
export const toLedgerId         = (n: bigint): LedgerId         => n as LedgerId;
/** @param n - Parsed action amount */
export const toAmount           = (n: bigint): Amount           => n as Amount;
/** @param n - Parsed wallet balance */
export const toBalance          = (n: bigint): Balance          => n as Balance;
/** @param s - UUID string from API or DB */
export const toTxId             = (s: string): TxId             => s as TxId;
/** @param s - UUID string from API or DB */
export const toActionId         = (s: string): ActionId         => s as ActionId;
/** @param s - UUID string for rollback target */
export const toOriginalActionId = (s: string): OriginalActionId => s as OriginalActionId;
/** @param s - Currency code from request */
export const toCurrencyCode     = (s: string): CurrencyCode     => s as CurrencyCode;
/** @param s - Provider `user_id` from request */
export const toProviderUserId   = (s: string): ProviderUserId   => s as ProviderUserId;

/** Wallet row used inside settlement transactions (locked via `FOR UPDATE`). */
export interface DomainWallet {
  id: WalletId;
  providerUserId: ProviderUserId;
  currency: CurrencyCode;
  balance: Balance;
  createdAt: Date;
  updatedAt: Date;
}

/** Wire and domain action kinds; persisted as smallint via {@link ACTION_TYPE_TO_DB}. */
export const ActionType = {
  BET:      "bet",
  WIN:      "win",
  ROLLBACK: "rollback",
} as const satisfies Record<string, string>;

export type ActionType = (typeof ActionType)[keyof typeof ActionType];

/** Lifecycle of an action in `action_lookup` / ledger; persisted as smallint via {@link LEDGER_STATUS_TO_DB}. */
export const LedgerStatus = {
  APPLIED:      "applied",
  ROLLED_BACK:  "rolled_back",
  PRE_ROLLBACK: "pre_rollback",
  NOOP:         "noop",
} as const satisfies Record<string, string>;

export type LedgerStatus = (typeof LedgerStatus)[keyof typeof LedgerStatus];

/** Maps domain {@link ActionType} strings to `ledger_actions.action_type` smallint values. */
export const ACTION_TYPE_TO_DB = {
  bet:      1,
  win:      2,
  rollback: 3,
} as const satisfies Record<ActionType, number>;

const ACTION_TYPE_FROM_DB: Record<number, ActionType | undefined> = {
  1: ActionType.BET,
  2: ActionType.WIN,
  3: ActionType.ROLLBACK,
};

/** Maps domain {@link LedgerStatus} strings to DB smallint values. */
export const LEDGER_STATUS_TO_DB = {
  applied:      1,
  rolled_back:  2,
  pre_rollback: 3,
  noop:         4,
} as const satisfies Record<LedgerStatus, number>;

const LEDGER_STATUS_FROM_DB: Record<number, LedgerStatus | undefined> = {
  1: LedgerStatus.APPLIED,
  2: LedgerStatus.ROLLED_BACK,
  3: LedgerStatus.PRE_ROLLBACK,
  4: LedgerStatus.NOOP,
};

/**
 * @param value - `action_type` smallint from SQL
 * @returns Domain {@link ActionType}
 * @throws {Error} When the DB value is unknown
 */
export function actionTypeFromDb(value: number): ActionType {
  const result = ACTION_TYPE_FROM_DB[value];
  if (result === undefined) throw new Error(`Unknown action_type from DB: ${value}`);
  return result;
}

/**
 * @param value - `status` smallint from SQL
 * @returns Domain {@link LedgerStatus}
 * @throws {Error} When the DB value is unknown
 */
export function ledgerStatusFromDb(value: number): LedgerStatus {
  const result = LEDGER_STATUS_FROM_DB[value];
  if (result === undefined) throw new Error(`Unknown ledger_status from DB: ${value}`);
  return result;
}
