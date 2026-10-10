import { describe, expect, it } from "vitest";
import { applyStatus, findPattern } from "./status";

const base = { isAlwaysOpen: false, applyStart: null, applyEnd: null, endDate: null };
const T = "2026-10-10";
type C = Parameters<typeof applyStatus>[0];
const course = (o: Partial<C> = {}): C => ({ ...base, ...o });

// pipeline/tests/test_derive.py 의 apply_status 케이스를 그대로 옮긴 것. 같은 입력 → 같은 결과.
describe("applyStatus = pipeline/derive.py:apply_status", () => {
  it("boundaries", () => {
    const row = course({ applyStart: "2026-10-05", applyEnd: "2026-10-15" });
    expect(applyStatus(row, "2026-10-04").status).toBe("before");
    expect(applyStatus(row, "2026-10-05").status).toBe("open"); // 시작 당일
    expect(applyStatus(row, "2026-10-15").status).toBe("open"); // 마감 당일
    expect(applyStatus(row, "2026-10-16").status).toBe("closed");
  });
  it("always and unknown", () => {
    expect(applyStatus(course({ isAlwaysOpen: true, applyEnd: "2020-01-01" }), T).status).toBe("always");
    expect(applyStatus(course(), T).status).toBe("unknown");
    expect(applyStatus(course({ endDate: "2026-10-09" }), T).status).toBe("closed");
    expect(applyStatus(course({ endDate: "2026-10-10" }), T).status).toBe("unknown");
  });
  it("partial dates (contract §10: 마감일만·안 지남 → unknown, 시작일만·지남 → open)", () => {
    expect(applyStatus(course({ applyEnd: "2026-10-12" }), T).status).toBe("unknown");
    expect(applyStatus(course({ applyEnd: "2026-10-09" }), T).status).toBe("closed");
    expect(applyStatus(course({ applyStart: "2026-10-01" }), T).status).toBe("open");
    expect(applyStatus(course({ applyStart: "2026-10-11" }), T).status).toBe("before");
    // 마감 지남이 시작 전보다 먼저(데이터가 거꾸로여도 closed)
    expect(applyStatus(course({ applyStart: "2026-10-20", applyEnd: "2026-10-01" }), T).status).toBe("closed");
  });
  it.each([
    ["2026-09-25", "before", "before"],
    ["2026-09-26", "open", "before"],
    ["2026-09-27", "open", "open"],
    ["2026-09-30", "open", "open"],
    ["2026-10-01", "closed", "closed"],
  ])("gangnam window boundaries %s", (today, z1, z2) => {
    // gangnam_window(2026-10-01, 1|2) = 9/26~9/30, 9/27~9/30
    expect(applyStatus(course({ applyStart: "2026-09-26", applyEnd: "2026-09-30" }), today).status).toBe(z1);
    expect(applyStatus(course({ applyStart: "2026-09-27", applyEnd: "2026-09-30" }), today).status).toBe(z2);
  });
});

describe("applyStatus 세부", () => {
  it("before 는 시작일, open 은 마감일을 date 로 준다", () => {
    const c = course({ applyStart: "2026-10-11", applyEnd: "2026-10-20" });
    expect(applyStatus(c, T)).toMatchObject({ status: "before", date: "2026-10-11", isEstimate: false });
    expect(applyStatus(c, "2026-10-11")).toMatchObject({ status: "open", date: "2026-10-20" });
  });
  it("시작일 없이 마감일만 있고 안 지났으면 날짜를 지어내지 않는다", () => {
    expect(applyStatus(course({ applyEnd: "2026-10-12" }), T)).toEqual({ status: "unknown", isEstimate: false });
  });
  it("시작일이 없으면 마감일이 있어도 예측을 쓴다(5번)", () => {
    const p = { nextOpenEstimate: "2026-10-25", basisCount: 4, ruleNote: null };
    expect(applyStatus(course({ applyEnd: "2026-10-30" }), T, p)).toMatchObject({
      status: "before", isEstimate: true, date: "2026-10-25", estimateDate: "2026-10-25", basisCount: 4,
    });
    expect(applyStatus(course(), T, p)).toMatchObject({ status: "before", isEstimate: true });
  });
  it("확정 접수일이 있으면 예측보다 우선한다", () => {
    const p = { nextOpenEstimate: "2026-10-25", basisCount: 4, ruleNote: null };
    const r = applyStatus(course({ applyStart: "2026-10-12" }), T, p);
    expect(r).toMatchObject({ status: "before", isEstimate: false, date: "2026-10-12" });
  });
  it("과거 예상일은 쓰지 않는다", () => {
    const p = { nextOpenEstimate: "2026-09-01", basisCount: 3, ruleNote: null };
    expect(applyStatus(course(), T, p).status).toBe("unknown");
  });
  it("findPattern 은 기관+시군구가 맞는 행을 고른다", () => {
    const ps = [
      { institution: "A", sigungu: "강남구" },
      { institution: "A", sigungu: "서초구" },
    ];
    expect(findPattern({ institution: "A", sigungu: "서초구" }, ps)).toBe(ps[1]);
    expect(findPattern({ institution: "B", sigungu: "서초구" }, ps)).toBeUndefined();
  });
});
