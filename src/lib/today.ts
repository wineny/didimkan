/** 기준일(YYYY-MM-DD, 한국 시간). DIDIM_TODAY 는 production 이 아닐 때만 쓴다. */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function getToday(): string {
  const fixed = process.env.DIDIM_TODAY;
  if (fixed && YMD.test(fixed) && process.env.VERCEL_ENV !== "production") {
    return fixed;
  }
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
}
