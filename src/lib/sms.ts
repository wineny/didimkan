// 문자 발송(서버 전용). 솔라피 키 3개가 다 있으면 solapi, 아니면 console(발송 안 함, 기록만).
// 모든 발송은 sms_log 에 남긴다. 알림 문자는 (alert_id, kind) 유니크로 두 번 보내지 않는다(spec-m2 §2).
import { createHmac, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { ensureAppTables } from "@/db/app";
import { smsLog } from "@/db/app-schema";
import { db } from "@/db/client";
import { maskOtpBody } from "./otp";
import { maskPhone } from "./phone";

export type SmsKind = "otp" | "d3" | "d0";
export type SmsProvider = "solapi" | "console";

export type SendSmsInput = {
  to: string;
  text: string;
  kind: SmsKind;
  alertId?: string | null;
  userId?: string | null;
  /** 상한 검사와 함께 미리 예약해 둔 sms_log 행(status 'sending'). 있으면 새로 넣지 않고 그 행의 상태만 바꾼다. */
  logId?: number;
};

export type SendSmsResult = {
  ok: boolean;
  status: "sent" | "failed" | "dry" | "skipped";
  providerId?: string;
  error?: string;
};

const SOLAPI_URL = "https://api.solapi.com/messages/v4/send";
const SOLAPI_TIMEOUT_MS = 10_000;

export function getSmsProvider(): SmsProvider {
  const { SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER } = process.env;
  return SOLAPI_API_KEY && SOLAPI_API_SECRET && SOLAPI_SENDER ? "solapi" : "console";
}

/**
 * 문자 1건. 먼저 sms_log 에 행을 넣고(console 은 'dry', solapi 는 'sending'),
 * 유니크 위반이면 이미 보낸 것이라 'skipped'. solapi 결과로 'sent'/'failed' 를 적는다.
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const to = input.to.replace(/\D/g, "");
  const provider = getSmsProvider();
  const body = input.kind === "otp" ? maskOtpBody(input.text) : input.text;
  await ensureAppTables();

  let logId = input.logId;
  if (logId == null) {
    const inserted = await db
      .insert(smsLog)
      .values({
        kind: input.kind,
        alertId: input.alertId ?? null,
        userId: input.userId ?? null,
        toPhone: to,
        body,
        provider,
        status: provider === "console" ? "dry" : "sending",
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning({ id: smsLog.id });
    logId = inserted[0]?.id;
    if (logId == null) return { ok: true, status: "skipped" };
  }

  if (provider === "console") {
    if (input.logId != null) {
      await db.update(smsLog).set({ status: "dry", provider }).where(eq(smsLog.id, logId));
    }
    console.log(`[sms:console] kind=${input.kind} to=${maskPhone(to)} text=${body}`);
    return { ok: true, status: "dry" };
  }

  const r = await sendSolapi(to, input.text);
  if (r.ok) {
    await db
      .update(smsLog)
      .set({ status: "sent", providerId: r.providerId ?? null })
      .where(eq(smsLog.id, logId));
    return { ok: true, status: "sent", providerId: r.providerId };
  }
  await db
    .update(smsLog)
    .set({ status: "failed", error: r.error })
    .where(eq(smsLog.id, logId));
  console.warn(`[sms:solapi] 실패 kind=${input.kind} to=${maskPhone(to)} error=${r.error}`);
  return { ok: false, status: "failed", error: r.error };
}

/** 솔라피 HMAC-SHA256 헤더: signature = HMAC(secret, date + salt). */
function solapiAuthHeader(apiKey: string, secret: string): string {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const signature = createHmac("sha256", secret).update(date + salt).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/** 오류 문구에는 비밀값·번호·본문을 담지 않는다(HTTP 상태와 솔라피 errorCode 만). */
async function sendSolapi(
  to: string,
  text: string,
): Promise<{ ok: true; providerId?: string } | { ok: false; error: string }> {
  const apiKey = process.env.SOLAPI_API_KEY ?? "";
  const secret = process.env.SOLAPI_API_SECRET ?? "";
  const from = (process.env.SOLAPI_SENDER ?? "").replace(/\D/g, "");
  try {
    const res = await fetch(SOLAPI_URL, {
      method: "POST",
      headers: {
        Authorization: solapiAuthHeader(apiKey, secret),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: { to, from, text } }),
      signal: AbortSignal.timeout(SOLAPI_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as
      | { messageId?: unknown; errorCode?: unknown }
      | null;
    if (!res.ok) {
      const code = typeof json?.errorCode === "string" ? ` ${json.errorCode.slice(0, 60)}` : "";
      return { ok: false, error: `solapi HTTP ${res.status}${code}` };
    }
    const providerId = typeof json?.messageId === "string" ? json.messageId : undefined;
    return { ok: true, providerId };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return { ok: false, error: name === "TimeoutError" ? "solapi timeout" : "solapi network" };
  }
}
