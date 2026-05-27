import { describe, it, expect } from "vitest";
import { replayWalletLedger } from "@/services/ledger-reconciliation.js";
import type { ReconcileLedgerRow } from "@/domain/sql-rows.js";
import { toBalance, toLedgerId } from "@/domain/types.js";
import { ACTION_TYPE_TO_DB, LEDGER_STATUS_TO_DB } from "@/domain/types.js";

function ledgerRow(
  id: bigint,
  actionType: number,
  status: number,
  amount: bigint,
  balanceBefore: bigint,
  balanceAfter: bigint,
): ReconcileLedgerRow {
  return {
    id: toLedgerId(id),
    actionType,
    status,
    amount: toBalance(amount),
    balanceBefore: toBalance(balanceBefore),
    balanceAfter: toBalance(balanceAfter),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("replayWalletLedger", () => {
  it("returns null expected balance for empty ledger", () => {
    const replay = replayWalletLedger([]);
    expect(replay.expectedBalance).toBeNull();
    expect(replay.sumDelta).toBe(0n);
    expect(replay.chainBreakAtLedgerId).toBeNull();
  });

  it("replays bet then win chain", () => {
    const rows = [
      ledgerRow(
        1n,
        ACTION_TYPE_TO_DB.bet,
        LEDGER_STATUS_TO_DB.applied,
        100n,
        1000n,
        900n,
      ),
      ledgerRow(
        2n,
        ACTION_TYPE_TO_DB.win,
        LEDGER_STATUS_TO_DB.applied,
        250n,
        900n,
        1150n,
      ),
    ];

    const replay = replayWalletLedger(rows);
    expect(replay.expectedBalance).toBe(1150n);
    expect(replay.sumDelta).toBe(150n);
    expect(replay.counts.appliedBet).toBe(1);
    expect(replay.counts.appliedWin).toBe(1);
    expect(replay.chainBreakAtLedgerId).toBeNull();
  });

  it("detects broken balance chain", () => {
    const rows = [
      ledgerRow(1n, ACTION_TYPE_TO_DB.bet, LEDGER_STATUS_TO_DB.applied, 100n, 1000n, 900n),
      ledgerRow(2n, ACTION_TYPE_TO_DB.win, LEDGER_STATUS_TO_DB.applied, 50n, 800n, 850n),
    ];

    const replay = replayWalletLedger(rows);
    expect(replay.chainBreakAtLedgerId).toBe(toLedgerId(2n));
    expect(replay.chainBreakDetail).toContain("900");
    expect(replay.chainBreakDetail).toContain("800");
  });

  it("counts noop and pre_rollback rows without balance effect", () => {
    const rows = [
      ledgerRow(
        1n,
        ACTION_TYPE_TO_DB.rollback,
        LEDGER_STATUS_TO_DB.pre_rollback,
        0n,
        1000n,
        1000n,
      ),
      ledgerRow(2n, ACTION_TYPE_TO_DB.bet, LEDGER_STATUS_TO_DB.noop, 100n, 1000n, 1000n),
    ];

    const replay = replayWalletLedger(rows);
    expect(replay.expectedBalance).toBe(1000n);
    expect(replay.sumDelta).toBe(0n);
    expect(replay.counts.preRollback).toBe(1);
    expect(replay.counts.noop).toBe(1);
  });
});
