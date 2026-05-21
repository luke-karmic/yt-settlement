# ADR 00 — Ledger vs Event Sourcing

**Status:** Accepted

## Decision
Use an append-only `ledger_actions` table (balance projection), not a full event-sourcing system.

## Reasoning
- `wallets.balance` is the single source of truth for play money — O(1) read for hot path.
- Ledger rows are for audit/reconciliation, not the primary balance driver.
- Full event sourcing would require replaying billions of rows to read balance — not viable at scale.

## Trade-off
- Replay-based reconciliation workers still exist for async integrity checks.
- Balance drift between `wallets.balance` and ledger replay would require manual intervention (never auto-corrected).
