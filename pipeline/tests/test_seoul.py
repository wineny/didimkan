"""소스4 서울 예약사이트: 축약 fixture 로 프레임·어댑터를 검사한다. 네트워크 0(conftest 가 막는다)."""
import dataclasses
import re
from pathlib import Path

import pytest

from pipeline.common import http
from pipeline.common.failures import Failures
from pipeline.sources.seoul import base
from pipeline.sources.seoul.adapters import ADAPTERS, BY_SOURCE, STATUS_OPEN
from pipeline.sources.std import COURSE_KEYS
from pipeline.tools import capture_fixtures as cap

FIXTURES = Path(__file__).parent / "fixtures" / "seoul"
TODAY = "2026-10-10"
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HHMM = re.compile(r"^\d{2}:\d{2}$")
DAYS = re.compile(r"^[월화수목금토일](,[월화수목금토일])*$")
CAPTURED = [a for a in ADAPTERS if (FIXTURES / cap.fixture_name(a)).exists()]
CONTRACT_CODES = {
    "seoul_jongno", "seoul_junggu", "seoul_seongdong", "seoul_dongdaemun", "seoul_gangbuk",
    "seoul_gwanak", "seoul_gangdong", "seoul_yongsan", "seoul_seongbuk", "seoul_seodaemun",
    "seoul_guro", "seoul_songpa", "seoul_seocho", "seoul_nowon",
}


def fixture_bytes(adapter, text: str | None = None) -> bytes:
    text = text if text is not None else (FIXTURES / cap.fixture_name(adapter)).read_text("utf-8")
    return text.encode(adapter.encoding or "utf-8")


@pytest.fixture
def net(monkeypatch):
    """http.get/post 를 가짜로: body 를 돌려주고 호출을 센다."""
    state = {"body": b"", "calls": []}

    def fake(url, data=None, **kw):
        state["calls"].append((url, data))
        return state["body"]

    monkeypatch.setattr(http, "get", lambda url, **kw: fake(url, **kw))
    monkeypatch.setattr(http, "post", lambda url, data=None, **kw: fake(url, data, **kw))
    return state


@pytest.fixture
def real_http(monkeypatch):
    """http 모듈 내부(robots·요청)만 가짜로 — robots 판정 경로를 그대로 탄다."""
    monkeypatch.setattr(http, "_sleep", lambda s: None)
    monkeypatch.setattr(http, "_last_request", {})
    monkeypatch.setattr(http, "_robots_cache", {})
    monkeypatch.setattr(http, "failures", Failures())
    state = {"robots": {}, "bodies": {}, "requests": []}

    def fetch_robots(origin):
        return state["robots"].get(origin, "")

    def do_request(method, url, headers, data, timeout):
        state["requests"].append(url)
        host = http._host(url)
        return state["bodies"].get(host, b"")

    monkeypatch.setattr(http, "_fetch_robots", fetch_robots)
    monkeypatch.setattr(http, "_do_request", do_request)
    return state


def test_adapter_table_matches_contract():
    assert {a.source for a in ADAPTERS} == CONTRACT_CODES
    assert all(a.gu.endswith("구") for a in ADAPTERS)
    assert BY_SOURCE["seoul_nowon"].no_apply_period is True
    for a in ADAPTERS:  # 행 규칙이 없으면 todo 가 반드시 있다
        if not a.row_selector:
            assert a.todo, a.source


def test_fixtures_exist_for_some_gu():
    assert len(CAPTURED) >= 1


@pytest.mark.parametrize("adapter", CAPTURED, ids=lambda a: a.source)
def test_collect_fixture_rows_follow_contract(net, adapter):
    """거르기(상태·기관)를 끈 어댑터로 fixture 전 행이 계약 형식으로 정규화되는지."""
    net["body"] = fixture_bytes(adapter)
    loose = dataclasses.replace(adapter, status_allow=None, institution_pattern=None)
    f = Failures()
    rows = base.collect_gu(loose, failures=f, collected_at=TODAY, max_pages=2)
    assert len(rows) >= 1
    assert f.items == []
    for r in rows:
        assert set(r) == set(COURSE_KEYS)
        assert r["description"] is None
        assert r["source"] == adapter.source and r["source"].startswith("seoul_")
        assert r["sido"] == "서울특별시" and r["sigungu"] == adapter.gu
        assert r["title"] and re.fullmatch(r"[0-9a-f]{16}", r["id"])
        assert r["collected_at"] == TODAY and r["data_date"] == TODAY
        for k in ("start_date", "end_date", "apply_start", "apply_end"):
            assert r[k] is None or ISO.match(r[k]), (k, r[k])
        for k in ("start_time", "end_time"):
            assert r[k] is None or HHMM.match(r[k]), (k, r[k])
        assert r["weekdays"] is None or DAYS.match(r["weekdays"])
        assert r["is_online"] in (0, 1) and r["is_free"] in (0, 1)
        assert r["source_url"] and "{dong}" not in r["source_url"]
        assert r["detail_url"] is None or r["detail_url"].startswith("https://")
        if adapter.no_apply_period:
            assert r["apply_start"] is None and r["apply_end"] is None


@pytest.mark.parametrize("adapter", CAPTURED, ids=lambda a: a.source)
def test_collect_keeps_only_open_and_dong_center_rows(net, adapter):
    net["body"] = fixture_bytes(adapter)
    rows = base.collect_gu(adapter, failures=Failures(), collected_at=TODAY, max_pages=2)
    parsed = base.parse_rows(adapter, fixture_bytes(adapter).decode(adapter.encoding or "utf-8"))
    expected = {r["title"] for r in parsed if base.keep_row(adapter, r)}
    assert {r["title"] for r in rows} == expected
    if adapter.status_allow:
        for r in parsed:
            if r["title"] in expected:
                assert re.search(adapter.status_allow, r.get("status") or "")


def test_closed_rows_are_dropped_junggu(net):
    ad = BY_SOURCE["seoul_junggu"]
    net["body"] = fixture_bytes(ad)
    parsed = base.parse_rows(ad, fixture_bytes(ad).decode())
    assert parsed and all(r["status"] == "접수마감" for r in parsed)
    assert base.collect_gu(ad, failures=Failures(), collected_at=TODAY, max_pages=1) == []
    assert not re.search(STATUS_OPEN, "접수마감")
    assert all(re.search(STATUS_OPEN, s) for s in ("접수중", "접수대기", "모집 중", "모집대기", "신청가능", "준비"))


def _first(adapter, net, **kw):
    net["body"] = fixture_bytes(adapter, kw.pop("text", None))
    loose = dataclasses.replace(adapter, status_allow=None, institution_pattern=None)
    return base.collect_gu(loose, failures=Failures(), collected_at=TODAY, max_pages=1)[0]


@pytest.mark.skipif(not (FIXTURES / "gangdong.html").exists(), reason="fixture 없음")
def test_gangdong_values(net):
    r = _first(BY_SOURCE["seoul_gangdong"], net)
    assert (r["title"], r["institution"], r["dong"]) == ("일본어(초급)", "천호3동 주민센터", "천호3동")
    assert (r["apply_start"], r["apply_end"]) == ("2026-10-12", "2026-10-16")
    assert (r["start_date"], r["end_date"]) == ("2026-11-02", "2026-12-31")
    assert (r["weekdays"], r["weekday_bits"], r["start_time"], r["end_time"]) == ("월,목", 9, "13:00", "14:00")
    assert r["capacity"] == 2 and r["time_bucket"] == "오후"
    assert r["detail_url"] == "https://jumin.gangdong.go.kr/program/ProgramClassroomView.do?menucode=84&gn_seq=3134"


@pytest.mark.skipif(not (FIXTURES / "dongdaemun.html").exists(), reason="fixture 없음")
def test_dongdaemun_values(net):
    r = _first(BY_SOURCE["seoul_dongdaemun"], net)
    assert (r["title"], r["institution"], r["dong"]) == ("서예교실", "용두동 자치회관", "용두동")
    assert (r["apply_start"], r["apply_end"], r["start_date"], r["end_date"]) == (
        "2026-09-21", "2026-09-22", "2026-10-01", "2026-12-31")
    assert (r["weekdays"], r["start_time"], r["end_time"]) == ("월", "10:00", "12:00")
    assert r["selection_method"] == "선착순" and r["capacity"] == 2 and r["fee_raw"] is None
    assert r["detail_url"].startswith("https://www.ddm.go.kr/reserve/selectDongdaemunUserCourseView.do?")


@pytest.mark.skipif(not (FIXTURES / "seocho.html").exists(), reason="fixture 없음")
def test_seocho_values(net):
    r = _first(BY_SOURCE["seoul_seocho"], net)
    assert r["title"].startswith("[남성전용] 기찬몸 수련")
    assert (r["fee_won"], r["is_free"], r["is_online"], r["weekdays"]) == (80000, 0, 0, "목")
    assert (r["apply_start"], r["apply_end"]) == ("2026-10-12", "2026-10-30")
    assert r["detail_url"] == "https://www.seocho.go.kr/site/seocho/ex/lecture/View.do?clIdx=L00019344"


@pytest.mark.skipif(not (FIXTURES / "guro.html").exists(), reason="fixture 없음")
def test_guro_values(net):
    r = _first(BY_SOURCE["seoul_guro"], net)
    assert (r["title"], r["dong"]) == ("SNPE", "가리봉동")
    assert (r["apply_start"], r["apply_end"], r["start_date"]) == ("2026-09-07", "2026-12-31", "2026-10-01")
    assert (r["weekdays"], r["start_time"], r["end_time"], r["capacity"]) == ("화", "18:30", "20:10", 20)


@pytest.mark.skipif(not (FIXTURES / "nowon.html").exists(), reason="fixture 없음")
def test_nowon_institution_filter_and_no_apply_period(net):
    ad = BY_SOURCE["seoul_nowon"]
    net["body"] = fixture_bytes(ad)
    assert base.collect_gu(ad, failures=Failures(), collected_at=TODAY, max_pages=1) == []
    text = (FIXTURES / "nowon.html").read_text("utf-8").replace("노원전통문화체험관 다완재", "주민센터_상계8동", 1)
    net["body"] = fixture_bytes(ad, text)
    rows = base.collect_gu(ad, failures=Failures(), collected_at=TODAY, max_pages=1)
    assert len(rows) == 1
    r = rows[0]
    assert (r["institution"], r["dong"]) == ("상계8동 주민센터", "상계8동")
    assert r["apply_start"] is None and r["apply_end"] is None
    assert (r["title"], r["fee_won"], r["weekdays"], r["start_time"]) == (
        "우리 술 빚기 -11월 전통 주 만들기 (4주 과정)", 40000, "수", "10:00")


def test_robots_block_means_zero_requests(real_http):
    ad = BY_SOURCE["seoul_gangdong"]
    real_http["robots"]["https://jumin.gangdong.go.kr"] = "User-agent: *\nDisallow: /\n"
    f = Failures()
    rows = base.collect_gu(ad, failures=f, collected_at=TODAY)
    assert rows == []
    assert real_http["requests"] == []
    assert [(it["source"], it["reason"]) for it in f.items] == [("seoul_gangdong", "robots")]


@pytest.mark.skipif(not (FIXTURES / "guro.html").exists(), reason="fixture 없음")
def test_one_gu_failure_does_not_stop_collect_all(real_http):
    blocked, ok = BY_SOURCE["seoul_gangdong"], BY_SOURCE["seoul_guro"]
    real_http["robots"]["https://jumin.gangdong.go.kr"] = "User-agent: *\nDisallow: /\n"
    real_http["bodies"]["www.guro.go.kr"] = fixture_bytes(ok)
    f = Failures()
    rows = base.collect_all([blocked, ok], failures=f, collected_at=TODAY)
    assert rows and {r["source"] for r in rows} == {"seoul_guro"}
    assert ("seoul_gangdong", "robots") in {(it["source"], it["reason"]) for it in f.items}
    assert not any("jumin.gangdong" in u for u in real_http["requests"])


def test_js_shell_is_recorded_and_stops(net):
    ad = BY_SOURCE["seoul_seongbuk"]
    shell = ("<html><head><script>document.cookie='sabFingerPrint=" + "x" * 900
             + "';location.replace(location.href);</script></head><body></body></html>")
    net["body"] = shell.encode()
    assert len(net["body"]) < 1100
    f = Failures()
    rows = base.collect_gu(ad, failures=f, collected_at=TODAY)
    assert rows == []
    assert [it["reason"] for it in f.items] == ["js_shell"]
    assert len(net["calls"]) == 1


def test_empty_real_page_is_no_rows_not_shell(net):
    """행 0개지만 본문이 있는 정상 페이지(「데이터가 없습니다」)는 껍데기가 아니라 no_rows."""
    ad = BY_SOURCE["seoul_gangbuk"]
    body = "<html><body><table><thead><tr><th>강좌명</th></tr></thead><tbody></tbody></table>" + \
           "<p>" + "데이터가 없습니다. 강북구 교육 신청 안내 " * 60 + "</p></body></html>"
    net["body"] = body.encode()
    assert len(net["body"]) > base.SHELL_BYTES
    f = Failures()
    assert base.collect_gu(ad, failures=f, collected_at=TODAY) == []
    assert [it["reason"] for it in f.items] == ["no_rows"]
    assert len(net["calls"]) == 2  # 상태 필터 2개(접수중·접수대기) 첫 페이지씩


def test_todo_adapter_makes_no_request(net):
    f = Failures()
    assert base.collect_gu(BY_SOURCE["seoul_jongno"], failures=f, collected_at=TODAY) == []
    assert net["calls"] == []
    assert f.items[0]["reason"] == "todo"


def test_build_request_get_post_and_shard():
    m, url, data = base.build_request(BY_SOURCE["seoul_songpa"], None, (("searchVal7", "2"),), None)
    assert m == "POST" and ("searchKind4", "9998") in data and ("searchVal7", "2") in data
    sdm = BY_SOURCE["seoul_seodaemun"]
    m, url, data = base.build_request(sdm, sdm.shards[0], (), 3)
    assert m == "GET" and data is None
    assert url.startswith("https://www.sdm.go.kr/dong/bah/acms/com/lecture.do?") and "cp=3" in url
    jg = BY_SOURCE["seoul_junggu"]
    m, url, _ = base.build_request(jg, jg.shards[1], (), 1)
    assert "cmsid=16380" in url and "s_dong=%ED%9A%8C%ED%98%84%EB%8F%99" in url and "page=1" in url


def test_sanitize_strips_scripts_long_text_teacher_and_extra_rows():
    ad = dataclasses.replace(BY_SOURCE["seoul_seodaemun"], encoding=None)
    rows = "".join(
        f"<tr><td>{i}</td><td>학습</td><td>성인</td><td><a href=\"javascript:goView('{i}');\">[충현동] 강좌{i}</a></td>"
        f"<td>홍길동</td><td>06-15~09-30</td><td>07-01~09-30</td><td><b>접수중</b></td></tr>"
        for i in range(8))
    html = ("<html><head><style>.a{}</style><script>var x=1;</script></head><body><nav>메뉴</nav>"
            "<p>" + "긴 소개 문단 " * 40 + "</p><table class=\"table_style_col\"><thead><tr><th>번호</th>"
            "<th>분야</th><th>대상</th><th>프로그램명</th><th>강사</th><th>모집기간</th><th>강의기간</th>"
            "<th>상태</th></tr></thead><tbody>" + rows + "</tbody></table><img src=x></body></html>")
    out = cap.sanitize(ad, html)
    assert "<script" not in out and "<style" not in out and "<img" not in out
    assert "홍길동" not in out and "(생략)" in out
    assert "긴 소개 문단" not in out and "메뉴" not in out
    assert out.count("<tr>") == 1 + cap.MAX_ROWS
    assert len(base.parse_rows(ad, out)) == cap.MAX_ROWS
