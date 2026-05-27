# Yeet Settlement Engine

Production-style bet processor: HMAC auth, atomic bet/win/rollback, idempotency, pre-rollback, RTP reporting.

## Quick Start

```bash
pnpm install
pnpm bootstrap          # postgres + migrate + seed (writes k6/wallets.json)
pnpm dev                # → http://localhost:3000/health
```

Or step by step:

```bash
docker compose up -d postgres
pnpm install
DATABASE_URL=postgres://yeet:yeet@localhost:5433/yeet_dev pnpm db:migrate
DATABASE_URL=postgres://yeet:yeet@localhost:5433/yeet_dev pnpm db:seed
pnpm dev
```

**API in Docker** (migrate + seed on container start):

```bash
docker compose up -d --build
curl http://localhost:3000/health
```

## API

All routes require `Authorization: HMAC-SHA256 <hex>` (see Auth section below).

### `POST /aggregator/takehome/process`

Balance lookup or bet/win/rollback actions.

**Balance only:**
```json
{ "user_id": "8|USDT|USD", "currency": "USD", "game": "acceptance:test" }
```
Response: `{ "balance": 74322001 }`

**With actions:**
```json
{
  "user_id": "8|USDT|USD",
  "currency": "USD",
  "game": "acceptance:test",
  "game_id": "uuid",
  "finished": true,
  "actions": [
    { "action": "bet", "action_id": "uuid", "amount": 100 },
    { "action": "win", "action_id": "uuid", "amount": 250 },
    { "action": "rollback", "action_id": "uuid", "original_action_id": "uuid" }
  ]
}
```
Response:
```json
{ "game_id": "...", "transactions": [{ "action_id": "...", "tx_id": "..." }], "balance": 74322151 }
```

**Insufficient funds (HTTP 422):**
```json
{ "code": 100, "message": "Player has not enough funds to process an action" }
```

### `GET /aggregator/takehome/rtp/users?from=&to=&page=&limit=`

Per-user RTP report. Returns paginated list:
```json
{
  "data": [{ "user_id": "...", "currency": "USD", "rounds": 100, "total_bet": 100000, "total_win": 95000, "rollback_bet": 0, "rollback_win": 0, "rtp": 95.0 }],
  "pagination": { "page": 1, "limit": 20, "total": 500 }
}
```
`rtp` is `null` when `total_bet = 0`.

### `GET /aggregator/takehome/rtp/casino?from=&to=`

Casino-wide RTP aggregated per currency.

### `GET /health`

No auth. Returns `{ "status": "ok", "db": "ok" }`.

## Auth (HMAC-SHA256)

```
Authorization: HMAC-SHA256 <hex>
signature = hex(HMAC_SHA256(secret, raw_request_body_bytes))
```

**Critical:** Sign the **raw bytes as received** — never re-serialize JSON. Body spacing/key order must be preserved.

**POST requests:**
```bash
BODY='{"user_id":"8|USDT|USD","currency":"USD","game":"acceptance:test"}'
SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "test" | awk '{print $2}')
curl -X POST http://localhost:3000/aggregator/takehome/process \
  -H "Content-Type: application/json" \
  -H "Authorization: HMAC-SHA256 $SIG" \
  -d "$BODY"
```

**GET requests:** Sign an empty string `""`:
```bash
SIG=$(echo -n "" | openssl dgst -sha256 -hmac "test" | awk '{print $2}')
curl "http://localhost:3000/aggregator/takehome/rtp/casino?from=2024-01-01T00:00:00Z&to=2025-01-01T00:00:00Z" \
  -H "Authorization: HMAC-SHA256 $SIG"
```

**Spec test vectors:**
```
secret: test
body:   {"user_id":"8|USDT|USD","currency":"USD","game":"acceptance:test"}
sig:    442c4cd8926008096225416b21f5a1862fbf4fc4e5224362e3b463e85a39f40a

body:   {"user_id": "8|USDT|USD","currency": "USD","game": "acceptance:test"}
sig:    7376e78d5f65ca750c9719d2163daffa129e8a07ba9a1abe12241b3b1de51295
```

## Wallet Model

| Concept | Details |
|---------|---------|
| Table | `wallets` (not `users`) |
| API field | `user_id` in request body |
| DB column | `provider_user_id` (opaque string) |
| Key | `UNIQUE(provider_user_id, currency)` |
| Balance | BIGINT, smallest currency unit |
| Per-game balance | Not supported — all games share one `(user_id, currency)` wallet |

The acceptance fixture uses `"8|USDT|USD"` as user_id (opaque string, pipes have no meaning).
Production simulators use ULID values.

## Running Tests

```bash
# Start Postgres first
docker compose up -d postgres

# Unit tests (no DB needed)
pnpm test:unit

# Integration tests (yeet_test DB)
DATABASE_URL=postgres://yeet:yeet@localhost:5433/yeet_test pnpm db:migrate
pnpm test:integration

# Acceptance tests A–J
pnpm test:acceptance

# All
pnpm test:all
```

## Test DB Isolation

- All Vitest tests use `DATABASE_URL` pointing to `yeet_test`.
- `.env.test` configures this automatically.
- Each test runs `TRUNCATE ... CASCADE` + re-seed before each case.
- k6 uses `yeet_load` DB (separate).
- `yeet_dev` is never touched by tests.

## Event Simulator

```bash
# Start API first: pnpm dev
pnpm simulate:events
```

Typed integrator simulator: bet+win batches, idempotent replay, pre-rollback. Uses pino-pretty in development.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgres://yeet:yeet@localhost:5433/yeet_dev` | Wallet seeding |
| `API_URL` | `http://localhost:3000` | Settlement API |
| `HMAC_SECRET` | `test` | Request signing |
| `USERS` | `20` | Simulated players |
| `ROUNDS` | `10` | Rounds per player |
| `INITIAL_BALANCE` | `1000000` | Starting balance (smallest units) |
| `LOG_LEVEL` | `info` | Pino level |
| `LOG_PRETTY` | on in `development` | Pretty-print logs |

## RTP Game Runner

```bash
DATABASE_URL=postgres://yeet:yeet@localhost:5433/yeet_dev \
  USERS=50 ROUNDS=200 pnpm simulate:rtp
```

Win distribution: 50% loss, 45% win×1.45, 5% jackpot×6  
Expected RTP: ≈ 95.25% — verified against casino RTP endpoint.  
Tolerance: ±2% (at 10,000 rounds; ±1% at 100,000+ rounds).

## Balance reconciliation (ledger replay)

Replays every `ledger_actions` row for a wallet in order (`balance_before` → `balance_after` chain) and compares the final balance to `wallets.balance`.

```bash
# All wallets
pnpm reconcile

# One wallet
pnpm reconcile -- --user-id "8|USDT|USD" --currency USD
pnpm reconcile -- --wallet-id 1

# JSON + non-zero exit on drift/chain break (default)
pnpm reconcile -- --json

# Report only (always exit 0)
pnpm reconcile -- --no-strict
```

Output includes row counts, per-action-type/status counts, `sum_delta`, `expected_balance`, `wallet_balance`, and `drift`.

**Negative test:** corrupt a wallet without touching the ledger, then re-run:

```sql
UPDATE wallets SET balance = balance + 500 WHERE provider_user_id = '8|USDT|USD';
```

## k6 Load Test

HMAC-signed `process` traffic: balance-only lookups and atomic bet+win batches. Two profiles in `k6/process-load.js`:

| Profile | Command | Purpose |
|---------|---------|---------|
| **smoke** (default) | `pnpm load:k6` | Low VUs + `sleep(0.1)` — quick regression on laptop/CI |
| **burst** | `pnpm load:k6:burst` | **250 req/s** open-model arrival rate — capacity / pool-sizing signal |

```bash
# Postgres + API (local dev or full compose)
docker compose up -d postgres
DATABASE_URL=postgres://yeet:yeet@localhost:5433/yeet_dev pnpm db:migrate

# Smoke: ~21 wallets (default K6_WALLETS=20 + acceptance wallet)
DATABASE_URL=postgres://yeet:yeet@localhost:5433/yeet_dev pnpm db:seed
pnpm dev   # or: docker compose up -d

# Burst: spread load across many wallets (avoids fake hot-wallet contention)
K6_WALLETS=500 DATABASE_URL=postgres://yeet:yeet@localhost:5433/yeet_dev pnpm db:seed

# k6 (install https://k6.io or use Docker)
pnpm load:k6              # smoke
pnpm load:k6:burst        # burst @ 250 iters/s for 3m (no sleep between iterations)

# Docker if k6 is not installed locally:
pnpm load:k6:docker
API_URL=http://host.docker.internal:3001 pnpm load:k6:burst:docker
```

`setup()` checks `/health`, probes balance on a seeded wallet, and fails fast if `k6/wallets.json` is missing. Burst requires at least **100** wallets (default check); use **500+** for realistic spread.

Thresholds (both profiles): p95 < 500 ms, error rate < 5%.

Environment overrides: `K6_BURST_RPS`, `K6_BURST_DURATION`, `K6_BURST_MIN_WALLETS`, `API_URL`, `HMAC_SECRET`.

### Why two profiles?

- **Smoke** does not prove “thousands of concurrent users.” It uses ~60 peak VUs, ~21 wallets, and **100 ms sleep** between iterations — so throughput (~310 req/s) is an **artificially paced** health check, not a player model.
- **Burst** targets **250 req/s** with k6 `constant-arrival-rate` (no sleep). That number is a **5× headroom** planning figure on ~50 req/s steady-state for ~1000 slot players (~20 s between spins), not “1000 connections.”
- Production pool sizing: `PgBouncer backends ≈ peak_RPS × avg_DB_transaction_seconds × (1 + headroom)`, validated with pool-wait and lock-wait metrics — not `concurrent_users = pool_size`.

### Results — smoke (Docker Compose stack, MacBook Pro M3, 2025-05-22)

| Metric | Value | Threshold |
|--------|-------|-----------|
| Total requests | 18,649 | — |
| Throughput | **310 req/s** | — |
| `http_req_duration` p95 | **15.72 ms** | < 500 ms ✅ |
| `http_req_duration` avg | 8.37 ms | — |
| `http_req_duration` max | 75.52 ms | — |
| Error rate | **0.00%** | < 5% ✅ |
| Checks passed | 18,647 / 18,647 (100%) | — |

**Scenarios (60 s):** `balance` 10 VUs × 30 s; `bet_win` ramp 0→20→50→0 over 60 s. **bet_latency** p95 ~16 ms.

### Results — burst (local: Postgres Docker + single API `pnpm dev`, 501 wallets, 2026-05-26)

| Metric | Value | Threshold |
|--------|-------|-----------|
| Target / achieved throughput | **250 req/s** | ~**250 req/s** ✅ |
| Total iterations | 45,001 | 3 min |
| `http_req_duration` p95 | **19.93 ms** | < 500 ms ✅ |
| `http_req_duration` avg | 11.55 ms | — |
| `http_req_duration` max | 117.5 ms | — |
| **bet_latency** p95 (75% of traffic) | **22 ms** | — |
| Error rate | **0.00%** | < 5% ✅ |
| k6 VUs used | 0–8 of 80 pre-allocated | API not saturated |

**Burst scenario:** 250 iterations/s for 3m, **25%** balance-only / **75%** bet+win, random wallet per request across **501** funded wallets, no inter-iteration sleep.

**Pool-sizing back-of-envelope from this run:**

\[
250\ \text{RPS} \times 0.012\ \text{s (avg HTTP)} \approx 3\ \text{concurrent slots},\quad
250 \times 0.020 \approx 5\ \text{ at p95}
\]

So **~20** app/PgBouncer backends was ample here; production would still measure under real network latency, multi-pod API, and PgBouncer queue metrics before committing to a number.

**Caveats:** Single API process, direct `DATABASE_URL` to Postgres (not full Compose API→PgBouncer path). Staging should repeat burst against the production-shaped stack and watch `cl_waiting` / lock wait before sizing pools for deploy.

## Scale Design (Billions of Rows)

| Concern | Mechanism |
|---------|-----------|
| Ledger growth | Monthly range partitions on `ledger_actions(created_at)` |
| RTP at scale | `rtp_hourly` aggregates in same txn — O(1) report reads |
| Idempotency table | `action_lookup` grows with unique actions; archive via partition or TTL |
| Hot wallets | Row lock on `wallets` (single serialize point per wallet) |
| Reconciliation | Sliding 24h window replay vs `wallets.balance`; async alert only |
| Hash chain | SHA256 chain in `ledger_actions`; validated by async worker, never on bet path |

### Partition Management

Create next month's partition before month end:
```sql
CREATE TABLE ledger_actions_2025_07
  PARTITION OF ledger_actions
  FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');
```

## Assumptions & Limitations

- **`finished` field** is accepted but ignored for balance purposes (no game-session lifecycle).
- **No deposits** — wallet balance is seeded; production deposit flow is out of scope.
- **Single HMAC secret** per environment — production would use per-provider secrets.
- **No FX** — bets in USD stay USD; USDT is treated as a separate currency.
- **RTP tolerance** is ±2% at 10,000 rounds due to variance; converges to ±0.5% at 1M+ rounds.
- **PgBouncer** uses `pool_mode = session` (required for multi-statement transactions).
- **Rollback of rollback** → 409 (second reversal prevented).
- **Docker port:** Postgres mapped to host `5433` (not 5432) to avoid conflicts with local installations.
