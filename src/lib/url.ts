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
