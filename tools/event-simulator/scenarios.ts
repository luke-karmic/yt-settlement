import { randomUUID } from "node:crypto";
import type { ProcessRequest } from "@/schemas/process.js";
import type { SimulatorEnv } from "../lib/simulator-env.js";

export type ScenarioKind = "pre_rollback" | "idempotent_replay" | "bet_win" | "bet_only";

const WEIGHTS = {
  preRollback: 0.05,
  idempotentReplay: 0.05,
  betWin: 0.35,
} as const;

export type PendingBetEntry = {
  userId: string;
  amount: number;
};

export type PendingBetRegistry = Map<string, PendingBetEntry>;

export type RoundContext = {
  userId: string;
  gameId: string;
  betAmount: number;
  betId: string;
};

export function pickScenario(registry: PendingBetRegistry): ScenarioKind {
  const roll = Math.random();
  const canReplay = registry.size > 0;

  if (canReplay && roll < WEIGHTS.preRollback) return "pre_rollback";
  if (canReplay && roll < WEIGHTS.preRollback + WEIGHTS.idempotentReplay) return "idempotent_replay";
  if (roll < WEIGHTS.preRollback + WEIGHTS.idempotentReplay + WEIGHTS.betWin) return "bet_win";
  return "bet_only";
}

export function buildProcessRequest(
  env: SimulatorEnv,
  scenario: ScenarioKind,
  ctx: RoundContext,
  registry: PendingBetRegistry,
): ProcessRequest {
  const base = {
    user_id: ctx.userId,
    currency: env.CURRENCY,
    game: env.GAME,
    game_id: ctx.gameId,
    finished: true as const,
  };

  switch (scenario) {
    case "pre_rollback": {
      const futureBetId = randomUUID();
      return {
        ...base,
        actions: [
          {
            action: "rollback",
            action_id: randomUUID(),
            original_action_id: futureBetId,
          },
        ],
      };
    }
    case "idempotent_replay": {
      const entries = [...registry.entries()];
      const picked = entries[Math.floor(Math.random() * entries.length)]!;
      return {
        ...base,
        user_id: picked[1].userId,
        actions: [{ action: "bet", action_id: picked[0], amount: picked[1].amount }],
      };
    }
    case "bet_win": {
      const winAmount = Math.floor(ctx.betAmount * (0.5 + Math.random() * 2));
      return {
        ...base,
        actions: [
          { action: "bet", action_id: ctx.betId, amount: ctx.betAmount },
          { action: "win", action_id: randomUUID(), amount: winAmount },
        ],
      };
    }
    case "bet_only":
      return {
        ...base,
        actions: [{ action: "bet", action_id: ctx.betId, amount: ctx.betAmount }],
      };
  }
}

export function recordPendingBet(
  scenario: ScenarioKind,
  ctx: RoundContext,
  registry: PendingBetRegistry,
  succeeded: boolean,
): void {
  if (!succeeded) return;
  if (scenario === "bet_only" || scenario === "bet_win") {
    registry.set(ctx.betId, { userId: ctx.userId, amount: ctx.betAmount });
  }
}

export function isScenarioFailure(
  scenario: ScenarioKind,
  status: number,
  kind: string,
): boolean {
  if (kind === "insufficient_funds") return false;
  if (scenario === "idempotent_replay") return status !== 200;
  if (kind === "success") return false;
  return true;
}
