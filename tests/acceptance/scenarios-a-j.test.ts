import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "@/app.js";
import { truncateAll, seedAcceptanceWallet, closeTestDb } from "../helpers/db.js";
import { authHeader } from "../helpers/hmac.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeEach(async () => {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  await truncateAll();
  await seedAcceptanceWallet();
});

afterAll(async () => {
  if (app) await app.close();
  await closeTestDb();
});

function post(body: string) {
  return app.inject({
    method: "POST",
    url: "/aggregator/takehome/process",
    headers: {
      "content-type": "application/json",
      authorization: authHeader(body),
    },
    body,
  });
}

function postNoAuth(body: string) {
  return app.inject({
    method: "POST",
    url: "/aggregator/takehome/process",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("Acceptance scenarios A–J", () => {

  // A. Missing Authorization → 403
  it("A. Missing Authorization → 403", async () => {
    const body = `{ "user_id": "8|USDT|USD", "currency": "USD" }`;
    const res = await postNoAuth(body);
    expect(res.statusCode).toBe(403);
  });

  // B. Balance lookup
  it("B. Balance lookup", async () => {
    const body = `{"user_id": "8|USDT|USD","currency": "USD","game": "acceptance:test"}`;
    const res = await post(body);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ balance: 74322001 });
  });

  // C. Single bet, finished (no win)
  it("C. Single bet deducts balance", async () => {
    const body = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761032910245540510",
      finished: true,
      actions: [{ action: "bet", action_id: "3b42f070-dab5-4d6c-8bc6-7241b68f00bd", amount: 100 }],
    });
    const res = await post(body);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.balance).toBe(74321901);
    expect(json.transactions).toHaveLength(1);
    expect(json.transactions[0].action_id).toBe("3b42f070-dab5-4d6c-8bc6-7241b68f00bd");
  });

  // D. Bet + win in same call
  it("D. Bet + win in same call", async () => {
    // Start from seeded 74322001, add prior C bet state
    // Each test re-seeds, so we start fresh at 74322001
    const body = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761032910488163506",
      actions: [
        { action: "bet", action_id: "7c8affbf-53fd-4fcc-b1ca-18118c5dd287", amount: 100 },
        { action: "win", action_id: "86441c7a-560e-4501-b829-110af6a1b956", amount: 250 },
      ],
    });
    const res = await post(body);
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    // 74322001 - 100 + 250 = 74322151
    expect(json.balance).toBe(74322151);
    expect(json.transactions).toHaveLength(2);
    expect(json.game_id).toBe("1761032910488163506");
  });

  // E. Insufficient funds
  it("E. Insufficient funds → code 100", async () => {
    const body = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761032911004723918",
      finished: true,
      actions: [{ action: "bet", action_id: "6c1e98e8-8e93-4856-b6ef-8b2ddc6c4cbc", amount: 74322202 }],
    });
    const res = await post(body);
    expect(res.statusCode).toBe(422);
    const json = JSON.parse(res.body);
    expect(json.code).toBe(100);
    expect(json.message).toBe("Player has not enough funds to process an action");
  });

  // F. Bet then win (separate calls)
  it("F. Bet then win (two calls)", async () => {
    const betBody = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761032911166149146",
      actions: [{ action: "bet", action_id: "19bd35d5-50c3-4720-a402-145a46ab874c", amount: 100 }],
    });
    const betRes = await post(betBody);
    expect(betRes.statusCode).toBe(200);
    const betJson = JSON.parse(betRes.body);
    expect(betJson.balance).toBe(74321901);

    const winBody = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761032911166149146",
      finished: true,
      actions: [{ action: "win", action_id: "dcafc246-24b6-458b-a823-f6e7ecd6e9c3", amount: 700 }],
    });
    const winRes = await post(winBody);
    expect(winRes.statusCode).toBe(200);
    const winJson = JSON.parse(winRes.body);
    // 74322001 - 100 + 700 = 74322601
    expect(winJson.balance).toBe(74322601);
  });

  // G. Bet then rollback that bet
  it("G. Bet then rollback restores balance", async () => {
    const betBody = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761034000123456789",
      actions: [{ action: "bet", action_id: "4dbcbf1d-bcf6-43e9-9a62-7d3c0f3c6486", amount: 100 }],
    });
    const betRes = await post(betBody);
    expect(betRes.statusCode).toBe(200);
    const betJson = JSON.parse(betRes.body);
    expect(betJson.balance).toBe(74321901);

    const rollBody = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761034000123456789",
      finished: true,
      actions: [{
        action: "rollback",
        action_id: "c9a9c3a7-e9e8-4f5a-9fdf-1d8a377d1b8f",
        original_action_id: "4dbcbf1d-bcf6-43e9-9a62-7d3c0f3c6486",
      }],
    });
    const rollRes = await post(rollBody);
    expect(rollRes.statusCode).toBe(200);
    const rollJson = JSON.parse(rollRes.body);
    expect(rollJson.balance).toBe(74322001);
  });

  // H. Duplicate bet id across calls (idempotency)
  it("H. Duplicate bet id returns same tx_id, new bet applies", async () => {
    // First bet
    const bet1Body = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761032913606999220",
      actions: [{ action: "bet", action_id: "f61c5eba-fb26-4070-89b5-c3a2edf54c02", amount: 100 }],
    });
    const r1 = await post(bet1Body);
    expect(r1.statusCode).toBe(200);
    const j1 = JSON.parse(r1.body);
    const firstTxId = j1.transactions[0].tx_id;
    // seeded 74322001 - 100 = 74321901
    expect(j1.balance).toBe(74321901);

    // Re-send same bet + new bet
    const bet2Body = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761032913606999220",
      actions: [
        { action: "bet", action_id: "f61c5eba-fb26-4070-89b5-c3a2edf54c02", amount: 100 },
        { action: "bet", action_id: "d94b2fa5-e87f-4d8e-9a01-4a443ed5c11c", amount: 50 },
      ],
    });
    const r2 = await post(bet2Body);
    expect(r2.statusCode).toBe(200);
    const j2 = JSON.parse(r2.body);
    // Same tx_id for duplicate
    expect(j2.transactions[0].tx_id).toBe(firstTxId);
    // 74321901 - 50 = 74321851
    expect(j2.balance).toBe(74321851);
  });

  // I. Rollback arrives before the bet
  it("I. Pre-rollback: rollback before bet → bet NOOP", async () => {
    const rollBody = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761032915476894301",
      finished: true,
      actions: [{
        action: "rollback",
        action_id: "65d57850-5ee3-418b-b1b0-b4975242efcf",
        original_action_id: "27710aca-60f9-4259-a9bb-26f75cd05917",
      }],
    });
    const rollRes = await post(rollBody);
    expect(rollRes.statusCode).toBe(200);
    const rollJson = JSON.parse(rollRes.body);
    expect(rollJson.balance).toBe(74322001); // unchanged

    // Later bet should be NOOP
    const betBody = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761032915476894301",
      finished: true,
      actions: [{ action: "bet", action_id: "27710aca-60f9-4259-a9bb-26f75cd05917", amount: 100 }],
    });
    const betRes = await post(betBody);
    expect(betRes.statusCode).toBe(200);
    const betJson = JSON.parse(betRes.body);
    expect(betJson.balance).toBe(74322001); // still unchanged
  });

  // J. Two pre-rollbacks + NOOP batch
  it("J. Two pre-rollbacks then bet+win → all NOOP", async () => {
    const rollBody = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761032916227566632",
      finished: true,
      actions: [
        { action: "rollback", action_id: "12af93e7-f208-46f1-9399-4c1668fdd675", original_action_id: "a2fd2ce9-5184-48b6-bdde-f6ba05d32e01" },
        { action: "rollback", action_id: "85762689-2ab3-40d6-a7cd-e3babb53ae06", original_action_id: "7e4ad25b-b2c2-4eb7-b38e-63e7ddcdab52" },
      ],
    });
    const rollRes = await post(rollBody);
    expect(rollRes.statusCode).toBe(200);
    const rollJson = JSON.parse(rollRes.body);
    expect(rollJson.balance).toBe(74322001); // unchanged

    // Later bet + win should both NOOP
    const betWinBody = JSON.stringify({
      user_id: "8|USDT|USD",
      currency: "USD",
      game: "acceptance:test",
      game_id: "1761032916227566632",
      finished: true,
      actions: [
        { action: "bet", action_id: "a2fd2ce9-5184-48b6-bdde-f6ba05d32e01", amount: 100 },
        { action: "win", action_id: "7e4ad25b-b2c2-4eb7-b38e-63e7ddcdab52", amount: 200 },
      ],
    });
    const bwRes = await post(betWinBody);
    expect(bwRes.statusCode).toBe(200);
    const bwJson = JSON.parse(bwRes.body);
    expect(bwJson.balance).toBe(74322001); // still unchanged
  });
});
