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
  endDate?: string;
  institution?: string;
  lat?: number;
  lng?: number;
};

function insert(r: Row, stair = 2): InStatement {
  return {
    sql: `INSERT INTO courses (id, source, collected_at, title, sido, sigungu, dong, apply_start, apply_end, end_date, institution, lat, lng, stair)
          VALUES (?, 'std', '2026-10-01', ?, '서울특별시', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [r.id, `강좌 ${r.id}`, r.sigungu, r.dong, r.applyStart, r.applyEnd, r.endDate ?? null, r.institution ?? null, r.lat ?? null, r.lng ?? null, stair],
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
  // 거리: 강남구인데 동을 모르는(구청 자리, 도곡1동에서 3km 넘음) 접수일 모름 650행(id 가 앞섬) vs
  // 서초구지만 실제 좌표가 도곡1동 0.3km 인 5행(id 가 뒤). 600 상한을 이름 순위로 자르면 서초 5행이 빠진다.
  for (let i = 0; i < 650; i++)
    rows.push({ id: `c${pad(i)}`, sigungu: "강남구", dong: "없는동", applyStart: null, applyEnd: null });
  for (let i = 0; i < 5; i++)
    rows.push({ id: `zz${i}`, sigungu: "서초구", dong: "반포1동", applyStart: null, applyEnd: null, lat: 37.488305 + 0.3 / 111.2, lng: 127.038969 });
  // 예측 접수 예정: 시작일 없고 강좌 종료일은 지났지만 기관 예측일이 미래(contract §10 7번) → 마감으로 잘리면 안 된다.
  rows.push({ id: "zp0", sigungu: "강남구", dong: "도곡1동", applyStart: null, applyEnd: null, endDate: "2026-09-30", institution: "예측기관" });
  await client.batch(rows.map((r) => insert(r)), "write");
  await client.execute({
    sql: "INSERT INTO enrollment_patterns (institution, sigungu, next_open_estimate, basis_count) VALUES ('예측기관', '강남구', ?, 3)",
    args: [addDays(TODAY, 20)],
  });
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

  it("600 상한 안에서도 실제로 가까운 이웃 구 강좌와 예측 접수 예정 강좌가 빠지지 않는다", async () => {
    const out = await listCourses({ stair: 2, area: AREA, today: TODAY, limit: 100 });
    const ids = out.map((c) => c.id);
    // 1km 미만: 도곡1동 접수 중 30 → 예측 접수 예정 1 → 접수일 모름(도곡1동 50, 0km → 서초 좌표 5, 0.3km)
    expect(ids.slice(0, 30).every((id) => id.startsWith("z2"))).toBe(true);
    expect(ids[30]).toBe("zp0");
    expect(out[30].status.status).toBe("before");
    expect(ids.slice(31, 81).every((id) => id.startsWith("z1"))).toBe(true);
    expect(ids.slice(81, 86)).toEqual(["zz0", "zz1", "zz2", "zz3", "zz4"]);
  });

  it("마감은 숨기지 않고 맨 뒤, 그 앞은 거리 구간 순", async () => {
    const out = await listCourses({ stair: 2, area: AREA, today: TODAY, limit: 2000 });
    expect(out).toHaveLength(1456);
    // 1~3km: 서초구(구청 자리 0.8km 지만 구만 알아 1km 로 침) 접수 중 700 → 3~5km: 강남구청 자리 650 → 마감 20
    expect(out.slice(86, 786).every((c) => c.sigungu === "서초구" && c.status.status === "open")).toBe(true);
    expect(out.slice(786, 1436).every((c) => c.dong === "없는동")).toBe(true);
    expect(out.slice(1436).every((c) => c.status.status === "closed")).toBe(true);
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
