# Implementation guide — full build (Claude / executor)

**Read first:** [docs/TRADE_OFFS.md](docs/TRADE_OFFS.md), [docs/MECHANISMS.md](docs/MECHANISMS.md), [PLAN.md](PLAN.md).

**Goal:** Working take-home settlement service: Docker, tests A–J, RTP runner, event simulator, k6, README.

**Rule:** Complete each step; run tests before next step. Use `yeet_test` for all vitest. Never store balance outside `wallets`.

---

## Environment variables

| Variable | Dev | Test | Load |
|----------|-----|------|------|
| `DATABASE_URL` | `postgres://yeet:yeet@localhost:6432/yeet_dev` | `...@localhost:5432/yeet_test` | `.../yeet_load` |
| `HMAC_SECRET` | `test` | `test` | `test` |
| `PORT` | `3000` | `3001` (test server) | `3000` |
| `NODE_ENV` | development | test | load |

---

## Repository structure (create all)

```
yeet/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── drizzle.config.ts
├── vitest.config.ts
├── eslint.config.js
├── .prettierrc
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── README.md
├── PLAN.md
├── IMPLEMENTATION.md
├── docs/
│   ├── TRADE_OFFS.md
│   └── MECHANISMS.md
├── adr/
│   ├── 00-ledger-vs-event-sourcing.md
│   ├── 01-postgres-write-db.md
│   ├── 02-balance-projection.md
│   ├── 03-partition-strategy.md
│   ├── 04-multi-currency-wallets.md
│   ├── 05-wallet-lifecycle.md
│   └── 06-hmac-provider-auth.md
├── src/
│   ├── server.ts
│   ├── app.ts
│   ├── config.ts
│   ├── plugins/raw-body.ts
│   ├── auth/hmac.ts
│   ├── routes/process.ts
│   ├── routes/rtp.ts
│   ├── routes/health.ts
│   ├── db/client.ts
│   ├── db/schema/index.ts
│   ├── db/schema/wallets.ts
│   ├── db/schema/action-lookup.ts
│   ├── db/schema/ledger-actions.ts
│   ├── db/schema/rollback-intents.ts
│   ├── db/schema/rtp-hourly.ts
│   ├── domain/errors.ts
│   ├── domain/types.ts
│   ├── schemas/process.ts
│   ├── schemas/rtp.ts
│   ├── services/transaction-processor.ts
│   ├── services/wallet-resolver.ts
│   ├── services/actions/bet.ts
│   ├── services/actions/win.ts
│   ├── services/actions/rollback.ts
│   ├── services/idempotency.ts
│   ├── services/payload-hash.ts
│   ├── services/rtp-aggregator.ts
│   ├── services/ledger-writer.ts
│   └── observability/logger.ts
├── drizzle/
│   └── (generated migrations)
├── tests/
│   ├── setup.ts
│   ├── helpers/hmac.ts
│   ├── helpers/db.ts
│   ├── unit/hmac.test.ts
│   ├── unit/payload-hash.test.ts
│   ├── integration/settlement.test.ts
│   └── acceptance/scenarios-a-j.test.ts
├── tools/
│   ├── seed.ts
│   ├── wallet-factory.ts
│   ├── event-simulator.ts
│   └── rtp-game-runner.ts
├── k6/
│   └── process-load.js
└── .github/workflows/ci.yml
```

---

## Step 0 — Scaffold

1. `package.json`: `packageManager: pnpm@9`, `engines.node >= 22`, scripts from PLAN.md.
2. Deps: `fastify`, `@fastify/raw-body` or custom raw body, `drizzle-orm`, `postgres`, `zod`, `pino`, `uuid`, `ulid`, dev: `typescript@6`, `tsx`, `vitest`, `drizzle-kit`, `fast-check`, `eslint`, `prettier`.
3. `tsconfig.json`: strict, ES2022, outDir dist.
4. `docker-compose.yml`: postgres:17, pgbouncer session mode, api service.
5. `GET /health` returns `{ status: "ok", db: "ok" }`.
6. `.env.example` with all URLs.

**Verify:** `pnpm install && pnpm bootstrap && pnpm dev`, then `curl localhost:3000/health`. Or `docker compose up -d --build` (API runs migrate + seed on start).

---

## Step 1 — Database schema + migrations

### Enums (smallint)

- `action_type`: BET=1, WIN=2, ROLLBACK=3
- `ledger_status`: APPLIED=1, ROLLED_BACK=2, PRE_ROLLBACK=3, NOOP=4

### Tables

Implement exactly as PLAN.md. Additional DDL notes:

**`ledger_actions`:** declarative partitioning by RANGE (`created_at`); create parent + template for monthly children (current month minimum).

**Indexes:**

- `action_lookup(action_id)` PK
- `ledger_actions(wallet_id, created_at)`
- `ledger_actions(original_action_id)` WHERE original_action_id IS NOT NULL
- `rollback_intents(original_action_id)` PK

Run `pnpm db:generate` && `pnpm db:migrate`.

Create databases in init script or document:

```sql
CREATE DATABASE yeet_dev;
CREATE DATABASE yeet_test;
CREATE DATABASE yeet_load;
```

**Verify:** `\dt` shows wallets, action_lookup, ledger_actions, etc.

---

## Step 2 — Seed + wallet factory

**`tools/wallet-factory.ts`:**

- `createPlayerId(): string` → `ulid()`
- `ensureWallet(db, providerUserId, currency, balance: bigint)`

**`tools/seed.ts`:**

- Acceptance: `8|USDT|USD`, `USD`, `74322001n`
- Optional: 1000 ULID wallets with random balance for load tools

**Verify:** `pnpm db:seed` → row exists.

---

## Step 3 — HMAC + Zod

**`src/plugins/raw-body.ts`:** attach `request.rawBody: Buffer`.

**`src/auth/hmac.ts`:**

- `verifyHmac(rawBody, authorizationHeader, secret): boolean`
- Parse `HMAC-SHA256 <hex>` prefix exactly.

**`src/schemas/process.ts`:** Zod for request/response per spec.

**Tests `tests/unit/hmac.test.ts`:**

1. Spec body §8 hex with secret `test` → pass
2. Invalid hex → fail
3. Tampered body → fail

**Verify:** `pnpm test:unit`.

---

## Step 4 — Wallet resolver + DB client

**`src/services/wallet-resolver.ts`:**

- `resolveWallet(tx, providerUserId, currency)` → wallet row `FOR UPDATE`

**`src/db/client.ts`:** drizzle + postgres.js pool from `DATABASE_URL`.

---

## Step 5 — Transaction processor (core)

**`src/services/transaction-processor.ts`:**

```typescript
export async function processRequest(body: ProcessRequest): Promise<ProcessResponse>
```

Flow per MECHANISMS.md:

1. Begin transaction.
2. `resolveWallet`.
3. If no `actions` or empty → return `{ balance }`.
4. For each action: `processAction(tx, wallet, action, meta)`.
5. Commit; return `{ balance, transactions, game_id }`.

**`processAction` order:**

1. `checkIdempotency` → replay or continue
2. If rollback → `handleRollback`
3. If bet → check `rollback_intents` for NOOP path
4. If win → same intent check for NOOP
5. Apply bet/win/rollback
6. `writeLedger`, `upsertActionLookup`, `updateRtpHourly`

**`src/domain/errors.ts`:**

- `InsufficientFundsError` → map to HTTP 4xx `{ code: 100, message: "Player has not enough funds to process an action" }`
- `IdempotencyConflictError` → 409
- `InvalidRollbackError` → 409

**Route `POST /aggregator/takehome/process`:**

- HMAC preHandler on route
- Call processor
- Map errors to status codes

**Verify:** manual curl with signed body (bet) after seed.

---

## Step 6 — Integration tests

**`tests/setup.ts`:** load `.env.test`, migrate, truncate before each test.

**`tests/integration/settlement.test.ts`:**

| # | Test |
|---|------|
| 1 | Balance-only returns seeded balance |
| 2 | Single bet −100 |
| 3 | Bet+win same request |
| 4 | Insufficient → 100, balance unchanged |
| 5 | Batch atomicity: ok bet + fail bet → no change |
| 6 | Duplicate action_id → same tx_id, one debit |
| 7 | Same action_id different amount → 409 |
| 8 | Bet + rollback restores |
| 9 | Pre-rollback then bet NOOP |
| 10 | Lazy wallet create on new ULID |

**Verify:** `DATABASE_URL=...yeet_test pnpm test:integration`.

---

## Step 7 — Rollbacks + idempotency hardening

Complete J scenario logic in rollback handler. Ensure:

- `rollback_intents` insert on early rollback
- Original bet/win checks intent → NOOP
- RTP not incremented on NOOP

Re-run integration tests; add case for **J** if not covered.

---

## Step 8 — RTP endpoints

**`GET /aggregator/takehome/rtp/users?from=&to=&page=&limit=`**

- HMAC required (sign query string convention: document whether GET body empty and sign `""` or canonical query — **use empty body** and sign empty buffer if no body, or require POST for reports; **simplest: HMAC sign empty string for GET** — document in README)

**Clarification for implementer:** Take-home says all calls signed. For GET with no body, use `HMAC_SHA256(secret, "")` or sign canonical `from|to|page`. **Pick:** sign UTF-8 of sorted query string `from=...&to=...` and document in README.

**`GET /aggregator/takehome/rtp/casino`:** aggregate sums.

**Integration test:** after bet+win, report matches expected rtp.

---

## Step 9 — Acceptance tests A–J

**`tests/acceptance/scenarios-a-j.test.ts`:**

- Start API against `yeet_test` or use `app.inject()`.
- `tests/helpers/hmac.ts` → `sign(body: string)`.
- Copy request bodies from take-home spec verbatim.
- Assert status, `code`, `balance` deltas relative to seeded 74322001 (track running balance per scenario file).

**Must include:** A, B, C, D, E, F, G, H, I, J.

**Verify:** `pnpm test:acceptance`.

---

## Step 10 — Event simulator

**`tools/event-simulator.ts`:**

- CLI: `--users 100 --rounds 50 --seed 42`
- `ensureWallet` each user with balance
- Random bet/win/rollback mix
- Duplicates + pre-rollback cases
- Print error rate summary

**Verify:** `pnpm simulate:events` exits 0.

---

## Step 11 — RTP game runner

**`tools/rtp-game-runner.ts`:**

- N users, M rounds, win distribution → ~95% RTP (e.g. 55% loss, 30% 2x, 15% 5x)
- Record `from`/`to` window
- Call casino RTP endpoint
- Assert `|rtp - 0.95| < 0.01` for large M (document tolerance in README)

**Verify:** `pnpm simulate:rtp`.

---

## Step 12 — k6

**`k6/process-load.js`:**

- `setup()`: create DB wallets or call seed endpoint
- Profiles: `smoke` (default, VU ramp + sleep) and `burst` (`K6_PROFILE=burst`, 250 iters/s, 500+ wallets, no sleep)
- Thresholds: p95 < 500ms initially

**Verify:** `pnpm load:k6` (smoke), `K6_WALLETS=500 pnpm db:seed && pnpm load:k6:burst` (capacity signal).

---

## Step 13 — Workers (Phase 2 light)

**`src/workers/ledger-integrity.ts`:** scan recent partition, verify hashes, log alert.

**`src/workers/sliding-reconciliation.ts`:** replay 1h window vs wallets.balance.

Docker profile `ops` optional.

---

## Step 14 — Property test (optional stand-out)

**`tests/properties/ledger-balance.test.ts`:**

- fast-check: random action sequences
- Property: replay APPLIED/ROLLED_BACK/NOOP ledger == `wallets.balance`

---

## Step 15 — ADRs + README

Copy bullets from TRADE_OFFS into short ADRs.

**README must include:**

- `docker compose up`, migrate, seed, test commands
- HMAC how-to (raw body)
- Wallet model (`user_id` → `provider_user_id`)
- Test DB isolation
- RTP tolerance
- Scale section (partitions, rtp_hourly, billions)
- GET HMAC signing rule

---

## Step 16 — CI

**.github/workflows/ci.yml:**

```yaml
- docker compose up -d --wait
- pnpm install
- pnpm db:migrate (against test)
- pnpm db:seed
- pnpm test:unit
- pnpm test:integration
- pnpm test:acceptance
```

---

## HMAC test vectors (implement in unit test)

| Body | Secret | Expected hex (from spec) |
|------|--------|--------------------------|
| `{"user_id": "8\|USDT\|USD","currency": "USD","game": "acceptance:test"}` | test | `442c4cd8926008096225416b21f5a1862fbf4fc4e5224362e3b463e85a39f40a` (§8) |

Also test §3 vector if different spacing.

---

## Acceptance balance tracking

Seed: **74322001**.

Scenarios build on each other in spec order — **use separate game_ids / fresh action_ids** per scenario or reset DB between scenarios. **Recommended:** `beforeEach` truncate + re-seed for acceptance file to avoid cross-scenario drift.

---

## Phase 1 done checklist

- [ ] Docker up, health ok
- [ ] Migrations + wallets table + partitions
- [ ] `pnpm test:unit` green
- [ ] `pnpm test:integration` green on yeet_test
- [ ] `pnpm test:acceptance` A–J green
- [ ] `pnpm simulate:events` ok
- [ ] `pnpm simulate:rtp` within tolerance
- [ ] README complete
- [ ] adr/00–06 present

---

## Executor instructions (Claude)

1. Do not skip tests for a step.
2. Do not use float for money.
3. Do not re-serialize JSON for HMAC.
4. One transaction per process request.
5. Use `wallets` not `users`.
6. Refer to MECHANISMS.md when unsure on edge cases.
7. Commit logically per step if user requests commits.

**Start command:** Step 0 scaffold, then proceed sequentially through Step 16.
