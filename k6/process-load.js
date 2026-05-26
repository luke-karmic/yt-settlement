import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import crypto from "k6/crypto";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const errorRate = new Rate("errors");
const betLatency = new Trend("bet_latency");

const wallets = JSON.parse(open("./wallets.json"));

const profile = __ENV.K6_PROFILE || "smoke";
const BASE_URL = __ENV.API_URL || "http://localhost:3000";
const HMAC_SECRET = __ENV.HMAC_SECRET || "test";
const BURST_RPS = parseInt(__ENV.K6_BURST_RPS || "250", 10);
const BURST_DURATION = __ENV.K6_BURST_DURATION || "3m";
const BURST_MIN_WALLETS = parseInt(__ENV.K6_BURST_MIN_WALLETS || "100", 10);

function smokeOptions() {
  return {
    scenarios: {
      balance: {
        executor: "constant-vus",
        vus: 10,
        duration: "30s",
        exec: "balanceCheck",
      },
      bet_win: {
        executor: "ramping-vus",
        startVUs: 0,
        stages: [
          { duration: "10s", target: 20 },
          { duration: "40s", target: 50 },
          { duration: "10s", target: 0 },
        ],
        exec: "betWin",
      },
    },
    thresholds: {
      http_req_duration: ["p(95)<500"],
      errors: ["rate<0.05"],
    },
  };
}

function burstOptions() {
  return {
    scenarios: {
      burst: {
        executor: "constant-arrival-rate",
        rate: BURST_RPS,
        timeUnit: "1s",
        duration: BURST_DURATION,
        preAllocatedVUs: 80,
        maxVUs: 400,
        exec: "settlementMixed",
      },
    },
    thresholds: {
      http_req_duration: ["p(95)<500"],
      errors: ["rate<0.05"],
      http_req_failed: ["rate<0.05"],
    },
  };
}

export const options = profile === "burst" ? burstOptions() : smokeOptions();

function hmacSign(body) {
  const mac = crypto.createHMAC("sha256", HMAC_SECRET);
  mac.update(body);
  return mac.digest("hex");
}

function post(body) {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  const sig = hmacSign(bodyStr);
  return http.post(`${BASE_URL}/aggregator/takehome/process`, bodyStr, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `HMAC-SHA256 ${sig}`,
    },
  });
}

function pickWallet(data) {
  return data.wallets[Math.floor(Math.random() * data.wallets.length)];
}

function pacingSleep() {
  if (profile === "burst") return;
  sleep(0.1);
}

export function setup() {
  const health = http.get(`${BASE_URL}/health`);
  if (health.status !== 200) {
    throw new Error(`API not healthy at ${BASE_URL}/health (status ${health.status})`);
  }
  if (!wallets.length) {
    throw new Error("k6/wallets.json is empty — run pnpm db:seed first");
  }
  if (profile === "burst" && wallets.length < BURST_MIN_WALLETS) {
    throw new Error(
      `Burst profile needs at least ${BURST_MIN_WALLETS} wallets (have ${wallets.length}). ` +
        `Re-seed: K6_WALLETS=500 pnpm db:seed`,
    );
  }
  const probe = post(
    JSON.stringify({
      user_id: wallets[0].userId,
      currency: wallets[0].currency,
      game: "load:setup",
    }),
  );
  if (probe.status !== 200) {
    throw new Error(`Balance probe failed (${probe.status}): ${probe.body}`);
  }
  return { wallets, profile, burstRps: BURST_RPS };
}

export function settlementMixed(data) {
  if (Math.random() < 0.25) {
    balanceCheck(data);
  } else {
    betWin(data);
  }
}

export function balanceCheck(data) {
  const w = pickWallet(data);
  const body = JSON.stringify({ user_id: w.userId, currency: w.currency, game: "load:balance" });
  const res = post(body);
  check(res, { "balance 200": (r) => r.status === 200 });
  errorRate.add(res.status !== 200);
  pacingSleep();
}

export function betWin(data) {
  const w = pickWallet(data);
  const betId = uuidv4();
  const winId = uuidv4();
  const gameId = uuidv4();
  const amount = Math.floor(Math.random() * 100) + 10;

  const body = {
    user_id: w.userId,
    currency: w.currency,
    game: "load:bet_win",
    game_id: gameId,
    actions: [
      { action: "bet", action_id: betId, amount },
      { action: "win", action_id: winId, amount: Math.floor(amount * 1.45) },
    ],
  };

  const start = Date.now();
  const res = post(body);
  betLatency.add(Date.now() - start);

  const ok = res.status === 200 || res.status === 422;
  check(res, { "bet/win ok": () => ok });
  errorRate.add(!ok);
  pacingSleep();
}
