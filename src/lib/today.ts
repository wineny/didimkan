/**
 * 기준일(YYYY-MM-DD, 한국 시간).
 * DIDIM_TODAY 는 명시 플래그 DIDIM_ALLOW_TODAY_OVERRIDE=1 이 있고 Vercel production 이 아닐 때만 쓴다.
 * (e2e 는 `pnpm start` = NODE_ENV=production 이라 NODE_ENV 로는 가를 수 없어 플래그를 둔다.)
 */
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YMD_HM = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

export type KstNow = { date: string; hour: number; minute: number };

/** 기준 시각을 바꿔도 되는 환경인가(플래그 + production 아님). 크론 `?now=` 도 이 조건을 쓴다. */
export function overrideAllowed(): boolean {
  return (
    process.env.DIDIM_ALLOW_TODAY_OVERRIDE === "1" && process.env.VERCEL_ENV !== "production"
  );
}

export function getToday(): string {
  const fixed = process.env.DIDIM_TODAY;
  const allowed = overrideAllowed();
  if (fixed && YMD.test(fixed) && allowed) {
    return fixed;
  }
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
}

/** 주어진 순간의 한국 날짜·시·분. 한국은 서머타임이 없어 +9시간이면 된다. */
export function nowKst(d: Date): KstNow {
  const k = new Date(d.getTime() + 9 * 3_600_000);
  return { date: k.toISOString().slice(0, 10), hour: k.getUTCHours(), minute: k.getUTCMinutes() };
}

/** `YYYY-MM-DDTHH:MM`(한국 시각) → KstNow. 형식·범위가 틀리면 null. */
export function parseKstNow(s: string | null | undefined): KstNow | null {
  const m = s ? YMD_HM.exec(s) : null;
  if (!m) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) return null;
  return { date: m[1], hour, minute };
}

/**
 * 지금 한국 시각. 오버라이드 조건(overrideAllowed)에서 DIDIM_NOW 가 있으면 그 값,
 * DIDIM_TODAY 만 있으면 날짜만 바꾸고 시·분은 실제 시각.
 */
export function getNow(): KstNow {
  const real = nowKst(new Date());
  if (!overrideAllowed()) return real;
  const fixed = parseKstNow(process.env.DIDIM_NOW);
  if (fixed) return fixed;
  const day = process.env.DIDIM_TODAY;
  if (day && YMD.test(day)) return { ...real, date: day };
  return real;
}
