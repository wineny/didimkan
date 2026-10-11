"""소스2(공공데이터포털 개별 파일 32곳) 테스트. 네트워크 0: http.get/post 는 가짜로 바꾼다."""
import json
import re
from pathlib import Path

import pytest

from pipeline.common import http
from pipeline.common.failures import Failures
from pipeline.common.parse import SIDO_FULL
from pipeline.sources import portal

FIX = Path(__file__).resolve().parent / "fixtures" / "portal"
SCHEMA = Path(__file__).resolve().parent.parent / "schema.sql"
TODAY = "2026-10-10"
REQUIRED_KEYS = {
    "key", "sido", "sigungu", "public_data_pk", "kind", "url", "encoding_hint",
    "has_apply_period", "default_is_dong_center", "column_map", "filters", "notes",
}
SIDO_COUNTS = {
    "서울특별시": 9, "인천광역시": 3, "대구광역시": 4, "대전광역시": 2, "전남광주통합특별시": 3,
    "울산광역시": 1, "경기도": 3, "충청남도": 4, "충청북도": 2, "경상남도": 1,
}


def schema_columns() -> list[str]:
    body = re.search(r"CREATE TABLE courses \((.*?)\n\);", SCHEMA.read_text(encoding="utf-8"), re.S).group(1)
    cols = []
    for line in body.splitlines():
        m = re.match(r"\s+([a-z_]+)\s+(TEXT|INTEGER|REAL)\b", line)
        if m:
            cols.append(m.group(1))
    return cols


def entry(manifest: list[dict], key: str) -> dict:
    return next(e for e in manifest if e["key"] == key)


@pytest.fixture(scope="module")
def manifest() -> list[dict]:
    return portal.load_manifest()


# ---------------------------------------------------------------- 매니페스트

def test_manifest_has_32_entries(manifest):
    assert len(manifest) == 32
    assert len({e["key"] for e in manifest}) == 32


def test_manifest_schema(manifest):
    for e in manifest:
        assert REQUIRED_KEYS <= set(e), e["key"]
        assert e["sido"] in SIDO_FULL, e["key"]
        assert e["kind"] in portal.KINDS, e["key"]
        assert re.fullmatch(r"\d+", e["public_data_pk"]), e["key"]
        assert isinstance(e["has_apply_period"], bool) and isinstance(e["default_is_dong_center"], bool)
        assert e["url"] is None or e["url"].startswith("http"), e["key"]
        if e["url"] is None:
            assert e.get("todo"), f"{e['key']}: url 이 없으면 todo 가 있어야 함"
        for target in e["column_map"].values():
            for t in target if isinstance(target, list) else [target]:
                assert t in portal.TARGETS, (e["key"], t)
        if e["kind"] == "link":
            assert e["link_resolve"] in portal.LINK_RESOLVERS, e["key"]
        if not e["column_map"]:
            assert e.get("auto_map") and e.get("todo"), f"{e['key']}: 헤더 미확인 표시가 필요"


def test_manifest_region_counts(manifest):
    counts = {}
    for e in manifest:
        counts[e["sido"]] = counts.get(e["sido"], 0) + 1
    assert counts == SIDO_COUNTS


def test_manifest_has_no_excluded_datasets(manifest):
    assert len(portal.EXCLUDED_PKS) == 9
    for e in manifest:
        pks = {e["public_data_pk"]} | {x["public_data_pk"] for x in e.get("extra_files", [])}
        assert not pks & portal.EXCLUDED_PKS, e["key"]


def test_load_manifest_rejects_excluded_dataset(tmp_path):
    bad = [{"key": "x", "public_data_pk": "15037707"}]  # 성동구 2024 파일
    path = tmp_path / "m.json"
    path.write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(ValueError):
        portal.load_manifest(path)


def test_apply_period_entries(manifest):
    with_period = {e["key"] for e in manifest if e["has_apply_period"]}
    assert with_period == {"seoul-gwangjin", "seoul-geumcheon", "incheon-seo", "chungnam-cheonan"}


def test_course_keys_match_schema():
    assert portal.COURSE_KEYS == schema_columns()


# ---------------------------------------------------------------- normalize: 대표 5곳

def run(manifest, key, filename):
    return portal.normalize(entry(manifest, key), FIX / filename, collected_at=TODAY)


def assert_course_shape(rows):
    assert rows
    for r in rows:
        assert set(r) == set(portal.COURSE_KEYS)
        assert r["source"] == "portal" and r["collected_at"] == TODAY
        assert r["title"] and r["id"]
        assert r["signals"] == "[]" and r["weekday_bits"] >= 0
        assert r["category"] is None and r["stair"] is None and r["term_days"] is None
        assert r["lat"] is None and r["lng"] is None
        assert all(v != "" for v in r.values()), "빈 문자열 금지(NULL 로)"


def test_mapo(manifest):
    rows = run(manifest, "seoul-mapo", "seoul-mapo__15037729.csv")
    assert len(rows) == 2
    assert_course_shape(rows)
    r = rows[0]
    assert (r["sido"], r["sigungu"], r["dong"]) == ("서울특별시", "마포구", "공덕동")
    assert r["title"] == "요가교실"
    assert (r["weekdays"], r["weekday_bits"]) == ("월,수", 0b101)
    assert (r["start_time"], r["end_time"], r["time_bucket"]) == ("19:00", "20:10", "저녁")
    assert (r["fee_won"], r["fee_period"], r["is_free"]) == (60000, "총", 0)
    assert r["institution_phone"] == "02-3153-6514"
    assert r["data_date"] == "2026-02-27"
    assert r["venue"] == "지하다목적실"
    assert r["institution"] == "마포구 공덕동 주민센터"
    assert r["is_dong_center"] == 1
    assert r["source_file"] == "seoul-mapo__15037729.csv"
    assert r["source_url"] == "https://www.data.go.kr/data/15037729/fileData.do"
    assert r["description"] is None and r["apply_start"] is None


def test_gwangjin_apply_period(manifest):
    rows = run(manifest, "seoul-gwangjin", "seoul-gwangjin__15037963.html")
    assert len(rows) == 3
    assert_course_shape(rows)
    r = rows[0]
    assert r["title"] == "스포츠댄스"
    assert r["dong"] == "구의2동"
    assert (r["apply_start"], r["apply_end"]) == ("2026-09-15", "2026-12-31")
    assert (r["start_date"], r["end_date"]) == ("2026-10-01", "2026-12-31")
    assert (r["weekdays"], r["start_time"], r["end_time"]) == ("화,목", "13:00", "14:00")
    assert (r["capacity"], r["fee_won"], r["venue"]) == (20, 60000, "대강당(5층)")
    assert r["detail_url"] == "https://www.gwangjin.go.kr/atdrc/pgm/jachi/view.do?progrmSn=8168&menuNo=1200005"
    assert rows[1]["capacity"] == 100 and rows[2]["weekdays"] == "월,수"


def test_geumcheon_keeps_only_dong_centers(manifest):
    rows = run(manifest, "seoul-geumcheon", "seoul-geumcheon__15162774.csv")
    assert [r["title"] for r in rows] == ["[시흥4동] 헬스 (26년 3분기)", "[시흥4동] 라인댄스 (26년 3분기)"]
    assert_course_shape(rows)
    gym, dance = rows
    assert gym["dong"] == "시흥4동" and gym["institution"] == "금천구 시흥4동 주민센터"
    assert (gym["apply_start"], gym["apply_end"]) == ("2026-06-15", "2026-06-17")
    assert (gym["start_date"], gym["end_date"]) == ("2026-07-01", "2026-09-30")
    assert gym["weekdays"] == "월,화,수,목,금"  # '주말 및 공휴일 제외' 는 요일로 읽지 않는다
    assert (gym["start_time"], gym["end_time"]) == ("09:00", "21:00")
    assert (dance["weekdays"], dance["start_time"], dance["end_time"]) == ("월,수", "18:30", "20:30")
    assert (dance["fee_won"], dance["capacity"]) == (75000, 35)
    assert dance["institution_phone"] == "02-2104-5703"
    assert dance["address"].startswith("08569 서울특별시 금천구")


def test_daejeon_seo_api_json(manifest):
    rows = run(manifest, "daejeon-seo", "daejeon-seo__15128300.json")
    assert len(rows) == 3
    assert_course_shape(rows)
    assert rows[1]["title"] == "요가교실 A"
    assert (rows[1]["weekdays"], rows[1]["start_time"], rows[1]["end_time"]) == ("월,화,목", "10:10", "11:10")
    assert rows[0]["dong"] == "복수동" and rows[0]["venue"] == "복수동 행정복지센터"
    assert rows[0]["data_date"] == "2026-04-28"
    assert rows[0]["source_url"] == "https://www.data.go.kr/data/15128300/openapi.do"
    assert (rows[0]["sido"], rows[0]["sigungu"]) == ("대전광역시", "서구")


def test_yeonsu_sessions_per_week(manifest):
    # 연수구: 요일·시간·날짜 없음. 「횟수(1주)」만 sessions_per_week 로 받고, 「-」는 None. 연도 없는 기간은 안 읽는다.
    rows = run(manifest, "incheon-yeonsu", "incheon-yeonsu__15087577.csv")
    assert len(rows) == 3
    assert_course_shape(rows)
    yoga, cafe, line = rows
    assert (yoga["title"], yoga["sessions_per_week"], yoga["capacity"]) == ("요가", 3, 30)
    assert (cafe["title"], cafe["sessions_per_week"], cafe["capacity"]) == ("북카페", None, None)
    assert (line["title"], line["sessions_per_week"]) == ("라인댄스", 2)
    for r in rows:
        assert r["weekday_bits"] == 0 and r["weekdays"] is None
        assert r["start_date"] is None and r["end_date"] is None
        assert r["start_time"] is None
        assert r["is_dong_center"] == 1 and r["sigungu"] == "연수구"
    assert yoga["dong"] == "옥련1동" and cafe["dong"] == "연수3동"


@pytest.mark.parametrize("raw,expected", [
    ("3", 3), ("주 2회", 2), (" 1 ", 1), ("7", 7),
    ("-", None), ("", None), ("0", None), ("8", None), ("12", None),
])
def test_sessions_per_week(raw, expected):
    assert portal._sessions_per_week(raw) == expected


def test_ulsan_dong_broken_header_is_repaired(manifest):
    rows = run(manifest, "ulsan-dong", "ulsan-dong__3076787.csv")
    assert len(rows) == 2
    assert_course_shape(rows)
    r = rows[0]
    assert r["title"] == "사교댄스(초급)"  # 깨진 헤더 '프로그램명수강인원' 에서 복구
    assert r["dong"] == "방어동"  # 헤더 '동 ' 의 뒤쪽 공백 제거
    assert (r["weekdays"], r["start_time"], r["end_time"]) == ("월,수", "09:00", "10:00")
    assert (r["fee_won"], r["fee_period"]) == (11000, "월")
    assert r["capacity"] is None


def test_unknown_header_is_reported(manifest, tmp_path):
    wrong = tmp_path / "seoul-mapo__15037729.csv"
    wrong.write_bytes((FIX / "ulsan-dong__3076787.csv").read_bytes())
    f = Failures()
    rows = portal.normalize(entry(manifest, "seoul-mapo"), wrong, collected_at=TODAY, failures=f)
    assert rows == []
    assert any(i["reason"] == "schema_mismatch" for i in f.items)


# ---------------------------------------------------------------- 값 변환

@pytest.mark.parametrize("raw,monthly,expected", [
    ("무료", False, (0, 1, None)),
    ("없음", False, (0, 1, None)),
    ("0", False, (0, 1, None)),
    ("60,000(분기)", False, (60000, 0, "총")),
    ("1개월 10,000원", False, (10000, 0, "월")),
    ("3개월 30,000원", False, (30000, 0, "총")),
    ("분기별 36000원", False, (36000, 0, "총")),
    ("10000원/월", False, (10000, 0, "월")),
    ("36000원/3개월(재료비 없음)", False, (36000, 0, "총")),
    ("15000", True, (15000, 0, "월")),
    ("", False, (None, 0, None)),
    ("문의", False, (None, 0, None)),
    # 만 단위 표기(예산·김해·인천 서구 실측). 예전엔 숫자만 먼저 뽑다가 「만」이 끊겨 None 이 됐다
    ("1만원", False, (10000, 0, "총")),
    ("3만원/분기", False, (30000, 0, "총")),
    ("7만 5천원/분기", False, (75000, 0, "총")),
    ("월 1만원", False, (10000, 0, "월")),
    ("월 1만원(장소 대관 및 재료비)", False, (10000, 0, "월")),
    ("1만원/월(3개월납)", False, (10000, 0, "월")),
    ("3개월 2만원", False, (20000, 0, "총")),
    ("회당 1만원", False, (10000, 0, "총")),
    # 만 단위의 경계: 원 금액이 앞에 있으면 그쪽, 기간은 금액이 든 쉼표 구간만, 「만 65세」「1만명」은 금액 아님
    ("30,000원(재료비 1만원 별도)", False, (30000, 0, "총")),
    ("10,000원(재료비 2만원)", False, (10000, 0, "총")),
    ("3개월 6만원, 1개월 2만원", False, (60000, 0, "총")),
    ("5000 만65세이상 반액", False, (5000, 0, "총")),
    ("1만명", False, (None, 0, None)),
    ("1.5만원", False, (None, 0, None)),
])
def test_fee(raw, monthly, expected):
    assert portal._fee(raw, monthly) == expected


@pytest.mark.parametrize("raw,expected", [
    ("10:00~12:00", ("10:00", "12:00")),
    ("13:00 ~ 14:00", ("13:00", "14:00")),
    ("월+수 09:00~10:00", ("09:00", "10:00")),
    ("9시부터~21시까지", ("09:00", "21:00")),
    ("18시 30분부터~20시 30분까지", ("18:30", "20:30")),
    ("매주 목요일 14:00 ~ 15:30", ("14:00", "15:30")),
    ("14:00", ("14:00", None)),
    ("", (None, None)),
])
def test_time_range(raw, expected):
    assert portal._time_range(raw)[:2] == expected


@pytest.mark.parametrize("raw,expected", [
    ("월 ~ 금 ", "월,화,수,목,금"),
    ("화·목", "화,목"),
    ("월/수/금", "월,수,금"),
    ("매주 목요일", "목"),
    ("평일 주말 및 공휴일 제외", "월,화,수,목,금"),
    ("", ""),
])
def test_weekdays(raw, expected):
    assert portal._weekdays(raw) == expected


def test_always_open_words():
    rec = {k: None for k in portal.COURSE_KEYS}
    rec["is_always_open"] = 0
    portal._apply_target("apply_range", "수시", rec)
    assert rec["is_always_open"] == 1 and rec["apply_start"] is None


# ---------------------------------------------------------------- download (가짜 http)

class FakeHttp:
    def __init__(self, routes: dict[str, bytes]):
        self.routes = routes
        self.calls: list[tuple[str, str]] = []

    def get(self, url, **kw):
        self.calls.append(("GET", url))
        for prefix, body in self.routes.items():
            if url.startswith(prefix):
                return body
        raise AssertionError(f"예상 못 한 GET {url}")

    def post(self, url, data=None, **kw):
        self.calls.append(("POST", url))
        assert data["publicDataPk"] and data["publicDataDetailPk"].startswith("uddi:")
        return self.routes[url]


def install(monkeypatch, routes):
    fake = FakeHttp(routes)
    monkeypatch.setattr(http, "get", fake.get)
    monkeypatch.setattr(http, "post", fake.post)
    return fake


def test_download_file_kind(monkeypatch, tmp_path, manifest):
    e = entry(manifest, "seoul-geumcheon")
    csv_bytes = (FIX / "seoul-geumcheon__15162774.csv").read_bytes()
    fake = install(monkeypatch, {
        "https://www.data.go.kr/data/15162774/fileData.do":
            b'<input type="hidden" name="publicDataDetailPk" value="uddi:abc-123" />',
        portal.META_URL: json.dumps({"fileDataRegistVO": {"atchFileId": "FILE_000000007648946"}}).encode(),
        "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000007648946": csv_bytes,
    })
    paths = portal.download(e, tmp_path, Failures())
    assert [p.name for p in paths] == ["seoul-geumcheon__15162774.csv"]
    assert paths[0].read_bytes() == csv_bytes
    assert [c[0] for c in fake.calls] == ["GET", "POST", "GET"]
    assert len(portal.normalize(e, paths[0], collected_at=TODAY)) == 2


def test_download_file_kind_with_extra_files(monkeypatch, tmp_path, manifest):
    e = entry(manifest, "incheon-michuhol")
    body = (FIX / "ulsan-dong__3076787.csv").read_bytes()
    install(monkeypatch, {
        "https://www.data.go.kr/data/": b'name="publicDataDetailPk" value="uddi:x-1"',
        portal.META_URL: json.dumps({"fileDataRegistVO": {"atchFileId": "FILE_1"}}).encode(),
        "https://www.data.go.kr/cmm/cmm/fileDownload.do": body,
    })
    paths = portal.download(e, tmp_path, Failures())
    assert sorted(p.name for p in paths) == ["incheon-michuhol__15099941.csv", "incheon-michuhol__15099948.csv"]


def test_download_link_kind_follows_select_link_url(monkeypatch, tmp_path, manifest):
    e = entry(manifest, "seoul-mapo")
    csv_bytes = (FIX / "seoul-mapo__15037729.csv").read_bytes()
    origin = "http://www.mapo.go.kr/site/main/openData/view?dataId=58"
    page = ('<a href="/site/main/file/download/uu/aaa"><button class="btn_small">EXCEL</button></a>'
            '<a href="/site/main/file/download/uu/bbb"><button class="btn_small">CSV</button></a>')
    fake = install(monkeypatch, {
        "https://www.data.go.kr/tcs/dss/selectLinkUrl.do?publicDataPk=15037729":
            json.dumps({"linkUrl": origin, "status": True}).encode(),
        origin: page.encode(),
        "http://www.mapo.go.kr/site/main/file/download/uu/bbb": csv_bytes,
    })
    paths = portal.download(e, tmp_path, Failures())
    assert paths[0].name == "seoul-mapo__15037729.csv" and paths[0].read_bytes() == csv_bytes
    assert ("GET", "http://www.mapo.go.kr/site/main/file/download/uu/bbb") in fake.calls
    assert len(portal.normalize(e, paths[0], collected_at=TODAY)) == 2


def test_download_link_html_table(monkeypatch, tmp_path, manifest):
    e = entry(manifest, "seoul-gwangjin")
    html = (FIX / "seoul-gwangjin__15037963.html").read_bytes()
    install(monkeypatch, {
        "https://www.data.go.kr/tcs/dss/selectLinkUrl.do":
            json.dumps({"linkUrl": e["url"], "status": True}).encode(),
        e["url"]: html,
    })
    paths = portal.download(e, tmp_path, Failures())
    assert paths[0].suffix == ".html"


def test_download_link_bot_block_is_recorded(monkeypatch, tmp_path, manifest):
    e = entry(manifest, "daegu-jung")
    js = b"<html><script>document.cookie = 'sabSignature=ABC';\nwindow.location.reload();\n</script></html>"
    install(monkeypatch, {
        "https://www.data.go.kr/tcs/dss/selectLinkUrl.do": json.dumps({"linkUrl": e["url"]}).encode(),
        e["url"]: js,
    })
    f = Failures()
    with pytest.raises(portal.PortalError):
        portal.download(e, tmp_path, f)
    assert "bot_block" in {i["reason"] for i in f.items}
    assert not list(tmp_path.glob("*"))


def test_download_api_kind(monkeypatch, tmp_path, manifest):
    e = entry(manifest, "daejeon-seo")
    body = (FIX / "daejeon-seo__15128300.json").read_bytes()
    page2 = json.dumps({"response": {"body": {"totalCnt": 197, "items": []}}}).encode()
    fake = install(monkeypatch, {e["url"] + "?pageNo=1&numOfRows=1000": body,
                                 e["url"] + "?pageNo=2&numOfRows=1000": page2})
    paths = portal.download(e, tmp_path, Failures())
    assert paths[0].name == "daejeon-seo__15128300.json"
    saved = json.loads(paths[0].read_text(encoding="utf-8"))
    assert len(saved["items"]) == 3 and saved["totalCnt"] == 197
    # 합계(197)보다 적게 오면 다음 쪽을 요청하고, 빈 쪽이 오면 멈춘다
    assert [c[1][-20:] for c in fake.calls] == ["pageNo=1&numOfRows=1000"[-20:], "pageNo=2&numOfRows=1000"[-20:]]


def test_download_api_falls_back_to_file(monkeypatch, tmp_path, manifest):
    e = entry(manifest, "daejeon-seo")

    def boom(url, **kw):
        if "seoguAPI" in url:
            raise OSError("api down")
        if url.endswith("fileData.do"):
            return b'name="publicDataDetailPk" value="uddi:q-1"'
        return b"x" * 200

    monkeypatch.setattr(http, "get", boom)
    monkeypatch.setattr(http, "post", lambda url, data=None, **kw: json.dumps(
        {"fileDataRegistVO": {"atchFileId": "FILE_9"}}).encode())
    f = Failures()
    paths = portal.download(e, tmp_path, f)
    assert paths[0].name == "daejeon-seo__3072105.csv"
    assert "api_fallback_to_file" in {i["reason"] for i in f.items}


# ---------------------------------------------------------------- collect_all

def test_collect_all_continues_after_a_failure(monkeypatch, tmp_path, manifest):
    good = entry(manifest, "ulsan-dong")
    bad = entry(manifest, "seoul-eunpyeong")
    blocked = entry(manifest, "seoul-gwangjin")

    def fake_download(e, raw_dir, failures):
        if e["key"] == "seoul-eunpyeong":
            raise RuntimeError("boom")
        if e["key"] == "seoul-gwangjin":
            raise http.RobotsBlocked(e["url"])
        return [FIX / "ulsan-dong__3076787.csv"]

    monkeypatch.setattr(portal, "download", fake_download)
    f = Failures()
    rows = portal.collect_all(f, raw_dir=tmp_path, collected_at=TODAY, manifest=[bad, blocked, good])
    assert len(rows) == 2 and rows[0]["title"] == "사교댄스(초급)"
    reasons = [(i["reason"], i["detail"]) for i in f.items]
    assert len(reasons) == 1 and reasons[0][0] == "entry_failed" and "seoul-eunpyeong" in reasons[0][1]
