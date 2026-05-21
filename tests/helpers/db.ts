import postgres from "postgres";

const TEST_DB_URL = process.env["DATABASE_URL"] ?? "postgres://yeet:yeet@localhost:5433/yeet_test";

let _sql: ReturnType<typeof postgres> | null = null;

export function getTestSql(): ReturnType<typeof postgres> {
  if (!_sql) {
    _sql = postgres(TEST_DB_URL, { max: 5 });
  }
  return _sql;
}

export async function truncateAll(): Promise<void> {
  const sql = getTestSql();
  await sql`TRUNCATE TABLE rtp_hourly, rollback_intents, action_lookup, ledger_actions, wallets RESTART IDENTITY CASCADE`;
}

export async function seedAcceptanceWallet(): Promise<void> {
  const sql = getTestSql();
  await sql`
    INSERT INTO wallets (provider_user_id, currency, balance)
    VALUES ('8|USDT|USD', 'USD', 74322001)
    ON CONFLICT (provider_user_id, currency)
    DO UPDATE SET balance = 74322001, updated_at = now()
  `;
}

export async function closeTestDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
  }
}
