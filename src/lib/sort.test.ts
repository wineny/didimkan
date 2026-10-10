import { describe, expect, it } from "vitest";
import { sortCourses } from "./sort";

const T = "2026-10-10";
const mk = (id: string, o: Record<string, unknown> = {}) => ({
  id, title: id, institution: "기관", sido: "서울특별시", sigungu: "강남구", dong: "도곡1동",
  isAlwaysOpen: false, applyStart: "2026-10-01", applyEnd: "2026-10-30", endDate: null, ...o,
}) as Parameters<typeof sortCourses>[0][number];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const area = { sido: "서울특별시", sigungu: "강남구", dong: "도곡1동" };

describe("sortCourses (contract §10 정렬)", () => {
  it("지역: 동 > 구 > 시도 > 나머지", () => {
    const list = [
      mk("나머지", { sido: "부산광역시", sigungu: "해운대구", dong: "x" }),
      mk("시도", { sigungu: "서초구", dong: "y" }),
      mk("구", { dong: "z" }),
      mk("동"),
    ];
    expect(ids(sortCourses(list, { stair: 2, area, today: T }))).toEqual(["동", "구", "시도", "나머지"]);
  });
  it("1단은 지역을 무시하고 상태 → id 로만 정렬", () => {
    const list = [mk("b", { sido: "부산광역시", sigungu: "x", dong: "x" }), mk("a", { sigungu: "서초구" })];
    expect(ids(sortCourses(list, { stair: 1, area, today: T }))).toEqual(["a", "b"]);
  });
  it("상태: open → before(가까운 순) → always → unknown → closed", () => {
    const list = [
      mk("closed", { applyStart: "2026-09-01", applyEnd: "2026-09-10" }),
      mk("unknown", { applyStart: null, applyEnd: null }),
      mk("always", { isAlwaysOpen: true }),
      mk("before-far", { applyStart: "2026-11-01", applyEnd: "2026-11-10" }),
      mk("before-near", { applyStart: "2026-10-12", applyEnd: "2026-10-20" }),
      mk("open"),
    ];
    expect(ids(sortCourses(list, { stair: 2, area, today: T }))).toEqual([
      "open", "before-near", "before-far", "always", "unknown", "closed",
    ]);
  });
  it("접수 중은 마감 가까운 순, 마감일 없음은 뒤", () => {
    const list = [
      mk("o-null", { applyEnd: null }),
      mk("o-far", { applyEnd: "2026-10-30" }),
      mk("o-near", { applyEnd: "2026-10-11" }),
    ];
    expect(ids(sortCourses(list, { stair: 2, area, today: T }))).toEqual(["o-near", "o-far", "o-null"]);
  });
  it("마감은 최근 마감 순", () => {
    const list = [
      mk("c-old", { applyStart: "2026-08-01", applyEnd: "2026-08-10" }),
      mk("c-recent", { applyStart: "2026-09-25", applyEnd: "2026-10-09" }),
      mk("c-noapply", { applyStart: null, applyEnd: null, endDate: "2026-10-01" }),
    ];
    expect(ids(sortCourses(list, { stair: 2, area, today: T }))).toEqual(["c-recent", "c-old", "c-noapply"]);
  });
  it("접수 전은 확정·예상을 섞어 날짜 가까운 순(예상은 next_open_estimate)", () => {
    const est = mk("예상", { applyStart: null, applyEnd: null, institution: "E" });
    const fixed = mk("확정", { applyStart: "2026-12-01", applyEnd: "2026-12-10" });
    const patterns = [{ institution: "E", sigungu: "강남구", nextOpenEstimate: "2026-10-12", basisCount: 3, ruleNote: null }];
    expect(ids(sortCourses([fixed, est], { stair: 2, area, today: T, patterns }))).toEqual(["예상", "확정"]);
  });
  it("모두 같으면 id 오름차순이고 원본을 바꾸지 않는다", () => {
    const list = [mk("z"), mk("a"), mk("m")];
    expect(ids(sortCourses(list, { stair: 2, area, today: T }))).toEqual(["a", "m", "z"]);
    expect(ids(list)).toEqual(["z", "a", "m"]);
  });
});
