// 휴대전화 번호 정규화·표시(순수). 저장·발송은 숫자만(01012345678).

const MOBILE = /^01[016789]\d{7,8}$/;

/** 숫자만 남기고 +82/82 는 0 으로 바꾼다. 휴대전화 번호가 아니면 null. */
export function normalizePhone(input: string): string | null {
  let d = String(input ?? "").replace(/\D/g, "");
  if (d.startsWith("82")) {
    d = d.slice(2);
    if (!d.startsWith("0")) d = `0${d}`;
  }
  return MOBILE.test(d) ? d : null;
}

/** 01012345678 → 010-1234-5678, 0111234567 → 011-123-4567. 그 밖의 길이는 숫자 그대로. */
export function formatPhone(d: string): string {
  const s = String(d ?? "").replace(/\D/g, "");
  if (s.length === 11) return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
  if (s.length === 10) return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}`;
  return s;
}

/** 가운데를 가린다: 010-****-5678. 짧은 값은 전부 가린다. */
export function maskPhone(d: string): string {
  const s = String(d ?? "").replace(/\D/g, "");
  if (s.length < 8) return "****";
  return `${s.slice(0, 3)}-${"*".repeat(s.length - 7)}-${s.slice(-4)}`;
}
