import { pgTable, uuid, bigint, timestamp } from "drizzle-orm/pg-core";
import { wallets } from "./wallets.js";

export const rollbackIntents = pgTable("rollback_intents", {
  originalActionId: uuid("original_action_id").primaryKey(),
  rollbackActionId: uuid("rollback_action_id").notNull(),
  walletId: bigint("wallet_id", { mode: "bigint" })
    .notNull()
    .references(() => wallets.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RollbackIntent = typeof rollbackIntents.$inferSelect;
export type NewRollbackIntent = typeof rollbackIntents.$inferInsert;
