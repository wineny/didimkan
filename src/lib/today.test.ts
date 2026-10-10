import { afterEach, describe, expect, it, vi } from "vitest";
import { getNow, getToday, nowKst, parseKstNow } from "./today";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("getToday", () => {
  it("DIDIM_ALLOW_TODAY_OVERRIDE=1 이고 비-production 이면 DIDIM_TODAY 를 쓴다", () => {
    vi.stubEnv("DIDIM_TODAY", "2026-10-05");
    vi.stubEnv("DIDIM_ALLOW_TODAY_OVERRIDE", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(getToday()).toBe("2026-10-05");
    vi.stubEnv("VERCEL_ENV", "");
    expect(getToday()).toBe("2026-10-05");
  });
  it("플래그가 없으면 DIDIM_TODAY 를 무시한다", () => {
    vi.stubEnv("DIDIM_TODAY", "2026-10-05");
    vi.stubEnv("DIDIM_ALLOW_TODAY_OVERRIDE", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.useFakeTimers({ now: new Date("2026-12-31T16:00:00Z") });
    expect(getToday()).toBe("2027-01-01");
  });
  it("Vercel production 에서는 플래그가 있어도 무시하고 실제 오늘(KST)", () => {
    vi.stubEnv("DIDIM_TODAY", "2026-10-05");
    vi.stubEnv("DIDIM_ALLOW_TODAY_OVERRIDE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.useFakeTimers({ now: new Date("2026-12-31T16:00:00Z") });
    expect(getToday()).toBe("2027-01-01");
  });
  it("값이 없거나 형식이 틀리면 실제 오늘(KST)", () => {
    vi.stubEnv("DIDIM_TODAY", "내일");
    vi.stubEnv("DIDIM_ALLOW_TODAY_OVERRIDE", "1");
    expect(getToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("nowKst", () => {
  it("UTC 15:00 은 다음 날 0시(KST)", () => {
    expect(nowKst(new Date("2026-12-31T15:00:00Z"))).toEqual({ date: "2027-01-01", hour: 0, minute: 0 });
  });
  it("UTC 09:00 = 18시, 23:00 = 다음 날 8시(크론 두 번)", () => {
    expect(nowKst(new Date("2026-04-23T09:05:00Z"))).toEqual({ date: "2026-04-23", hour: 18, minute: 5 });
    expect(nowKst(new Date("2026-04-25T23:59:00Z"))).toEqual({ date: "2026-04-26", hour: 8, minute: 59 });
  });
});

describe("parseKstNow", () => {
  it("형식이 맞으면 읽고, 틀리면 null", () => {
    expect(parseKstNow("2026-04-26T08:30")).toEqual({ date: "2026-04-26", hour: 8, minute: 30 });
    expect(parseKstNow("2026-04-26 08:30")).toBeNull();
    expect(parseKstNow("2026-04-26T24:00")).toBeNull();
    expect(parseKstNow("2026-04-26T08:60")).toBeNull();
    expect(parseKstNow("")).toBeNull();
    expect(parseKstNow(null)).toBeNull();
  });
});

describe("getNow", () => {
  it("허용되면 DIDIM_NOW 를 쓴다", () => {
    vi.stubEnv("DIDIM_NOW", "2026-04-26T08:30");
    vi.stubEnv("DIDIM_ALLOW_TODAY_OVERRIDE", "1");
    vi.stubEnv("VERCEL_ENV", "");
    expect(getNow()).toEqual({ date: "2026-04-26", hour: 8, minute: 30 });
  });
  it("DIDIM_TODAY 만 있으면 날짜만 바꾸고 시·분은 실제(KST)", () => {
    vi.stubEnv("DIDIM_NOW", "");
    vi.stubEnv("DIDIM_TODAY", "2026-04-26");
    vi.stubEnv("DIDIM_ALLOW_TODAY_OVERRIDE", "1");
    vi.stubEnv("VERCEL_ENV", "");
    vi.useFakeTimers({ now: new Date("2026-10-10T09:15:00Z") });
    expect(getNow()).toEqual({ date: "2026-04-26", hour: 18, minute: 15 });
  });
  it("플래그가 없으면 DIDIM_NOW 를 무시한다", () => {
    vi.stubEnv("DIDIM_NOW", "2026-04-26T08:30");
    vi.stubEnv("DIDIM_ALLOW_TODAY_OVERRIDE", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.useFakeTimers({ now: new Date("2026-10-10T09:15:00Z") });
    expect(getNow()).toEqual({ date: "2026-10-10", hour: 18, minute: 15 });
  });
  it("Vercel production 에서는 플래그가 있어도 실제 시각", () => {
    vi.stubEnv("DIDIM_NOW", "2026-04-26T08:30");
    vi.stubEnv("DIDIM_ALLOW_TODAY_OVERRIDE", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.useFakeTimers({ now: new Date("2026-12-31T23:00:00Z") });
    expect(getNow()).toEqual({ date: "2027-01-01", hour: 8, minute: 0 });
  });
});
