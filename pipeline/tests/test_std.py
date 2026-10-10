import json
import re
from pathlib import Path

import pytest

from pipeline.common import http
from pipeline.common.failures import Failures
from pipeline.sources import std

FIX = Path(__file__).parent / "fixtures" / "std"
SEOUL = FIX / "서울특별시_강남구_평생학습강좌.csv"  # cp949
BUSAN = FIX / "부산광역시_해운대구_평생학습강좌.csv"  # utf-8-sig
SCHEMA = Path(__file__).resolve().parent.parent / "schema.sql"
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def schema_columns() -> set[str]:
    body = SCHEMA.read_text(encoding="utf-8").split("CREATE TABLE courses (")[1].split("\n);")[0]
    cols = set()
    for line in body.splitlines():
        m = re.match(r"\s{2}([a-z_]+)\s+(TEXT|INTEGER|REAL)", line)
        if m:
            cols.add(m.group(1))
    return cols


@pytest.fixture
def rows():
    return std.normalize(SEOUL, collected_at="2026-10-10") + std.normalize(BUSAN, collected_at="2026-10-10")


def test_column_keys_match_schema(rows):
    assert len(rows) == 5
    for r in rows:
        assert set(r) == schema_columns()
        assert r["source"] == "std"
        assert r["collected_at"] == "2026-10-10"


def test_dates_sido_and_derived_left_empty(rows):
    for r in rows:
        for k in ("start_date", "end_date", "apply_start", "apply_end", "data_date"):
            assert r[k] is None or DATE_RE.match(r[k]), (k, r[k])
        assert r["category"] is None and r["stair"] is None and r["stair_reason"] is None
        assert r["term_days"] is None and r["sessions_per_week"] is None
        assert r["is_dong_center"] == 0 and r["signals"] == "[]"
    assert rows[0]["sido"] == "서울특별시" and rows[0]["sigungu"] == "강남구"
    assert rows[3]["sido"] == "부산광역시" and rows[3]["sigungu"] == "해운대구"
    assert rows[2]["apply_start"] == "2026-09-01"  # 20260901 형식


def test_fields(rows):
    yoga, english, calli, paint, song = rows
    assert yoga["source_file"] == SEOUL.name
    assert yoga["weekdays"] == "월,수" and yoga["weekday_bits"] == 0b0000101
    assert yoga["time_bucket"] == "오전" and yoga["is_free"] == 1 and yoga["capacity"] == 20
    assert yoga["selection_method"] == "추첨" and yoga["dong"] == "역삼1동"
    assert yoga["description"] == "몸을 풀어주는 요가"
    assert english["is_online"] == 1 and english["fee_won"] == 60000 and english["fee_period"] == "월"
    assert english["is_always_open"] == 1 and english["selection_method"] == "선착순"
    assert english["time_bucket"] == "저녁" and english["detail_url"] is None
    assert calli["fee_won"] == 30000 and calli["fee_period"] == "총" and calli["selection_method"] is None
    assert calli["is_always_open"] == 0 and calli["is_online"] == 0
    assert paint["is_online"] == 1 and paint["start_time"] is None and paint["time_bucket"] is None
    assert song["homepage_url"] is None


def test_id_deterministic_and_distinct(rows):
    again = std.normalize(SEOUL, collected_at="2026-10-11") + std.normalize(BUSAN, collected_at="2026-10-11")
    assert [r["id"] for r in rows] == [r["id"] for r in again]
    assert len({r["id"] for r in rows}) == 5


def test_missing_columns_do_not_crash(tmp_path):
    p = tmp_path / "경기도_수원시_평생학습강좌.csv"
    p.write_text("강좌명,운영기관명\n요가,수원시\n", encoding="utf-8")
    f = Failures()
    out = std.normalize(p, collected_at="2026-10-10", failures=f)
    assert len(out) == 1 and out[0]["sido"] == "경기도" and out[0]["start_date"] is None
    assert f.items and f.items[0]["reason"] == "schema_mismatch"


def test_parse_catalog_page():
    items = std.parse_catalog_page((FIX / "catalog_page.html").read_text(encoding="utf-8"))
    assert [i["uddi"] for i in items] == [
        "uddi:59bd6b84-527d-4fca-bfc8-a42e9622988e",
        "uddi:acd20208-09ab-400d-8aef-8abb6c037590_201910211427",
    ]
    assert items[0]["name"] == "울산광역시_동구_평생학습강좌"
    assert items[0]["org"] == "울산광역시 동구"
    assert items[1]["update_date"] == "2026-08-14"


def test_fetch_catalog_paginates_and_caches(monkeypatch, tmp_path):
    html = (FIX / "catalog_page.html").read_bytes()
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        return html if "currentPage=1" in url else b"<html></html>"

    monkeypatch.setattr(http, "get", fake_get)
    cat = std.fetch_catalog(raw_dir=tmp_path)
    assert len(cat) == 2 and len(calls) == 2
    assert json.loads((tmp_path / "catalog.json").read_text(encoding="utf-8")) == cat
    std.fetch_catalog(raw_dir=tmp_path)  # 캐시 재사용
    assert len(calls) == 2
    std.fetch_catalog(raw_dir=tmp_path, refresh=True)
    assert len(calls) == 4


def test_fetch_catalog_empty_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(http, "get", lambda url, **kw: b"<html></html>")
    with pytest.raises(std.StdCatalogError):
        std.fetch_catalog(raw_dir=tmp_path)


def test_download_flow_skip_and_failure(monkeypatch, tmp_path):
    catalog = [
        {"uddi": "uddi:aaa", "name": "울산광역시_동구_평생학습강좌"},
        {"uddi": "uddi:bbb", "name": "경상북도/영천시_평생학습강좌"},
        {"uddi": "uddi:ccc", "name": "깨진파일"},
    ]
    calls = []

    def fake_get(url, **kw):
        calls.append(url)
        if "uddi:ccc" in url:
            raise OSError("boom")
        if "selectFileDataDownload" in url:
            return json.dumps({"fileDataRegistVO": {"atchFileId": "ATCH1"}}).encode()
        assert "atchFileId=ATCH1" in url and kw["referer"]
        return b"x" * 200

    monkeypatch.setattr(http, "get", fake_get)
    f = Failures()
    paths = std.download(catalog, tmp_path, f)
    assert [p.name for p in paths] == ["울산광역시_동구_평생학습강좌.csv", "경상북도_영천시_평생학습강좌.csv"]
    assert all(p.read_bytes() == b"x" * 200 for p in paths)
    assert [i["reason"] for i in f.items] == ["download_error"]
    n = len(calls)
    paths2 = std.download(catalog[:2], tmp_path, f)  # 이미 있으면 스킵
    assert len(paths2) == 2 and len(calls) == n
