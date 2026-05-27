import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { v4 as uuidv4 } from "uuid";
import { processRequest } from "@/services/transaction-processor.js";
import { reconcileWalletByUser } from "@/services/ledger-reconciliation.js";
import { truncateAll, seedAcceptanceWallet, closeTestDb, getTestSql } from "../helpers/db.js";

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

describe("Ledger reconciliation", () => {
  it("matches wallet balance after bet+win", async () => {
    await processRequest({
      user_id: USER,
      currency: CURRENCY,
      game: GAME,
      game_id: uuidv4(),
      actions: [
        { action: "bet", action_id: uuidv4(), amount: 100 },
        { action: "win", action_id: uuidv4(), amount: 250 },
      ],
    });

    const result = await reconcileWalletByUser(USER, CURRENCY);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.status).toBe("ok");
    expect(result.drift).toBe(0n);
    expect(result.ledgerRowCount).toBe(2);
    expect(result.counts.appliedBet).toBe(1);
    expect(result.counts.appliedWin).toBe(1);
    expect(result.expectedBalance).toBe(BigInt(SEED - 100 + 250));
    expect(result.walletBalance).toBe(result.expectedBalance);
  });

  it("detects drift when wallet balance is manually corrupted", async () => {
    await processRequest({
      user_id: USER,
      currency: CURRENCY,
      game: GAME,
      game_id: uuidv4(),
      actions: [{ action: "bet", action_id: uuidv4(), amount: 100 }],
    });

    const sql = getTestSql();
    await sql`
      UPDATE wallets
      SET balance = balance + 500
      WHERE provider_user_id = ${USER} AND currency = ${CURRENCY}
    `;

    const result = await reconcileWalletByUser(USER, CURRENCY);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.status).toBe("drift");
    expect(result.drift).toBe(500n);
    expect(result.ledgerRowCount).toBe(1);
    expect(result.walletBalance - result.expectedBalance!).toBe(500n);
  });

  it("reports no_ledger for funded wallet without actions", async () => {
    const result = await reconcileWalletByUser(USER, CURRENCY);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.status).toBe("no_ledger");
    expect(result.ledgerRowCount).toBe(0);
    expect(result.drift).toBe(0n);
  });

  it("stays in sync after pre-rollback and noop bet (scenario I)", async () => {
    const betId = uuidv4();

    await processRequest({
      user_id: USER,
      currency: CURRENCY,
      game: GAME,
      game_id: uuidv4(),
      finished: true,
      actions: [{ action: "rollback", action_id: uuidv4(), original_action_id: betId }],
    });

    await processRequest({
      user_id: USER,
      currency: CURRENCY,
      game: GAME,
      game_id: uuidv4(),
      finished: true,
      actions: [{ action: "bet", action_id: betId, amount: 100 }],
    });

    const result = await reconcileWalletByUser(USER, CURRENCY);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.status).toBe("ok");
    expect(result.drift).toBe(0n);
    expect(result.walletBalance).toBe(BigInt(SEED));
    expect(result.counts.preRollback).toBe(1);
    expect(result.counts.noop).toBe(1);
    expect(result.sumDelta).toBe(0n);
  });

  it("detects chain_break when ledger balance_before is corrupted", async () => {
    await processRequest({
      user_id: USER,
      currency: CURRENCY,
      game: GAME,
      game_id: uuidv4(),
      actions: [
        { action: "bet", action_id: uuidv4(), amount: 100 },
        { action: "win", action_id: uuidv4(), amount: 250 },
      ],
    });

    const sql = getTestSql();
    await sql`
      UPDATE ledger_actions
      SET balance_before = balance_before - 1
      WHERE wallet_id = (SELECT id FROM wallets WHERE provider_user_id = ${USER} AND currency = ${CURRENCY})
        AND id = (
          SELECT id FROM ledger_actions
          WHERE wallet_id = (SELECT id FROM wallets WHERE provider_user_id = ${USER} AND currency = ${CURRENCY})
          ORDER BY created_at ASC, id ASC
          OFFSET 1 LIMIT 1
        )
    `;

    const result = await reconcileWalletByUser(USER, CURRENCY);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.status).toBe("chain_break");
    expect(result.chainBreakDetail).not.toBeNull();
  });
});
