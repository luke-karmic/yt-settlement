import { createHash } from "crypto";
import type { Action } from "@/schemas/actions.js";

/**
 * Builds the idempotency fingerprint for a single action (bet, win, or rollback).
 * Stored in `action_lookup.payload_hash` and compared on retries so the same
 * `action_id` with the same semantic payload replays, while a changed amount or
 * type yields 409. Uses canonical JSON (sorted keys), not raw HTTP body bytes.
 *
 * @param action - Validated action from the process request (`actions[]` entry)
 * @returns SHA-256 digest (32 bytes) of the canonical action JSON
 */
export function computePayloadHash(action: Action): Buffer {
  const canonical = canonicalize(action);
  return createHash("sha256").update(canonical, "utf8").digest();
}

/**
 * Serializes a value to deterministic JSON text so equivalent objects always
 * hash the same way regardless of property insertion order in memory.
 *
 * @param value - Action object or nested field being canonicalized
 * @returns Stable JSON text with sorted object keys
 */
function canonicalize(value: unknown): string {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  const keys = Object.keys(value as object).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k]));
  return "{" + pairs.join(",") + "}";
}
