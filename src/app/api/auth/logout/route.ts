import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, destroySession } from "@/lib/auth";
import { sameOriginOrNull } from "@/lib/guard";

export async function POST(req: NextRequest) {
  const blocked = sameOriginOrNull(req);
  if (blocked) return blocked;
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  store.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
