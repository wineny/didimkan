import type { Course, Stair } from "@/db/schema";

export const FORBIDDEN = ["창구", "대신", "고독사 위험"] as const;

export const STAIR_NAMES: Record<Stair, string> = {
  1: "아직은 집에서",
  2: "한 번 나가 볼 수 있어요",
  3: "정기적으로 다닐 곳",
};

/** 상태 질문 화면의 회색 보조 한 줄 (v4 index.html 원문) */
export const STAIR_SUB: Record<Stair, string> = {
  1: "아직 밖에 나가는 건 부담돼요",
  2: "짧게, 한 번이면 해볼 만해요",
  3: "매주 나갈 자리가 있으면 좋겠어요",
};

/** 스테퍼 칸 이름 (v4 index.html 원문) */
export const STEP_LABELS: Record<Stair, string> = {
  1: "집에서",
  2: "한 번 나가보기",
  3: "정기적으로",
};

/** 같은 정원 정보를 상태에 따라 다르게 권하는 홈 문구 (프로토타입 README 원문) */
export const HOME_HINT: Record<1 | 2, string> = {
  1: "조용히 앉아 있어도 돼요",
  2: "얼굴을 익히기 쉬워요",
};

/** 3단을 고른 사람의 「다음 칸」 자리 */
export const NEXT_SLOT_STAIR3 = "같은 자리 다음 학기";

export const EMPTY_LIST =
  "아직 이 칸에 맞는 강좌를 못 찾았어요. 다른 칸을 보거나 동네를 바꿔 보세요";

export const NOTIFY_SHEET =
  "접수 알림은 11월에 열려요. 지금은 기관에 전화하거나 사이트에서 신청하세요";

export const LOTTERY_NOTE = "서둘러 누르지 않아도 됩니다";
export const NO_PHONE = "전화번호 확인 안 됨";
export const NO_SIGNAL = "찾은 신호가 없어요";
export const ESTIMATE_NOTE = "예상이며 확정 아님";
export const UNKNOWN = "확인 안 됨";

/** 정원 → 홈 카드 보조 문구. 15명 이하면 얼굴을 익히기 쉽다고, 아니면 조용히 앉아 있어도 된다고 적는다. */
export function capacityHint(capacity: number | null | undefined): string | null {
  if (capacity == null) return null;
  return capacity <= 15 ? HOME_HINT[2] : HOME_HINT[1];
}

export function phoneText(phone: string | null | undefined): string {
  return phone ? phone : NO_PHONE;
}

function won(n: number): string {
  const man = Math.floor(n / 10000);
  const rest = n % 10000;
  if (rest % 100 !== 0) return `${n.toLocaleString("ko-KR")}원`;
  const parts: string[] = [];
  if (man) parts.push(`${man}만`);
  const cheon = Math.floor(rest / 1000);
  const baek = Math.floor((rest % 1000) / 100);
  if (cheon) parts.push(`${cheon}천`);
  if (baek) parts.push(`${baek}백`);
  return `${parts.join(" ")} 원`;
}

/** 「무료」·「월 1만 8천 원」·「3만 원」·「확인 안 됨」 */
export function feeLabel(
  feeWon: number | null | undefined,
  isFree: boolean,
  feePeriod?: string | null,
): string {
  if (isFree) return "무료";
  if (feeWon == null) return UNKNOWN;
  if (feeWon === 0) return "무료";
  const amount = won(feeWon);
  return feePeriod === "월" ? `월 ${amount}` : amount;
}

export type TileTone = "good" | "neutral" | "muted";
export type Tile = {
  key: "fee" | "basic" | "capacity" | "selection" | "period" | "place";
  label: string;
  value: string;
  tone: TileTone;
};

type TileCourse = Pick<
  Course,
  | "isFree"
  | "isOnline"
  | "feeWon"
  | "feePeriod"
  | "capacity"
  | "selectionMethod"
  | "signals"
  | "termDays"
  | "sessionsPerWeek"
>;

/** 문턱 신호 → 타일 6개 (R15). welcome·no_supplies 는 타일이 아니라 원문 인용 칸에서 보여 준다. */
export function tiles(c: TileCourse): Tile[] {
  const has = (k: string) => (c.signals as string[]).includes(k);

  const fee: Tile = {
    key: "fee",
    label: "수강료",
    value: feeLabel(c.feeWon, c.isFree, c.feePeriod),
    tone: c.isFree ? "good" : c.feeWon == null ? "muted" : "neutral",
  };
  const basic: Tile = has("basic")
    ? { key: "basic", label: "수준", value: "기초·입문", tone: "good" }
    : { key: "basic", label: "수준", value: "표시 없음", tone: "muted" };
  const capacity: Tile =
    c.capacity == null
      ? { key: "capacity", label: "정원", value: UNKNOWN, tone: "muted" }
      : has("small")
        ? { key: "capacity", label: "정원", value: `${c.capacity}명 소규모`, tone: "good" }
        : { key: "capacity", label: "정원", value: `${c.capacity}명`, tone: "neutral" };
  const selection: Tile =
    has("lottery") || c.selectionMethod === "추첨"
      ? { key: "selection", label: "접수", value: `추첨 · ${LOTTERY_NOTE}`, tone: "good" }
      : c.selectionMethod === "선착순"
        ? { key: "selection", label: "접수", value: "선착순", tone: "neutral" }
        : { key: "selection", label: "접수", value: UNKNOWN, tone: "muted" };
  const weeks = c.termDays ? Math.ceil(c.termDays / 7) : null;
  const period: Tile = has("once")
    ? { key: "period", label: "기간", value: "1회", tone: "good" }
    : weeks && c.sessionsPerWeek
      ? { key: "period", label: "기간", value: `${weeks}주 · 주 ${c.sessionsPerWeek}회`, tone: "neutral" }
      : weeks
        ? { key: "period", label: "기간", value: `${weeks}주`, tone: "neutral" }
        : { key: "period", label: "기간", value: UNKNOWN, tone: "muted" };
  const place: Tile =
    c.isOnline || has("online")
      ? { key: "place", label: "장소", value: "집에서", tone: "good" }
      : { key: "place", label: "장소", value: "직접 가요", tone: "neutral" };

  return [fee, basic, capacity, selection, period, place];
}
