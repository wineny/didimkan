import type { StatusResult } from "./status";

export const UNKNOWN_TEXT = "확인 안 됨";

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** 'D-3' | 'D-day' | 'D+2'. 날짜가 없으면 「확인 안 됨」. */
export function dday(target: string | null | undefined, today: string): string {
  if (!target) return UNKNOWN_TEXT;
  const diff = dayNumber(target) - dayNumber(today);
  if (diff === 0) return "D-day";
  return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

/** 카드·사진 위에 올리는 접수 문구. */
export function ddayLabel(r: StatusResult, today: string): string {
  switch (r.status) {
    case "before": {
      const d = dday(r.date, today);
      return r.isEstimate
        ? `접수 예상 ${d} · 예상이며 확정 아님`
        : `이번 접수 ${d}`;
    }
    case "open":
      return r.date ? `접수 중 · ~${r.date.slice(5, 7)}/${r.date.slice(8, 10)}` : "접수 중";
    case "closed":
      return "지난 회차";
    case "always":
      return "연중 · 수시 접수";
    default:
      return "접수일 확인 안 됨";
  }
}
