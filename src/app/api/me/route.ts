import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, deleteUser, getSession } from "@/lib/auth";
import { sameOriginOrNull } from "@/lib/guard";

/** 「내 번호 지우기」: 사용자·알림·세션·문자기록 삭제 + 쿠키 삭제. */
export async function DELETE(req: NextRequest) {
  const blocked = sameOriginOrNull(req);
  if (blocked) return blocked;
  const session = await getSession();
  const store = await cookies();
  if (!session) {
    store.delete(SESSION_COOKIE);
    return NextResponse.json({ ok: false, reason: "login" }, { status: 401 });
  }
  await deleteUser(session.userId);
  store.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
