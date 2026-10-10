// A1: 후보 상한(600)이 id 순으로 잘려 「가까운 순」이 무너지지 않는지, 임시 SQLite 파일로 확인한다.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TODAY = "2026-10-10";
const AREA = { sido: "서울특별시", sigungu: "강남구", dong: "도곡1동" };

let dir: string;
let client: Client;
let listCourses: typeof import("./queries").listCourses;

const addDays = (ymd: string, n: number) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type Row = {
  id: string;
  sigungu: string;
  dong: string;
  applyStart: string | null;
  applyEnd: string | null;
};

function insert(r: Row, stair = 2): InStatement {
  return {
    sql: `INSERT INTO courses (id, source, collected_at, title, sido, sigungu, dong, apply_start, apply_end, stair)
          VALUES (?, 'std', '2026-10-01', ?, '서울특별시', ?, ?, ?, ?, ?)`,
    args: [r.id, `강좌 ${r.id}`, r.sigungu, r.dong, r.applyStart, r.applyEnd, stair],
  };
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "didim-q-"));
  const url = `file:${path.join(dir, "t.db")}`;
  client = createClient({ url });
  await client.executeMultiple(readFileSync(path.resolve(__dirname, "../../pipeline/schema.sql"), "utf8"));

  const rows: Row[] = [];
  const pad = (n: number) => String(n).padStart(3, "0");
  // id 가 앞서는(a…) 다른 구 접수 중 700행 → id 순으로 600 에서 자르면 고른 동이 전부 빠진다.
  for (let i = 0; i < 700; i++)
    rows.push({ id: `a${pad(i)}`, sigungu: "서초구", dong: "반포1동", applyStart: "2026-10-01", applyEnd: "2026-10-30" });
  // 고른 동: 접수일 모름 50, 접수 중 30, 마감 20. id 는 모두 뒤(z…).
  for (let i = 0; i < 50; i++)
    rows.push({ id: `z1${pad(i)}`, sigungu: "강남구", dong: "도곡1동", applyStart: null, applyEnd: null });
  for (let i = 0; i < 30; i++)
    rows.push({ id: `z2${pad(i)}`, sigungu: "강남구", dong: "도곡1동", applyStart: "2026-10-01", applyEnd: addDays(TODAY, 1 + i) });
  for (let i = 0; i < 20; i++)
    rows.push({ id: `z0${pad(i)}`, sigungu: "강남구", dong: "도곡1동", applyStart: "2026-09-01", applyEnd: "2026-09-10" });
  await client.batch(rows.map((r) => insert(r)), "write");
  // 1단(온라인): 지역을 보지 않는다. 마감 1 + 접수 중 1.
  await client.batch([
    insert({ id: "o1", sigungu: "서초구", dong: "x", applyStart: "2026-09-01", applyEnd: "2026-09-10" }, 1),
    insert({ id: "o2", sigungu: "강남구", dong: "y", applyStart: "2026-10-01", applyEnd: "2026-10-30" }, 1),
  ], "write");
  // 1단 접수 중 700행. id 가 가장 큰 p699 의 마감이 가장 가깝다 → id 순으로 600 에서 자르면 빠진다.
  const online: InStatement[] = [];
  for (let i = 0; i < 700; i++) {
    const applyEnd = i === 699 ? addDays(TODAY, 1) : "2026-12-31";
    online.push(insert({ id: `p${pad(i)}`, sigungu: "x", dong: "x", applyStart: "2026-10-01", applyEnd }, 1));
  }
  await client.batch(online, "write");

  process.env.TURSO_DATABASE_URL = url;
  ({ listCourses } = await import("./queries"));
});

afterAll(() => {
  client?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("listCourses 후보 상한", () => {
  it("800행 중 고른 동·접수 중이 먼저 나온다", async () => {
    const out = await listCourses({ stair: 2, area: AREA, today: TODAY, limit: 10 });
    expect(out).toHaveLength(10);
    for (const c of out) {
      expect(c.dong).toBe("도곡1동");
      expect(c.status.status).toBe("open");
    }
    // 접수 중 안에서는 마감 가까운 순
    expect(out.map((c) => c.applyEnd)).toEqual([...out.map((c) => c.applyEnd)].sort());
    expect(out[0].applyEnd).toBe("2026-10-11");
  });

  it("고른 동의 마감 강좌도 숨기지 않고, 접수일 모름 뒤에 온다", async () => {
    const out = await listCourses({ stair: 2, area: AREA, today: TODAY, limit: 100 });
    const statuses = out.map((c) => c.status.status);
    expect(statuses.slice(0, 30).every((s) => s === "open")).toBe(true);
    expect(statuses.slice(30, 80).every((s) => s === "unknown")).toBe(true);
    expect(statuses.slice(80, 100).every((s) => s === "closed")).toBe(true);
    expect(out.slice(0, 100).every((c) => c.dong === "도곡1동")).toBe(true);
  });
});

describe("listCourses 1단", () => {
  it("지역 순위 없이도 조회되고 접수 중이 먼저, 마감은 뒤", async () => {
    const out = await listCourses({ stair: 1, area: AREA, today: TODAY, limit: 10 });
    expect(out.map((c) => c.id).slice(0, 2)).toEqual(["p699", "o2"]);
    expect(out.every((c) => c.status.status === "open")).toBe(true);
    const all = await listCourses({ stair: 1, area: AREA, today: TODAY, limit: 702 });
    expect(all.at(-1)?.id).toBe("o1");
  });
  it("후보 상한 600 을 넘어도 마감 가장 가까운 행(id 가장 큼)이 1번", async () => {
    const [first] = await listCourses({ stair: 1, today: TODAY, limit: 1 });
    expect(first.id).toBe("p699");
  });
  it("지역을 안 고른 2단도 조회된다", async () => {
    const out = await listCourses({ stair: 2, today: TODAY, limit: 3 });
    expect(out).toHaveLength(3);
    expect(out.every((c) => c.status.status === "open")).toBe(true);
  });
});
