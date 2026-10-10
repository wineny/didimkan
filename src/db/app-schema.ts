// 앱 테이블(Drizzle). 로그인·관심 등록·문자 기록용 — 강좌 계약(schema.ts)과 따로 둔다.
// DDL 은 src/db/app-ddl.ts 가 원본이고, 여기 컬럼·제약은 그것과 같아야 한다(spec-m2 §2).
// FK 는 두지 않는다(courses 는 Turso 교체 때 통째로 바뀐다).
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

export const otpCodes = sqliteTable(
  "otp_codes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    salt: text("salt").notNull(),
    expiresAt: text("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: text("consumed_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_otp_phone_created").on(t.phone, t.createdAt)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** 토큰의 sha256 hex. 토큰 자체는 저장하지 않는다. */
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("idx_sessions_user").on(t.userId)],
);

export const alerts = sqliteTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    courseId: text("course_id").notNull(),
    isOn: integer("is_on").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("alerts_is_on", sql`${t.isOn} IN (0, 1)`),
    unique("alerts_user_course").on(t.userId, t.courseId),
    index("idx_alerts_course").on(t.courseId),
  ],
);

export const SMS_KINDS = ["otp", "d3", "d0"] as const;
export const SMS_STATUSES = ["sending", "sent", "failed", "dry"] as const;

export const smsLog = sqliteTable(
  "sms_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: SMS_KINDS }).notNull(),
    alertId: text("alert_id"),
    userId: text("user_id"),
    /** 숫자만(마스킹 전). 발송 제한 집계와 「내 번호 지우기」에 쓴다. */
    toPhone: text("to_phone").notNull(),
    /** OTP 는 숫자를 가린 본문(maskOtpBody). */
    body: text("body").notNull(),
    provider: text("provider").notNull(),
    providerId: text("provider_id"),
    status: text("status", { enum: SMS_STATUSES }).notNull(),
    error: text("error"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    check("sms_log_kind", sql`${t.kind} IN ('otp', 'd3', 'd0')`),
    check(
      "sms_log_status",
      sql`${t.status} IN ('sending', 'sent', 'failed', 'dry')`,
    ),
    uniqueIndex("uq_sms_log_alert_kind")
      .on(t.alertId, t.kind)
      .where(sql`${t.alertId} IS NOT NULL AND ${t.status} <> 'failed'`),
  ],
);

export type User = typeof users.$inferSelect;
export type OtpCode = typeof otpCodes.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type NewAlert = typeof alerts.$inferInsert;
export type SmsLog = typeof smsLog.$inferSelect;
export type NewSmsLog = typeof smsLog.$inferInsert;
