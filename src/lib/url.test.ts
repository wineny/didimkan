import { describe, expect, it } from "vitest";
import { safeHttpUrl, safeNext } from "./url";

describe("safeHttpUrl", () => {
  it("javascript: 는 막는다", () => {
    expect(safeHttpUrl("javascript:;")).toBeNull();
    expect(safeHttpUrl("JavaScript:alert(1)")).toBeNull();
  });
  it("www. 로 시작하면 https:// 를 붙이고 http(s) 는 그대로", () => {
    expect(safeHttpUrl(" www.x.go.kr ")).toBe("https://www.x.go.kr");
    expect(safeHttpUrl("http://a.go.kr/p?q=1")).toBe("http://a.go.kr/p?q=1");
  });
  it("data:·빈 값·호스트 없음은 null", () => {
    expect(safeHttpUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl("https://")).toBeNull();
  });
});

describe("safeNext", () => {
  const origin = "https://didimkan.vercel.app";
  it("같은 사이트 경로는 그대로", () => {
    expect(safeNext("/me", origin)).toBe("/me");
    expect(safeNext("/me?x=1", origin)).toBe("/me?x=1");
    expect(safeNext("/course/abc?st=2&sido=서울특별시", origin)).toBe(
      "/course/abc?st=2&sido=%EC%84%9C%EC%9A%B8%ED%8A%B9%EB%B3%84%EC%8B%9C",
    );
  });
  it("다른 사이트로 가는 값은 /me", () => {
    expect(safeNext("//evil.com", origin)).toBe("/me");
    expect(safeNext("/\\evil.com", origin)).toBe("/me");
    expect(safeNext("https://evil.com", origin)).toBe("/me");
    expect(safeNext("/\t/evil.com", origin)).toBe("/me");
    expect(safeNext("javascript:alert(1)", origin)).toBe("/me");
  });
  it("정규화 뒤 // 가 되는 값도 /me (점 세그먼트·퍼센트 인코딩)", () => {
    expect(safeNext("/.//evil.com", origin)).toBe("/me");
    expect(safeNext("/..//evil.com", origin)).toBe("/me");
    expect(safeNext("/%2e//evil.com", origin)).toBe("/me");
    expect(safeNext("/a/..//evil.com", origin)).toBe("/me");
  });
  it("문자열이 아니거나 비면 /me", () => {
    expect(safeNext(undefined, origin)).toBe("/me");
    expect(safeNext(null, origin)).toBe("/me");
    expect(safeNext(["/me"], origin)).toBe("/me");
    expect(safeNext("", origin)).toBe("/me");
    expect(safeNext("me", origin)).toBe("/me");
  });
});
