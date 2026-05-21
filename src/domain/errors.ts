/** HTTP 422 — wallet balance too low for a bet or win reversal. */
export class InsufficientFundsError extends Error {
  readonly code = 100;
  constructor() {
    super("Player has not enough funds to process an action");
    this.name = "InsufficientFundsError";
  }
}

/** HTTP 409 — same `action_id` reused with a different canonical payload hash. */
export class IdempotencyConflictError extends Error {
  /**
   * @param actionId - Conflicting global action UUID
   */
  constructor(actionId: string) {
    super(`Action ${actionId} already exists with different payload`);
    this.name = "IdempotencyConflictError";
  }
}

/** HTTP 409 — rollback preconditions failed (wrong wallet, already rolled back, etc.). */
export class InvalidRollbackError extends Error {
  /**
   * @param message - Human-readable rejection reason
   */
  constructor(message: string) {
    super(message);
    this.name = "InvalidRollbackError";
  }
}

/** HTTP 403 — missing or invalid `Authorization: HMAC-SHA256` header. */
export class HmacAuthError extends Error {
  constructor() {
    super("Invalid or missing HMAC signature");
    this.name = "HmacAuthError";
  }
}
