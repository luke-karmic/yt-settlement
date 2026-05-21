import { createHmac } from "crypto";

const SECRET = process.env["HMAC_SECRET"] ?? "test";

/**
 * @param body - Exact JSON body string used as the HTTP payload
 * @returns HMAC-SHA256 hex digest using test `HMAC_SECRET`
 */
export function sign(body: string): string {
  return createHmac("sha256", SECRET).update(Buffer.from(body, "utf8")).digest("hex");
}

/**
 * @param body - Exact JSON body string used as the HTTP payload
 * @returns `Authorization` header value (`HMAC-SHA256 <hex>`)
 */
export function authHeader(body: string): string {
  return `HMAC-SHA256 ${sign(body)}`;
}
