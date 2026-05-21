import { createHmac } from "node:crypto";
import {
  insufficientFundsErrorSchema,
  processResponseSchema,
  type ProcessRequest,
} from "@/schemas/process.js";
import { rtpUserEntrySchema } from "@/schemas/rtp.js";
import { z } from "zod";

export type SettlementClientConfig = {
  baseUrl: string;
  hmacSecret: string;
};

const rtpCasinoResponseSchema = z.object({
  data: z.array(rtpUserEntrySchema),
});

function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex");
}

function authHeader(secret: string, rawBody: string): string {
  return `HMAC-SHA256 ${signBody(secret, rawBody)}`;
}

export type ProcessCallResult =
  | { kind: "success"; status: 200; data: z.infer<typeof processResponseSchema> }
  | { kind: "insufficient_funds"; status: 422; data: z.infer<typeof insufficientFundsErrorSchema> }
  | { kind: "error"; status: number; data: unknown };

export class SettlementClient {
  private readonly processUrl: string;

  constructor(private readonly config: SettlementClientConfig) {
    this.processUrl = `${config.baseUrl.replace(/\/$/, "")}/aggregator/takehome/process`;
  }

  async process(body: ProcessRequest): Promise<ProcessCallResult> {
    const bodyStr = JSON.stringify(body);
    const res = await fetch(this.processUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: authHeader(this.config.hmacSecret, bodyStr),
      },
      body: bodyStr,
    });

    const json: unknown = await res.json();

    if (res.status === 200) {
      return { kind: "success", status: 200, data: processResponseSchema.parse(json) };
    }
    if (res.status === 422) {
      const funds = insufficientFundsErrorSchema.safeParse(json);
      if (funds.success) {
        return { kind: "insufficient_funds", status: 422, data: funds.data };
      }
    }

    return { kind: "error", status: res.status, data: json };
  }

  async getCasinoRtp(from: Date, to: Date): Promise<z.infer<typeof rtpCasinoResponseSchema>> {
    const fromIso = encodeURIComponent(from.toISOString());
    const toIso = encodeURIComponent(to.toISOString());
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/aggregator/takehome/rtp/casino?from=${fromIso}&to=${toIso}`;

    const res = await fetch(url, {
      headers: { authorization: authHeader(this.config.hmacSecret, "") },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`RTP casino GET failed (${res.status}): ${body}`);
    }

    return rtpCasinoResponseSchema.parse(await res.json());
  }
}

export function isUnexpectedProcessFailure(result: ProcessCallResult): boolean {
  if (result.kind === "success") return false;
  if (result.kind === "insufficient_funds") return false;
  return true;
}
