import type { Course, EnrollmentPattern, Stair } from "@/db/schema";
import { applyStatus, findPattern, type StatusCourse } from "./status";

export type Area = { sido?: string; sigungu?: string; dong?: string };

type SortCourse = StatusCourse &
  Pick<Course, "title" | "institution" | "sido" | "sigungu" | "dong">;
type SortPattern = Pick<
  EnrollmentPattern,
  "institution" | "sigungu" | "nextOpenEstimate" | "basisCount" | "ruleNote"
>;

export type SortOptions = {
  stair: Stair;
  area: Area;
  today: string;
  patterns?: readonly SortPattern[];
};

/** 지역 일치도: 동 0 > 구 1 > 시도 2 > 나머지 3. 1단(온라인)은 전부 동급. */
function areaRank(c: SortCourse, area: Area, stair: Stair): number {
  if (stair === 1) return 0;
  const sidoOk = !!area.sido && c.sido === area.sido;
  const guOk = sidoOk && !!area.sigungu && c.sigungu === area.sigungu;
  if (guOk && area.dong && c.dong === area.dong) return 0;
  if (guOk) return 1;
  if (sidoOk) return 2;
  return 3;
}

/** open → 확정 before(가까운 순) → 예상 before → always → unknown → closed */
function statusRank(s: ReturnType<typeof applyStatus>): number {
  switch (s.status) {
    case "open":
      return 0;
    case "before":
      return s.isEstimate ? 2 : 1;
    case "always":
      return 3;
    case "unknown":
      return 4;
    default:
      return 5;
  }
}

export function sortCourses<C extends SortCourse>(
  courses: readonly C[],
  { stair, area, today, patterns }: SortOptions,
): C[] {
  const keyed = courses.map((c, i) => {
    const st = applyStatus(c, today, findPattern(c, patterns));
    return {
      c,
      i,
      a: areaRank(c, area, stair),
      s: statusRank(st),
      d: st.status === "before" ? (st.date ?? "") : "",
    };
  });
  keyed.sort(
    (x, y) =>
      x.a - y.a ||
      x.s - y.s ||
      (x.d < y.d ? -1 : x.d > y.d ? 1 : 0) ||
      x.c.title.localeCompare(y.c.title, "ko") ||
      x.i - y.i,
  );
  return keyed.map((k) => k.c);
}
