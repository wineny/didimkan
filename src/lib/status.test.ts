import { describe, expect, it } from "vitest";
import { applyStatus, findPattern } from "./status";

const base = { isAlwaysOpen: false, applyStart: null, applyEnd: null, endDate: null };
const T = "2026-10-10";

describe("applyStatus", () => {
  it("apply_start 전날은 before, 당일은 open", () => {
    const c = { ...base, applyStart: "2026-10-11", applyEnd: "2026-10-20" };
    expect(applyStatus(c, "2026-10-10")).toMatchObject({ status: "before", date: "2026-10-11" });
    expect(applyStatus(c, "2026-10-11").status).toBe("open");
  });
  it("apply_end 당일은 open, 다음날은 closed", () => {
    const c = { ...base, applyStart: "2026-10-01", applyEnd: "2026-10-10" };
    expect(applyStatus(c, T)).toMatchObject({ status: "open", date: "2026-10-10" });
    expect(applyStatus(c, "2026-10-11").status).toBe("closed");
  });
  it("연중·수시는 always", () => {
    expect(applyStatus({ ...base, isAlwaysOpen: true }, T).status).toBe("always");
  });
  it("둘 다 없고 end_date 가 과거면 closed, 아니면 unknown", () => {
    expect(applyStatus({ ...base, endDate: "2026-09-30" }, T).status).toBe("closed");
    expect(applyStatus({ ...base, endDate: "2026-12-31" }, T).status).toBe("unknown");
    expect(applyStatus(base, T).status).toBe("unknown");
  });
  it("둘 다 없고 예측이 있으면 예상 before", () => {
    const p = { nextOpenEstimate: "2026-10-25", basisCount: 4, ruleNote: null };
    expect(applyStatus(base, T, p)).toMatchObject({
      status: "before", isEstimate: true, date: "2026-10-25", estimateDate: "2026-10-25", basisCount: 4,
    });
  });
  it("확정 접수일이 있으면 예측보다 우선한다", () => {
    const p = { nextOpenEstimate: "2026-10-25", basisCount: 4, ruleNote: null };
    const r = applyStatus({ ...base, applyStart: "2026-10-12" }, T, p);
    expect(r).toMatchObject({ status: "before", isEstimate: false, date: "2026-10-12" });
  });
  it("과거 예상일은 쓰지 않는다", () => {
    const p = { nextOpenEstimate: "2026-09-01", basisCount: 3, ruleNote: null };
    expect(applyStatus(base, T, p).status).toBe("unknown");
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
