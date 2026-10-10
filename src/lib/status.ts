import type { Course, EnrollmentPattern } from "@/db/schema";

export type ApplyStatus = "before" | "open" | "closed" | "unknown" | "always";

export type StatusResult = {
  status: ApplyStatus;
  /** 예상일 기반이면 true (화면에 「예상이며 확정 아님」) */
  isEstimate: boolean;
  /** before 는 접수 시작일, open 은 접수 마감일, closed 는 접수 마감일(있을 때), 예상이면 예상일 */
  date?: string;
  /** 예상일 (isEstimate 일 때만, date 와 같다) */
  estimateDate?: string;
  basisCount?: number;
  ruleNote?: string | null;
};

export type StatusCourse = Pick<
  Course,
  "isAlwaysOpen" | "applyStart" | "applyEnd" | "endDate"
>;
export type StatusPattern = Pick<
  EnrollmentPattern,
  "nextOpenEstimate" | "basisCount" | "ruleNote"
>;

const result = (
  status: ApplyStatus,
  date?: string | null,
): StatusResult => ({ status, isEstimate: false, ...(date ? { date } : {}) });

/**
 * 접수 상태를 today(YYYY-MM-DD) 기준으로 계산한다. 날짜 문자열 비교는 사전순 = 시간순.
 * docs/contract.md §10 판정 순서를 그대로 옮겼다(pipeline/derive.py:apply_status 와 같은 결과, 5번 예측만 추가).
 */
export function applyStatus(
  course: StatusCourse,
  today: string,
  pattern?: StatusPattern | null,
): StatusResult {
  const start = course.applyStart ?? null;
  const end = course.applyEnd ?? null;

  // 1. 연중·수시
  if (course.isAlwaysOpen) return result("always");
  // 2. 마감일 지남
  if (end && today > end) return result("closed", end);
  // 3·4. 시작일 있음 → 시작 전이면 before, 아니면 open(마감일 없거나 안 지남)
  if (start) return today < start ? result("before", start) : result("open", end);
  // 5. 시작일 없음 ∧ 예측이 오늘 이후
  const est = pattern?.nextOpenEstimate ?? null;
  if (est && est >= today) {
    return {
      status: "before",
      isEstimate: true,
      date: est,
      estimateDate: est,
      basisCount: pattern?.basisCount,
      ruleNote: pattern?.ruleNote ?? null,
    };
  }
  // 6. 강좌 종료일 지남
  if (course.endDate && today > course.endDate) return result("closed");
  // 7. 그 밖(시작일 없이 마감일만 있고 안 지남 포함)
  return result("unknown");
}

/** 기관명(+시군구)으로 예측 행을 찾는다. 시군구까지 맞는 행을 우선한다. */
export function findPattern<
  P extends Pick<EnrollmentPattern, "institution" | "sigungu">,
>(
  course: Pick<Course, "institution" | "sigungu">,
  patterns: readonly P[] | undefined,
): P | undefined {
  if (!patterns || !course.institution) return undefined;
  const same = patterns.filter((p) => p.institution === course.institution);
  return (
    same.find((p) => p.sigungu === course.sigungu) ??
    same.find((p) => p.sigungu == null)
  );
}
