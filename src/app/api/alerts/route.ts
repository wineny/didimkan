import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAlert } from "@/db/alerts";
import { getSession } from "@/lib/auth";
import { sameOriginOrNull } from "@/lib/guard";

const Body = z.object({ courseId: z.string().min(1).max(64) });

/** 관심 등록. 401 로그인 필요 · 404 강좌 없음/연중 · 409 알림 30개 초과 · 200 { id, created } */
export async function POST(req: NextRequest) {
  const blocked = sameOriginOrNull(req);
  if (blocked) return blocked;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, reason: "login" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  const r = await createAlert(session.userId, parsed.data.courseId);
  if ("error" in r) {
    const status = r.error === "limit" ? 409 : 404;
    return NextResponse.json({ ok: false, reason: r.error }, { status });
  }
  return NextResponse.json(r);
}
