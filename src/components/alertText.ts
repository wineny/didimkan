import { koreanClock, koreanDate, slotState, type AlertKind } from "@/lib/notify";

/** 「4월 27일(월)」, 강남 통합예약만 접수 시각 「오전 9시」를 덧붙인다. */
export function applyWhen(applyDate: string, source: string | null | undefined): string {
  return source === "gangnam" ? `${koreanDate(applyDate)} ${koreanClock(9)}` : koreanDate(applyDate);
}

/** 칸 표시: 보냈어요 / 지났어요 / 아직. 기준은 notify.slotState 하나다. */
export function slotMark(
  kind: AlertKind,
  applyDate: string,
  now: { date: string; hour: number },
  sent: readonly AlertKind[],
): "sent" | "passed" | "upcoming" {
  return slotState(kind, applyDate, now, new Set(sent));
}
