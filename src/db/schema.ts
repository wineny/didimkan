// 디딤칸 DB 계약(Drizzle). pipeline/schema.sql 과 테이블·컬럼이 완전히 같아야 한다
// (pipeline/tests/test_contract.py 가 검사). 값 규칙은 docs/contract.md.
// 규칙: 컬럼은 언제나 `키: 타입("snake_case_이름", …)` 형태로 쓴다(테스트가 이 형태를 읽는다).
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** 문턱 신호 8키. 저장 순서도 이 순서. */
export const SIGNAL_KEYS = [
  "free",
  "basic",
  "small",
  "lottery",
  "once",
  "online",
  "welcome",
  "no_supplies",
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

export const CATEGORIES = [
  "몸 풀기",
  "춤",
  "어학",
  "미술·서예",
  "악기",
  "노래",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Stair = 1 | 2 | 3;
export type TimeBucket = "오전" | "오후" | "저녁";
export type FeePeriod = "월" | "총";
export type SelectionMethod = "선착순" | "추첨";

export const courses = sqliteTable(
  "courses",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    sourceFile: text("source_file"),
    sourceUrl: text("source_url"),
    detailUrl: text("detail_url"),
    collectedAt: text("collected_at").notNull(),
    dataDate: text("data_date"),
    title: text("title").notNull(),
    description: text("description"),
    institution: text("institution"),
    institutionPhone: text("institution_phone"),
    sido: text("sido"),
    sigungu: text("sigungu"),
    dong: text("dong"),
    venue: text("venue"),
    address: text("address"),
    startDate: text("start_date"),
    endDate: text("end_date"),
    startTime: text("start_time"),
    endTime: text("end_time"),
    weekdaysRaw: text("weekdays_raw"),
    weekdays: text("weekdays"),
    weekdayBits: integer("weekday_bits").notNull().default(0),
    timeBucket: text("time_bucket").$type<TimeBucket>(),
    capacity: integer("capacity"),
    feeRaw: text("fee_raw"),
    feeWon: integer("fee_won"),
    feePeriod: text("fee_period").$type<FeePeriod>(),
    isFree: integer("is_free", { mode: "boolean" }).notNull().default(false),
    isOnline: integer("is_online", { mode: "boolean" }).notNull().default(false),
    targetRaw: text("target_raw"),
    applyStart: text("apply_start"),
    applyEnd: text("apply_end"),
    applyMethod: text("apply_method"),
    selectionMethod: text("selection_method").$type<SelectionMethod>(),
    isAlwaysOpen: integer("is_always_open", { mode: "boolean" })
      .notNull()
      .default(false),
    homepageUrl: text("homepage_url"),
    lat: real("lat"),
    lng: real("lng"),
    isDongCenter: integer("is_dong_center", { mode: "boolean" })
      .notNull()
      .default(false),
    category: text("category").$type<Category>(),
    stair: integer("stair").$type<Stair>(),
    stairReason: text("stair_reason"),
    signals: text("signals", { mode: "json" })
      .$type<SignalKey[]>()
      .notNull()
      .default(sql`'[]'`),
    termDays: integer("term_days"),
    sessionsPerWeek: integer("sessions_per_week"),
  },
  (t) => [
    check(
      "courses_source_code",
      sql`${t.source} IN ('std', 'portal', 'gangnam') OR ${t.source} LIKE 'seoul_%'`,
    ),
    check(
      "courses_no_repost_description",
      sql`(${t.source} NOT IN ('gangnam') AND ${t.source} NOT LIKE 'seoul_%') OR ${t.description} IS NULL`,
    ),
    check("courses_stair", sql`${t.stair} IN (1, 2, 3) OR ${t.stair} IS NULL`),
    check("courses_is_free", sql`${t.isFree} IN (0, 1)`),
    check("courses_is_online", sql`${t.isOnline} IN (0, 1)`),
    check("courses_is_always_open", sql`${t.isAlwaysOpen} IN (0, 1)`),
    check("courses_is_dong_center", sql`${t.isDongCenter} IN (0, 1)`),
    check(
      "courses_category",
      sql`${t.category} IN ('몸 풀기', '춤', '어학', '미술·서예', '악기', '노래') OR ${t.category} IS NULL`,
    ),
    check(
      "courses_time_bucket",
      sql`${t.timeBucket} IN ('오전', '오후', '저녁') OR ${t.timeBucket} IS NULL`,
    ),
    check(
      "courses_fee_period",
      sql`${t.feePeriod} IN ('월', '총') OR ${t.feePeriod} IS NULL`,
    ),
    check(
      "courses_selection_method",
      sql`${t.selectionMethod} IN ('선착순', '추첨') OR ${t.selectionMethod} IS NULL`,
    ),
    check("courses_weekday_bits", sql`${t.weekdayBits} BETWEEN 0 AND 127`),
    index("idx_courses_stair").on(t.stair),
    index("idx_courses_sido_sigungu").on(t.sido, t.sigungu),
    index("idx_courses_institution").on(t.institution),
    index("idx_courses_apply_start").on(t.applyStart),
  ],
);

export const institutions = sqliteTable("institutions", {
  institution: text("institution").notNull(),
  sigungu: text("sigungu"),
  phone: text("phone"),
  source: text("source").notNull(),
});

export const enrollmentPatterns = sqliteTable(
  "enrollment_patterns",
  {
    institution: text("institution").notNull(),
    sigungu: text("sigungu"),
    openHistory: text("open_history", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    cycleDays: integer("cycle_days"),
    nextOpenEstimate: text("next_open_estimate"),
    basisCount: integer("basis_count").notNull().default(0),
    ruleNote: text("rule_note"),
    isEstimate: integer("is_estimate", { mode: "boolean" })
      .notNull()
      .default(true),
  },
  (t) => [
    check("enrollment_patterns_is_estimate", sql`${t.isEstimate} IN (0, 1)`),
    index("idx_enrollment_patterns_institution_sigungu").on(
      t.institution,
      t.sigungu,
    ),
  ],
);

/** meta.key 값: build_date · source_counts(JSON 문자열) · today_hint */
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export type Course = typeof courses.$inferSelect;
export type NewCourse = typeof courses.$inferInsert;
export type Institution = typeof institutions.$inferSelect;
export type EnrollmentPattern = typeof enrollmentPatterns.$inferSelect;
export type Meta = typeof meta.$inferSelect;
