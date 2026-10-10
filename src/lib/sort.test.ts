import { describe, expect, it } from "vitest";
import { sortCourses } from "./sort";

const T = "2026-10-10";
const mk = (title: string, o: Record<string, unknown> = {}) => ({
  title, institution: "기관", sido: "서울특별시", sigungu: "강남구", dong: "도곡1동",
  isAlwaysOpen: false, applyStart: "2026-10-01", applyEnd: "2026-10-30", endDate: null, ...o,
}) as Parameters<typeof sortCourses>[0][number];
const titles = (xs: { title: string }[]) => xs.map((x) => x.title);
const area = { sido: "서울특별시", sigungu: "강남구", dong: "도곡1동" };

describe("sortCourses", () => {
  it("지역: 동 > 구 > 시도 > 나머지", () => {
    const list = [
      mk("나머지", { sido: "부산광역시", sigungu: "해운대구", dong: "x" }),
      mk("시도", { sigungu: "서초구", dong: "y" }),
      mk("구", { dong: "z" }),
      mk("동"),
    ];
    expect(titles(sortCourses(list, { stair: 2, area, today: T }))).toEqual(["동", "구", "시도", "나머지"]);
  });
  it("1단은 지역을 무시하고 상태/제목으로만 정렬", () => {
    const list = [mk("나", { sido: "부산광역시", sigungu: "x", dong: "x" }), mk("가", { sigungu: "서초구" })];
    expect(titles(sortCourses(list, { stair: 1, area, today: T }))).toEqual(["가", "나"]);
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
    expect(titles(sortCourses(list, { stair: 2, area, today: T }))).toEqual([
      "open", "before-near", "before-far", "always", "unknown", "closed",
    ]);
  });
  it("예상 접수는 확정 접수 뒤", () => {
    const est = mk("예상", { applyStart: null, applyEnd: null, institution: "E" });
    const fixed = mk("확정", { applyStart: "2026-12-01", applyEnd: "2026-12-10" });
    const patterns = [{ institution: "E", sigungu: "강남구", nextOpenEstimate: "2026-10-12", basisCount: 3, ruleNote: null }];
    expect(titles(sortCourses([est, fixed], { stair: 2, area, today: T, patterns }))).toEqual(["확정", "예상"]);
  });
  it("같으면 입력 순서를 유지하고 원본을 바꾸지 않는다", () => {
    const list = [mk("같음"), mk("같음", { institution: "둘째" })];
    const out = sortCourses(list, { stair: 2, area, today: T });
    expect(out[1].institution).toBe("둘째");
    expect(list[0].institution).toBe("기관");
  });
});
