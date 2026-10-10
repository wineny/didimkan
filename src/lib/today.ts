/**
 * 기준일(YYYY-MM-DD, 한국 시간).
 * DIDIM_TODAY 는 명시 플래그 DIDIM_ALLOW_TODAY_OVERRIDE=1 이 있고 Vercel production 이 아닐 때만 쓴다.
 * (e2e 는 `pnpm start` = NODE_ENV=production 이라 NODE_ENV 로는 가를 수 없어 플래그를 둔다.)
 */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function getToday(): string {
  const fixed = process.env.DIDIM_TODAY;
  const allowed =
    process.env.DIDIM_ALLOW_TODAY_OVERRIDE === "1" && process.env.VERCEL_ENV !== "production";
  if (fixed && YMD.test(fixed) && allowed) {
    return fixed;
  }
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
}
