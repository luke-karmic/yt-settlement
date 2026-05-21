import { pgTable, bigint, varchar, timestamp, bigint as pgBigint, index } from "drizzle-orm/pg-core";
import { wallets } from "./wallets.js";
import { primaryKey } from "drizzle-orm/pg-core";

export const rtpHourly = pgTable(
  "rtp_hourly",
  {
    hourBucket: timestamp("hour_bucket", { withTimezone: true }).notNull(),
    walletId: bigint("wallet_id", { mode: "bigint" })
      .notNull()
      .references(() => wallets.id),
    currency: varchar("currency", { length: 10 }).notNull(),
    totalBet: bigint("total_bet", { mode: "bigint" }).notNull(),
    totalWin: bigint("total_win", { mode: "bigint" }).notNull(),
    rollbackBet: bigint("rollback_bet", { mode: "bigint" }).notNull(),
    rollbackWin: bigint("rollback_win", { mode: "bigint" }).notNull(),
    rounds: bigint("rounds", { mode: "bigint" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.hourBucket, t.walletId, t.currency] }),
    index("rtp_hourly_bucket_idx").on(t.hourBucket),
  ],
);

export type RtpHourly = typeof rtpHourly.$inferSelect;
export type NewRtpHourly = typeof rtpHourly.$inferInsert;
