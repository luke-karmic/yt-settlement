import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import crypto from "k6/crypto";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

const errorRate = new Rate("errors");
const betLatency = new Trend("bet_latency");

const wallets = JSON.parse(open("./wallets.json"));

export const options = {
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

const BASE_URL = __ENV["API_URL"] || "http://localhost:3000";
const HMAC_SECRET = __ENV["HMAC_SECRET"] || "test";

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

export function setup() {
  const health = http.get(`${BASE_URL}/health`);
  if (health.status !== 200) {
    throw new Error(`API not healthy at ${BASE_URL}/health (status ${health.status})`);
  }
  if (!wallets.length) {
    throw new Error("k6/wallets.json is empty — run pnpm db:seed first");
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
  return { wallets };
}

export function balanceCheck(data) {
  const w = data.wallets[Math.floor(Math.random() * data.wallets.length)];
  const body = JSON.stringify({ user_id: w.userId, currency: w.currency, game: "load:balance" });
  const res = post(body);
  check(res, { "balance 200": (r) => r.status === 200 });
  errorRate.add(res.status !== 200);
  sleep(0.1);
}

export function betWin(data) {
  const w = data.wallets[Math.floor(Math.random() * data.wallets.length)];
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
  sleep(0.1);
}
