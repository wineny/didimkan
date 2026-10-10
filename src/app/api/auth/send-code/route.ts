import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requestOtp } from "@/lib/auth";
import { sameOriginOrNull } from "@/lib/guard";

const Body = z.object({ phone: z.string().max(40) });

export async function POST(req: NextRequest) {
  const blocked = sameOriginOrNull(req);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  const r = await requestOtp(parsed.data.phone);
  if (r.ok) {
    return NextResponse.json(r.devCode ? { ok: true, devCode: r.devCode } : { ok: true });
  }
  if (r.reason === "rate") {
    const retryAfterSec = r.retryAfterSec ?? 600;
    return NextResponse.json(
      { ok: false, reason: "rate", retryAfterSec },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
  }
  if (r.reason === "failed") {
    return NextResponse.json({ ok: false, reason: "failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
}
