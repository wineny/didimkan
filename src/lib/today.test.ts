import { afterEach, describe, expect, it, vi } from "vitest";
import { getToday } from "./today";

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
