import { describe, expect, it } from "vitest";
import { dday, ddayLabel } from "./dday";

describe("dday", () => {
  it("미래·당일·과거", () => {
    expect(dday("2026-10-13", "2026-10-10")).toBe("D-3");
    expect(dday("2026-10-10", "2026-10-10")).toBe("D-day");
    expect(dday("2026-10-08", "2026-10-10")).toBe("D+2");
  });
  it("월 경계를 넘어도 맞다", () => {
    expect(dday("2026-11-01", "2026-10-30")).toBe("D-2");
  });
  it("날짜 없으면 확인 안 됨", () => {
    expect(dday(null, "2026-10-10")).toBe("확인 안 됨");
    expect(dday(undefined, "2026-10-10")).toBe("확인 안 됨");
  });
});

describe("ddayLabel", () => {
  const T = "2026-10-10";
  it("상태별 문구", () => {
    expect(ddayLabel({ status: "before", isEstimate: false, date: "2026-10-13" }, T)).toBe("이번 접수 D-3");
    expect(ddayLabel({ status: "before", isEstimate: true, date: "2026-10-13" }, T)).toBe("접수 예상 D-3 · 예상이며 확정 아님");
    expect(ddayLabel({ status: "open", isEstimate: false, date: "2026-10-20" }, T)).toBe("접수 중 · 마감 D-10");
    expect(ddayLabel({ status: "open", isEstimate: false, date: T }, T)).toBe("접수 중 · 오늘 마감");
    expect(ddayLabel({ status: "open", isEstimate: false }, T)).toBe("접수 중");
    expect(ddayLabel({ status: "closed", isEstimate: false }, T)).toBe("지난 회차");
    expect(ddayLabel({ status: "closed", isEstimate: false, date: "2026-10-01" }, T)).toBe("지난 회차");
    expect(ddayLabel({ status: "always", isEstimate: false }, T)).toBe("연중 · 수시 접수");
    expect(ddayLabel({ status: "unknown", isEstimate: false }, T)).toBe("접수일 확인 안 됨");
  });
});
