import { z } from "zod";

export const rtpQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type RtpQuery = z.infer<typeof rtpQuerySchema>;

export const rtpUserEntrySchema = z.object({
  user_id: z.string(),
  currency: z.string(),
  rounds: z.number(),
  total_bet: z.number(),
  total_win: z.number(),
  rollback_bet: z.number(),
  rollback_win: z.number(),
  rtp: z.number().nullable(),
});

export type RtpUserEntry = z.infer<typeof rtpUserEntrySchema>;
