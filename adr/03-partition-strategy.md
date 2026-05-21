# ADR 03 — Monthly Partition Strategy for ledger_actions

**Status:** Accepted

## Decision
Partition `ledger_actions` by `RANGE (created_at)` into monthly child tables.

## Reasoning
- Billions of rows over time; partition pruning makes time-bounded queries (reconciliation, audit) efficient.
- Old partitions can be archived/dropped without affecting live data.
- `action_lookup` remains unpartitioned (global PK required for idempotency uniqueness).

## Trade-off
- Partition maintenance (creating future months) is an operational task — documented in README.
- Cross-partition queries (e.g., audit spanning months) require querying parent table with time bounds.
