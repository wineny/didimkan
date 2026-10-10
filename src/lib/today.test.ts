import { afterEach, describe, expect, it, vi } from "vitest";
import { getToday } from "./today";

afterEach(() => vi.unstubAllEnvs());

describe("getToday", () => {
  it("DIDIM_TODAY 를 비-production 에서 쓴다", () => {
    vi.stubEnv("DIDIM_TODAY", "2026-10-05");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(getToday()).toBe("2026-10-05");
    vi.stubEnv("VERCEL_ENV", "");
    expect(getToday()).toBe("2026-10-05");
  });
  it("production 에서는 무시하고 실제 오늘", () => {
    vi.stubEnv("DIDIM_TODAY", "2026-10-05");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.useFakeTimers({ now: new Date("2026-12-31T16:00:00Z") });
    expect(getToday()).toBe("2027-01-01");
    vi.useRealTimers();
  });
  it("값이 없거나 형식이 틀리면 실제 오늘(KST)", () => {
    vi.stubEnv("DIDIM_TODAY", "내일");
    expect(getToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
