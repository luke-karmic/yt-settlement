import { sql } from "drizzle-orm";
import { ActionType } from "@/domain/types.js";
import {
  countRowSchema,
  mapRtpAggregateRow,
  parseFirstRow,
  rtpAggregateRowSchema,
  toNumber,
} from "@/domain/sql-rows.js";
import { db } from "@/db/client.js";
import type { RtpQuery, RtpUserEntry } from "@/schemas/rtp.js";
import type { UpdateRtpHourlyInput } from "@/services/types.js";

function hourBucket(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()),
  );
}

/**
 * Upserts hourly RTP counters for a wallet (`rtp_hourly`) inside the caller's transaction.
 * Increments bet/win totals or rollback counters depending on `actionType` and `isRollback`.
 *
 * @param params - Open transaction, wallet, currency, action type, amount, rollback flag
 * @returns Resolves when the hourly bucket row is inserted or updated
 */
export async function updateRtpHourly(params: UpdateRtpHourlyInput): Promise<void> {
  const { tx, walletId, currency, actionType, amount, isRollback } = params;
  const bucket = hourBucket(new Date());

  if (isRollback) {
    if (actionType === ActionType.BET) {
      await tx.execute(
        sql`INSERT INTO rtp_hourly (hour_bucket, wallet_id, currency, rollback_bet)
            VALUES (${bucket.toISOString()}, ${walletId}, ${currency}, ${amount})
            ON CONFLICT (hour_bucket, wallet_id, currency) DO UPDATE
            SET rollback_bet = rtp_hourly.rollback_bet + EXCLUDED.rollback_bet`,
      );
    } else if (actionType === ActionType.WIN) {
      await tx.execute(
        sql`INSERT INTO rtp_hourly (hour_bucket, wallet_id, currency, rollback_win)
            VALUES (${bucket.toISOString()}, ${walletId}, ${currency}, ${amount})
            ON CONFLICT (hour_bucket, wallet_id, currency) DO UPDATE
            SET rollback_win = rtp_hourly.rollback_win + EXCLUDED.rollback_win`,
      );
    }
  } else if (actionType === ActionType.BET) {
    await tx.execute(
      sql`INSERT INTO rtp_hourly (hour_bucket, wallet_id, currency, total_bet, rounds)
          VALUES (${bucket.toISOString()}, ${walletId}, ${currency}, ${amount}, 1)
          ON CONFLICT (hour_bucket, wallet_id, currency) DO UPDATE
          SET total_bet = rtp_hourly.total_bet + EXCLUDED.total_bet,
              rounds = rtp_hourly.rounds + 1`,
    );
  } else if (actionType === ActionType.WIN) {
    await tx.execute(
      sql`INSERT INTO rtp_hourly (hour_bucket, wallet_id, currency, total_win)
          VALUES (${bucket.toISOString()}, ${walletId}, ${currency}, ${amount})
          ON CONFLICT (hour_bucket, wallet_id, currency) DO UPDATE
          SET total_win = rtp_hourly.total_win + EXCLUDED.total_win`,
    );
  }
}

function mapRtpRows(rows: readonly unknown[], defaultUserId: string): RtpUserEntry[] {
  return rows.map((row) => {
    const parsed = rtpAggregateRowSchema.parse(row);
    const userId = parsed.user_id ?? defaultUserId;
    return mapRtpAggregateRow(parsed, userId);
  });
}

/**
 * Returns per-user RTP aggregates for a time window with offset pagination.
 *
 * @param query - ISO `from`/`to` bounds plus `page` and `limit`
 * @returns Paginated RTP rows and total distinct `(user_id, currency)` groups
 */
export async function getRtpUsers(query: RtpQuery): Promise<{ data: RtpUserEntry[]; total: number }> {
  const { from, to, page, limit } = query;
  const offset = (page - 1) * limit;

  const rows = await db.execute(
    sql`SELECT
          w.provider_user_id AS user_id,
          r.currency,
          SUM(r.rounds)::bigint AS rounds,
          SUM(r.total_bet)::bigint AS total_bet,
          SUM(r.total_win)::bigint AS total_win,
          SUM(r.rollback_bet)::bigint AS rollback_bet,
          SUM(r.rollback_win)::bigint AS rollback_win
        FROM rtp_hourly r
        JOIN wallets w ON w.id = r.wallet_id
        WHERE r.hour_bucket >= date_trunc('hour', ${from}::timestamptz)
          AND r.hour_bucket <= date_trunc('hour', ${to}::timestamptz)
        GROUP BY w.provider_user_id, r.currency
        ORDER BY w.provider_user_id
        LIMIT ${limit} OFFSET ${offset}`,
  );

  const countRows = await db.execute(
    sql`SELECT COUNT(DISTINCT (w.provider_user_id, r.currency)) AS total
        FROM rtp_hourly r
        JOIN wallets w ON w.id = r.wallet_id
        WHERE r.hour_bucket >= date_trunc('hour', ${from}::timestamptz)
          AND r.hour_bucket <= date_trunc('hour', ${to}::timestamptz)`,
  );

  const total = toNumber(parseFirstRow(countRowSchema, countRows).total);

  return { data: mapRtpRows(rows, ""), total };
}

/**
 * Returns casino-wide RTP totals grouped by currency (no per-user breakdown).
 *
 * @param query - ISO `from`/`to` hour-bucket bounds
 * @returns One aggregate row per currency with `user_id` set to `"casino"`
 */
export async function getRtpCasino(query: RtpQuery): Promise<RtpUserEntry[]> {
  const { from, to } = query;

  const rows = await db.execute(
    sql`SELECT
          r.currency,
          SUM(r.rounds)::bigint AS rounds,
          SUM(r.total_bet)::bigint AS total_bet,
          SUM(r.total_win)::bigint AS total_win,
          SUM(r.rollback_bet)::bigint AS rollback_bet,
          SUM(r.rollback_win)::bigint AS rollback_win
        FROM rtp_hourly r
        WHERE r.hour_bucket >= date_trunc('hour', ${from}::timestamptz)
          AND r.hour_bucket <= date_trunc('hour', ${to}::timestamptz)
        GROUP BY r.currency
        ORDER BY r.currency`,
  );

  return mapRtpRows(rows, "casino");
}
