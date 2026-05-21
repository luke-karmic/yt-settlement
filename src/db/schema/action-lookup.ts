import { pgTable, uuid, bigint, smallint, timestamp, customType } from "drizzle-orm/pg-core";
import { wallets } from "./wallets.js";
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

export const actionLookup = pgTable("action_lookup", {
  actionId: uuid("action_id").primaryKey(),
  walletId: bigint("wallet_id", { mode: "bigint" })
    .notNull()
    .references(() => wallets.id),
  ledgerId: bigint("ledger_id", { mode: "bigint" }),
  txId: uuid("tx_id").notNull(),
  actionType: actionTypeCol("action_type").notNull(),
  status: ledgerStatusCol("status").notNull(),
  payloadHash: bytea("payload_hash").notNull(),
  partitionHint: timestamp("partition_hint", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ActionLookup = typeof actionLookup.$inferSelect;
export type NewActionLookup = typeof actionLookup.$inferInsert;
