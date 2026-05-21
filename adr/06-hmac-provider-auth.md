# ADR 06 — HMAC-SHA256 Provider Auth

**Status:** Accepted

## Decision
Authenticate all API calls with `HMAC-SHA256` over **raw request body bytes**. For GET requests (RTP endpoints), sign an empty string `""`.

## Reasoning
- Caller is a game backend server-to-server — HMAC over raw body binds signature to exact payload bytes.
- Re-serializing JSON (parse then stringify) would break signature for any whitespace/key-order variation.
- `crypto.timingSafeEqual` prevents timing attacks on signature comparison.
- GET signing convention: empty body → `HMAC-SHA256("")` — consistent and documented.

## Trade-off
- One shared secret per environment (take-home); production would use per-provider secrets.
- GET HMAC does not cover query parameters — document that query tampering is detected only at the application level.
