import type { Course, EnrollmentPattern } from "@/db/schema";

export type ApplyStatus = "before" | "open" | "closed" | "unknown" | "always";

export type StatusResult = {
  status: ApplyStatus;
  /** 예상일 기반이면 true (화면에 「예상이며 확정 아님」) */
  isEstimate: boolean;
  /** before 는 접수 시작일, open 은 접수 마감일, 예상이면 예상일 */
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

/** 접수 상태를 today(YYYY-MM-DD) 기준으로 계산한다. 날짜 문자열 비교는 사전순 = 시간순. */
export function applyStatus(
  course: StatusCourse,
  today: string,
  pattern?: StatusPattern | null,
): StatusResult {
  if (course.isAlwaysOpen) return result("always");

  const start = course.applyStart ?? null;
  const end = course.applyEnd ?? null;

  if (!start && !end) {
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
    if (course.endDate && course.endDate < today) return result("closed");
    return result("unknown");
  }

  if (start && today < start) return result("before", start);
  if (end && today > end) return result("closed");
  if (!end && course.endDate && course.endDate < today) return result("closed");
  return result("open", end);
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
