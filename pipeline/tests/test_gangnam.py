import json
from datetime import date
from pathlib import Path

import pytest

from pipeline import derive
from pipeline.common import http
from pipeline.common.failures import Failures
from pipeline.sources import gangnam
from pipeline.tests.test_std import schema_columns

FIX = Path(__file__).parent / "fixtures" / "gangnam"
TODAY = date(2026, 10, 10)


@pytest.fixture
def companies():
    return {c["comcd"]: c for c in json.loads((FIX / "companies.json").read_text(encoding="utf-8"))}


@pytest.fixture
def rows(companies):
    sample = json.loads((FIX / "lectures_sample.json").read_text(encoding="utf-8"))
    return [gangnam.normalize(lec, companies[code], collected_at="2026-10-10", today=TODAY)
            for code, lecs in sample.items() for lec in lecs]


def test_six_rows_match_schema(rows):
    assert len(rows) == 6
    for r in rows:
        assert set(r) == schema_columns()
        assert r["description"] is None
        assert r["source"] == "gangnam"
        assert r["sigungu"] == "강남구" and r["sido"] == "서울특별시"
        assert r["fee_period"] == "월" and r["fee_won"] > 0
        assert r["is_online"] == 0 and r["is_dong_center"] == 1
        assert r["start_date"] is None and r["end_date"] is None and r["is_always_open"] == 0
        assert r["apply_method"] == "온라인(강남구 통합예약)"
        assert r["detail_url"].startswith("https://life.gangnam.go.kr/fmcs/52?action=read&comcd=GNCC")


def test_fields(rows):
    r = rows[0]
    assert r["institution"] == "개포2동복합문화센터" and r["venue"] == r["institution"]
    assert r["dong"] == "개포2동"
    assert (r["title"], r["start_time"], r["end_time"], r["weekdays"], r["capacity"]) == (
        "금요수채화", "13:00", "15:50", "금", 15)
    assert r["fee_won"] == 60000 and r["time_bucket"] == "오후"
    assert r["source_url"].endswith("company_code=GNCC07&page=1&page_size=1000")


def test_apply_window_matches_derive(rows):
    ref = date(2026, 11, 1)  # 빌드일(10월)이 속한 달의 신규 창
    z2 = [r for r in rows if r["institution"] == "개포2동복합문화센터"]
    z1 = [r for r in rows if r["institution"] == "도곡1동복합문화센터"]
    assert len(z1) == len(z2) == 3
    for zone, group in ((1, z1), (2, z2)):
        start, end, _ = derive.gangnam_window(ref, zone)
        assert all((r["apply_start"], r["apply_end"]) == (start, end) for r in group)
    assert z1[0]["apply_start"] == "2026-10-26" and z2[0]["apply_start"] == "2026-10-27"
    assert z1[0]["apply_end"] == "2026-10-31"


def test_december_ref_rolls_year(companies):
    lec = {"class_cd": "1", "class_nm": "x", "course_fee": "1,000", "comcd": "GNCC13"}
    r = gangnam.normalize(lec, companies["GNCC13"], collected_at="2026-12-10", today=date(2026, 12, 10))
    assert (r["apply_start"], r["apply_end"]) == ("2026-12-26", "2026-12-31")


def test_non_dong_center_has_no_window(companies):
    lec = {"class_cd": "1", "class_nm": "테니스", "course_fee": "30,000", "comcd": "GNCC05"}
    r = gangnam.normalize(lec, companies["GNCC05"], collected_at="2026-10-10", today=TODAY)
    assert r["apply_start"] is None and r["is_dong_center"] == 0


def test_make_id_deterministic(rows, companies):
    sample = json.loads((FIX / "lectures_sample.json").read_text(encoding="utf-8"))
    again = [gangnam.normalize(lec, companies[c], collected_at="2026-11-01", today=date(2026, 11, 1))
             for c, lecs in sample.items() for lec in lecs]
    assert [r["id"] for r in rows] == [r["id"] for r in again]
    assert len({r["id"] for r in rows}) == 6


def test_capture_strips_description_keys():
    lec = {"class_nm": "a", "class_desc": "긴 설명", "remark": "x", "teacher_name": "홍", "capa": "1"}
    assert gangnam.capture([lec, lec], 1) == [{"class_nm": "a", "capa": "1"}]


def _fake_get(pages, calls):
    def get(url, **kw):
        calls.append(url)
        return json.dumps(pages[len(calls) - 1] if len(calls) <= len(pages) else []).encode()
    return get


def test_fetch_lectures_single_page(monkeypatch, tmp_path):
    calls = []
    page = [{"class_cd": str(i), "total_count": 3} for i in range(3)]
    monkeypatch.setattr(http, "get", _fake_get([page], calls))
    out = gangnam.fetch_lectures("GNCC07", Failures(), raw_dir=tmp_path)
    assert len(out) == 3 and len(calls) == 1
    assert "company_code=GNCC07" in calls[0] and "page_size=1000" in calls[0]
    assert json.loads((tmp_path / "GNCC07.json").read_text(encoding="utf-8")) == page


def test_fetch_lectures_paginates(monkeypatch, tmp_path):
    monkeypatch.setattr(gangnam, "PAGE_SIZE", 2)
    calls = []
    p1 = [{"class_cd": "1", "total_count": 3}, {"class_cd": "2", "total_count": 3}]
    p2 = [{"class_cd": "3", "total_count": 3}]
    monkeypatch.setattr(http, "get", _fake_get([p1, p2], calls))
    out = gangnam.fetch_lectures("GNCC07", None, raw_dir=tmp_path)
    assert [x["class_cd"] for x in out] == ["1", "2", "3"]
    assert len(calls) == 2 and "page=2" in calls[1]


def test_fetch_lectures_empty(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(http, "get", _fake_get([[]], calls))
    assert gangnam.fetch_lectures("GNCC07", None, raw_dir=tmp_path) == [] and len(calls) == 1


def test_collect_survives_center_failure(monkeypatch, tmp_path, companies):
    comp = [companies["GNCC07"], companies["GNCC13"]]
    sample = json.loads((FIX / "lectures_sample.json").read_text(encoding="utf-8"))

    def get(url, **kw):
        if "company?type=L" in url:
            return json.dumps(comp).encode()
        if "GNCC07" in url:
            raise ConnectionError("boom")
        return json.dumps(sample["GNCC13"]).encode()

    monkeypatch.setattr(http, "get", get)
    f = Failures()
    rows = gangnam.collect(f, "2026-10-10", TODAY, raw_dir=tmp_path)
    assert len(rows) == 3 and {r["institution"] for r in rows} == {"도곡1동복합문화센터"}
    assert [i["reason"] for i in f.items] == ["center_error"]
