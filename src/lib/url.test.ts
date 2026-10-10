import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./url";

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
