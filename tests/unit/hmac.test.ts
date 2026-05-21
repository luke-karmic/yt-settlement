import { describe, it, expect } from "vitest";
import { verifyHmac, signBody } from "@/auth/hmac.js";

describe("HMAC-SHA256 verification", () => {
  const SECRET = "test";

  // Spec §8 vector (compact JSON no spaces)
  const specBody8 = `{"user_id":"8|USDT|USD","currency":"USD","game":"acceptance:test"}`;
  const specHex8 = "442c4cd8926008096225416b21f5a1862fbf4fc4e5224362e3b463e85a39f40a";

  // Spec §3 vector (spaced JSON)
  const specBody3 = `{"user_id": "8|USDT|USD","currency": "USD","game": "acceptance:test"}`;
  const specHex3 = "7376e78d5f65ca750c9719d2163daffa129e8a07ba9a1abe12241b3b1de51295";

  it("verifies spec §8 HMAC vector", () => {
    const rawBody = Buffer.from(specBody8, "utf8");
    expect(verifyHmac(rawBody, `HMAC-SHA256 ${specHex8}`, SECRET)).toBe(true);
  });

  it("verifies spec §3 HMAC vector (spaced JSON)", () => {
    const rawBody = Buffer.from(specBody3, "utf8");
    expect(verifyHmac(rawBody, `HMAC-SHA256 ${specHex3}`, SECRET)).toBe(true);
  });

  it("signBody produces correct hex for spec §8", () => {
    expect(signBody(specBody8, SECRET)).toBe(specHex8);
  });

  it("rejects tampered body", () => {
    const tampered = Buffer.from(specBody8.replace("8|USDT", "9|USDT"), "utf8");
    expect(verifyHmac(tampered, `HMAC-SHA256 ${specHex8}`, SECRET)).toBe(false);
  });

  it("rejects missing authorization header", () => {
    const rawBody = Buffer.from(specBody8, "utf8");
    expect(verifyHmac(rawBody, undefined, SECRET)).toBe(false);
  });

  it("rejects wrong format header", () => {
    const rawBody = Buffer.from(specBody8, "utf8");
    expect(verifyHmac(rawBody, "Bearer abc123", SECRET)).toBe(false);
  });

  it("rejects wrong secret", () => {
    const rawBody = Buffer.from(specBody8, "utf8");
    const wrongHex = signBody(specBody8, "wrong_secret");
    expect(verifyHmac(rawBody, `HMAC-SHA256 ${wrongHex}`, SECRET)).toBe(false);
  });

  it("rejects odd-length hex", () => {
    const rawBody = Buffer.from(specBody8, "utf8");
    expect(verifyHmac(rawBody, "HMAC-SHA256 abc", SECRET)).toBe(false);
  });
});
