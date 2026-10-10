// 조회 함수. 계약: docs/contract.md §10(접수 상태·정렬), R7·R9.
// 지역은 걸러내는 조건이 아니라 정렬 기준이다. DB 에서는 계단으로만 거르고,
// 후보 상한 안에 「가까운」 행이 들어오도록 SQL ORDER BY 에서 지역 일치·마감·접수 중을 먼저 본다.
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

async function loadPatterns(rows: readonly Course[]): Promise<EnrollmentPattern[]> {
  const names = [...new Set(rows.map((r) => r.institution).filter((v): v is string => !!v))];
  if (names.length === 0) return [];
  return db
    .select()
    .from(enrollmentPatterns)
    .where(inArray(enrollmentPatterns.institution, names));
}

function attach(
  row: Course,
  patterns: readonly EnrollmentPattern[],
  today: string,
): CourseWithStatus {
  const pattern = findPattern(row, patterns) ?? null;
  const status = applyStatus(row, today, pattern);
  return { ...row, pattern, status, ddayLabel: ddayLabel(status, today) };
}

/**
 * 지역 일치 순위: 동 0 → 구 1 → 시도 2 → 나머지 3. 1단(온라인)·지역 없음은 순위가 없으니 null
 * (상수 `ORDER BY 0` 은 SQLite 가 열 번호로 읽어 오류가 나므로 아예 빼야 한다).
 */
function areaRankSql(stair: Stair, area: Area): SQL | null {
  if (stair === 1 || !area.sido) return null;
  const sido = eq(courses.sido, area.sido);
  const gu = area.sigungu ? and(sido, eq(courses.sigungu, area.sigungu)) : undefined;
  const dong = gu && area.dong ? and(gu, eq(courses.dong, area.dong)) : undefined;
  return sql`CASE${dong ? sql` WHEN ${dong} THEN 0` : sql``}${gu ? sql` WHEN ${gu} THEN 1` : sql``} WHEN ${sido} THEN 2 ELSE 3 END`;
}

/**
 * 마감이면 1(contract §10 3·5·8번): 접수 마감일 지남, 또는 강좌 종료일 지남 ∧ (시작일 없음 ∨ 마감일 없이 시작일 ≤ today).
 * 연중·수시와 날짜가 거꾸로인 행(2번 unknown)은 0. 시작일이 미래면(4번 before) 종료일이 지나도 0.
 * 한계: 시작일 없이 예측(7번 before)이 있는 행도 종료일이 지났으면 여기서는 1 로 뒤에 놓인다
 * (예측은 enrollment_patterns 조인이 필요해 SQL 에서 보지 않음). 최종 상태·순서는 sortCourses 가 정한다.
 */
function closedSql(today: string): SQL {
  return sql`CASE WHEN ${courses.isAlwaysOpen} = 1 THEN 0
    WHEN ${courses.applyStart} IS NOT NULL AND ${courses.applyEnd} IS NOT NULL AND ${courses.applyStart} > ${courses.applyEnd} THEN 0
    WHEN ${courses.applyEnd} IS NOT NULL AND ${courses.applyEnd} < ${today} THEN 1
    WHEN (${courses.applyStart} IS NULL OR (${courses.applyEnd} IS NULL AND ${courses.applyStart} <= ${today}))
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
      ...[areaRankSql(stair, area)].filter((x): x is SQL => x !== null),
      closedSql(today),
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
