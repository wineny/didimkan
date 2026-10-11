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
  // 도곡1동 대표 위치(centroids.json)에서 북쪽으로 km 만큼 떨어진 점. 위도 1도 ≈ 111.2km.
  const north = (km: number) => ({ lat: 37.488305 + km / 111.2, lng: 127.038969 });
  it("거리 구간: 1km 안 > 3km 안 > 5km 안 > 10km 안 > 20km 안 > 그 밖 > 위치 모름", () => {
    const list = [
      mk("모름", { sido: null, sigungu: null, dong: null }),
      mk("30km", north(30)),
      mk("15km", north(15)),
      mk("7km", north(7)),
      mk("4km", north(4)),
      mk("2km", north(2)),
      mk("0.5km", north(0.5)),
    ];
    expect(ids(sortCourses(list, { stair: 2, area, today: T }))).toEqual([
      "0.5km", "2km", "4km", "7km", "15km", "30km", "모름",
    ]);
  });
  it("같은 구간 안에서는 상태가 거리보다 먼저, 상태·날짜가 같으면 가까운 순", () => {
    const list = [
      mk("모름-0.2km", { ...north(0.2), applyStart: null, applyEnd: null }),
      mk("접수중-0.9km", north(0.9)),
      mk("접수중-0.4km", north(0.4)),
      mk("접수중-1.5km", north(1.5)),
    ];
    expect(ids(sortCourses(list, { stair: 2, area, today: T }))).toEqual([
      "접수중-0.4km", "접수중-0.9km", "모름-0.2km", "접수중-1.5km",
    ]);
  });
  it("마감은 거리와 상관없이 맨 뒤, 그 안에서 가까운 순", () => {
    const closed = { applyStart: "2026-09-01", applyEnd: "2026-09-10" };
    const list = [
      mk("마감-3km", { ...north(3.5), ...closed }),
      mk("마감-0.2km", { ...north(0.2), ...closed }),
      mk("접수중-15km", north(15)),
      mk("모름-7km", { ...north(7), applyStart: null, applyEnd: null }),
    ];
    expect(ids(sortCourses(list, { stair: 2, area, today: T }))).toEqual([
      "모름-7km", "접수중-15km", "마감-0.2km", "마감-3km",
    ]);
  });
  it("좌표가 없으면 동 대표 위치, 구만 알면 1km 안으로 치지 않는다", () => {
    const list = [
      mk("서초구만", { sigungu: "서초구", dong: "없는동" }), // 서초구청은 도곡1동에서 0.8km 지만 1km 로 본다
      mk("같은동", { applyStart: null, applyEnd: null }), // 접수일 모름이어도 1km 안
    ];
    expect(ids(sortCourses(list, { stair: 2, area, today: T }))).toEqual(["같은동", "서초구만"]);
  });
  it("동네를 안 고르면 거리를 보지 않는다", () => {
    const list = [mk("b", north(30)), mk("a", { ...north(0.1), applyStart: "2026-09-01", applyEnd: "2026-09-10" })];
    expect(ids(sortCourses(list, { stair: 2, area: {}, today: T }))).toEqual(["b", "a"]);
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
