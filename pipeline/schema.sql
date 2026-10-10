-- 디딤칸 DB 계약(DDL). src/db/schema.ts 와 테이블·컬럼이 완전히 같아야 한다
-- (pipeline/tests/test_contract.py 가 검사). 값 규칙은 docs/contract.md.
-- 재실행 안전: 테이블을 지우고 다시 만든다.

DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS institutions;
DROP TABLE IF EXISTS enrollment_patterns;
DROP TABLE IF EXISTS meta;

CREATE TABLE courses (
  id                TEXT PRIMARY KEY,
  source            TEXT NOT NULL,
  source_file       TEXT,
  source_url        TEXT,
  detail_url        TEXT,
  collected_at      TEXT NOT NULL,
  data_date         TEXT,
  title             TEXT NOT NULL,
  description       TEXT,
  institution       TEXT,
  institution_phone TEXT,
  sido              TEXT,
  sigungu           TEXT,
  dong              TEXT,
  venue             TEXT,
  address           TEXT,
  start_date        TEXT,
  end_date          TEXT,
  start_time        TEXT,
  end_time          TEXT,
  weekdays_raw      TEXT,
  weekdays          TEXT,
  weekday_bits      INTEGER NOT NULL DEFAULT 0,
  time_bucket       TEXT,
  capacity          INTEGER,
  fee_raw           TEXT,
  fee_won           INTEGER,
  fee_period        TEXT,
  is_free           INTEGER NOT NULL DEFAULT 0,
  is_online         INTEGER NOT NULL DEFAULT 0,
  target_raw        TEXT,
  apply_start       TEXT,
  apply_end         TEXT,
  apply_method      TEXT,
  selection_method  TEXT,
  is_always_open    INTEGER NOT NULL DEFAULT 0,
  homepage_url      TEXT,
  lat               REAL,
  lng               REAL,
  is_dong_center    INTEGER NOT NULL DEFAULT 0,
  category          TEXT,
  stair             INTEGER,
  stair_reason      TEXT,
  signals           TEXT NOT NULL DEFAULT '[]',
  term_days         INTEGER,
  sessions_per_week INTEGER,
  CONSTRAINT courses_source_code CHECK (source IN ('std', 'portal', 'gangnam') OR source LIKE 'seoul_%'),
  CONSTRAINT courses_no_repost_description CHECK ((source NOT IN ('gangnam') AND source NOT LIKE 'seoul_%') OR description IS NULL),
  CONSTRAINT courses_stair CHECK (stair IN (1, 2, 3) OR stair IS NULL),
  CONSTRAINT courses_is_free CHECK (is_free IN (0, 1)),
  CONSTRAINT courses_is_online CHECK (is_online IN (0, 1)),
  CONSTRAINT courses_is_always_open CHECK (is_always_open IN (0, 1)),
  CONSTRAINT courses_is_dong_center CHECK (is_dong_center IN (0, 1)),
  CONSTRAINT courses_category CHECK (category IN ('몸 풀기', '춤', '어학', '미술·서예', '악기', '노래') OR category IS NULL),
  CONSTRAINT courses_time_bucket CHECK (time_bucket IN ('오전', '오후', '저녁') OR time_bucket IS NULL),
  CONSTRAINT courses_fee_period CHECK (fee_period IN ('월', '총') OR fee_period IS NULL),
  CONSTRAINT courses_selection_method CHECK (selection_method IN ('선착순', '추첨') OR selection_method IS NULL),
  CONSTRAINT courses_weekday_bits CHECK (weekday_bits BETWEEN 0 AND 127)
);

CREATE INDEX idx_courses_stair ON courses (stair);
CREATE INDEX idx_courses_sido_sigungu ON courses (sido, sigungu);
CREATE INDEX idx_courses_institution ON courses (institution);
CREATE INDEX idx_courses_apply_start ON courses (apply_start);
CREATE INDEX idx_courses_stair_region ON courses (stair, sido, sigungu);

CREATE TABLE institutions (
  institution TEXT NOT NULL,
  sigungu     TEXT,
  phone       TEXT,
  source      TEXT NOT NULL
);

CREATE TABLE enrollment_patterns (
  institution        TEXT NOT NULL,
  sigungu            TEXT,
  open_history       TEXT NOT NULL DEFAULT '[]',
  cycle_days         INTEGER,
  next_open_estimate TEXT,
  basis_count        INTEGER NOT NULL DEFAULT 0,
  rule_note          TEXT,
  is_estimate        INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT enrollment_patterns_is_estimate CHECK (is_estimate IN (0, 1))
);

CREATE INDEX idx_enrollment_patterns_institution_sigungu ON enrollment_patterns (institution, sigungu);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
