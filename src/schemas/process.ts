import { z } from "zod";
import { actionSchema } from "./actions.js";

export const processRequestSchema = z.object({
  user_id: z.string().min(1),
  currency: z.string().min(1).max(10),
  game: z.string().optional(),
  game_id: z.string().optional(),
  finished: z.boolean().optional(),
  actions: z.array(actionSchema).optional().default([]),
});

export type ProcessRequest = z.infer<typeof processRequestSchema>;

export const transactionSchema = z.object({
  action_id: z.string().uuid(),
  tx_id: z.string().uuid(),
});

export type Transaction = z.infer<typeof transactionSchema>;

export const processResponseSchema = z.object({
  game_id: z.string().optional(),
  transactions: z.array(transactionSchema).optional(),
  balance: z.number(),
});

export type ProcessResponse = z.infer<typeof processResponseSchema>;

export const insufficientFundsErrorSchema = z.object({
  code: z.literal(100),
  message: z.string(),
});

export type InsufficientFundsErrorBody = z.infer<typeof insufficientFundsErrorSchema>;
