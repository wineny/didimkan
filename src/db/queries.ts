// 조회 함수. 계약: docs/contract.md §10(접수 상태·정렬), R7·R9.
// 지역은 걸러내는 조건이 아니라 정렬 기준이다. DB 에서는 계단으로만 거르고,
// 같은 시도 행을 먼저 가져온 뒤 모자라면 나머지에서 채운다.
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
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

export async function listCourses({
  stair,
  area = {},
  today = getToday(),
  limit = 10,
  offset = 0,
}: ListCoursesInput): Promise<CourseWithStatus[]> {
  // 접수가 확실히 끝난 행(apply_end < today)은 뒤로 보내 후보 상한에 잘리지 않게 한다.
  const closedLast = sql`CASE WHEN ${courses.applyEnd} IS NOT NULL AND ${courses.applyEnd} < ${today} THEN 1 ELSE 0 END`;
  const base = eq(courses.stair, stair);
  const fetchRows = (where: ReturnType<typeof and>) =>
    db
      .select()
      .from(courses)
      .where(where)
      .orderBy(closedLast, asc(courses.id))
      .limit(CANDIDATE_CAP);

  const need = offset + limit;
  let rows: Course[];
  if (stair !== 1 && area.sido) {
    rows = await fetchRows(and(base, eq(courses.sido, area.sido)));
    if (rows.length < need) {
      const rest = await fetchRows(
        and(base, or(isNull(courses.sido), ne(courses.sido, area.sido))),
      );
      rows = rows.concat(rest);
    }
  } else {
    rows = await fetchRows(base);
  }

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

export async function listAreas(): Promise<AreaTree> {
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
