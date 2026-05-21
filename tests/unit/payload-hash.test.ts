import { describe, it, expect } from "vitest";
import { computePayloadHash } from "@/services/payload-hash.js";

describe("payload hash", () => {
  it("produces consistent hash for same action", () => {
    const action = { action: "bet" as const, action_id: "test-uuid", amount: 100 };
    const h1 = computePayloadHash(action);
    const h2 = computePayloadHash(action);
    expect(h1.equals(h2)).toBe(true);
  });

  it("produces different hash for different amount", () => {
    const a = { action: "bet" as const, action_id: "test-uuid", amount: 100 };
    const b = { action: "bet" as const, action_id: "test-uuid", amount: 200 };
    expect(computePayloadHash(a).equals(computePayloadHash(b))).toBe(false);
  });

  it("is stable regardless of object key insertion order", () => {
    const a = { action: "bet" as const, action_id: "test-uuid", amount: 100 };
    const b = { amount: 100, action_id: "test-uuid", action: "bet" as const };
    expect(computePayloadHash(a).equals(computePayloadHash(b))).toBe(true);
  });
});
