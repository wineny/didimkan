import { afterEach, describe, expect, it } from "vitest";
import { getArea, getBig, getStair, setArea, setBig, setStair } from "./storage";

const g = globalThis as { window?: unknown };
afterEach(() => { delete g.window; });

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("storage", () => {
  it("SSR(window 없음)에서도 기본값", () => {
    expect(getStair()).toBe(2);
    expect(getArea()).toEqual({});
    expect(getBig()).toBe(false);
    expect(() => { setStair(1); setArea({}); setBig(true); }).not.toThrow();
  });
  it("접근 자체가 예외를 던져도 기본값", () => {
    const boom = new Proxy({}, { get() { throw new Error("denied"); } });
    g.window = { localStorage: boom };
    expect(getStair()).toBe(2);
    expect(getArea()).toEqual({});
    expect(getBig()).toBe(false);
    expect(() => { setStair(3); setArea({ sido: "x" }); setBig(true); }).not.toThrow();
  });
  it("정상 저장소에서 왕복", () => {
    g.window = { localStorage: memory() };
    setStair(3); setBig(true); setArea({ sido: "서울특별시", sigungu: "강남구" });
    expect(getStair()).toBe(3);
    expect(getBig()).toBe(true);
    expect(getArea()).toEqual({ sido: "서울특별시", sigungu: "강남구", dong: undefined });
  });
  it("깨진 값은 기본값", () => {
    const ls = memory();
    ls.setItem("didim.st", "9"); ls.setItem("didim.area", "{oops");
    g.window = { localStorage: ls };
    expect(getStair()).toBe(2);
    expect(getArea()).toEqual({});
  });
});
