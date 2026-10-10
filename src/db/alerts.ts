// 관심 등록(알림)과 크론 발송. 규칙: spec-m2 §3·§13(F1 alertApplyDate, F4 dry, F5 otp 청소).
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { ensureAppTables } from "./app";
import { alerts, otpCodes, sessions, smsLog, users } from "./app-schema";
import { client, db } from "./client";
import { getCoursesWithStatus, type CourseWithStatus } from "./queries";
import { orgName } from "@/lib/copy";
import {
  ALERT_KINDS,
  alertApplyDate,
  dueKinds,
  nextSms,
  smsText,
  type AlertKind,
} from "@/lib/notify";
import { maskPhone } from "@/lib/phone";
import { sendSms } from "@/lib/sms";
import { getNow } from "@/lib/today";
import { safeHttpUrl } from "@/lib/url";

/** 한 번 실행에 보내는 문자 상한(함수 실행 시간 60초 안에 끝나게). 넘친 건수는 결과 overflow 로 알린다 — 창 안에 다음 실행이 없어 그 건은 나가지 않는다. */
const MAX_PER_RUN = 200;
/** inArray 한 번에 넣는 id 수. */
const CHUNK = 500;
/** 동시에 보내는 문자 수. */
const SEND_CONCURRENCY = 5;
const OTP_KEEP_MS = 24 * 60 * 60 * 1000;

type Now = { date: string; hour: number };
type CourseView = CourseWithStatus & { phone: string | null };

export type AlertView = {
  id: string;
  courseId: string;
  isOn: boolean;
  createdAt: string;
  /** 강좌가 사라졌으면 null(「강좌 정보가 바뀌었어요」). */
  course: CourseView | null;
  /** 알림 기준 접수일(alertApplyDate). 연중·날짜 없음이면 null. */
  applyDate: string | null;
  isEstimate: boolean;
  /** 이미 보낸 문자(sms_log status 'sent'·'dry'). */
  sent: AlertKind[];
  /** 다음에 보낼 문자. 알림이 꺼졌거나 남은 칸이 없으면 null. */
  next: { kind: AlertKind; date: string; hour: number } | null;
};

const isKind = (k: string): k is AlertKind => (ALERT_KINDS as readonly string[]).includes(k);

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

/** alertId → 보낸 kind. statuses 에 든 행만 센다. */
async function sentKinds(
  alertIds: readonly string[],
  statuses: readonly ("sending" | "sent" | "dry")[],
): Promise<Map<string, Set<AlertKind>>> {
  const out = new Map<string, Set<AlertKind>>();
  for (const part of chunks(alertIds)) {
    const rows = await db
      .select({ alertId: smsLog.alertId, kind: smsLog.kind })
      .from(smsLog)
      .where(and(inArray(smsLog.alertId, part), inArray(smsLog.status, [...statuses])));
    for (const r of rows) {
      if (!r.alertId || !isKind(r.kind)) continue;
      const set = out.get(r.alertId) ?? new Set<AlertKind>();
      set.add(r.kind);
      out.set(r.alertId, set);
    }
  }
  return out;
}

async function coursesById(ids: readonly string[], today: string): Promise<Map<string, CourseView>> {
  const out = new Map<string, CourseView>();
  for (const part of chunks([...new Set(ids)])) {
    for (const [k, v] of await getCoursesWithStatus(part, today)) out.set(k, v);
  }
  return out;
}

function toNow(now: string | Now | undefined): Now {
  if (now === undefined) return getNow();
  if (typeof now === "string") return { date: now, hour: getNow().hour };
  return now;
}

/** 관심 등록. 강좌가 없거나 연중·수시면 null. 이미 있으면 기존 id(꺼져 있었으면 다시 켠다). */
/** 한 사람이 켜 둘 수 있는 알림 수. 문자 비용·한 번 실행 상한(500통)을 한 사람이 다 쓰지 못하게. */
export const MAX_ALERTS_PER_USER = 30;

export async function createAlert(
  userId: string,
  courseId: string,
): Promise<{ id: string; created: boolean } | { error: "not_found" | "limit" }> {
  await ensureAppTables();
  const today = getNow().date;
  const c = (await getCoursesWithStatus([courseId], today)).get(courseId);
  // 연중·접수일 없음·접수일이 이미 지난 강좌는 보낼 문자가 없다.
  const ad = c ? alertApplyDate(c, c.pattern) : null;
  if (!c || !ad || ad.date < today) return { error: "not_found" };

  // 상한 검사와 등록을 한 문장으로(동시 요청이 30개를 넘지 못하게). 같은 강좌가 이미 있으면 유니크 위반으로 0행.
  const id = crypto.randomUUID();
  const inserted = await client.execute({
    sql: `INSERT OR IGNORE INTO alerts (id, user_id, course_id, is_on, created_at)
      SELECT ?, ?, ?, 1, ?
      WHERE (SELECT count(*) FROM alerts WHERE user_id = ? AND is_on = 1 AND course_id <> ?) < ?
      RETURNING id`,
    args: [id, userId, courseId, new Date().toISOString(), userId, courseId, MAX_ALERTS_PER_USER],
  });
  if (inserted.rows[0]) return { id: String(inserted.rows[0].id), created: true };

  // 이미 있던 알림(꺼져 있을 수 있음)이면 다시 켠다. 켤 때도 같은 상한을 센다.
  const [existing] = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(and(eq(alerts.userId, userId), eq(alerts.courseId, courseId)))
    .limit(1);
  if (!existing) return { error: "limit" };
  const turned = await turnOn(userId, existing.id);
  return turned ? { id: existing.id, created: false } : { error: "limit" };
}

/** 켤 때도 켜진 알림 수를 같은 문장에서 센다(상한 30). 이미 켜져 있으면 그대로 true. */
async function turnOn(userId: string, alertId: string): Promise<boolean> {
  const r = await client.execute({
    sql: `UPDATE alerts SET is_on = 1
      WHERE id = ? AND user_id = ?
        AND (is_on = 1 OR (SELECT count(*) FROM alerts WHERE user_id = ? AND is_on = 1) < ?)
      RETURNING id`,
    args: [alertId, userId, userId, MAX_ALERTS_PER_USER],
  });
  return r.rows.length > 0;
}

async function views(
  rows: (typeof alerts.$inferSelect)[],
  now: Now,
): Promise<AlertView[]> {
  if (rows.length === 0) return [];
  const [byCourse, sentMap] = await Promise.all([
    coursesById(rows.map((r) => r.courseId), now.date),
    sentKinds(rows.map((r) => r.id), ["sent", "dry"]),
  ]);
  return rows.map((r) => {
    const course = byCourse.get(r.courseId) ?? null;
    const ad = course ? alertApplyDate(course, course.pattern) : null;
    const sentSet = sentMap.get(r.id) ?? new Set<AlertKind>();
    const isOn = r.isOn === 1;
    return {
      id: r.id,
      courseId: r.courseId,
      isOn,
      createdAt: r.createdAt,
      course,
      applyDate: ad?.date ?? null,
      isEstimate: ad?.isEstimate ?? false,
      sent: ALERT_KINDS.filter((k) => sentSet.has(k)),
      next: ad && isOn ? nextSms(ad.date, now, sentSet) : null,
    };
  });
}

/** 내 알림 전부(최근 등록 먼저). now 를 안 주면 getNow(), 날짜 문자열만 주면 시는 실제 시각. */
export async function listMyAlerts(userId: string, now?: string | Now): Promise<AlertView[]> {
  await ensureAppTables();
  const rows = await db
    .select()
    .from(alerts)
    .where(eq(alerts.userId, userId))
    .orderBy(desc(alerts.createdAt), desc(alerts.id));
  return views(rows, toNow(now));
}

/** 내 알림 하나. 없거나 남의 것이면 null. */
export async function getMyAlert(
  userId: string,
  alertId: string,
  now?: string | Now,
): Promise<AlertView | null> {
  await ensureAppTables();
  const rows = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
    .limit(1);
  const [v] = await views(rows, toNow(now));
  return v ?? null;
}

/** 끄기는 언제나, 켜기는 상한(30) 안에서만. 없는/남의 알림·상한 초과는 false. */
export async function setAlertOn(userId: string, alertId: string, on: boolean): Promise<boolean> {
  await ensureAppTables();
  if (on) return turnOn(userId, alertId);
  const r = await db
    .update(alerts)
    .set({ isOn: 0 })
    .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
    .returning({ id: alerts.id });
  return r.length > 0;
}

export async function deleteAlert(userId: string, alertId: string): Promise<boolean> {
  await ensureAppTables();
  const r = await db
    .delete(alerts)
    .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
    .returning({ id: alerts.id });
  return r.length > 0;
}

export type NotifyResult = {
  now: Now;
  planned: { alertId: string; kind: AlertKind; to: string }[];
  sent: number;
  failed: number;
  skipped: number;
  /** 상한에 걸려 이번 실행에서 못 보낸 건수(창 안에 다음 실행이 없어 나가지 않는다) */
  overflow: number;
};

/**
 * 크론 1회: 켜진 알림 → 강좌 → alertApplyDate → dueKinds → 문자.
 * dry 면 sendSms 를 부르지 않고 planned 만 돌려준다(기록·청소도 하지 않음).
 * 끝에 하루 지난 인증번호 행(otp_codes, sms_log kind='otp')을 지운다.
 */
export async function runNotify(now: Now, { dry = false }: { dry?: boolean } = {}): Promise<NotifyResult> {
  await ensureAppTables();
  const rows = await db
    .select({ id: alerts.id, userId: alerts.userId, courseId: alerts.courseId, phone: users.phone })
    .from(alerts)
    .innerJoin(users, eq(users.id, alerts.userId))
    .where(eq(alerts.isOn, 1))
    .orderBy(alerts.createdAt, alerts.id);

  const byCourse = await coursesById(rows.map((r) => r.courseId), now.date);
  const none = new Set<AlertKind>();
  const due = rows.flatMap((r) => {
    const course = byCourse.get(r.courseId);
    const ad = course ? alertApplyDate(course, course.pattern) : null;
    if (!course || !ad) return [];
    const kinds = dueKinds(ad.date, now, none);
    return kinds.length ? [{ ...r, course, ad, kinds }] : [];
  });

  // 'sending' 도 보낸 것으로 본다(유니크 색인과 같은 기준: failed 만 다시 보낼 수 있다).
  const sentMap = await sentKinds(due.map((d) => d.id), ["sending", "sent", "dry"]);
  const allJobs = due.flatMap((d) =>
    d.kinds.filter((k) => !sentMap.get(d.id)?.has(k)).map((kind) => ({ ...d, kind })),
  );
  const jobs = allJobs.slice(0, MAX_PER_RUN);

  const result: NotifyResult = {
    now,
    planned: jobs.map((j) => ({ alertId: j.id, kind: j.kind, to: maskPhone(j.phone) })),
    sent: 0,
    failed: 0,
    skipped: 0,
    overflow: allJobs.length - jobs.length,
  };
  if (dry) return result;

  for (let i = 0; i < jobs.length; i += SEND_CONCURRENCY) {
    await Promise.all(
      jobs.slice(i, i + SEND_CONCURRENCY).map(async (j) => {
        const c = j.course;
        const text = smsText(j.kind, {
          title: c.title,
          applyDate: j.ad.date,
          isEstimate: j.ad.isEstimate,
          source: c.source,
          orgName: orgName(c),
          siteUrl: safeHttpUrl(c.detailUrl) ?? safeHttpUrl(c.homepageUrl),
          phone: c.phone,
          capacity: c.capacity,
          selectionMethod: c.selectionMethod,
        });
        try {
          const r = await sendSms({ to: j.phone, text, kind: j.kind, alertId: j.id, userId: j.userId });
          if (r.status === "sent" || r.status === "dry") result.sent += 1;
          else if (r.status === "skipped") result.skipped += 1;
          else result.failed += 1;
        } catch (e) {
          // 번호·본문은 남기지 않는다.
          console.warn(`[notify] 발송 오류 alert=${j.id} kind=${j.kind} ${e instanceof Error ? e.name : ""}`);
          result.failed += 1;
        }
      }),
    );
  }

  const cutoff = new Date(Date.now() - OTP_KEEP_MS).toISOString();
  await db.delete(otpCodes).where(lt(otpCodes.createdAt, cutoff));
  await db.delete(smsLog).where(and(eq(smsLog.kind, "otp"), lt(smsLog.createdAt, cutoff)));
  // 만료된 세션 행도 여기서 지운다(다른 정리 지점이 없다).
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString()));
  return result;
}
