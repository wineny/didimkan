// 검증용 임시 DB(data/dev.db). pipeline/schema.sql 로 테이블을 만들고
// docs/contract.md §16 예시 행 3개 + 강남 패턴 1개를 넣는다. 커밋하지 않는다.
import { createClient } from "@libsql/client";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(resolve(root, "data"), { recursive: true });
const client = createClient({ url: `file:${resolve(root, "data/dev.db")}` });

await client.executeMultiple(readFileSync(resolve(root, "pipeline/schema.sql"), "utf8"));

const base = {
  source_file: null, source_url: null, detail_url: null, data_date: null,
  description: null, institution_phone: null, sido: null, sigungu: null, dong: null,
  venue: null, address: null, start_date: null, end_date: null, start_time: null,
  end_time: null, weekdays_raw: null, weekdays: null, weekday_bits: 0, time_bucket: null,
  capacity: null, fee_raw: null, fee_won: null, fee_period: null, is_free: 0, is_online: 0,
  target_raw: null, apply_start: null, apply_end: null, apply_method: null,
  selection_method: null, is_always_open: 0, homepage_url: null, lat: null, lng: null,
  is_dong_center: 0, category: null, stair: null, stair_reason: null, signals: "[]",
  term_days: null, sessions_per_week: null,
};

const rows = [
  {
    id: "211602f65f72f238", source: "gangnam", collected_at: "2026-10-10", data_date: "2026-10-10",
    source_url: "https://life.gangnam.go.kr/rest/lecture/list?company_code=GNCCxx&page=1&page_size=1000",
    detail_url: "https://life.gangnam.go.kr/fmcs/52?action=read&comcd=GNCCxx&classcd=xxxxx&type=R",
    title: "일본어기초", institution: "도곡1동 복합문화센터", sido: "서울특별시", sigungu: "강남구",
    dong: "도곡1동", venue: "도곡1동 복합문화센터", start_time: "16:00", end_time: "17:20",
    weekdays_raw: "금", weekdays: "금", weekday_bits: 16, time_bucket: "오후", capacity: 20,
    fee_raw: "18000", fee_won: 18000, fee_period: "월", apply_start: "2026-10-26",
    apply_end: "2026-10-31", is_dong_center: 1, category: "어학", stair: 2,
    stair_reason: "강좌명에 「기초」 표시가 있어 처음이어도 괜찮아요", signals: '["basic"]',
    sessions_per_week: 1,
  },
  {
    id: "099a03a3206bc253", source: "std", source_file: "문화체육관광부_국립국악원_평생학습강좌.csv",
    source_url: "https://www.data.go.kr/data/15013110/standard.do",
    detail_url: "http://academy.gugak.go.kr/course/active/detail.do?courseActiveSeq=875&srchCategoryTypeCd=CATEGORY_TYPE::NONDEGREE&courseMasterSeq=875&currentMenuId=900001001",
    collected_at: "2026-10-10", data_date: "2026-06-01", title: "우리악기 이해하기 1 (가야금,거문고,아쟁)",
    description: "국악기 중 현악기인 가야금, 거문고, 아쟁의 역사와 특징에 대해 알 수 있다.각 국악기의 매력을 느낄 수 있는 국악곡을 감상할 수 있다.",
    institution: "국립국악원", institution_phone: "02-580-3086", venue: "온라인",
    address: "서울특별시 서초구 남부순환로 2364", start_date: "2026-01-01", end_date: "2026-12-31",
    start_time: "10:00", end_time: "23:59", time_bucket: "오전", fee_raw: "0", fee_won: 0,
    is_free: 1, is_online: 1, target_raw: "국악기를 알고 싶은 누구나", apply_start: "2026-01-01",
    apply_end: "2026-12-31", apply_method: "인터넷", selection_method: "선착순", is_always_open: 1,
    homepage_url: "http://academy.gugak.go.kr/course/active/detail.do?courseActiveSeq=875&srchCategoryTypeCd=CATEGORY_TYPE::NONDEGREE&courseMasterSeq=875&currentMenuId=900001001",
    category: "악기", stair: 1, stair_reason: "집에서 무료로 들어 볼 수 있어요",
    signals: '["free","online"]', term_days: 365,
  },
  {
    id: "7615528ea4ad4fcf", source: "std", source_file: "서울특별시_영등포구_평생학습강좌.csv",
    source_url: "https://www.data.go.kr/data/15013110/standard.do", collected_at: "2026-10-10",
    data_date: "2026-06-12", title: "바른 몸을 위한 요가&매트필라테스",
    description: "요가와 맨몸으로하는 필라테스로 하는 건강강좌",
    institution: "서울특별시 영등포구 미래교육과", institution_phone: "02-2670-7581",
    sido: "서울특별시", sigungu: "영등포구", venue: "YDP미래평생학습관",
    address: "서울특별시 영등포구 도신로4길20", start_date: "2026-07-08", end_date: "2026-09-18",
    start_time: "10:00", end_time: "12:00", weekdays_raw: "수+금", weekdays: "수,금",
    weekday_bits: 20, time_bucket: "오전", capacity: 20, fee_raw: "30000", fee_won: 30000,
    fee_period: "총", target_raw: "성인(영등포구민 우선)", apply_start: "2026-06-01",
    apply_end: "2026-06-30", apply_method: "온라인", selection_method: "선착순",
    homepage_url: "https://www.ydp.go.kr", category: "몸 풀기", stair: 3,
    stair_reason: "10주 동안 수·금 같은 시간에 만나요", term_days: 73, sessions_per_week: 2,
  },
];

for (const r of rows) {
  const row = { ...base, ...r };
  const cols = Object.keys(row);
  await client.execute({
    sql: `INSERT INTO courses (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    args: cols.map((c) => row[c]),
  });
}

await client.execute({
  sql: `INSERT INTO enrollment_patterns (institution, sigungu, open_history, cycle_days, next_open_estimate, basis_count, rule_note, is_estimate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  args: [
    "도곡1동 복합문화센터", "강남구", "[]", null, "2026-10-26", 0,
    "1권역 신규회원은 매월 26일 09시~말일 인터넷 접수. 기존회원은 16~25일(주말·공휴일이면 그 전 평일까지)", 0,
  ],
});
await client.execute({
  sql: "INSERT INTO meta (key, value) VALUES ('build_date', '2026-10-10')",
  args: [],
});

const n = await client.execute("SELECT count(*) AS n FROM courses");
console.log(`data/dev.db 준비됨: courses ${n.rows[0].n}행`);
client.close();
