import { pgTable, bigserial, varchar, bigint, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const wallets = pgTable(
  "wallets",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    providerUserId: varchar("provider_user_id", { length: 255 }).notNull(),
    currency: varchar("currency", { length: 10 }).notNull(),
    balance: bigint("balance", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("wallets_provider_user_id_currency_idx").on(t.providerUserId, t.currency)],
);

export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;
