// 「가까운 순」 거리 계산(contract §10). 좌표 출처: centroids.json(카카오 행정구역 대표 위치, pipeline/tools/geocode.py regions).
import centroids from "./centroids.json";
import type { Area } from "./sort";

/** [위도, 경도] */
export type Point = readonly [number, number];

type Located = { lat?: number | null; lng?: number | null; sido?: string | null; sigungu?: string | null; dong?: string | null };

// JSON 은 number[] 로 읽히므로 [위도, 경도] 로 좁힌다(geocode.py 가 항상 두 값으로 쓴다).
const DONG = centroids.dong as unknown as Record<string, Point>;
const GU = centroids.gu as unknown as Record<string, Point>;
const SIDO = centroids.sido as unknown as Record<string, Point>;

/** 두 점 사이 거리(km, 구면). */
export function distanceKm(a: Point, b: Point): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b[0] - a[0]) * r) / 2) ** 2 +
    Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** 대표 위치를 어느 단계에서 찾았나. */
type Level = "dong" | "gu" | "sido";

/** 이름으로 대표 위치: 동 → 구 → 시도. 없으면 null. */
function regionPoint({ sido, sigungu, dong }: Located): { p: Point; level: Level } | null {
  if (!sido) return null;
  const d = sigungu && dong ? DONG[`${sido}|${sigungu}|${dong}`] : undefined;
  if (d) return { p: d, level: "dong" };
  const g = sigungu ? GU[`${sido}|${sigungu}`] : undefined;
  if (g) return { p: g, level: "gu" };
  return SIDO[sido] ? { p: SIDO[sido], level: "sido" } : null;
}

/** 사용자가 고른 동네의 기준점(동 → 구 → 시도 대표 위치). */
export function areaPoint(area: Area): Point | null {
  return regionPoint(area)?.p ?? null;
}

const MIN_KM: Record<Level, number> = { dong: 0, gu: 1, sido: 10 };

/**
 * 강좌 기준점: 실제 좌표(lat·lng) → 동 → 구 → 시도 대표 위치.
 * 구·시도 대표 위치는 구청·시청 자리라 강좌가 그 안 어디인지 모른다.
 * 그래서 최소 거리(minKm)를 둬서 「1km 안」 같은 가까운 구간을 장담하지 않는다.
 */
export function coursePoint(c: Located): { p: Point; minKm: number } | null {
  if (c.lat != null && c.lng != null) return { p: [c.lat, c.lng], minKm: 0 };
  const r = regionPoint(c);
  if (!r) return null;
  return { p: r.p, minKm: MIN_KM[r.level] };
}

/** 사용자 기준점에서 강좌까지 km(최소 거리 반영). 강좌 위치를 모르면 null. */
export function courseDistanceKm(home: Point, c: Located): number | null {
  const cp = coursePoint(c);
  return cp ? Math.max(distanceKm(home, cp.p), cp.minKm) : null;
}

/**
 * 거리 구간 위쪽 끝(km, 미만). 같은 구간 안에서는 상태·날짜가 거리보다 먼저다
 * (0.9km 접수 예정이 0.5km 접수일 모름보다 앞선다).
 */
export const DISTANCE_BANDS_KM = [1, 3, 5, 10, 20] as const;
/** 20km 이상 */
export const FAR_BAND = DISTANCE_BANDS_KM.length;
/** 위치 모름 */
export const UNKNOWN_BAND = FAR_BAND + 1;

/** 구간 번호: 0(1km 미만) … 5(20km 이상), 위치를 모르면 6. */
export function band(km: number | null): number {
  if (km === null) return UNKNOWN_BAND;
  const i = DISTANCE_BANDS_KM.findIndex((b) => km < b);
  return i === -1 ? FAR_BAND : i;
}

/**
 * DB 후보를 고를 때 쓰는 이름별 구간표(sortCourses 와 같은 규칙). 20km 이상인 이름은 넣지 않는다.
 * dong 키 `시도|시군구|동`, gu 키 `시도|시군구`, sido 키 `시도`. 값은 구간 번호.
 * 좌표가 없는 강좌는 동 → 구 → 시도 순으로 이 표를 본다(표에 없는 동은 구로 넘어간다).
 */
export function bandTable(home: Point): { dong: Map<string, number>; gu: Map<string, number>; sido: Map<string, number> } {
  const pick = (t: Record<string, Point>, minKm: number) => {
    const m = new Map<string, number>();
    for (const [k, p] of Object.entries(t)) {
      const b = band(Math.max(distanceKm(home, p), minKm));
      if (b < FAR_BAND) m.set(k, b);
    }
    return m;
  };
  return { dong: pick(DONG, MIN_KM.dong), gu: pick(GU, MIN_KM.gu), sido: pick(SIDO, MIN_KM.sido) };
}
