import { NextResponse, type NextRequest } from "next/server";
import { runNotify } from "@/db/alerts";
import { requireCron } from "@/lib/guard";
import { getNow, overrideAllowed, parseKstNow } from "@/lib/today";

export const dynamic = "force-dynamic";
// 문자 500건을 5건씩 보내면 수십 초가 걸릴 수 있다. Vercel 함수 기본값보다 넉넉히 둔다.
export const maxDuration = 60;

/**
 * 접수 알림 문자 발송(Vercel Cron: UTC 09시 = KST 18시, UTC 23시 = KST 08시).
 * `?dry=1` 이면 보내지 않고 planned 만. `?now=YYYY-MM-DDTHH:MM`(KST)는 오버라이드 허용 환경에서만.
 */
async function handle(req: NextRequest) {
  const denied = requireCron(req);
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const dry = q.get("dry") === "1";
  const rawNow = q.get("now");
  let now = getNow();
  if (rawNow && overrideAllowed()) {
    const parsed = parseKstNow(rawNow);
    if (!parsed) {
      return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
    }
    now = parsed;
  }
  try {
    return NextResponse.json(await runNotify(now, { dry }));
  } catch (e) {
    console.error(`[cron:notify] 실패 ${e instanceof Error ? e.name : ""}`);
    return NextResponse.json({ ok: false, reason: "error" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
