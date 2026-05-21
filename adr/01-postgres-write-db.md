# ADR 01 — PostgreSQL as Write Database

**Status:** Accepted

## Decision
Use PostgreSQL 17 (via PgBouncer session pool) as the only data store for settlement.

## Reasoning
- ACID transactions guarantee atomicity across wallet + ledger + idempotency in a single `BEGIN/COMMIT`.
- Row-level locks (`FOR UPDATE` on wallet rows) handle concurrent bet requests without application-level locking.
- Partitioning (`ledger_actions` by month) and indexes handle billions of rows.
- No Redis/Kafka on the money path — sync correctness over async throughput.

## Trade-off
- Hot wallets (high-frequency same user) serialize on a single row lock — accepted, expected behavior.
- Horizontal write scaling requires Citus/sharding — documented as future work.
