// 문자 인증번호 순수부(spec-m2 §13 F6·F9). DB·쿠키는 auth.ts 가 다룬다.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

/** 발송 상한. 번호당 10분 3회·하루 10회, 전체 1시간 100회·하루 500회. */
export const OTP_LIMITS = {
  phone10m: { max: 3, windowSec: 10 * 60 },
  phone1d: { max: 10, windowSec: 24 * 60 * 60 },
  all1h: { max: 100, windowSec: 60 * 60 },
  all1d: { max: 500, windowSec: 24 * 60 * 60 },
} as const;

export type OtpCounts = { phone10m: number; phone1d: number; all1h: number; all1d: number };

/** 6자리 숫자(앞자리 0 포함). */
export function genCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(salt: string, code: string): string {
  return createHash("sha256").update(salt + code).digest("hex");
}

/** 저장된 해시와 입력 코드를 상수 시간으로 비교한다. */
export function checkCode(hash: string, salt: string, code: string): boolean {
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(hashCode(salt, code), "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/**
 * 지금 더 보내도 되는지. 넘친 창이 있으면 그중 가장 긴 창 길이를 retryAfterSec 로 준다
 * (개별 발송 시각은 모르므로 상한값).
 */
export function otpLimit(counts: OtpCounts): { ok: boolean; retryAfterSec?: number } {
  let retry = 0;
  for (const key of Object.keys(OTP_LIMITS) as (keyof OtpCounts)[]) {
    const { max, windowSec } = OTP_LIMITS[key];
    if (counts[key] >= max) retry = Math.max(retry, windowSec);
  }
  return retry > 0 ? { ok: false, retryAfterSec: retry } : { ok: true };
}

export function otpText(code: string): string {
  return `[디딤칸] 인증번호 ${code} (5분 안에 입력해 주세요)`;
}

/** 기록용: 본문의 6자리 숫자를 ****** 로 가린다. */
export function maskOtpBody(text: string): string {
  return text.replace(/\d{6}/g, "******");
}
