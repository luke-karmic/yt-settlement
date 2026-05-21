# ADR 04 — Multi-Currency Wallets (One Row per Currency)

**Status:** Accepted

## Decision
One `wallets` row per `(provider_user_id, currency)` pair. Games share the same wallet if they use the same `user_id` + `currency`.

## Reasoning
- Independent per-currency balances and locks — no FX conversion on bet path.
- Clear RTP reporting per currency (never sum USD + USDT).
- `game` field is attribution metadata only; no per-game sub-balance.

## Trade-off
- Multi-currency players have multiple wallet rows — expected and correct.
- Reporting must filter by currency to be meaningful.
