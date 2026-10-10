import pytest

from pipeline.common import parse as p


@pytest.mark.parametrize("raw,exp", [
    ("2026-07-15", "2026-07-15"), ("20260715", "2026-07-15"), ("2026.7.5", "2026-07-05"),
    ("2026/07/15", "2026-07-15"), (" 2026-7-15 ", "2026-07-15"),
    ("2026-02-30", None), ("", None), ("내일", None),
])
def test_parse_date(raw, exp):
    assert p.parse_date(raw) == exp


@pytest.mark.parametrize("raw,exp", [
    ("09:30", "09:30"), ("9:5", "09:05"), ("14시", "14:00"), ("18:30", "18:30"),
    ("", None), ("25:00", None), ("abc", None),
])
def test_parse_time(raw, exp):
    assert p.parse_time(raw) == exp


@pytest.mark.parametrize("raw,exp", [
    ("월,수", "월,수"), ("월~금", "월,화,수,목,금"), ("매주 화요일", "화"),
    ("월요일", "월"), ("매일", "월,화,수,목,금,토,일"), ("주말", "토,일"), ("", ""),
    ("금~월", "월,금,토,일"),
])
def test_parse_weekdays(raw, exp):
    assert p.parse_weekdays(raw) == exp


def test_weekday_bits():
    assert p.weekday_bits("월,수") == 0b101
    assert p.weekday_bits("") == 0
    assert p.weekday_bits("일") == 1 << 6


@pytest.mark.parametrize("t,exp", [
    ("11:59", "오전"), ("12:00", "오후"), ("17:59", "오후"),
    ("18:00", "저녁"), ("00:00", "오전"), (None, None),
])
def test_time_bucket(t, exp):
    assert p.time_bucket(t) == exp


@pytest.mark.parametrize("raw,exp", [
    ("월 18,000원", (18000, 0, "월")), ("무료", (0, 1, None)), ("30,000원", (30000, 0, "총")),
    ("0", (0, 1, None)), ("문의", (None, 0, None)), ("", (None, 0, None)),
    ("0원", (0, 1, None)),
])
def test_parse_fee(raw, exp):
    assert p.parse_fee(raw) == exp


def test_sido_all_16():
    # 2026-07-01 광주광역시+전라남도 → 전남광주통합특별시 (16개 시도)
    assert len(p.SIDO_FULL) == 16
    abbr = ["서울", "부산", "대구", "인천", "대전", "울산", "세종", "경기", "강원",
            "충북", "충남", "전북", "전남", "경북", "경남", "제주"]
    assert [p.normalize_sido(a) for a in abbr] == p.SIDO_FULL
    for full in p.SIDO_FULL:
        assert p.normalize_sido(full) == full
    assert p.normalize_sido("서울 특별시") == "서울특별시"
    for old in ["광주", "광주광역시", "광주특별시", "전남", "전라남도"]:
        assert p.normalize_sido(old) == "전남광주통합특별시"
    assert p.normalize_sido("대전충남통합특별시") == "대전충남통합특별시"  # 통합 안 됨 → 원문 유지(호출자가 기록)
    assert p.normalize_sido("전라북도") == "전북특별자치도"


def test_sido_unknown_kept():
    assert p.normalize_sido("전남광주통합특별시") == "전남광주통합특별시"


def test_sigungu():
    assert p.normalize_sigungu("강남") == "강남구"
    assert p.normalize_sigungu(" 강남 구 ") == "강남구"
    assert p.normalize_sigungu("수원시") == "수원시"
    assert p.normalize_sigungu("용인") == "용인"


def test_make_id():
    a = p.make_id("요가 교실", "강남구청", "2026-10-01", "10:00", "2층 강의실")
    assert a == p.make_id("요가  교실!", "강남 구청", "2026-10-01", "10:00", "2층 강의실")
    assert len(a) == 16
    assert a != p.make_id("필라테스", "강남구청", "2026-10-01", "10:00", "2층 강의실")
    assert a != p.make_id("요가 교실", "강남구청", "2026-10-02", "10:00", "2층 강의실")


def test_norm_key():
    assert p.norm_key(" AbC-가 나_! ") == "abc가나"
    assert p.norm_key(None) == ""


def test_decode_bytes_cp949():
    text, enc = p.decode_bytes("강좌명".encode("cp949"))
    assert text == "강좌명" and enc == "cp949"


# ---------- 링크 주소(http/https 만) ----------

def test_safe_http_url_blocks_javascript():
    assert p.safe_http_url("javascript:;") is None
    assert p.safe_http_url("JavaScript:alert(1)") is None


def test_safe_http_url_adds_https_to_www():
    assert p.safe_http_url(" www.x.go.kr ") == "https://www.x.go.kr"
    assert p.safe_http_url("http://a.go.kr/p?q=1") == "http://a.go.kr/p?q=1"


def test_safe_http_url_blocks_data_and_empty():
    assert p.safe_http_url("data:text/html,<b>x</b>") is None
    assert p.safe_http_url("") is None
    assert p.safe_http_url("   ") is None
    assert p.safe_http_url(None) is None
    assert p.safe_http_url("https://") is None
