// 조회 함수. 계약: docs/contract.md §10(접수 상태·정렬), R7·R9.
// 지역은 걸러내는 조건이 아니라 정렬 기준이다. DB 에서는 계단으로만 거르고,
// 후보 상한 안에 「가까운」 행이 들어오도록 SQL ORDER BY 에서 마감 여부·거리 구간·접수 중을 먼저 본다.
// 최종 순서는 메모리 sortCourses 가 정한다.
import { and, asc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { db } from "./client";
import {
  courses,
  enrollmentPatterns,
  institutions,
  type Course,
  type EnrollmentPattern,
  type Stair,
} from "./schema";
import { ddayLabel } from "@/lib/dday";
import { areaPoint, bandTable, DISTANCE_BANDS_KM, FAR_BAND, UNKNOWN_BAND } from "@/lib/geo";
import { sortCourses, type Area } from "@/lib/sort";
import { applyStatus, findPattern, type StatusResult } from "@/lib/status";
import { getToday } from "@/lib/today";

/** 1차 후보 상한. 정렬은 메모리에서 하므로 너무 크게 가져오지 않는다. */
const CANDIDATE_CAP = 600;

export type CourseWithStatus = Course & {
  pattern: EnrollmentPattern | null;
  status: StatusResult;
  ddayLabel: string;
};

export type ListCoursesInput = {
  stair: Stair;
  area?: Area;
  today?: string;
  limit?: number;
  offset?: number;
};

export async function loadPatterns(rows: readonly Course[]): Promise<EnrollmentPattern[]> {
  const names = [...new Set(rows.map((r) => r.institution).filter((v): v is string => !!v))];
  if (names.length === 0) return [];
  return db
    .select()
    .from(enrollmentPatterns)
    .where(inArray(enrollmentPatterns.institution, names));
}

export function attach(
  row: Course,
  patterns: readonly EnrollmentPattern[],
  today: string,
): CourseWithStatus {
  const pattern = findPattern(row, patterns) ?? null;
  const status = applyStatus(row, today, pattern);
  return { ...row, pattern, status, ddayLabel: ddayLabel(status, today) };
}

const KM_PER_DEG = 111.195; // 지구 반지름 6371km 기준 위도 1도

/**
 * 후보 거리 구간(sortCourses 와 같은 구간 번호). 1단(온라인)·지역 없음은 null
 * (상수 `ORDER BY 0` 은 SQLite 가 열 번호로 읽어 오류가 나므로 아예 빼야 한다).
 * 좌표가 있으면 평면 근사 거리(20km 안 오차 0.5% 미만), 없으면 동 → 구 → 시도 이름별 구간표.
 * 표에 없는 동(20km 이상)은 구 구간으로 넘어가 실제보다 가깝게 잡힐 수 있다 — 후보가 늘 뿐 빠지지는 않는다.
 */
function bandSql(stair: Stair, area: Area): SQL | null {
  if (stair === 1) return null;
  const home = areaPoint(area);
  if (!home) return null;
  const kx = KM_PER_DEG * Math.cos((home[0] * Math.PI) / 180);
  const dLat = sql`((${courses.lat} - ${home[0]}) * ${KM_PER_DEG})`;
  const dLng = sql`((${courses.lng} - ${home[1]}) * ${kx})`;
  const d2 = sql`(${dLat} * ${dLat} + ${dLng} * ${dLng})`;
  const byCoord = DISTANCE_BANDS_KM.map((b, i) => sql` WHEN ${d2} < ${b * b} THEN ${i}`);
  const t = bandTable(home);
  const keys = {
    dong: sql`(${courses.sido} || '|' || ${courses.sigungu} || '|' || ${courses.dong})`,
    gu: sql`(${courses.sido} || '|' || ${courses.sigungu})`,
    sido: sql`${courses.sido}`,
  };
  const byName = (["dong", "gu", "sido"] as const).flatMap((lvl) =>
    DISTANCE_BANDS_KM.flatMap((_, i) => {
      const names = [...t[lvl]].filter(([, b]) => b === i).map(([k]) => sql`${k}`);
      return names.length ? [sql` WHEN ${keys[lvl]} IN (${sql.join(names, sql`, `)}) THEN ${i}`] : [];
    }),
  );
  return sql`CASE WHEN ${courses.lat} IS NOT NULL AND ${courses.lng} IS NOT NULL THEN (CASE${sql.join(byCoord, sql``)} ELSE ${FAR_BAND} END)${sql.join(byName, sql``)}
    WHEN ${courses.sido} IS NULL THEN ${UNKNOWN_BAND} ELSE ${FAR_BAND} END`;
}

/**
 * 마감이면 1(contract §10 3·5·8번): 접수 마감일 지남, 또는 강좌 종료일 지남 ∧ (시작일 없음 ∨ 마감일 없이 시작일 ≤ today).
 * 연중·수시와 날짜가 거꾸로인 행(2번 unknown)은 0. 시작일이 미래면(4번 before) 종료일이 지나도 0.
 * 시작일이 없고 같은 기관 예측일이 오늘 이후면(7번 before) 종료일이 지나도 0. 기관명만 보고 시군구는 안 본다
 * (findPattern 보다 넓게 잡아 후보에서 빠지지 않게 한다). 최종 상태·순서는 sortCourses 가 정한다.
 */
function closedSql(today: string): SQL {
  const hasEstimate = sql`EXISTS (SELECT 1 FROM ${enrollmentPatterns} WHERE ${enrollmentPatterns.institution} = ${courses.institution} AND ${enrollmentPatterns.nextOpenEstimate} >= ${today})`;
  return sql`CASE WHEN ${courses.isAlwaysOpen} = 1 THEN 0
    WHEN ${courses.applyStart} IS NOT NULL AND ${courses.applyEnd} IS NOT NULL AND ${courses.applyStart} > ${courses.applyEnd} THEN 0
    WHEN ${courses.applyEnd} IS NOT NULL AND ${courses.applyEnd} < ${today} THEN 1
    WHEN ${courses.applyStart} IS NULL AND ${courses.endDate} IS NOT NULL AND ${courses.endDate} < ${today}
      AND NOT ${hasEstimate} THEN 1
    WHEN ${courses.applyStart} IS NOT NULL AND ${courses.applyEnd} IS NULL AND ${courses.applyStart} <= ${today}
      AND ${courses.endDate} IS NOT NULL AND ${courses.endDate} < ${today} THEN 1
    ELSE 0 END`;
}

/** 접수 중이면 0(contract §10 6번: 시작일 ≤ today ≤ 마감일, 마감일이 없으면 강좌 종료일이 안 지남). */
function notOpenSql(today: string): SQL {
  return sql`CASE WHEN ${courses.isAlwaysOpen} = 0 AND ${courses.applyStart} IS NOT NULL AND ${courses.applyStart} <= ${today}
    AND ((${courses.applyEnd} IS NOT NULL AND ${today} <= ${courses.applyEnd})
      OR (${courses.applyEnd} IS NULL AND (${courses.endDate} IS NULL OR ${today} <= ${courses.endDate}))) THEN 0 ELSE 1 END`;
}

export async function listCourses({
  stair,
  area = {},
  today = getToday(),
  limit = 10,
  offset = 0,
}: ListCoursesInput): Promise<CourseWithStatus[]> {
  const rows: Course[] = await db
    .select()
    .from(courses)
    .where(eq(courses.stair, stair))
    .orderBy(
      closedSql(today), // 마감은 맨 뒤(contract §10 0)
      ...[bandSql(stair, area)].filter((x): x is SQL => x !== null),
      notOpenSql(today),
      sql`${courses.applyEnd} IS NULL`, // 마감일 없음은 뒤로
      asc(courses.applyEnd),
      asc(courses.applyStart),
      asc(courses.id),
    )
    .limit(Math.max(CANDIDATE_CAP, offset + limit));

  const patterns = await loadPatterns(rows);
  const sorted = sortCourses(rows, { stair, area, today, patterns });
  return sorted.slice(offset, offset + limit).map((r) => attach(r, patterns, today));
}

export async function getCourse(
  id: string,
  today: string = getToday(),
): Promise<(CourseWithStatus & { phone: string | null }) | null> {
  const [row] = await db.select().from(courses).where(eq(courses.id, id)).limit(1);
  if (!row) return null;
  const patterns = await loadPatterns([row]);
  let phone = row.institutionPhone;
  if (!phone && row.institution) {
    const [inst] = await db
      .select({ phone: institutions.phone })
      .from(institutions)
      .where(
        and(
          eq(institutions.institution, row.institution),
          isNotNull(institutions.phone),
        ),
      )
      .limit(1);
    phone = inst?.phone ?? null;
  }
  return { ...attach(row, patterns, today), phone };
}

/** 여러 강좌를 한 번에(알림 목록·크론). 없는 id 는 Map 에 없다. 전화는 getCourse 와 같이 기관 표에서 보충한다. */
export async function getCoursesWithStatus(
  ids: string[],
  today: string = getToday(),
): Promise<Map<string, CourseWithStatus & { phone: string | null }>> {
  const out = new Map<string, CourseWithStatus & { phone: string | null }>();
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return out;
  const rows: Course[] = await db.select().from(courses).where(inArray(courses.id, uniq));
  if (rows.length === 0) return out;
  const patterns = await loadPatterns(rows);
  const need = [
    ...new Set(
      rows
        .filter((r) => !r.institutionPhone && r.institution)
        .map((r) => r.institution as string),
    ),
  ];
  const instPhone = new Map<string, string>();
  if (need.length > 0) {
    const insts = await db
      .select({ institution: institutions.institution, phone: institutions.phone })
      .from(institutions)
      .where(and(inArray(institutions.institution, need), isNotNull(institutions.phone)));
    for (const i of insts) {
      if (i.phone && !instPhone.has(i.institution)) instPhone.set(i.institution, i.phone);
    }
  }
  for (const r of rows) {
    const phone = r.institutionPhone || (r.institution ? instPhone.get(r.institution) ?? null : null);
    out.set(r.id, { ...attach(r, patterns, today), phone });
  }
  return out;
}

export type AreaTree = {
  sido: { name: string; sigungu: { name: string; dong: string[] }[] }[];
};

/** 지역 목록은 빌드 때만 바뀌므로 서버 메모리에 1시간 둔다(실패하면 버리고 다음 요청에 다시 읽는다). */
const AREAS_TTL_MS = 60 * 60 * 1000;
let areasCache: { at: number; tree: Promise<AreaTree> } | null = null;

export function listAreas(): Promise<AreaTree> {
  const now = Date.now();
  if (areasCache && now - areasCache.at < AREAS_TTL_MS) return areasCache.tree;
  const tree = readAreas();
  areasCache = { at: now, tree };
  tree.catch(() => {
    if (areasCache?.tree === tree) areasCache = null;
  });
  return tree;
}

async function readAreas(): Promise<AreaTree> {
  const rows = await db
    .selectDistinct({
      sido: courses.sido,
      sigungu: courses.sigungu,
      dong: courses.dong,
    })
    .from(courses)
    .where(isNotNull(courses.sido))
    .orderBy(asc(courses.sido), asc(courses.sigungu), asc(courses.dong));

  const sidoMap = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    if (!r.sido || !r.sigungu) continue;
    const gu = sidoMap.get(r.sido) ?? new Map<string, Set<string>>();
    const dongs = gu.get(r.sigungu) ?? new Set<string>();
    if (r.dong) dongs.add(r.dong);
    gu.set(r.sigungu, dongs);
    sidoMap.set(r.sido, gu);
  }
  return {
    sido: [...sidoMap].map(([name, gu]) => ({
      name,
      sigungu: [...gu].map(([g, d]) => ({ name: g, dong: [...d] })),
    })),
  };
}

export async function countByStair(): Promise<Record<Stair, number>> {
  const rows = await db
    .select({ stair: courses.stair, n: sql<number>`count(*)` })
    .from(courses)
    .where(isNotNull(courses.stair))
    .groupBy(courses.stair);
  const out: Record<Stair, number> = { 1: 0, 2: 0, 3: 0 };
  for (const r of rows) if (r.stair) out[r.stair] = Number(r.n);
  return out;
}
