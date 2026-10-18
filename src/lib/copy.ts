import type { Course, Stair } from "@/db/schema";

export const FORBIDDEN = ["창구", "대신", "고독사 위험", "수강생"] as const;

/** 모든 화면 맨 아래 한 줄(Shell 기본값). */
export const FOOT_NOTE = "실제 접수는 기관에 확인하세요";

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

/**
 * 카드에서 모르는 값을 한 줄로 모은다(2026-10-11): 「요일·수강료·접수일 확인 안 됨」.
 * 요일·시간·수강료·접수일이 다 없는 강좌(연수구 꼴)에 「확인 안 됨」이 세 번 나오던 것을 합친 것. 다 알면 null.
 */
export function unknownLine(known: { when: boolean; fee: boolean; apply: boolean }): string | null {
  const parts = [!known.when && "요일", !known.fee && "수강료", !known.apply && "접수일"].filter(Boolean);
  return parts.length ? `${parts.join("·")} ${UNKNOWN}` : null;
}

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
        : c.sessionsPerWeek
          ? { key: "period", label: "기간", value: `주 ${c.sessionsPerWeek}회`, tone: "neutral" } // contract §12 ⑤: 날짜 없이 주 횟수만(요일에서 셌거나 연수구 「횟수(1주)」)
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
    aboutLink: "기관 안내",
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
  /** 기관 안내(/about). 기관 담당자가 읽는 글이라 합니다체. 숫자는 2026-10-11 빌드(README 데이터 현황)·참가신청서 출처 표. */
  about: {
    h1: "기관 안내",
    sub: "디딤칸은 강좌를 직접 열지 않습니다. 기관이 이미 연 자리에 새 사람이 오게 돕습니다.",
    why: {
      sec: "왜 만들었나",
      lead: "나갈 자리가 끊기면 고립이 시작됩니다.",
      rows: [
        { k: "고독사 · 2024년", v: "3,924명", s: "63%가 50~60대 · 1년 새 7.2% 늘었습니다" },
        { k: "독거노인 우울 증상", v: "16.1%", s: "노인 부부의 두 배" },
        { k: "배울 곳을 찾아본 적 없는 성인", v: "3명 중 2명", s: "가지 않는 이유 1위는 「동기·자신감 부족」" },
      ],
      tail: "몰라서, 망설여서 못 갑니다.",
    },
    what: {
      sec: "디딤칸이 하는 일",
      lead: "「무엇을 배우고 싶은가」가 아니라 「지금 어디까지 나갈 수 있는가」를 묻습니다. 동주민센터 강좌까지 모아 「다시 나가는 첫걸음」부터 권합니다.",
      stairs: [
        { k: "1단 · 집에서 듣는 온라인", v: "2,274개" },
        { k: "2단 · 다시 나가는 첫걸음", v: "6,033개", s: "한 번 나가 보는 자리" },
        { k: "3단 · 매주 같은 요일", v: "21,232개" },
        { k: "모은 공공 강좌", v: "34,567개", s: "시군구 227곳 · 서울 25개 구 중 24개 · 2026-10-11 · 계단 밖(어린이·청소년 전용) 5,028개 포함" },
      ],
      aiSec: "AI가 하는 일",
      ai: ["처음 가도 괜찮은 강좌인지 알려 줍니다", "기관마다 제각각인 강좌명을 분야별로 묶습니다", "다음에 나가 볼 강좌를 골라 줍니다"],
      aiNote: "지금은 규칙으로 판정하고, 11월부터 AI 분류를 더합니다",
      flow: "흩어진 강좌 모으기 → 상태 묻기 → 지금 칸 권하기 → 접수일 알림 → 「다녀오셨어요?」 후기(11월)",
    },
    together: {
      sec: "기관과 함께하고 싶은 것",
      rows: [
        { k: "데이터", v: "강좌 목록을 파일이나 API로 받습니다. 출처·기관 링크를 표시하고, 신청은 기관 사이트·전화로 보냅니다." },
        { k: "시범", v: "복지관 1곳에서 담당자와 「함께 고르기」 30명(11월 중순~12월). 다녀온 뒤 「다녀오셨어요?」 응답을 모읍니다." },
        { k: "안내", v: "상담 때 한 번 소개, 포스터·QR 비치. 디지털이 어려운 분은 크게 보기·전화 안내로." },
      ],
      giveK: "디딤칸이 드리는 것",
      giveV: "동네 강좌 한 화면 · 접수 알림 · 어느 동네·시간대 강좌를 찾는지 수요 리포트",
    },
    contact: {
      sec: "연락",
      nameK: "만든 사람",
      nameV: "윤누리",
      mailK: "이메일",
      mail: "ynr0402@gmail.com",
      noteK: "참가",
      noteV: "2026 AI·디지털 기반 사회문제 해결 챌린지 · 서비스 개발 부문",
    },
    mailSubject: "디딤칸 기관 협력 문의",
    mailBtn: "메일 보내기",
    back: "처음으로",
  },
  /** 소개 자료(/intro). 소개 이미지 v3 7장(프로토타입/소개이미지-v3/final → public/intro/1~7.webp)을 좌우로 넘겨 본다. slides 는 장마다 그림 속 글(alt). */
  intro: {
    title: "디딤칸 소개",
    sub: "디딤칸 소개 자료 7장입니다. 좌우로 넘겨 보세요.",
    label: "소개 자료",
    prev: "이전",
    next: "다음",
    goTo: "장으로",
    turn: "폰을 가로로 돌리면 크게 보입니다",
    about: "기관 안내",
    home: "디딤칸 써 보기",
    slides: [
      "디딤칸. 다시 밖으로 나가는 첫걸음이 되어 드립니다. 동주민센터까지 흩어진 지자체의 무료·저가 강좌를 한 곳에 모아, 고립된 사람이 다시 밖으로 나가는 첫걸음을 뗄 수 있게 돕는 웹 서비스입니다. 흩어진 강좌 → 상태 하나 → 지금 칸 → 접수일 알림. 부문 서비스 개발·개인, 현안 고독사·은둔·노인 우울·1인 가구·디지털 소외, 데이터 공공 강좌 34,567개·시군구 227곳(2026-10-11), 사이트 didimkan.vercel.app.",
      "해결하려는 문제. 나갈 자리가 끊기면 고립이 시작됩니다. 고독사 2024년 3,924명, 63%가 50~60대이고 1년 새 7.2% 늘었습니다. 고립·은둔 청년 약 54만 명, 80% 이상이 벗어나고 싶어 합니다. 독거노인 우울 증상 16.1%, 노인 부부의 두 배입니다. 「찾아본 적 없음」 성인 3명 중 2명, 배우러 가지 않는 이유 1위 「동기·자신감 부족」. 몰라서, 망설여서 못 갑니다.",
      "현황. 강좌는 많고 대부분 가깝지만 흩어져 있어 찾기 어렵습니다. 공공데이터포털 348개 파일과 지자체 예약 사이트에서 공공 강좌 34,567개를 직접 모았습니다(2026-10-11). 지자체마다 사이트가 따로이고 서울만 25개입니다. 목록 대부분이 끝난 강좌로, 구로구는 2,572건 중 13건만 신청할 수 있었습니다. 접수일을 적지 않은 곳이 41곳입니다. 무료 강좌 13,408개, 돈 때문에 못 가는 자리가 아닙니다. 동주민센터 강좌는 한 해 5만여 개 중 약 18%(9,085개)만 공개 데이터로 모을 수 있었습니다. 선착순 85%, 접수 기간 중앙값 열흘 남짓. 언제 열리는지 아는 사람만 갑니다.",
      "해결. 동주민센터 강좌까지 모으고 「다시 나가는 첫걸음」부터 권합니다. 「무엇을 배우고 싶은가」가 아니라 「지금 어디까지 나갈 수 있는가」를 묻습니다. AI가 하는 일: 처음 가도 괜찮은 강좌인지 알려 주고, 기관마다 제각각인 강좌명을 분야별로 묶고, 다음에 나가 볼 강좌를 골라 줍니다. 계단: 집에서 듣는 온라인 2,274개, 한 번 나가 보는 자리 6,033개, 매주 같은 요일 21,232개. 지금 사이트에서 볼 수 있는 강좌 34,567개, 시군구 227곳, 서울 25개 구 중 24개. 흩어진 강좌 모으기 → 상태 묻기 → 지금 칸 권하기 → 접수일 알림 → 「다녀오셨어요?」 후기(11월).",
      "화면 구성. 상태 하나만 고르면 접수일까지 챙겨 드립니다. 01 시작: 「요즘 어떠세요?」 상태 하나만 고릅니다. 02 동네: 사는 구·시를 고르면 가까운 곳부터. 03 홈: 지금 칸과 다음 칸 강좌, 「접수 중·마감 D-4」. 04 강좌 카드: 수강료·정원·접수를 맨 앞에, 신청은 기관 사이트로. 05 접수 알림: 3일 전 저녁 6시·당일 아침 8시 두 번 알려 드립니다. 이어지는 화면: 문자 미리보기, 내 알림, 크게 보기.",
      "크게 보기와 함께 받기. 글자는 크게, 혼자 챙기기 어려우면 가족·복지관 담당자와 함께. 「크게 보기」 한 번이면 글자 1.5배(17→26px), 버튼 64px. 알림은 접수 3일 전 저녁과 당일 아침, 두 번 보냅니다. 가족·복지관 담당자 한 분이 알림을 함께 받습니다(11월). 복지관에서는 담당자가 옆에서 함께 고릅니다(12월 시범).",
      "기관과 함께하고 싶은 것. 디딤칸은 강좌를 직접 열지 않습니다. 기관이 이미 연 자리에 새 사람이 오게 돕습니다. 1 데이터: 강좌 목록을 파일이나 API로 받습니다. 출처와 기관 링크를 표시하고, 신청은 기관 사이트·전화로 보냅니다. 2 시범 운영: 복지관 1곳에서 담당자와 「함께 고르기」 30명(11월 중순~12월). 다녀온 뒤 「다녀오셨어요?」 응답을 모읍니다. 3 안내: 상담 때 한 번 소개, 포스터·QR 비치. 디지털이 어려운 분은 크게 보기와 전화 안내로 잇습니다. 디딤칸이 드리는 것: 동네 강좌 한 화면, 접수 알림, 어느 동네·시간대 강좌를 찾는지 수요 리포트. 연락 윤누리 ynr0402@gmail.com.",
    ],
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
