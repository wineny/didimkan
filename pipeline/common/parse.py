"""원문 파서: 날짜·시각·요일·수강료·시도/시군구·id. build_db.py(kakao-mcp 공모전)에서 개작."""
import csv
import hashlib
import re
from datetime import date
from pathlib import Path

WEEKDAYS = "월화수목금토일"
DATE_RE = re.compile(r"^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})$")
TIME_RE = re.compile(r"^(\d{1,2})[:시]?(\d{0,2})")

SIDO_FULL = [
    "서울특별시", "부산광역시", "대구광역시", "인천광역시", "대전광역시",
    "울산광역시", "세종특별자치시", "경기도", "강원특별자치도", "충청북도", "충청남도",
    "전북특별자치도", "전남광주통합특별시", "경상북도", "경상남도", "제주특별자치도",
]  # 2026-07-01 광주광역시+전라남도 → 전남광주통합특별시(약칭 광주특별시). 대전충남은 통합 안 됨(2026-10-10 확인)
_SIDO_EXTRA = {  # 구 명칭·긴 약칭
    "강원도": "강원특별자치도", "전라북도": "전북특별자치도", "제주도": "제주특별자치도",
    "세종시": "세종특별자치시", "세종특별시": "세종특별자치시",
    "충북": "충청북도", "충남": "충청남도", "전북": "전북특별자치도", "전남": "전남광주통합특별시",
    "경북": "경상북도", "경남": "경상남도",
    "광주광역시": "전남광주통합특별시", "전라남도": "전남광주통합특별시", "광주특별시": "전남광주통합특별시",
    "전남광주": "전남광주통합특별시", "광주전남통합특별시": "전남광주통합특별시",
}
SIDO_MAP: dict[str, str] = {
    **{"서울": "서울특별시", "부산": "부산광역시", "대구": "대구광역시", "인천": "인천광역시",
       "광주": "전남광주통합특별시", "대전": "대전광역시", "울산": "울산광역시", "세종": "세종특별자치시",
       "경기": "경기도", "강원": "강원특별자치도", "충북": "충청북도", "충남": "충청남도",
       "전북": "전북특별자치도", "전남": "전남광주통합특별시", "경북": "경상북도", "경남": "경상남도",
       "제주": "제주특별자치도"},
    **_SIDO_EXTRA,
    **{full: full for full in SIDO_FULL},
}

_SEOUL_GU_STEMS = [
    "강남", "강동", "강북", "강서", "관악", "광진", "구로", "금천", "노원", "도봉", "동대문",
    "동작", "마포", "서대문", "서초", "성동", "성북", "송파", "양천", "영등포", "용산", "은평",
    "종로", "중랑",
]
SIGUNGU_FIX = {stem: stem + "구" for stem in _SEOUL_GU_STEMS}


def parse_date(raw: str) -> str | None:
    """YYYY-MM-DD ISO 문자열로 정규화. 실패 시 None."""
    if not raw:
        return None
    m = DATE_RE.match(raw.strip())
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return None


def parse_time(raw: str) -> str | None:
    """HH:MM 정규화. 실패 시 None."""
    if not raw:
        return None
    m = TIME_RE.match(raw.strip())
    if not m:
        return None
    h = int(m.group(1))
    mi = int(m.group(2)) if m.group(2) else 0
    if not (0 <= h <= 24 and 0 <= mi <= 59):
        return None
    return f"{h:02d}:{mi:02d}"


def parse_weekdays(raw: str) -> str:
    """운영요일 원문 → '월,수,금'. 범위(월~금)·매일·평일·주말 지원. 없으면 ''."""
    if not raw:
        return ""
    text = raw.strip()
    if "매일" in text:
        return ",".join(WEEKDAYS)
    text = re.sub(r"[요용묘]일", "", text)
    text = text.replace("평일", "월,화,수,목,금").replace("주말", "토,일")
    found: list[str] = []
    range_m = re.search(rf"([{WEEKDAYS}])\s*[~∼-]\s*([{WEEKDAYS}])", text)
    if range_m:
        a, b = WEEKDAYS.index(range_m.group(1)), WEEKDAYS.index(range_m.group(2))
        if a <= b:
            found.extend(WEEKDAYS[a : b + 1])
        else:
            found.extend(WEEKDAYS[a:] + WEEKDAYS[: b + 1])
        text = text[: range_m.start()] + text[range_m.end() :]
    for ch in text:
        if ch in WEEKDAYS and ch not in found:
            found.append(ch)
    return ",".join(sorted(found, key=WEEKDAYS.index))


def weekday_bits(days: str) -> int:
    bits = 0
    for d in days.split(","):
        if d and d in WEEKDAYS:
            bits |= 1 << WEEKDAYS.index(d)
    return bits


def time_bucket(start_hhmm: str | None) -> str | None:
    if not start_hhmm:
        return None
    h = int(start_hhmm[:2])
    if h < 12:
        return "오전"
    if h < 18:
        return "오후"
    return "저녁"


def parse_fee(raw: str | None) -> tuple[int | None, int, str | None]:
    """수강료 원문 → (금액 원, 무료 0/1, 기간 '월'|'총'|None). 파싱 불가 (None, 0, None)."""
    if raw is None:
        return None, 0, None
    text = raw.strip()
    if text in ("0", "무료", "무상"):
        return 0, 1, None
    digits = re.sub(r"[^\d]", "", text)
    if not digits:
        return None, 0, None
    fee = int(digits)
    if fee == 0:
        return 0, 1, None
    return fee, 0, "월" if re.search(r"월|매달", text) else "총"


def normalize_sido(raw: str | None) -> str | None:
    """시도 약칭·구명칭 → 공식 전체 명칭. 모르는 값은 원문 그대로(호출자가 실패 기록). 빈 값은 None(계약: NULL)."""
    if raw is None or not raw.strip():
        return None
    key = re.sub(r"\s+", "", raw)
    return SIDO_MAP.get(key, raw)


def normalize_sigungu(raw: str | None) -> str | None:
    """공백 제거. 접미사 없는 값은 보정 표(서울 구)에 있을 때만 보정. 빈 값은 None(계약: NULL)."""
    if raw is None or not raw.strip():
        return None
    s = re.sub(r"\s+", "", raw)
    return SIGUNGU_FIX.get(s, s)


def norm_key(s: str | None) -> str:
    """공백·특수문자 제거 + 소문자 (id·중복 비교용)."""
    return re.sub(r"[\W_]+", "", (s or "").lower())


def make_id(title, institution, start_date, start_time, venue) -> str:
    key = "|".join(
        [norm_key(title), norm_key(institution), start_date or "", start_time or "", norm_key(venue)]
    )
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def decode_bytes(data: bytes) -> tuple[str, str]:
    for enc in ("utf-8-sig", "cp949"):
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("both", data, 0, 1, "utf-8-sig/cp949 모두 실패")


def read_csv_rows(path: Path) -> tuple[list[dict[str, str]], str]:
    text, enc = decode_bytes(Path(path).read_bytes())
    return list(csv.DictReader(text.splitlines())), enc
