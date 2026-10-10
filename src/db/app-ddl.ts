// 앱 테이블 5개 DDL(spec-m2 §2). pipeline/schema.sql 에는 넣지 않는다(계약 테스트·Turso 교체는 4개만).
// 문장 하나씩 client.execute 로 실행한다(ensureAppTables·scripts/ensure-app-tables.ts).
// src/db/app-schema.ts 와 컬럼·제약이 같아야 한다.
export const APP_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  created_at TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_otp_phone_created ON otp_codes (phone, created_at)`,
  `CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  is_on INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  CONSTRAINT alerts_is_on CHECK (is_on IN (0, 1)),
  CONSTRAINT alerts_user_course UNIQUE (user_id, course_id)
)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_course ON alerts (course_id)`,
  `CREATE TABLE IF NOT EXISTS sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  alert_id TEXT,
  user_id TEXT,
  to_phone TEXT NOT NULL,
  body TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_id TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  CONSTRAINT sms_log_kind CHECK (kind IN ('otp', 'd3', 'd0')),
  CONSTRAINT sms_log_status CHECK (status IN ('sending', 'sent', 'failed', 'dry'))
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_log_alert_kind ON sms_log (alert_id, kind) WHERE alert_id IS NOT NULL AND status <> 'failed'`,
];
