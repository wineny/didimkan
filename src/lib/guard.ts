// 라우트 첫 줄 검사. 통과하면 null, 막으면 바로 돌려줄 Response.
import { createHash, timingSafeEqual } from "node:crypto";

/** Origin 헤더가 있고 Host/X-Forwarded-Host 와 다르면 403. 변경 메서드(POST/PATCH/DELETE) 첫 줄에서 부른다. */
export function sameOriginOrNull(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return forbidden();
  }
  const hosts = [
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim(),
    req.headers.get("host")?.trim(),
  ]
    .filter((h): h is string => !!h)
    .map((h) => h.toLowerCase());
  return hosts.includes(originHost) ? null : forbidden();
}

/** CRON_SECRET 이 없거나 Authorization 이 `Bearer ${CRON_SECRET}` 와 다르면 401. */
export function requireCron(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return unauthorized();
  const got = req.headers.get("authorization") ?? "";
  return safeEqual(got, `Bearer ${secret}`) ? null : unauthorized();
}

/** 길이가 달라도 상수 시간으로 비교하도록 sha256 으로 맞춘 뒤 비교한다. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

function forbidden(): Response {
  return Response.json({ ok: false, reason: "origin" }, { status: 403 });
}

function unauthorized(): Response {
  return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
}
