import { createHmac, timingSafeEqual } from "crypto";

/**
 * Validates `Authorization: HMAC-SHA256 <hex>` against the raw request body bytes.
 * Used for game-server authentication and wire integrity before JSON is trusted.
 *
 * @param rawBody - Exact HTTP body bytes (from `req.rawBody`)
 * @param authorizationHeader - Value of the `Authorization` header, if present
 * @param secret - Shared HMAC secret (`HMAC_SECRET`)
 * @returns `true` when the MAC matches; `false` on missing header, bad format, or mismatch
 */
export function verifyHmac(rawBody: Buffer, authorizationHeader: string | undefined, secret: string): boolean {
  if (!authorizationHeader) return false;

  const match = /^HMAC-SHA256\s+([0-9a-f]+)$/i.exec(authorizationHeader);
  if (!match || !match[1]) return false;

  const providedHex = match[1];
  if (providedHex.length % 2 !== 0) return false;

  let providedBuffer: Buffer;
  try {
    providedBuffer = Buffer.from(providedHex, "hex");
  } catch {
    return false;
  }

  const expected = createHmac("sha256", secret).update(rawBody).digest();

  if (providedBuffer.length !== expected.length) return false;

  return timingSafeEqual(providedBuffer, expected);
}

/**
 * Produces the hex digest clients place in the Authorization header.
 * Must sign the exact UTF-8 bytes sent as the HTTP body (see `verifyHmac`).
 *
 * @param body - Raw JSON request body as sent on the wire (UTF-8 string)
 * @param secret - Shared HMAC secret
 * @returns Lowercase hex-encoded HMAC-SHA256 digest (no prefix)
 */
export function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex");
}
