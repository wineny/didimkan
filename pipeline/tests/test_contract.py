"""스키마 계약 테스트: pipeline/schema.sql 과 src/db/schema.ts 가 같은 테이블·컬럼을 정의하는지,
CHECK 제약(재게시 금지 소스 description NULL·stair 범위 등)이 실제로 막는지 확인한다."""
import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_SQL = ROOT / "pipeline" / "schema.sql"
SCHEMA_TS = ROOT / "src" / "db" / "schema.ts"

TS_TYPE_TO_SQL = {"text": "TEXT", "integer": "INTEGER", "real": "REAL"}
COLUMN_RE = re.compile(r"^\s*\w+:\s*(text|integer|real)\(\s*\"(\w+)\"", re.MULTILINE)


def load_sql_db() -> sqlite3.Connection:
    con = sqlite3.connect(":memory:")
    con.executescript(SCHEMA_SQL.read_text(encoding="utf-8"))
    return con


def sql_columns(con: sqlite3.Connection) -> dict[str, dict[str, tuple[str, bool, bool]]]:
    """테이블 → {컬럼: (타입, notnull, pk)}"""
    tables = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    out = {}
    for t in tables:
        out[t] = {
            name: (ctype.upper(), bool(notnull) or bool(pk), bool(pk))
            for _cid, name, ctype, notnull, _default, pk in con.execute(f"PRAGMA table_info({t})")
        }
    return out


def ts_columns() -> dict[str, dict[str, tuple[str, bool, bool]]]:
    """schema.ts 를 정규식으로 읽어 테이블 → {컬럼: (타입, notnull, pk)}"""
    src = SCHEMA_TS.read_text(encoding="utf-8")
    chunks = src.split("sqliteTable(")[1:]
    out = {}
    for chunk in chunks:
        name = re.match(r"\s*\"(\w+)\"", chunk).group(1)
        matches = list(COLUMN_RE.finditer(chunk))
        cols = {}
        for i, m in enumerate(matches):
            end = matches[i + 1].start() if i + 1 < len(matches) else len(chunk)
            body = chunk[m.end():end]
            # 콜백 `(t) => [` 이전까지만 컬럼 정의
            body = body.split("(t) =>")[0]
            pk = ".primaryKey()" in body
            cols[m.group(2)] = (TS_TYPE_TO_SQL[m.group(1)], pk or ".notNull()" in body, pk)
        out[name] = cols
    return out


def sql_indexes(con: sqlite3.Connection) -> dict[str, tuple[str, tuple[str, ...]]]:
    out = {}
    for name, table in con.execute(
            "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"):
        cols = tuple(r[2] for r in con.execute(f"PRAGMA index_info({name})"))
        out[name] = (table, cols)
    return out


def test_schema_sql_runs_twice_without_error() -> None:
    con = load_sql_db()
    con.executescript(SCHEMA_SQL.read_text(encoding="utf-8"))  # 재실행 안전
    assert set(sql_columns(con)) == {"courses", "institutions", "enrollment_patterns", "meta"}


def test_table_and_column_sets_identical() -> None:
    sql_side = {t: set(c) for t, c in sql_columns(load_sql_db()).items()}
    ts_side = {t: set(c) for t, c in ts_columns().items()}
    assert sql_side == ts_side


def test_column_types_notnull_pk_identical() -> None:
    assert sql_columns(load_sql_db()) == ts_columns()


def test_courses_has_spec_columns() -> None:
    expected = {
        "id", "source", "source_file", "source_url", "detail_url", "collected_at", "data_date",
        "title", "description", "institution", "institution_phone", "sido", "sigungu", "dong",
        "venue", "address", "start_date", "end_date", "start_time", "end_time", "weekdays_raw",
        "weekdays", "weekday_bits", "time_bucket", "capacity", "fee_raw", "fee_won", "fee_period",
        "is_free", "is_online", "target_raw", "apply_start", "apply_end", "apply_method",
        "selection_method", "is_always_open", "homepage_url", "lat", "lng", "is_dong_center",
        "category", "stair", "stair_reason", "signals", "term_days", "sessions_per_week",
    }
    assert set(sql_columns(load_sql_db())["courses"]) == expected


def test_indexes_present_in_both() -> None:
    expected = {
        "idx_courses_stair": ("courses", ("stair",)),
        "idx_courses_sido_sigungu": ("courses", ("sido", "sigungu")),
        "idx_courses_institution": ("courses", ("institution",)),
        "idx_courses_apply_start": ("courses", ("apply_start",)),
        "idx_courses_stair_region": ("courses", ("stair", "sido", "sigungu")),
        "idx_enrollment_patterns_institution_sigungu":
            ("enrollment_patterns", ("institution", "sigungu")),
    }
    assert sql_indexes(load_sql_db()) == expected
    ts_src = SCHEMA_TS.read_text(encoding="utf-8")
    ts_index_names = set(re.findall(r"index\(\s*\"(\w+)\"", ts_src))
    assert ts_index_names == set(expected)


def test_check_constraint_names_identical() -> None:
    sql_names = set(re.findall(r"CONSTRAINT (\w+) CHECK", SCHEMA_SQL.read_text(encoding="utf-8")))
    ts_names = set(re.findall(r"check\(\s*\"(\w+)\"", SCHEMA_TS.read_text(encoding="utf-8")))
    assert sql_names and sql_names == ts_names


# --- CHECK 제약 동작 ---

def insert_course(con: sqlite3.Connection, **over: object) -> None:
    row = {"id": "x", "source": "std", "collected_at": "2026-10-10", "title": "요가 기초"}
    row.update(over)
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    con.execute(f"INSERT INTO courses ({cols}) VALUES ({marks})", list(row.values()))


@pytest.mark.parametrize("source", ["gangnam", "seoul_jongno", "seoul_seocho"])
def test_no_repost_sources_reject_description(source: str) -> None:
    con = load_sql_db()
    with pytest.raises(sqlite3.IntegrityError):
        insert_course(con, source=source, description="강좌 소개 원문")


@pytest.mark.parametrize("source", ["gangnam", "seoul_jongno"])
def test_no_repost_sources_accept_null_description(source: str) -> None:
    con = load_sql_db()
    insert_course(con, source=source, description=None)
    assert con.execute("SELECT count(*) FROM courses").fetchone()[0] == 1


@pytest.mark.parametrize("source", ["std", "portal"])
def test_open_sources_accept_description(source: str) -> None:
    con = load_sql_db()
    insert_course(con, source=source, description="처음 오시는 분 환영")


@pytest.mark.parametrize("stair", [1, 2, 3, None])
def test_stair_accepts_valid(stair: int | None) -> None:
    insert_course(load_sql_db(), stair=stair)


@pytest.mark.parametrize("stair", [0, 4])
def test_stair_rejects_out_of_range(stair: int) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_course(load_sql_db(), stair=stair)


@pytest.mark.parametrize("over", [
    {"source": "kakao"},
    {"is_free": 2},
    {"is_online": -1},
    {"category": "운동"},
    {"time_bucket": "morning"},
    {"fee_period": "주"},
    {"selection_method": "先着"},
    {"weekday_bits": 128},
])
def test_other_checks_reject_bad_values(over: dict[str, object]) -> None:
    with pytest.raises(sqlite3.IntegrityError):
        insert_course(load_sql_db(), **over)


def test_example_valid_row_with_all_enums() -> None:
    insert_course(
        load_sql_db(), category="미술·서예", time_bucket="오후", fee_period="월",
        selection_method="추첨", weekday_bits=127, is_free=1, signals='["free","basic"]',
    )


def test_enrollment_pattern_is_estimate_bool() -> None:
    con = load_sql_db()
    con.execute("INSERT INTO enrollment_patterns (institution, is_estimate) VALUES ('a', 0)")
    with pytest.raises(sqlite3.IntegrityError):
        con.execute("INSERT INTO enrollment_patterns (institution, is_estimate) VALUES ('b', 2)")


# --- docs/contract.md 예시 행이 스키마·id 규칙과 맞는지 ---

CONTRACT_MD = ROOT / "docs" / "contract.md"
SIGNAL_ORDER = ["free", "basic", "small", "lottery", "once", "online", "welcome", "no_supplies"]


def contract_norm(s: str | None) -> str:
    if s is None:
        return ""
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", s).lower())


def contract_make_id(row: dict[str, object]) -> str:
    key = "|".join([
        contract_norm(row["title"]), contract_norm(row["institution"]),
        row["start_date"] or "", row["start_time"] or "", contract_norm(row["venue"]),
    ])
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def contract_examples() -> list[dict[str, object]]:
    blocks = re.findall(r"```json\n(.*?)\n```", CONTRACT_MD.read_text(encoding="utf-8"), re.DOTALL)
    return [json.loads(b) for b in blocks]


def test_contract_example_rows_fit_schema_and_id_rule() -> None:
    examples = contract_examples()
    course_rows = [r for r in examples if "id" in r]
    pattern_rows = [r for r in examples if "open_history" in r]
    assert {r["stair"] for r in course_rows} == {1, 2, 3}
    con = load_sql_db()
    for row in course_rows:
        assert set(row) == set(sql_columns(con)["courses"])
        assert row["id"] == contract_make_id(row)
        signals = json.loads(row["signals"])
        assert signals == [k for k in SIGNAL_ORDER if k in signals]
        insert_course(con, **row)
    for row in pattern_rows:
        cols = ", ".join(row)
        con.execute(f"INSERT INTO enrollment_patterns ({cols}) VALUES ({', '.join('?' for _ in row)})",
                    list(row.values()))
    assert con.execute("SELECT count(*) FROM courses").fetchone()[0] == 3
