import { describe, expect, it } from "vitest";
import { checkCode, genCode, hashCode, maskOtpBody, otpLimit, otpText } from "./otp";

describe("genCode", () => {
  it("언제나 숫자 6자리", () => {
    for (let i = 0; i < 200; i++) expect(genCode()).toMatch(/^\d{6}$/);
  });
});

describe("hashCode·checkCode", () => {
  const salt = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
  it("같은 salt·코드면 통과, 다르면 실패", () => {
    const h = hashCode(salt, "012345");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(checkCode(h, salt, "012345")).toBe(true);
    expect(checkCode(h, salt, "012346")).toBe(false);
    expect(checkCode(h, "other-salt", "012345")).toBe(false);
  });
  it("망가진 해시는 실패(던지지 않음)", () => {
    expect(checkCode("", salt, "012345")).toBe(false);
    expect(checkCode("zz", salt, "012345")).toBe(false);
  });
});

describe("otpLimit", () => {
  const zero = { phone10m: 0, phone1d: 0, all1h: 0, all1d: 0 };
  it("상한 아래면 통과", () => {
    expect(otpLimit(zero)).toEqual({ ok: true });
    expect(otpLimit({ phone10m: 2, phone1d: 9, all1h: 99, all1d: 499 })).toEqual({ ok: true });
  });
  it("번호당 10분 3회", () => {
    expect(otpLimit({ ...zero, phone10m: 3, phone1d: 3 })).toEqual({ ok: false, retryAfterSec: 600 });
  });
  it("번호당 하루 10회·전체 1시간 100회·하루 500회", () => {
    expect(otpLimit({ ...zero, phone1d: 10 })).toEqual({ ok: false, retryAfterSec: 86400 });
    expect(otpLimit({ ...zero, all1h: 100 })).toEqual({ ok: false, retryAfterSec: 3600 });
    expect(otpLimit({ ...zero, all1d: 500 })).toEqual({ ok: false, retryAfterSec: 86400 });
  });
});

describe("otpText·maskOtpBody", () => {
  it("기록 본문에는 숫자가 남지 않는다", () => {
    const t = otpText("004271");
    expect(t).toBe("[디딤칸] 인증번호 004271 (5분 안에 입력해 주세요)");
    expect(maskOtpBody(t)).toBe("[디딤칸] 인증번호 ****** (5분 안에 입력해 주세요)");
  });
});
