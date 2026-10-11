import { describe, expect, it } from "vitest";
import { FORBIDDEN, M2_COPY, EMPTY_LIST, STAIR_NAMES, STAIR_SUB, STEP_LABELS, HOME_HINT, NEXT_SLOT_STAIR3, capacityHint, feeLabel, phoneText, tiles } from "./copy";

const course = {
  isFree: false, isOnline: false, feeWon: 18000, feePeriod: "월" as const, capacity: 20,
  selectionMethod: "선착순" as const, signals: [] as never[], termDays: 28, sessionsPerWeek: 1,
};

describe("feeLabel", () => {
  it("4케이스", () => {
    expect(feeLabel(null, true, null)).toBe("무료");
    expect(feeLabel(18000, false, "월")).toBe("월 1만 8천 원");
    expect(feeLabel(30000, false, "총")).toBe("3만 원");
    expect(feeLabel(null, false, null)).toBe("확인 안 됨");
  });
  it("자릿수 변형", () => {
    expect(feeLabel(5000, false, null)).toBe("5천 원");
    expect(feeLabel(12500, false, null)).toBe("1만 2천 5백 원");
  });
});

describe("tiles", () => {
  it("항상 6개, 순서 고정", () => {
    const t = tiles(course);
    expect(t.map((x) => x.key)).toEqual(["fee", "basic", "capacity", "selection", "period", "place"]);
    expect(t.find((x) => x.key === "fee")?.value).toBe("월 1만 8천 원");
    expect(t.find((x) => x.key === "basic")?.value).toBe("표시 없음");
    expect(t.find((x) => x.key === "capacity")?.value).toBe("20명");
    expect(t.find((x) => x.key === "selection")?.value).toBe("선착순");
    expect(t.find((x) => x.key === "period")?.value).toBe("4주 · 주 1회");
    expect(t.find((x) => x.key === "place")?.value).toBe("직접 가요");
  });
  it("신호가 있으면 문구가 바뀐다", () => {
    const t = tiles({ ...course, isFree: true, isOnline: true, capacity: 12, selectionMethod: "추첨", signals: ["free", "basic", "small", "lottery", "once", "online"] });
    expect(t.map((x) => x.value)).toEqual(["무료", "기초·입문", "12명 소규모", "추첨 · 서둘러 누르지 않아도 됩니다", "1회", "집에서"]);
  });
  it("기간 주 수는 반올림(derive.py stair_reason 과 같음): 73일 → 10주(예전 올림은 11주)", () => {
    const period = (termDays: number) => tiles({ ...course, termDays, sessionsPerWeek: 2 }).find((x) => x.key === "period")?.value;
    expect(period(73)).toBe("10주 · 주 2회");
    expect(period(74)).toBe("11주 · 주 2회"); // 10.57 → 11
    expect(period(30)).toBe("4주 · 주 2회");
  });
  it("상시 운영(날짜 없음, 요일만)은 주 수를 지어내지 않고 주 N회만", () => {
    const t = tiles({ ...course, termDays: null, sessionsPerWeek: 2 });
    expect(t.find((x) => x.key === "period")?.value).toBe("주 2회");
  });
  it("요일 없이 날짜만(표준데이터 꼴)은 주 횟수를 지어내지 않고 N주만 (contract §12 ⑤)", () => {
    const t = tiles({ ...course, termDays: 92, sessionsPerWeek: null });
    expect(t.find((x) => x.key === "period")?.value).toBe("13주");
  });
  it("정보가 없으면 확인 안 됨", () => {
    const t = tiles({ ...course, feeWon: null, capacity: null, selectionMethod: null, termDays: null, sessionsPerWeek: null });
    expect(t.filter((x) => x.value === "확인 안 됨").map((x) => x.key)).toEqual(["fee", "capacity", "selection", "period"]);
  });
});

function flat(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (v && typeof v === "object") return Object.values(v).flatMap(flat);
  return [];
}

describe("문구", () => {
  it("전화번호 없음", () => {
    expect(phoneText(null)).toBe("전화번호 확인 안 됨");
    expect(phoneText("02-000-0000")).toBe("02-000-0000");
  });
  it("정원 보조 문구", () => {
    expect(capacityHint(15)).toBe("얼굴을 익히기 쉬워요");
    expect(capacityHint(20)).toBe("조용히 앉아 있어도 돼요");
    expect(capacityHint(null)).toBeNull();
    expect(HOME_HINT[1]).toBe("조용히 앉아 있어도 돼요");
  });
  it("고정 문구", () => {
    expect(STAIR_NAMES[1]).toBe("아직은 집에서");
    expect(EMPTY_LIST).toContain("못 찾았어요");
    expect(NEXT_SLOT_STAIR3).toBe("같은 자리 다음 학기");
  });
  it("M2 문구가 비어 있지 않다", () => {
    expect(flat(M2_COPY).length).toBeGreaterThan(80);
    expect(M2_COPY.sms.closing).toContain("신청은 직접 하셔야 해요");
  });
  it("금지어가 화면 문구에 없다", () => {
    const all = [...Object.values(STAIR_NAMES), ...Object.values(STAIR_SUB), ...Object.values(STEP_LABELS), ...Object.values(HOME_HINT), ...flat(M2_COPY), EMPTY_LIST, NEXT_SLOT_STAIR3, ...tiles(course).map((t) => t.value)];
    for (const w of FORBIDDEN) for (const s of all) expect(s).not.toContain(w);
    expect(all.join(" ")).not.toMatch(/수강생 \d+명/);
  });
});
