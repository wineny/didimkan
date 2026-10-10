import type { Course, EnrollmentPattern, Stair } from "@/db/schema";
import { applyStatus, findPattern, type ApplyStatus, type StatusCourse } from "./status";

export type Area = { sido?: string; sigungu?: string; dong?: string };

type SortCourse = StatusCourse &
  Pick<Course, "id" | "institution" | "sido" | "sigungu" | "dong">;
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

const STATUS_RANK: Record<ApplyStatus, number> = {
  open: 0,
  before: 1,
  always: 2,
  unknown: 3,
  closed: 4,
};

const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

/**
 * 같은 상태 안의 날짜 비교(contract §10 정렬 3).
 * open: 마감 가까운 순(NULL 뒤) / before: 접수 시작일(예측이면 예상일) 가까운 순 / closed: 마감 최근 순(NULL 뒤).
 */
function dateOrder(status: ApplyStatus, x: string | null, y: string | null): number {
  if (status !== "open" && status !== "before" && status !== "closed") return 0;
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return status === "closed" ? cmp(y, x) : cmp(x, y);
}

/** docs/contract.md §10 「가까운 순」: 지역 → 상태 → 상태 안 날짜 → id 오름차순. */
export function sortCourses<C extends SortCourse>(
  courses: readonly C[],
  { stair, area, today, patterns }: SortOptions,
): C[] {
  const keyed = courses.map((c) => {
    const st = applyStatus(c, today, findPattern(c, patterns));
    return {
      c,
      a: areaRank(c, area, stair),
      st: st.status,
      d: st.date ?? null,
    };
  });
  keyed.sort(
    (x, y) =>
      x.a - y.a ||
      STATUS_RANK[x.st] - STATUS_RANK[y.st] ||
      dateOrder(x.st, x.d, y.d) ||
      cmp(x.c.id, y.c.id),
  );
  return keyed.map((k) => k.c);
}
