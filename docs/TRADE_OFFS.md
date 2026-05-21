# Trade-off decisions — Yeet settlement engine

Decisions for the take-home and production-shaped implementation. When in doubt: **correctness over performance**, **boring infra over novelty**.

---

## 1. Settlement vs wallet / custody

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Scope | Bet/win/rollback settlement only | Deposits, Dynamic, Arbitrum in this repo | Take-home boundary; funding is a separate layer |
| Playable balance SOtR | `wallets.balance` in Postgres only | Duplicate balance in API/game DB | One write path; no sync drift |
| Table naming | `wallets` | `users` | Rows are per-currency wallets, not human accounts |

---

## 2. Identity and API `user_id`

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| API field | Keep `user_id` per spec | Rename to `player_id` in HTTP | Spec compliance |
| Storage | `provider_user_id` opaque VARCHAR | Parse `8\|USDT\|USD` pipes | Spec example is fixture only; product uses ULID |
| Wallet key | `(provider_user_id, currency)` UNIQUE | JSON map of balances on one row | Atomic SQL, per-currency locking, clear RTP |
| Per-game balance | Single wallet per player+currency | Balance per `game` | Product: all games share one bankroll |
| Multi-provider | Optional `provider_id` later | Single namespace only | Take-home has one integrator; document extension |

---

## 3. Auth

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| `process` auth | HMAC-SHA256 on **raw body** | JWT on same endpoint | Caller is game backend, not player; body-bound integrity |
| Compare | `crypto.timingSafeEqual` | `===` on hex | Timing safety |
| Secrets | One `HMAC_SECRET` per env (take-home: `test`) | Per-game secrets in v1 | Simpler; document per-provider later |
| Player auth | Out of scope | JWT for bets | Games use HMAC server-to-server |

---

## 4. Data store and money representation

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Database | PostgreSQL 17 | SQLite, Mongo | Transactions, row locks, partitions, take-home preference |
| Amounts | BIGINT smallest unit | float / decimal | Exact money |
| Balance read | `wallets.balance` O(1) | Replay ledger on read | Latency at scale |
| Ledger | Append-only `ledger_actions` | UPDATE ledger rows | Audit; hash chain |
| ORM | Drizzle + raw SQL hot path | Full raw only | Migrations + typed schema; SQL where needed |

---

## 5. Idempotency

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Key | `action_id` (UUID) per action | Whole-request `Idempotency-Key` only | Spec-defined |
| Gate table | Global `action_lookup` PK | Unique on partitioned ledger only | Partitions can't enforce global uniqueness cleanly |
| Payload | `payload_hash` BYTEA; mismatch → 409 | Key-only idempotency | Prevent same id, different amount |
| Replay response | Original `tx_id`; no balance change | Re-execute side effects | Spec + safe retries |
| Response `balance` | Current after full batch | Cached balance from first call | Scenario H: new bet changes total |

---

## 6. Transactions and concurrency

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Request scope | One DB transaction per HTTP request | Per-action transactions | Atomic batch; code 100 rolls back all |
| Bet debit | `UPDATE … WHERE balance >= amount RETURNING` | SELECT then UPDATE in app | Race-safe under concurrency |
| Hot user | Serialize on one `wallets` row | Redis lock + cache | Correctness; simpler |
| PgBouncer | `pool_mode = session` for writers | Transaction pooling | Multi-statement transactions work |
| Money path queue | None | Kafka for bets | Spec mindset; sync correctness |

---

## 7. Rollbacks

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Pre-rollback | `rollback_intents` + original → NOOP | Reject rollback if missing original | Spec |
| Second rollback same original | 409 | Silent noop | Prevent double reversal |
| Rollback NOOP original | Rollback row APPLIED, no balance change | Reject | Audit trail |
| Cross-wallet rollback | 409 if `original_action_id` not same wallet | Allow | Safety |

---

## 8. RTP and reporting

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Write path | Upsert `rtp_hourly` in same txn as settlement | Scan ledger at report time | Billions of rows |
| Rolled-back amounts | Exclude from `total_bet`/`total_win`; `rollback_*` columns | Net in place | Spec §2.2 |
| `rtp` when `total_bet = 0` | `null` | `0` | Document in README |
| Casino RTP | Per-currency or documented; never sum USD+EUR | Single blended RTP | Meaningless math |

---

## 9. Scale (billions of rows)

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Growth table | Partition `ledger_actions` by month | Single heap forever | Pruning, maintenance |
| Idempotency at scale | `action_lookup` grows with unique actions | Drop old keys in v1 | Honest; document archival later |
| Reconciliation | Sliding window + `balance_snapshots`; alert only | Full 5B replay inline | Impossible at scale |
| Hash validation | Async worker; never block bet txn | Inline chain verify | Latency |
| Proof of 5B | Schema + ADR + README | Load 5B rows in CI | Not required |

---

## 10. Testing and environments

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Test DB | `yeet_test` Postgres (truncate between tests) | Same as dev DB | No pollution |
| Load DB | `yeet_load` or tmpfs compose | k6 against dev | Isolation |
| Unit tests | HMAC + hash only; no DB | SQLite for integration | Fidelity |
| Integration | ~10–12 cases Postgres | 200 micro-tests | Lean, high signal |
| Acceptance | HTTP A–J (K not in spec body) | Duplicate all integration | Spec compliance |
| Property tests | Phase 2: replay == balance | Block Phase 1 | Optional stand-out |
| k6 | After acceptance | Day 1 | Correctness first |

---

## 11. Tooling and ops

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Package manager | pnpm 9+ | npm/yarn | 2026 standard, fast |
| TypeScript | 6.x strict | 5.x | Current toolchain |
| Workers auto-repair | Never on money drift | Auto-fix balance | Financial safety |
| CQRS / Kafka / Redis cache | Out of scope | Included | Spec constraints / focus |

---

## 12. Wallet creation

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Take-home | Seed + lazy upsert on `process` | Deposit API in scope | Spec |
| Production | Deposit credits settlement first | Game creates balance | Single SOtR |
| Simulators/k6 | `ensureWallet()` before traffic | Assume seeded | Avoid spurious code 100 |

---

## Summary one-liner

**Postgres wallets + global action_lookup + partitioned ledger + hourly RTP aggregates + HMAC raw body + single txn per request — no second balance, no FX, no async money path.**
