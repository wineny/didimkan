import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { SESSION_COOKIE, sessionCookieOptions, verifyOtp } from "@/lib/auth";
import { sameOriginOrNull } from "@/lib/guard";

const Body = z.object({ phone: z.string().max(40), code: z.string().max(12) });

export async function POST(req: NextRequest) {
  const blocked = sameOriginOrNull(req);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  const r = await verifyOtp(parsed.data.phone, parsed.data.code);
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: r.reason }, { status: 400 });
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, r.token, sessionCookieOptions());
  return NextResponse.json({ ok: true });
}
