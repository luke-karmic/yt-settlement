import { z } from "zod";

export const betActionSchema = z.object({
  action: z.literal("bet"),
  action_id: z.string().uuid(),
  amount: z.number().int().positive(),
});

export const winActionSchema = z.object({
  action: z.literal("win"),
  action_id: z.string().uuid(),
  amount: z.number().int().nonnegative(),
});

export const rollbackActionSchema = z.object({
  action: z.literal("rollback"),
  action_id: z.string().uuid(),
  original_action_id: z.string().uuid(),
});

export const actionSchema = z.discriminatedUnion("action", [
  betActionSchema,
  winActionSchema,
  rollbackActionSchema,
]);

export type BetAction = z.infer<typeof betActionSchema>;
export type WinAction = z.infer<typeof winActionSchema>;
export type RollbackAction = z.infer<typeof rollbackActionSchema>;
export type Action = z.infer<typeof actionSchema>;

/**
 * @param action - Discriminated process action
 * @returns `true` when `action` is a bet
 */
export function isBetAction(action: Action): action is BetAction {
  return action.action === "bet";
}

/**
 * @param action - Discriminated process action
 * @returns `true` when `action` is a win
 */
export function isWinAction(action: Action): action is WinAction {
  return action.action === "win";
}

/**
 * @param action - Discriminated process action
 * @returns `true` when `action` is a rollback
 */
export function isRollbackAction(action: Action): action is RollbackAction {
  return action.action === "rollback";
}
