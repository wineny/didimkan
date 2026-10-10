// 로그인(전화번호 + 문자 6자리)·세션(서버 전용 — 서버 코드에서만 import 한다).
// 쿠키에는 토큰, DB 에는 토큰의 sha256 만 둔다(spec-m2 §0-5·§3·§13 F5·F6·F8·F13).
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { ensureAppTables } from "@/db/app";
import { alerts, otpCodes, sessions, smsLog, users } from "@/db/app-schema";
import { client, db } from "@/db/client";
import {
  OTP_LIMITS,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  checkCode,
  genCode,
  hashCode,
  maskOtpBody,
  otpLimit,
  otpText,
} from "./otp";
import { normalizePhone } from "./phone";
import { getSmsProvider, sendSms } from "./sms";

export const SESSION_COOKIE = "didim_s";
const SESSION_DAYS = 90;
const SESSION_MAX_AGE_SEC = SESSION_DAYS * 24 * 60 * 60;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
    secure:
      process.env.NODE_ENV === "production" &&
      !(process.env.DIDIM_INSECURE_COOKIE === "1" && !process.env.VERCEL_ENV),
  };
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * 「내 번호 지우기」 뒤 OTP 기록에 남기는 번호 자리. 상한 집계용이며 하루 뒤 크론이 지운다.
 * 휴대전화 번호는 경우의 수가 적어 맨 sha256 은 되돌릴 수 있으므로 서버 비밀값을 섞은 HMAC 으로 만든다.
 */
function hashedPhone(phone: string): string {
  const key = process.env.DIDIM_HASH_SECRET ?? process.env.CRON_SECRET ?? "didimkan-dev";
  return `h:${createHmac("sha256", key).update(phone).digest("hex")}`;
}

function isoAgo(ms: number, now = Date.now()): string {
  return new Date(now - ms).toISOString();
}

export type RequestOtpResult =
  | { ok: true; devCode?: string }
  | { ok: false; reason: "invalid" | "rate" | "failed" | "unavailable"; retryAfterSec?: number };

/**
 * 인증번호를 만들어 문자로 보낸다. 상한은 sms_log(kind='otp') 집계.
 * devCode 는 console 공급자 + DIDIM_OTP_ECHO=1 + VERCEL_ENV 없음(로컬·CI)일 때만.
 * 'failed' 는 솔라피 발송 실패(§3 에 없던 경우라 추가).
 * 'unavailable' 은 Vercel(Preview·Production)인데 솔라피 키가 없어 문자를 보낼 수 없는 때 —
 * 코드를 만들지도, 기록하지도 않는다(오지 않는 문자를 기다리게 하지 않는다. decisions-pending 5).
 */
export async function requestOtp(phone: string): Promise<RequestOtpResult> {
  const p = normalizePhone(phone);
  if (!p) return { ok: false, reason: "invalid" };
  const provider = getSmsProvider();
  if (provider === "console" && process.env.VERCEL_ENV) return { ok: false, reason: "unavailable" };
  await ensureAppTables();

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const t10m = isoAgo(OTP_LIMITS.phone10m.windowSec * 1000, now);
  const t1h = isoAgo(OTP_LIMITS.all1h.windowSec * 1000, now);
  const t1d = isoAgo(OTP_LIMITS.phone1d.windowSec * 1000, now);
  const code = genCode();

  // 상한 집계와 기록 예약을 **한 문장**으로 한다(SQLite 는 문장 단위로 직렬화되므로 동시 요청이 상한을 넘지 못한다).
  // 행이 들어갔을 때만 코드를 만들고 보낸다. 실패(failed) 행도 집계에 들어가 반복 요청을 막는다.
  const reserved = await client.execute({
    sql: `INSERT INTO sms_log (kind, alert_id, user_id, to_phone, body, provider, provider_id, status, error, created_at)
      SELECT 'otp', NULL, NULL, ?, ?, ?, NULL, 'sending', NULL, ?
      WHERE (SELECT count(*) FROM sms_log WHERE kind = 'otp' AND to_phone IN (?, ?) AND created_at > ?) < ?
        AND (SELECT count(*) FROM sms_log WHERE kind = 'otp' AND to_phone IN (?, ?) AND created_at > ?) < ?
        AND (SELECT count(*) FROM sms_log WHERE kind = 'otp' AND created_at > ?) < ?
        AND (SELECT count(*) FROM sms_log WHERE kind = 'otp' AND created_at > ?) < ?
      RETURNING id`,
    args: [
      p, maskOtpBody(otpText(code)), provider, nowIso,
      p, hashedPhone(p), t10m, OTP_LIMITS.phone10m.max,
      p, hashedPhone(p), t1d, OTP_LIMITS.phone1d.max,
      t1h, OTP_LIMITS.all1h.max,
      t1d, OTP_LIMITS.all1d.max,
    ],
  });
  const logId = reserved.rows[0]?.id;
  if (logId == null) {
    // 어느 창이 넘쳤는지는 안내용으로만 다시 센다(경쟁 조건과 무관).
    const [c] = await db
      .select({
        phone10m: sql<number>`coalesce(sum(case when ${smsLog.toPhone} in (${p}, ${hashedPhone(p)}) and ${smsLog.createdAt} > ${t10m} then 1 else 0 end), 0)`,
        phone1d: sql<number>`coalesce(sum(case when ${smsLog.toPhone} in (${p}, ${hashedPhone(p)}) then 1 else 0 end), 0)`,
        all1h: sql<number>`coalesce(sum(case when ${smsLog.createdAt} > ${t1h} then 1 else 0 end), 0)`,
        all1d: sql<number>`count(*)`,
      })
      .from(smsLog)
      .where(and(eq(smsLog.kind, "otp"), gt(smsLog.createdAt, t1d)));
    const limit = otpLimit({
      phone10m: Number(c?.phone10m ?? 0),
      phone1d: Number(c?.phone1d ?? 0),
      all1h: Number(c?.all1h ?? 0),
      all1d: Number(c?.all1d ?? 0),
    });
    return { ok: false, reason: "rate", retryAfterSec: limit.retryAfterSec ?? OTP_LIMITS.phone10m.windowSec };
  }

  const salt = randomBytes(16).toString("hex");
  await db.insert(otpCodes).values({
    phone: p,
    codeHash: hashCode(salt, code),
    salt,
    expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
    createdAt: nowIso,
  });

  const sent = await sendSms({ to: p, text: otpText(code), kind: "otp", logId: Number(logId) });
  if (!sent.ok) return { ok: false, reason: "failed" };

  // 개발용 코드 에코: console 공급자 + DIDIM_OTP_ECHO=1 + Vercel 아님 + **파일 DB** 일 때만(원격 DB 를 보는 로컬 production 실행에서 새지 않게).
  const echo =
    provider === "console" &&
    process.env.DIDIM_OTP_ECHO === "1" &&
    !process.env.VERCEL_ENV &&
    (process.env.TURSO_DATABASE_URL ?? "").startsWith("file:");
  return echo ? { ok: true, devCode: code } : { ok: true };
}

export type VerifyOtpResult =
  | { ok: true; userId: string; token: string }
  | { ok: false; reason: "wrong" | "expired" | "locked" | "invalid" };

/**
 * 그 번호의 가장 최근 코드 1건(미소비)과 비교한다. 비교 전에 시도 횟수를 원자적으로 올리고(F6),
 * 5번째 오답은 locked 로 알린다. 성공하면 소비 표시 → users upsert → 세션 생성.
 */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const p = normalizePhone(phone);
  const c = String(code ?? "").replace(/\s/g, "");
  if (!p || !/^\d{6}$/.test(c)) return { ok: false, reason: "invalid" };
  await ensureAppTables();

  // 가장 최근에 보낸 코드만 유효하다. 이미 쓴 코드면 expired(다시 보내기 안내).
  const [latest] = await db
    .select({ id: otpCodes.id, expiresAt: otpCodes.expiresAt, consumedAt: otpCodes.consumedAt })
    .from(otpCodes)
    .where(eq(otpCodes.phone, p))
    .orderBy(desc(otpCodes.createdAt), desc(otpCodes.id))
    .limit(1);
  if (!latest || latest.consumedAt) return { ok: false, reason: "expired" };

  const nowIso = new Date().toISOString();
  const [row] = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(
      and(
        eq(otpCodes.id, latest.id),
        lt(otpCodes.attempts, OTP_MAX_ATTEMPTS),
        isNull(otpCodes.consumedAt),
        gt(otpCodes.expiresAt, nowIso),
      ),
    )
    .returning({
      codeHash: otpCodes.codeHash,
      salt: otpCodes.salt,
      attempts: otpCodes.attempts,
    });
  if (!row) {
    return { ok: false, reason: latest.expiresAt <= nowIso ? "expired" : "locked" };
  }
  if (!checkCode(row.codeHash, row.salt, c)) {
    return { ok: false, reason: row.attempts >= OTP_MAX_ATTEMPTS ? "locked" : "wrong" };
  }

  const consumed = await db
    .update(otpCodes)
    .set({ consumedAt: nowIso })
    .where(and(eq(otpCodes.id, latest.id), isNull(otpCodes.consumedAt)))
    .returning({ id: otpCodes.id });
  if (consumed.length === 0) return { ok: false, reason: "expired" };

  await db
    .insert(users)
    .values({ id: randomUUID(), phone: p, createdAt: nowIso })
    .onConflictDoNothing({ target: users.phone });
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, p))
    .limit(1);
  if (!user) throw new Error("사용자 행을 만들지 못했습니다");

  const token = await createSession(user.id);
  return { ok: true, userId: user.id, token };
}

/** 세션을 만들고 토큰(32바이트 hex)을 돌려준다. DB 에는 sha256(토큰). */
export async function createSession(userId: string): Promise<string> {
  await ensureAppTables();
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SESSION_MAX_AGE_SEC * 1000).toISOString(),
  });
  return token;
}

/** 쿠키가 없으면 DB 를 치지 않고 null. DB 오류는 던진다(TopBar 가 잡는다). */
export async function getSession(): Promise<{ userId: string; phone: string } | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  await ensureAppTables();
  const [row] = await db
    .select({ userId: users.id, phone: users.phone })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date().toISOString())))
    .limit(1);
  return row ?? null;
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  await ensureAppTables();
  await db.delete(sessions).where(eq(sessions.id, sha256(token)));
}

/**
 * 「내 번호 지우기」: 그 사용자의 알림·세션·인증번호·알림 문자기록·사용자 행 전부(F5).
 * OTP 문자 기록만은 지우지 않고 번호를 해시로 바꿔 둔다 — 지우면 로그인·지우기를 되풀이해 발송 상한을 되돌릴 수 있다.
 * 그 행은 하루 지나면 크론이 지운다(본문은 이미 가려져 있고, 사용자 id 는 비운다).
 */
export async function deleteUser(userId: string): Promise<void> {
  await ensureAppTables();
  const [user] = await db
    .select({ phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const phone = user?.phone ?? null;
  const otpRows = phone
    ? [
        db
          .update(smsLog)
          .set({ toPhone: hashedPhone(phone), userId: null, body: "" })
          .where(and(eq(smsLog.kind, "otp"), eq(smsLog.toPhone, phone))),
        db.delete(otpCodes).where(eq(otpCodes.phone, phone)),
      ]
    : [];
  await db.batch([
    db.delete(alerts).where(eq(alerts.userId, userId)),
    db.delete(sessions).where(eq(sessions.userId, userId)),
    db
      .delete(smsLog)
      .where(
        and(
          ne(smsLog.kind, "otp"),
          phone ? or(eq(smsLog.userId, userId), eq(smsLog.toPhone, phone)) : eq(smsLog.userId, userId),
        ),
      ),
    ...otpRows,
    db.delete(users).where(eq(users.id, userId)),
  ]);
}
