import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { truncateAll, seedAcceptanceWallet, closeTestDb, getTestSql } from "../helpers/db.js";
import { v4 as uuidv4 } from "uuid";
import { processRequest } from "@/services/transaction-processor.js";
import { ulid } from "ulid";

const USER = "8|USDT|USD";
const CURRENCY = "USD";
const GAME = "test:game";
const SEED = 74322001;

beforeEach(async () => {
  await truncateAll();
  await seedAcceptanceWallet();
});

afterAll(async () => {
  await closeTestDb();
});

describe("Settlement integration", () => {
  it("1. Balance-only returns seeded balance", async () => {
    const result = await processRequest({ user_id: USER, currency: CURRENCY, game: GAME });
    expect(result.balance).toBe(SEED);
    expect(result.transactions).toBeUndefined();
  });

  it("2. Single bet deducts balance", async () => {
    const result = await processRequest({
      user_id: USER, currency: CURRENCY, game: GAME,
      game_id: uuidv4(), actions: [{ action: "bet", action_id: uuidv4(), amount: 100 }],
    });
    expect(result.balance).toBe(SEED - 100);
    expect(result.transactions).toHaveLength(1);
  });

  it("3. Bet+win in same request", async () => {
    const result = await processRequest({
      user_id: USER, currency: CURRENCY, game: GAME,
      game_id: uuidv4(),
      actions: [
        { action: "bet", action_id: uuidv4(), amount: 100 },
        { action: "win", action_id: uuidv4(), amount: 250 },
      ],
    });
    expect(result.balance).toBe(SEED - 100 + 250);
    expect(result.transactions).toHaveLength(2);
  });

  it("4. Insufficient funds → code 100, balance unchanged", async () => {
    await expect(processRequest({
      user_id: USER, currency: CURRENCY, game: GAME,
      game_id: uuidv4(), actions: [{ action: "bet", action_id: uuidv4(), amount: SEED + 1 }],
    })).rejects.toMatchObject({ code: 100 });

    const check = await processRequest({ user_id: USER, currency: CURRENCY, game: GAME });
    expect(check.balance).toBe(SEED);
  });

  it("5. Batch atomicity: ok bet + failing bet → no change", async () => {
    await expect(processRequest({
      user_id: USER, currency: CURRENCY, game: GAME,
      game_id: uuidv4(),
      actions: [
        { action: "bet", action_id: uuidv4(), amount: 100 },
        { action: "bet", action_id: uuidv4(), amount: SEED + 1 },
      ],
    })).rejects.toMatchObject({ code: 100 });

    const check = await processRequest({ user_id: USER, currency: CURRENCY, game: GAME });
    expect(check.balance).toBe(SEED);
  });

  it("6. Duplicate action_id → same tx_id, one debit", async () => {
    const actionId = uuidv4();
    const gameId = uuidv4();
    const r1 = await processRequest({
      user_id: USER, currency: CURRENCY, game: GAME, game_id: gameId,
      actions: [{ action: "bet", action_id: actionId, amount: 100 }],
    });
    const firstTxId = r1.transactions![0]!.tx_id;

    const r2 = await processRequest({
      user_id: USER, currency: CURRENCY, game: GAME, game_id: gameId,
      actions: [{ action: "bet", action_id: actionId, amount: 100 }],
    });
    expect(r2.transactions![0]!.tx_id).toBe(firstTxId);
    expect(r2.balance).toBe(SEED - 100); // only debited once
  });

  it("7. Same action_id, different amount → 409", async () => {
    const actionId = uuidv4();
    await processRequest({
      user_id: USER, currency: CURRENCY, game: GAME, game_id: uuidv4(),
      actions: [{ action: "bet", action_id: actionId, amount: 100 }],
    });

    await expect(processRequest({
      user_id: USER, currency: CURRENCY, game: GAME, game_id: uuidv4(),
      actions: [{ action: "bet", action_id: actionId, amount: 200 }],
    })).rejects.toThrow("already exists with different payload");
  });

  it("8. Bet then rollback restores balance (scenario G)", async () => {
    const betId = uuidv4();
    const r1 = await processRequest({
      user_id: USER, currency: CURRENCY, game: GAME, game_id: uuidv4(),
      actions: [{ action: "bet", action_id: betId, amount: 100 }],
    });
    expect(r1.balance).toBe(SEED - 100);

    const r2 = await processRequest({
      user_id: USER, currency: CURRENCY, game: GAME, game_id: uuidv4(),
      actions: [{ action: "rollback", action_id: uuidv4(), original_action_id: betId }],
    });
    expect(r2.balance).toBe(SEED);
  });

  it("9. Pre-rollback then bet NOOP (scenario I)", async () => {
    const betId = uuidv4();

    // Rollback arrives before bet
    const r1 = await processRequest({
      user_id: USER, currency: CURRENCY, game: GAME, game_id: uuidv4(), finished: true,
      actions: [{ action: "rollback", action_id: uuidv4(), original_action_id: betId }],
    });
    expect(r1.balance).toBe(SEED); // no change

    // Later bet is NOOP
    const r2 = await processRequest({
      user_id: USER, currency: CURRENCY, game: GAME, game_id: uuidv4(), finished: true,
      actions: [{ action: "bet", action_id: betId, amount: 100 }],
    });
    expect(r2.balance).toBe(SEED); // still no change
  });

  it("10. Lazy wallet create for new ULID", async () => {
    const newUser = ulid();
    const result = await processRequest({ user_id: newUser, currency: CURRENCY, game: GAME });
    expect(result.balance).toBe(0);
  });
});
