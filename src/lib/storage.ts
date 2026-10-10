import type { Stair } from "@/db/schema";
import type { Area } from "./sort";

export const KEYS = {
  stair: "didim.st",
  area: "didim.area",
  big: "didim.big",
} as const;

export const DEFAULT_STAIR: Stair = 2;

function read(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    /* 저장이 막힌 환경(사생활 보호 모드 등)에서는 조용히 넘어간다 */
  }
}

export function getStair(): Stair {
  const v = read(KEYS.stair);
  return v === "1" || v === "2" || v === "3" ? (Number(v) as Stair) : DEFAULT_STAIR;
}
export function setStair(s: Stair): void {
  write(KEYS.stair, String(s));
}

export function getArea(): Area {
  const raw = read(KEYS.area);
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const pick = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
    return { sido: pick("sido"), sigungu: pick("sigungu"), dong: pick("dong") };
  } catch {
    return {};
  }
}
export function setArea(a: Area): void {
  write(KEYS.area, JSON.stringify(a));
}

export function getBig(): boolean {
  return read(KEYS.big) === "1";
}
export function setBig(on: boolean): void {
  write(KEYS.big, on ? "1" : "0");
}
