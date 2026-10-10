/**
 * 링크로 내보내도 되는 http(s) 주소만 돌려준다. pipeline/common/parse.py:safe_http_url 과 같은 규칙.
 * 공백 제거, `www.` 로 시작하면 https:// 를 붙이고, scheme 이 http/https 이고 호스트가 있을 때만 통과.
 * `javascript:`·`data:`·빈 값은 null.
 */
export function safeHttpUrl(v: string | null | undefined): string | null {
  if (v == null) return null;
  let s = String(v).replace(/\s+/g, "");
  if (!s) return null;
  if (s.toLowerCase().startsWith("www.")) s = `https://${s}`;
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(s);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  if ((scheme !== "http" && scheme !== "https") || !m[2]) return null;
  return s;
}

/**
 * 로그인 뒤 돌아갈 같은 사이트 경로만 돌려준다(spec-m2 §13 F7). 아니면 "/me".
 * 문자열이고 `/` 로 시작, `\` 없음, `new URL(next, origin).origin === origin` 일 때만 통과.
 */
export function safeNext(next: unknown, origin: string): string {
  const fallback = "/me";
  if (typeof next !== "string" || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.includes("\\")) return fallback;
  try {
    const base = new URL(origin).origin;
    const u = new URL(next, base);
    if (u.origin !== base) return fallback;
    const out = `${u.pathname}${u.search}${u.hash}`;
    // `/.//evil.com`·`/%2e//evil.com` 은 정규화 뒤 `//evil.com` 이 돼 브라우저가 다른 사이트로 읽는다
    if (out.startsWith("//") || out.startsWith("/\\")) return fallback;
    return out;
  } catch {
    return fallback;
  }
}
