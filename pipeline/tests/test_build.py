"""build.py(--offline)와 make_fixture.py 검사. 네트워크 0(conftest 가 막는다)."""
import json
import re
import sqlite3
from datetime import date
from pathlib import Path

import pytest

from pipeline import build, derive, make_fixture

REPORT_KEYS = {"total", "by_source", "dong_center_count", "dong_center_ratio", "by_stair",
               "seoul_gu_count", "failures_count", "skipped_rows"}


def rows_of(db: Path, sql: str) -> list[tuple]:
    con = sqlite3.connect(db)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def test_offline_build(tmp_path):
    db = tmp_path / "out.db"
    code = build.main(["--offline", "--today", "2026-10-10", "--out", str(db),
                       "--out-dir", str(tmp_path / "rep")])
    assert code == 0
    tables = {r[0] for r in rows_of(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"courses", "institutions", "enrollment_patterns", "meta"} <= tables
    assert rows_of(db, "SELECT count(*) FROM courses")[0][0] >= 1
    assert rows_of(db, "SELECT count(*) FROM courses WHERE id IS NULL")[0][0] == 0
    ids = [r[0] for r in rows_of(db, "SELECT id FROM courses")]
    assert len(ids) == len(set(ids))
    meta = dict(rows_of(db, "SELECT key, value FROM meta"))
    assert meta["build_date"] == "2026-10-10" and meta["today_hint"] is None
    assert sum(json.loads(meta["source_counts"]).values()) == len(ids)
    report = json.loads((tmp_path / "rep" / "build_report.json").read_text("utf-8"))
    assert REPORT_KEYS <= set(report) and report["total"] == len(ids)
    assert json.loads((tmp_path / "rep" / "failures.json").read_text("utf-8")) is not None
    assert report["skipped_rows"] == 0
    # R5: 설명을 저장하지 않는 소스
    assert rows_of(db, "SELECT count(*) FROM courses WHERE (source='gangnam' OR source LIKE 'seoul_%')"
                       " AND description IS NOT NULL")[0][0] == 0


def test_build_isolates_source_failure(tmp_path, monkeypatch):
    def boom(name, **kw):
        if name == "portal":
            raise RuntimeError("일부러 실패")
        return build.offline_gangnam("2026-10-10", date(2026, 10, 10)) if name == "gangnam" else []

    monkeypatch.setattr(build, "collect", boom)
    code = build.main(["--offline", "--today", "2026-10-10", "--sources", "portal,gangnam",
                       "--out", str(tmp_path / "o.db"), "--out-dir", str(tmp_path)])
    assert code == 0
    failures = json.loads((tmp_path / "failures.json").read_text("utf-8"))
    assert [f["reason"] for f in failures] == ["source_failed"]
    assert rows_of(tmp_path / "o.db", "SELECT count(*) FROM courses")[0][0] == 6


def test_duplicate_ids_get_suffix():
    base = {"source": "std", "source_file": "a.csv", "detail_url": None}
    rows = [dict(base, id="abc"), dict(base, id="abc"), dict(base, id="abc"), dict(base, id="zzz")]
    out = build.assign_unique_ids(rows)
    assert [r["id"] for r in out] == ["abc", "abc-2", "abc-3", "zzz"]


def test_check_violation_row_is_skipped(tmp_path):
    good = {k: None for k in build.COURSE_KEYS}
    good.update(id="a", source="std", collected_at="2026-10-10", title="좋은 강좌")
    bad = dict(good, id="b", category="없는 분야")
    from pipeline.common.failures import Failures
    f = Failures()
    skipped = build.write_db([good, bad], [], tmp_path / "x.db", build_date="2026-10-10",
                             source_counts={"std": 2}, today_hint=None, failures=f)
    assert skipped == 1 and [i["reason"] for i in f.items] == ["db_insert_skipped"]
    assert rows_of(tmp_path / "x.db", "SELECT id FROM courses") == [("a",)]


@pytest.mark.skipif(not make_fixture.OLD_DB.exists(), reason="옛 courses.db 없음")
def test_make_fixture(tmp_path):
    db, ids_json = tmp_path / "fixture.db", tmp_path / "ids.json"
    make_fixture.main(["--out", str(db), "--ids", str(ids_json)])
    n = rows_of(db, "SELECT count(*) FROM courses")[0][0]
    assert 1 <= n <= 300
    ids = json.loads(ids_json.read_text("utf-8"))
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", ids["today"])
    assert ids["sido"] == "서울특별시" and ids["sigungu"] == "강남구"
    assert {"9632", "8218", "10096", "2722"} <= set(ids["ids"])
    assert dict(rows_of(db, "SELECT key, value FROM meta"))["today_hint"] == ids["today"]
    today = date.fromisoformat(ids["today"])
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    row = lambda k: dict(con.execute("SELECT * FROM courses WHERE id=?", (ids["ids"][k],)).fetchone())  # noqa: E731
    assert derive.apply_status(row("9632"), today) in ("before", "open")
    assert derive.apply_status(row("8218"), today) == "always"
    assert row("2722")["selection_method"] == "추첨"
    assert row("10096")["stair"] == 3
    con.close()
