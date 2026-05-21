import {
  pgTable,
  bigserial,
  bigint,
  uuid,
  varchar,
  smallint,
  timestamp,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { wallets } from "./wallets.js";
import { sql } from "drizzle-orm";
import {
  actionTypeFromDb,
  ledgerStatusFromDb,
  ACTION_TYPE_TO_DB,
  LEDGER_STATUS_TO_DB,
  type ActionType,
  type LedgerStatus,
} from "@/domain/types.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const actionTypeCol = customType<{ data: ActionType; driverData: number }>({
  dataType: () => "smallint",
  fromDriver: actionTypeFromDb,
  toDriver: (v) => ACTION_TYPE_TO_DB[v],
});

const ledgerStatusCol = customType<{ data: LedgerStatus; driverData: number }>({
  dataType: () => "smallint",
  fromDriver: ledgerStatusFromDb,
  toDriver: (v) => LEDGER_STATUS_TO_DB[v],
});

export const ledgerActions = pgTable(
  "ledger_actions",
  {
    id: bigserial("id", { mode: "bigint" }).notNull(),
    walletId: bigint("wallet_id", { mode: "bigint" })
      .notNull()
      .references(() => wallets.id),
    txId: uuid("tx_id").notNull(),
    actionId: uuid("action_id").notNull(),
    game: varchar("game", { length: 255 }),
    gameId: varchar("game_id", { length: 255 }),
    actionType: actionTypeCol("action_type").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    balanceBefore: bigint("balance_before", { mode: "bigint" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "bigint" }).notNull(),
    status: ledgerStatusCol("status").notNull(),
    originalActionId: uuid("original_action_id"),
    previousHash: bytea("previous_hash"),
    currentHash: bytea("current_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_wallet_created_idx").on(t.walletId, t.createdAt),
    index("ledger_original_action_idx").on(t.originalActionId).where(sql`${t.originalActionId} IS NOT NULL`),
  ],
);

export type LedgerAction = typeof ledgerActions.$inferSelect;
export type NewLedgerAction = typeof ledgerActions.$inferInsert;
