import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { deleteAlert, setAlertOn } from "@/db/alerts";
import { getSession } from "@/lib/auth";
import { sameOriginOrNull } from "@/lib/guard";

const Body = z.object({ isOn: z.boolean() });

const notFound = () => NextResponse.json({ ok: false, reason: "not_found" }, { status: 404 });
const login = () => NextResponse.json({ ok: false, reason: "login" }, { status: 401 });

/** 알림 끄기·켜기. 남의 알림·없는 알림은 404. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = sameOriginOrNull(req);
  if (blocked) return blocked;
  const session = await getSession();
  if (!session) return login();
  const { id } = await params;
  if (id.length > 64) return notFound();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400 });
  }
  const ok = await setAlertOn(session.userId, id, parsed.data.isOn);
  return ok ? NextResponse.json({ ok: true }) : notFound();
}

/** 알림 빼기. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = sameOriginOrNull(req);
  if (blocked) return blocked;
  const session = await getSession();
  if (!session) return login();
  const { id } = await params;
  if (id.length > 64) return notFound();
  const ok = await deleteAlert(session.userId, id);
  return ok ? NextResponse.json({ ok: true }) : notFound();
}
