// 접수 알림 문자 규칙(순수). 문자는 두 번: 접수 3일 전 저녁 6시(d3) · 접수 당일 아침 8시(d0).
// 그날 창을 지나면 늦게 보내지 않는다(틀린 안내 방지). 날짜는 KST 달력 기준 YYYY-MM-DD.
import type { Course, EnrollmentPattern } from "@/db/schema";
import { ESTIMATE_NOTE } from "./copy";

export type AlertKind = "d3" | "d0";
export const ALERT_KINDS: readonly AlertKind[] = ["d3", "d0"];

/** 보내기 시작하는 시(KST). */
export const SEND_HOUR = { d3: 18, d0: 8 } as const;
/** 이 시 전까지만 보낸다(d3 는 그날 밤까지, d0 은 낮 12시 전까지). */
const WINDOW_END = { d3: 24, d0: 12 } as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_MAX = 60;
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

type Ymd = { y: number; m: number; d: number };
const parse = (ymd: string): Ymd => {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
};

export function addDays(ymd: string, n: number): string {
  const { y, m, d } = parse(ymd);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** `4월 27일(월)` */
export function koreanDate(ymd: string): string {
  const { y, m, d } = parse(ymd);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}월 ${d}일(${WEEKDAY[w]})`;
}

/** 0~5 새벽 · 6~8 아침 · 9~11 오전 · 12 낮 · 13~17 오후 · 18~23 저녁 */
export function koreanClock(hour: number): string {
  if (hour <= 5) return `새벽 ${hour}시`;
  if (hour <= 8) return `아침 ${hour}시`;
  if (hour <= 11) return `오전 ${hour}시`;
  if (hour === 12) return "낮 12시";
  if (hour <= 17) return `오후 ${hour - 12}시`;
  return `저녁 ${hour - 12}시`;
}

/**
 * 알림 기준 접수일. 연중·수시는 null, 접수 시작일이 있으면 확정, 없으면 기관 예측일(예상).
 * 시작일이 마감일보다 늦은 행은 날짜 오류라 null(지어내지 않는다, status.ts 2번과 같은 판단).
 */
export function alertApplyDate(
  course: Pick<Course, "isAlwaysOpen" | "applyStart" | "applyEnd">,
  pattern: Pick<EnrollmentPattern, "nextOpenEstimate"> | null | undefined,
): { date: string; isEstimate: boolean } | null {
  if (course.isAlwaysOpen) return null;
  const start = course.applyStart;
  if (start) {
    if (!YMD.test(start)) return null;
    if (course.applyEnd && start > course.applyEnd) return null;
    return { date: start, isEstimate: false };
  }
  const est = pattern?.nextOpenEstimate;
  return est && YMD.test(est) ? { date: est, isEstimate: true } : null;
}

export function schedule(applyDate: string): {
  d3: { date: string; hour: 18 };
  d0: { date: string; hour: 8 };
} {
  return {
    d3: { date: addDays(applyDate, -3), hour: SEND_HOUR.d3 },
    d0: { date: applyDate, hour: SEND_HOUR.d0 },
  };
}

type Now = { date: string; hour: number };

export type SlotState = "sent" | "passed" | "upcoming";

/**
 * 칸 상태 하나로 통일(화면 06·08·09 와 remaining·nextSms 가 모두 이 함수를 쓴다).
 * 보냈으면 sent, 보내는 시각(SEND_HOUR)이 지났으면 passed, 아니면 upcoming.
 * 크론이 한 창에 한 번만 돌므로 그 시각 뒤에 등록한 칸은 나가지 않는다 → 「지났어요」가 맞다.
 */
export function slotState(kind: AlertKind, applyDate: string, now: Now, sent: ReadonlySet<AlertKind>): SlotState {
  if (sent.has(kind)) return "sent";
  const date = schedule(applyDate)[kind].date;
  const passed = now.date > date || (now.date === date && now.hour >= SEND_HOUR[kind]);
  return passed ? "passed" : "upcoming";
}

/** 지금 보내야 하는 문자. d3: 3일 전 18시 이후 · d0: 당일 8시 이상 12시 전. 이미 보낸 건 뺀다. */
export function dueKinds(
  applyDate: string,
  now: Now,
  sent: ReadonlySet<AlertKind>,
): AlertKind[] {
  const s = schedule(applyDate);
  return ALERT_KINDS.filter(
    (k) =>
      !sent.has(k) &&
      now.date === s[k].date &&
      now.hour >= SEND_HOUR[k] &&
      now.hour < WINDOW_END[k],
  );
}

/** 다음에 보낼 문자(보내는 시각이 안 된 첫 칸). 없으면 null. */
export function nextSms(
  applyDate: string,
  now: Now,
  sent: ReadonlySet<AlertKind>,
): { kind: AlertKind; date: string; hour: number } | null {
  const s = schedule(applyDate);
  const kind = ALERT_KINDS.find((k) => slotState(k, applyDate, now, sent) === "upcoming");
  return kind ? { kind, date: s[kind].date, hour: s[kind].hour } : null;
}

/** 「남은 문자 2번 중 n번」: 아직 보내는 시각이 안 된 칸만 센다. */
export function remaining(
  applyDate: string,
  now: Now,
  sent: ReadonlySet<AlertKind>,
): { total: 2; left: number } {
  const left = ALERT_KINDS.filter((k) => slotState(k, applyDate, now, sent) === "upcoming").length;
  return { total: 2, left };
}

export type SmsCourse = {
  title: string;
  applyDate: string;
  isEstimate: boolean;
  source: string;
  orgName: string;
  siteUrl: string | null;
  phone: string | null;
  capacity: number | null;
  selectionMethod: string | null;
};

function cutTitle(title: string): string {
  const chars = Array.from(title.trim());
  return chars.length > TITLE_MAX ? `${chars.slice(0, TITLE_MAX - 1).join("")}…` : chars.join("");
}

/** 알림 문자 본문. 접수 시각은 강남 통합예약만 「오전 9시」(contract §11), 다른 곳은 시각을 쓰지 않는다. */
export function smsText(kind: AlertKind, c: SmsCourse): string {
  const time = c.source === "gangnam" ? ` ${koreanClock(9)}` : "";
  const title = cutTitle(c.title);
  const head = c.isEstimate ? "[디딤칸] (예상) " : "[디딤칸] ";
  const tail = c.isEstimate ? ` ${ESTIMATE_NOTE}` : "";
  const apply = ` 신청: ${c.orgName}${c.siteUrl ? ` ${c.siteUrl}` : ""}`;

  if (kind === "d3") {
    const seats =
      c.selectionMethod === "선착순" && c.capacity != null ? ` 선착순 ${c.capacity}명이에요.` : "";
    return `${head}3일 뒤 ${koreanDate(c.applyDate)}${time}에 「${title}」 접수가 열려요.${seats}${apply}${tail}`;
  }
  const ask = c.phone ? ` 전화로 물어볼 수 있어요 ${c.orgName} ${c.phone}` : apply;
  return `${head}오늘${time} 「${title}」 접수가 열려요.${ask}${tail}`;
}
