import type { Course, EnrollmentPattern, Stair } from "@/db/schema";
import { areaPoint, band, courseDistanceKm } from "./geo";
import { applyStatus, findPattern, type ApplyStatus, type StatusCourse } from "./status";

export type Area = { sido?: string; sigungu?: string; dong?: string };

type SortCourse = StatusCourse &
  Pick<Course, "id" | "institution" | "sido" | "sigungu" | "dong"> &
  Partial<Pick<Course, "lat" | "lng">>;
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

/**
 * docs/contract.md §10 「가까운 순」: 마감 아님 먼저 → 거리 구간 → 상태 → 상태 안 날짜 → 거리 → id 오름차순.
 * 마감은 숨기지 않고 맨 뒤에 가까운 순으로 둔다. 1단(온라인)과 동네를 안 고른 경우는 거리를 보지 않는다.
 */
export function sortCourses<C extends SortCourse>(
  courses: readonly C[],
  { stair, area, today, patterns }: SortOptions,
): C[] {
  const home = stair === 1 ? null : areaPoint(area);
  const keyed = courses.map((c) => {
    const st = applyStatus(c, today, findPattern(c, patterns));
    const km = home ? courseDistanceKm(home, c) : 0;
    const b = band(km);
    return {
      c,
      closed: st.status === "closed" ? 1 : 0,
      b,
      km: km ?? 0, // 위치 모름은 이미 맨 끝 구간이라 거리 비교가 의미 없다
      st: st.status,
      d: st.date ?? null,
    };
  });
  keyed.sort(
    (x, y) =>
      x.closed - y.closed ||
      x.b - y.b ||
      STATUS_RANK[x.st] - STATUS_RANK[y.st] ||
      dateOrder(x.st, x.d, y.d) ||
      x.km - y.km ||
      cmp(x.c.id, y.c.id),
  );
  return keyed.map((k) => k.c);
}
