# ADR 02 — Balance Projection in wallets.balance

**Status:** Accepted

## Decision
Store current balance as a running total in `wallets.balance` (BIGINT, smallest currency unit). Never store a second authoritative balance anywhere else.

## Reasoning
- O(1) read; no aggregation on hot path.
- Atomic `UPDATE wallets SET balance = balance - amount WHERE balance >= amount` prevents race conditions and negative balances in one SQL statement.
- BIGINT avoids float precision errors.

## Trade-off
- `wallets.balance` can drift from ledger sum if a bug skips ledger write — async reconciliation worker detects this without blocking bets.
