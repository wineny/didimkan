import { describe, expect, it } from "vitest";
import { formatPhone, maskPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("하이픈·공백을 지우고 숫자만 남긴다", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
    expect(normalizePhone(" 010 1234 5678 ")).toBe("01012345678");
    expect(normalizePhone("011-123-4567")).toBe("0111234567");
  });
  it("+82·82 는 0 으로 바꾼다", () => {
    expect(normalizePhone("+82 10-1234-5678")).toBe("01012345678");
    expect(normalizePhone("821012345678")).toBe("01012345678");
    expect(normalizePhone("+82 010-1234-5678")).toBe("01012345678");
  });
  it("휴대전화가 아니면 null", () => {
    expect(normalizePhone("02-123-4567")).toBeNull();
    expect(normalizePhone("010-123")).toBeNull();
    expect(normalizePhone("012-1234-5678")).toBeNull();
    expect(normalizePhone("010123456789")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
});

describe("formatPhone·maskPhone", () => {
  it("보기 좋게 하이픈을 넣는다", () => {
    expect(formatPhone("01012345678")).toBe("010-1234-5678");
    expect(formatPhone("0111234567")).toBe("011-123-4567");
  });
  it("가운데를 가린다", () => {
    expect(maskPhone("01012345678")).toBe("010-****-5678");
    expect(maskPhone("0111234567")).toBe("011-***-4567");
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
    expect(maskPhone("123")).toBe("****");
  });
});
