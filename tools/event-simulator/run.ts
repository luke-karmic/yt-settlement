import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { createToolDb, type ToolDb } from "../lib/db.js";
import { isUnexpectedProcessFailure, SettlementClient } from "../lib/settlement-client.js";
import { loadSimulatorEnv, type SimulatorEnv } from "../lib/simulator-env.js";
import { createToolLogger } from "../lib/tool-logger.js";
import { ensureWallet, createPlayerId } from "../wallet-factory.js";
import {
  buildProcessRequest,
  isScenarioFailure,
  pickScenario,
  recordPendingBet,
  type PendingBetRegistry,
  type ScenarioKind,
} from "./scenarios.js";

export type SimulationStats = {
  requests: number;
  failures: number;
  byScenario: Record<ScenarioKind, number>;
};

export async function seedPlayers(
  db: ToolDb,
  env: SimulatorEnv,
  log: Logger,
): Promise<string[]> {
  const playerIds = Array.from({ length: env.USERS }, () => createPlayerId());
  log.info({ users: env.USERS, initialBalance: env.INITIAL_BALANCE.toString() }, "Seeding wallets");

  for (const userId of playerIds) {
    await ensureWallet(db, userId, env.CURRENCY, env.INITIAL_BALANCE);
  }

  log.info({ users: playerIds.length }, "Wallets ready");
  return playerIds;
}

export async function runEventSimulation(
  env: SimulatorEnv,
  log: Logger,
): Promise<SimulationStats> {
  const db = createToolDb(env);
  const client = new SettlementClient({ baseUrl: env.API_URL, hmacSecret: env.HMAC_SECRET });
  const playerIds = await seedPlayers(db, env, log);

  const stats: SimulationStats = {
    requests: 0,
    failures: 0,
    byScenario: {
      pre_rollback: 0,
      idempotent_replay: 0,
      bet_win: 0,
      bet_only: 0,
    },
  };

  const pendingBets: PendingBetRegistry = new Map();

  for (let round = 0; round < env.ROUNDS; round++) {
    for (const userId of playerIds) {
      const scenario = pickScenario(pendingBets);
      stats.byScenario[scenario]++;

      const ctx = {
        userId,
        gameId: randomUUID(),
        betAmount: Math.floor(Math.random() * 1000) + 100,
        betId: randomUUID(),
      };

      const body = buildProcessRequest(env, scenario, ctx, pendingBets);
      const result = await client.process(body);
      stats.requests++;

      const failed = isScenarioFailure(scenario, result.status, result.kind);
      if (failed || isUnexpectedProcessFailure(result)) {
        stats.failures++;
        log.warn({ scenario, status: result.status, userId }, "Unexpected process response");
      }

      recordPendingBet(scenario, ctx, pendingBets, result.kind === "success");
    }

    if ((round + 1) % Math.max(1, Math.floor(env.ROUNDS / 5)) === 0) {
      log.info({ round: round + 1, totalRounds: env.ROUNDS, ...stats }, "Simulation progress");
    }
  }

  await db.end();
  return stats;
}

export async function main(): Promise<void> {
  const env = loadSimulatorEnv();
  const log = createToolLogger(env);

  log.info(
    {
      apiUrl: env.API_URL,
      users: env.USERS,
      rounds: env.ROUNDS,
      currency: env.CURRENCY,
    },
    "Starting event simulation",
  );

  const stats = await runEventSimulation(env, log);
  const errorRate = stats.requests > 0 ? (stats.failures / stats.requests) * 100 : 0;

  log.info(
    {
      requests: stats.requests,
      failures: stats.failures,
      errorRatePercent: Number(errorRate.toFixed(2)),
      byScenario: stats.byScenario,
    },
    "Simulation complete",
  );

  if (stats.failures > 0) {
    log.error({ failures: stats.failures }, "Simulation finished with unexpected errors");
    process.exit(1);
  }
}
