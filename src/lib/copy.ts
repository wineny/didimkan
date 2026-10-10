import type { Course, Stair } from "@/db/schema";

export const FORBIDDEN = ["창구", "대신", "고독사 위험", "수강생"] as const;

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
  // contract §9·§12: round(term_days/7), 0.5 는 올림 — derive.py stair_reason 과 같은 주 수
  const weeks = c.termDays ? Math.round(c.termDays / 7) : null;
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

/** M2-a 화면 문구: 로그인 · 관심 등록 · 문자 미리보기 · 내 알림 · 개인정보 안내 (금지어 검사 대상) */
export const M2_COPY = {
  login: {
    kick1: "처음 한 번만 · 2단계 중 1",
    kick2: "처음 한 번만 · 2단계 중 2",
    h1: "문자로 알려드리려면 로그인이 필요해요",
    sub: "다음부터는 누르면 바로 등록돼요",
    courseLabel: "등록하려는 강좌",
    phoneLabel: "휴대전화 번호",
    phonePlaceholder: "010-0000-0000",
    send: "문자 보내기",
    sending: "보내는 중이에요",
    note: "번호는 알림에만 써요. 원하시면 언제든 지울 수 있어요",
    privacyLink: "개인정보 처리 안내",
    codeLabel: "문자로 온 숫자 6자리",
    sentSuffix: "번호로 문자를 보냈어요",
    changePhone: "번호 바꾸기",
    verify: "확인하고 알림 정하기",
    verifying: "확인하는 중이에요",
    resendHint: "문자가 안 왔나요?",
    resend: "다시 보내기",
    resendWaitSuffix: "초 뒤에 다시 보낼 수 있어요",
    skip: "로그인하지 않고 계속 둘러보기",
    registering: "알림을 등록하고 있어요",

    confirmH1: "이 강좌의 접수 알림을 받을까요?",

    confirmBtn: "알림 받기",


    goMe: "내 알림으로 가기",


    backToCourse: "강좌로 돌아가기",

    errAlertLimit: "알림은 30개까지 둘 수 있어요. 내 알림에서 하나를 빼 주세요",
    errInvalidPhone: "휴대전화 번호를 다시 확인해 주세요",
    errWrong: "숫자가 달라요. 다시 확인해 주세요",
    errExpired: "시간이 지났어요. 다시 보내기를 눌러 주세요",
    errLocked: "5번 틀려서 잠시 막았어요. 다시 보내기를 눌러 주세요",
    errRate: "잠시 뒤 다시 보내 주세요",

    errSendFailed: "문자를 보내지 못했어요. 잠시 뒤 다시 해 주세요",
    errUnavailable: "문자 로그인은 준비 중이에요. 지금은 기관에 전화하거나 사이트에서 신청해 주세요",
    errCode: "숫자 6자리를 입력해 주세요",
    errNetwork: "연결이 잘 안 돼요. 잠시 뒤 다시 눌러 주세요",
    errNoAlert: "이 강좌는 알림을 받을 수 없어요. 강좌 화면으로 돌아가 확인해 주세요",
    errAlert: "알림을 등록하지 못했어요. 잠시 뒤 다시 해 주세요",
  },
  alert: {
    h1: "관심 강좌로 등록했어요",
    sub: "디딤칸은 알려드리기만 해요. 신청은 직접 하셔야 해요",
    applyConfirmed: "접수 시작 · 접수일 확정",
    applyEstimate: "접수 시작 · 예상이며 확정 아님",
    applyUnknown: "접수일 확인 안 됨",
    d3: "접수 3일 전 문자",
    d0: "접수 당일 문자",
    sent: "보냈어요",
    passed: "지났어요",
    noSchedule: "접수일이 정해지면 문자 날짜도 알려드려요",
    where: "신청하는 곳",
    to: "받을 사람",
    me: "본인",
    addMore: "함께 받을 사람 추가",
    soon: "준비 중",
    preview: "문자 미리보기",
    done: "이대로 알려주세요",
    gone: "강좌 정보가 바뀌었어요. 알림을 빼거나 다른 강좌를 찾아 주세요",
    remove: "빼기",
    browse: "다른 강좌 둘러보기",
  },
  sms: {
    title: "디딤칸 알림",
    sub: "문자 메시지",
    d3: "접수 3일 전",
    d0: "접수 당일",
    closing: "알림은 이 두 번만 보내요. 신청은 직접 하셔야 해요",
    empty: "접수일이 확인되지 않아 문자 미리보기를 만들 수 없어요",
    back: "알림 화면으로",
  },
  me: {
    h1: "내 알림",
    sub: "알림 받는 강좌와 사람을 여기서 바꿔요",
    listLabel: "등록한 강좌",
    empty: "아직 등록한 강좌가 없어요",
    nextSms: "다음 문자",
    noNext: "보낼 문자가 없어요",
    offNext: "꺼져 있어서 보내지 않아요",
    left: "남은 문자",
    off: "꺼짐",
    turnOff: "알림 끄기",
    turnOn: "알림 켜기",
    remove: "빼기",
    gone: "강좌 정보가 바뀌었어요",
    together: "함께 받는 사람",
    soon: "준비 중",
    deleteMe: "내 번호 지우기",
    deleteTitle: "번호와 알림을 모두 지워요. 되돌릴 수 없어요",
    deleteConfirm: "지우기",
    close: "닫기",
    logout: "로그아웃",
    browse: "다른 강좌 둘러보기",
    errAction: "바꾸지 못했어요. 잠시 뒤 다시 해 주세요",
  },
  privacy: {
    h1: "개인정보 처리 안내",
    draft: "초안",
    sub: "디딤칸이 휴대전화 번호를 어떻게 쓰는지 적었어요",
    rows: [
      { k: "모으는 것", v: "휴대전화 번호" },
      { k: "쓰는 곳", v: "로그인 확인과 접수 알림 문자 보내기" },
      { k: "보관", v: "「내 번호 지우기」를 누를 때까지. 1년 동안 쓰지 않으면 지울 예정이에요" },
      { k: "맡기는 곳", v: "문자 발송은 솔라피에 맡겨요" },
      { k: "지우는 방법", v: "내 알림 화면의 「내 번호 지우기」를 누르면 번호와 알림, 문자 기록이 모두 지워져요. 인증 문자 기록만 번호를 가린 채 하루 남았다가 지워져요(같은 번호로 문자를 너무 많이 보내는 것을 막기 위해서예요)" },
    ],
    back: "처음으로",
  },
} as const;

const SEOUL_GU: Record<string, string> = {
  jongno: "종로구", junggu: "중구", seongdong: "성동구", dongdaemun: "동대문구", gangbuk: "강북구",
  gwanak: "관악구", gangdong: "강동구", yongsan: "용산구", seongbuk: "성북구", seodaemun: "서대문구",
  guro: "구로구", songpa: "송파구", seocho: "서초구", nowon: "노원구",
};

/** 수집 출처 이름(강좌 상세 하단·신청처). */
export function sourceName(source: string): string {
  if (source === "gangnam") return "강남구 통합예약";
  if (source === "std") return "공공데이터포털 전국평생학습강좌표준데이터";
  if (source === "portal") return "공공데이터포털";
  const gu = SEOUL_GU[source.replace("seoul_", "")];
  return gu ? `서울 ${gu} 예약사이트` : source;
}

/** 신청하는 곳 이름. 강남·서울 예약사이트는 사이트 이름, 그 밖은 기관명(없으면 「기관」). */
export function orgName(c: Pick<Course, "source" | "institution">): string {
  return c.source === "gangnam" || c.source.startsWith("seoul_")
    ? sourceName(c.source)
    : (c.institution ?? "기관");
}
