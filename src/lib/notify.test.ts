import { describe, expect, it } from "vitest";
import {
  addDays,
  alertApplyDate,
  dueKinds,
  koreanClock,
  koreanDate,
  nextSms,
  remaining,
  schedule,
  slotState,
  smsText,
  type AlertKind,
  type SmsCourse,
} from "./notify";

const none = new Set<AlertKind>();
const BANNED = /창구|대신|고독사 위험|수강생 [0-9]+명/;

describe("addDays", () => {
  it("월말·연말을 넘긴다", () => {
    expect(addDays("2026-05-01", -3)).toBe("2026-04-28");
    expect(addDays("2026-03-02", -3)).toBe("2026-02-27");
    expect(addDays("2027-01-02", -3)).toBe("2026-12-30");
    expect(addDays("2026-04-30", 1)).toBe("2026-05-01");
  });
  it("윤년 2월 29일", () => {
    expect(addDays("2028-03-02", -3)).toBe("2028-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
});

describe("koreanDate · koreanClock", () => {
  it("요일은 KST 달력 기준", () => {
    expect(koreanDate("2026-04-27")).toBe("4월 27일(월)");
    expect(koreanDate("2026-10-10")).toBe("10월 10일(토)");
    expect(koreanDate("2028-02-29")).toBe("2월 29일(화)");
  });
  it("시각 이름", () => {
    expect(koreanClock(3)).toBe("새벽 3시");
    expect(koreanClock(8)).toBe("아침 8시");
    expect(koreanClock(9)).toBe("오전 9시");
    expect(koreanClock(12)).toBe("낮 12시");
    expect(koreanClock(15)).toBe("오후 3시");
    expect(koreanClock(18)).toBe("저녁 6시");
  });
});

describe("alertApplyDate", () => {
  const base = { isAlwaysOpen: false, applyStart: null, applyEnd: null };
  it("연중·수시는 null", () => {
    expect(alertApplyDate({ ...base, isAlwaysOpen: true, applyStart: "2026-06-01" }, null)).toBeNull();
  });
  it("시작일이 있으면 확정(접수 중이어도 그 날짜)", () => {
    expect(alertApplyDate({ ...base, applyStart: "2026-04-26", applyEnd: "2026-04-30" }, { nextOpenEstimate: "2026-07-01" }))
      .toEqual({ date: "2026-04-26", isEstimate: false });
  });
  it("시작일이 없으면 예측일(예상)", () => {
    expect(alertApplyDate(base, { nextOpenEstimate: "2026-07-01" })).toEqual({ date: "2026-07-01", isEstimate: true });
    expect(alertApplyDate(base, null)).toBeNull();
  });
  it("시작일 > 마감일은 날짜 오류라 null", () => {
    expect(alertApplyDate({ ...base, applyStart: "2026-05-10", applyEnd: "2026-05-01" }, null)).toBeNull();
  });
});

describe("schedule · dueKinds", () => {
  const apply = "2026-05-01";
  it("3일 전 저녁 6시 · 당일 아침 8시", () => {
    expect(schedule(apply)).toEqual({ d3: { date: "2026-04-28", hour: 18 }, d0: { date: "2026-05-01", hour: 8 } });
  });
  it("D-3 17시 → 없음, 18시 → d3, 23시 → d3", () => {
    expect(dueKinds(apply, { date: "2026-04-28", hour: 17 }, none)).toEqual([]);
    expect(dueKinds(apply, { date: "2026-04-28", hour: 18 }, none)).toEqual(["d3"]);
    expect(dueKinds(apply, { date: "2026-04-28", hour: 23 }, none)).toEqual(["d3"]);
  });
  it("이미 보냈으면 없음", () => {
    expect(dueKinds(apply, { date: "2026-04-28", hour: 18 }, new Set<AlertKind>(["d3"]))).toEqual([]);
    expect(dueKinds(apply, { date: "2026-05-01", hour: 8 }, new Set<AlertKind>(["d0"]))).toEqual([]);
  });
  it("당일 7시 → 없음, 8시 → d0, 12시 → 없음(창 닫힘)", () => {
    expect(dueKinds(apply, { date: "2026-05-01", hour: 7 }, none)).toEqual([]);
    expect(dueKinds(apply, { date: "2026-05-01", hour: 8 }, none)).toEqual(["d0"]);
    expect(dueKinds(apply, { date: "2026-05-01", hour: 11 }, none)).toEqual(["d0"]);
    expect(dueKinds(apply, { date: "2026-05-01", hour: 12 }, none)).toEqual([]);
  });
  it("그날이 지나면 늦게 보내지 않는다", () => {
    expect(dueKinds(apply, { date: "2026-04-29", hour: 8 }, none)).toEqual([]);
    expect(dueKinds(apply, { date: "2026-05-02", hour: 8 }, none)).toEqual([]);
  });
});

describe("nextSms · remaining", () => {
  const apply = "2026-05-01";
  it("처음엔 d3 가 다음, 2번 중 2번", () => {
    expect(nextSms(apply, { date: "2026-04-20", hour: 10 }, none)).toEqual({ kind: "d3", date: "2026-04-28", hour: 18 });
    expect(remaining(apply, { date: "2026-04-20", hour: 10 }, none)).toEqual({ total: 2, left: 2 });
  });
  it("d3 를 보냈으면 d0 이 다음, 1번", () => {
    const sent = new Set<AlertKind>(["d3"]);
    expect(nextSms(apply, { date: "2026-04-28", hour: 19 }, sent)).toEqual({ kind: "d0", date: "2026-05-01", hour: 8 });
    expect(remaining(apply, { date: "2026-04-28", hour: 19 }, sent).left).toBe(1);
  });
  it("D-3 이 지난 뒤 등록하면 d0 만 남는다", () => {
    expect(nextSms(apply, { date: "2026-04-30", hour: 9 }, none)?.kind).toBe("d0");
    expect(remaining(apply, { date: "2026-04-30", hour: 9 }, none).left).toBe(1);
  });
  it("당일 12시가 지나면 보낼 문자가 없다", () => {
    expect(nextSms(apply, { date: "2026-05-01", hour: 12 }, none)).toBeNull();
    expect(remaining(apply, { date: "2026-05-01", hour: 12 }, none).left).toBe(0);
  });
  it("보내는 시각이 지나면 「지남」 — D-3 18시 이후 등록은 d0 만, 당일 8시 이후는 0(화면·발송 기준 통일)", () => {
    expect(slotState("d3", apply, { date: "2026-04-28", hour: 17 }, none)).toBe("upcoming");
    expect(slotState("d3", apply, { date: "2026-04-28", hour: 18 }, none)).toBe("passed");
    expect(nextSms(apply, { date: "2026-04-28", hour: 19 }, none)?.kind).toBe("d0");
    expect(remaining(apply, { date: "2026-04-28", hour: 19 }, none).left).toBe(1);
    expect(slotState("d0", apply, { date: "2026-05-01", hour: 8 }, none)).toBe("passed");
    expect(slotState("d0", apply, { date: "2026-05-01", hour: 8 }, new Set<AlertKind>(["d0"]))).toBe("sent");
    expect(remaining(apply, { date: "2026-05-01", hour: 8 }, none).left).toBe(0);
  });
});

describe("smsText", () => {
  const c: SmsCourse = {
    title: "생활 요가 기초반",
    applyDate: "2026-06-01",
    isEstimate: false,
    source: "std",
    orgName: "OO구 평생학습관",
    siteUrl: "https://example.org/c/1",
    phone: "02-123-4567",
    capacity: 20,
    selectionMethod: "선착순",
  };
  const gangnam: SmsCourse = { ...c, source: "gangnam", orgName: "강남구 통합예약", applyDate: "2026-04-27" };

  it("d3 기본 문안", () => {
    expect(smsText("d3", c)).toBe(
      "[디딤칸] 3일 뒤 6월 1일(월)에 「생활 요가 기초반」 접수가 열려요. 선착순 20명이에요. 신청: OO구 평생학습관 https://example.org/c/1",
    );
  });
  it("d0 전화가 있으면 전화 안내", () => {
    expect(smsText("d0", c)).toBe(
      "[디딤칸] 오늘 「생활 요가 기초반」 접수가 열려요. 전화로 물어볼 수 있어요 OO구 평생학습관 02-123-4567",
    );
  });
  it("d0 전화가 없으면 신청처·링크", () => {
    expect(smsText("d0", { ...c, phone: null })).toBe(
      "[디딤칸] 오늘 「생활 요가 기초반」 접수가 열려요. 신청: OO구 평생학습관 https://example.org/c/1",
    );
    expect(smsText("d0", { ...c, phone: null, siteUrl: null })).toBe(
      "[디딤칸] 오늘 「생활 요가 기초반」 접수가 열려요. 신청: OO구 평생학습관",
    );
  });
  it("강남만 「오전 9시」", () => {
    expect(smsText("d3", gangnam)).toContain("4월 27일(월) 오전 9시에");
    expect(smsText("d0", gangnam)).toContain("오늘 오전 9시 「");
    expect(smsText("d3", c)).not.toContain("시에");
    expect(smsText("d0", c)).not.toContain("9시");
  });
  it("예상이면 앞에 (예상), 끝에 「예상이며 확정 아님」", () => {
    for (const k of ["d3", "d0"] as const) {
      const t = smsText(k, { ...c, isEstimate: true });
      expect(t.startsWith("[디딤칸] (예상) ")).toBe(true);
      expect(t.endsWith(" 예상이며 확정 아님")).toBe(true);
    }
  });
  it("선착순이 아니거나 정원이 없으면 자리 수를 쓰지 않는다", () => {
    expect(smsText("d3", { ...c, selectionMethod: "추첨" })).not.toContain("명이에요");
    expect(smsText("d3", { ...c, capacity: null })).not.toContain("명이에요");
  });
  it("제목은 60자에서 자른다(…)", () => {
    const long = "가".repeat(80);
    const t = smsText("d3", { ...c, title: long });
    const inner = /「(.*)」/.exec(t)![1];
    expect(Array.from(inner)).toHaveLength(60);
    expect(inner.endsWith("…")).toBe(true);
    expect(smsText("d3", { ...c, title: "가".repeat(60) })).toContain(`「${"가".repeat(60)}」`);
  });
  it("금지어 0건", () => {
    const all = [c, gangnam, { ...c, isEstimate: true, phone: null }].flatMap((x) =>
      (["d3", "d0"] as const).map((k) => smsText(k, x)),
    );
    for (const t of all) expect(t).not.toMatch(BANNED);
  });
});
