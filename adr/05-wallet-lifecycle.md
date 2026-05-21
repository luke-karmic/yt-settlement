# ADR 05 — Wallet Lifecycle

**Status:** Accepted

## Decision
Wallets are lazily created on first `process` call (`INSERT ON CONFLICT DO NOTHING`). Initial balance is 0. Tools (seed, simulators, k6) explicitly fund wallets before sending bets.

## Reasoning
- Spec requires lazy wallet creation; games should not pre-register players.
- Production path: deposit credits wallet first; `process` endpoint then handles bets.
- Simulators call `ensureWallet()` with initial balance before load to avoid spurious code 100 errors.

## Trade-off
- A new unfunded wallet receiving a bet immediately gets code 100 — correct behavior, documented.
