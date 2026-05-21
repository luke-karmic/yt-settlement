import { randomUUID } from "node:crypto";
import { createToolDb } from "./lib/db.js";
import { SettlementClient } from "./lib/settlement-client.js";
import { loadSimulatorEnv } from "./lib/simulator-env.js";
import { createToolLogger } from "./lib/tool-logger.js";
import type { ProcessRequest } from "@/schemas/process.js";
import { ensureWallet, createPlayerId } from "./wallet-factory.js";

const TARGET_RTP_PERCENT = 95;
const RTP_TOLERANCE_PERCENT = 2;

const env = loadSimulatorEnv({
  ...process.env,
  USERS: process.env["USERS"] ?? "50",
  ROUNDS: process.env["ROUNDS"] ?? "200",
  GAME: "rtp:runner",
});
const log = createToolLogger(env);
const sql = createToolDb(env);
const client = new SettlementClient({ baseUrl: env.API_URL, hmacSecret: env.HMAC_SECRET });

function getWinAmount(betAmount: number): number {
  const r = Math.random();
  if (r < 0.5) return 0;
  if (r < 0.95) return Math.round(betAmount * 1.45);
  return Math.round(betAmount * 6);
}

function buildRoundRequest(userId: string, betAmount: number, winAmount: number): ProcessRequest {
  const gameId = randomUUID();
  const actions: ProcessRequest["actions"] = [
    { action: "bet", action_id: randomUUID(), amount: betAmount },
  ];
  if (winAmount > 0) {
    actions.push({ action: "win", action_id: randomUUID(), amount: winAmount });
  }
  return {
    user_id: userId,
    currency: env.CURRENCY,
    game: env.GAME,
    game_id: gameId,
    finished: true,
    actions,
  };
}

const playerIds = Array.from({ length: env.USERS }, () => createPlayerId());
const betAmount = 1000;
const fromDate = new Date();

log.info({ users: env.USERS }, "Seeding wallets");
for (const id of playerIds) {
  await ensureWallet(sql, id, env.CURRENCY, 10_000_000n);
}

let totalBet = 0;
let totalWin = 0;
let code100Count = 0;
let errorCount = 0;

log.info({ users: env.USERS, rounds: env.ROUNDS }, "Running RTP simulation");

for (let round = 0; round < env.ROUNDS; round++) {
  for (const userId of playerIds) {
    const winAmount = getWinAmount(betAmount);
    const result = await client.process(buildRoundRequest(userId, betAmount, winAmount));

    if (result.kind === "success") {
      totalBet += betAmount;
      totalWin += winAmount;
    } else if (result.kind === "insufficient_funds") {
      code100Count++;
    } else {
      errorCount++;
      log.error({ userId, status: result.status, body: result.data }, "Unexpected process error");
    }
  }

  if ((round + 1) % 50 === 0) {
    const runningRtp = totalBet > 0 ? (totalWin / totalBet) * 100 : 0;
    log.info({ round: round + 1, runningRtpPercent: Number(runningRtp.toFixed(2)) }, "Progress");
  }
}

const toDate = new Date();
const observedRtpPercent = totalBet > 0 ? (totalWin / totalBet) * 100 : 0;

log.info(
  { totalBet, totalWin, observedRtpPercent: Number(observedRtpPercent.toFixed(4)), code100Count, errorCount },
  "Observed play-out RTP",
);

const rtpJson = await client.getCasinoRtp(fromDate, toDate);
log.info({ data: rtpJson.data }, "Casino RTP endpoint response");

const endpointRtp = rtpJson.data[0]?.rtp ?? null;
if (endpointRtp === null) {
  log.warn("No RTP data in reporting window — check from/to bounds");
  await sql.end();
  process.exit(1);
}

const diff = Math.abs(endpointRtp - TARGET_RTP_PERCENT);
log.info(
  {
    endpointRtpPercent: endpointRtp,
    targetPercent: TARGET_RTP_PERCENT,
    diffPercent: Number(diff.toFixed(4)),
  },
  "Endpoint RTP check",
);

if (diff > RTP_TOLERANCE_PERCENT) {
  log.error(
    { endpointRtp, tolerance: RTP_TOLERANCE_PERCENT },
    "RTP outside tolerance",
  );
  await sql.end();
  process.exit(1);
}

log.info({ tolerance: RTP_TOLERANCE_PERCENT }, "RTP within tolerance");
await sql.end();
