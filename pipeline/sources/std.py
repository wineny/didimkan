"""소스1: 공공데이터포털 전국평생학습강좌표준데이터(#15013110) 348파일 수집·정규화.

흐름: fetch_catalog(uddi 전량) → download(CSV 원본 저장) → normalize(파일 → courses dict 목록).
레시피는 kakao-mcp-공모전/scripts/download_courses.py·build_db.py 에서 개작했다.
파일 간 중복 id 처리는 build.py 몫이라 여기서는 그대로 돌려준다.
"""
import json
import re
from html.parser import HTMLParser
from pathlib import Path

from pipeline.common import http
from pipeline.common.failures import Failures
from pipeline.common.parse import (
    SIDO_FULL, make_id, normalize_sido, normalize_sigungu, parse_date, parse_fee, parse_time,
    parse_weekdays, read_csv_rows, time_bucket, weekday_bits,
)

SOURCE = "std"
PUBLIC_DATA_PK = "15013110"
DATASET_URL = f"https://www.data.go.kr/data/{PUBLIC_DATA_PK}/standard.do"
CATALOG_URL = f"https://www.data.go.kr/tcs/dss/selectStdDataDetailView.do?publicDataPk={PUBLIC_DATA_PK}"
CATALOG_LIST_URL = "https://www.data.go.kr/tcs/dss/selectStdDataDetailView.do"  # 쪽 이동은 POST(pageIndex), 쪽당 5건
META_URL = (
    "https://www.data.go.kr/tcs/dss/selectFileDataDownload.do"
    "?publicDataPk={pk}&publicDataDetailPk={uddi}&fileDetailSn=1"
)
FILE_URL = "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId={atch}&fileDetailSn=1"
RAW_DIR = Path(__file__).resolve().parent.parent / "raw" / "std"
MAX_PAGES = 200
MIN_FILE_BYTES = 100

EXPECTED_COLS = [
    "강좌명", "강사명", "교육시작일자", "교육종료일자", "교육시작시각", "교육종료시각",
    "강좌내용", "교육대상구분", "교육방법구분", "운영요일", "교육장소", "강좌정원수",
    "수강료", "교육장도로명주소", "운영기관명", "운영기관전화번호", "접수시작일자",
    "접수종료일자", "접수방법구분", "선정방법구분", "홈페이지주소",
    "직업능력개발훈련비지원강좌여부", "학점은행제평가(학점)인정여부",
    "평생학습계좌제평가인정여부", "데이터기준일자",
]
COURSE_KEYS = [
    "id", "source", "source_file", "source_url", "detail_url", "collected_at", "data_date",
    "title", "description", "institution", "institution_phone", "sido", "sigungu", "dong",
    "venue", "address", "start_date", "end_date", "start_time", "end_time", "weekdays_raw",
    "weekdays", "weekday_bits", "time_bucket", "capacity", "fee_raw", "fee_won", "fee_period",
    "is_free", "is_online", "target_raw", "apply_start", "apply_end", "apply_method",
    "selection_method", "is_always_open", "homepage_url", "lat", "lng", "is_dong_center",
    "category", "stair", "stair_reason", "signals", "term_days", "sessions_per_week",
]
SIDO_SUFFIXES = ("특별시", "광역시", "특별자치시", "특별자치도", "도")
ALWAYS_RE = re.compile(r"상시|수시|연중")
ONLINE_RE = re.compile(r"온라인|비대면|원격|사이버")
ALWAYS_OPEN_ENDS = {"2099-12-31", "9999-12-31"}
UDDI_RE = re.compile(r"uddi:[0-9a-fA-F-]{36}(?:_\d+)?")
BADGE_RE = re.compile(r"^(?:(?:파일데이터|오픈API|링크)\s*)+")  # 목록 칸의 유형 배지 글자
DATE_IN_TEXT = re.compile(r"\d{4}[-./]\d{1,2}[-./]\d{1,2}")
DONG_RE = re.compile(r"([가-힣]{1,6}?\d?동)(?=주민센터|행정복지|자치|복지|문화|청사|[^가-힣]|$)")
DONG_STOP = {"공동", "이동", "운동", "활동", "자동", "행동", "수동", "연동", "합동", "협동", "미동"}
_TIME_BUCKET_KO = {"morning": "오전", "afternoon": "오후", "evening": "저녁",
                   "오전": "오전", "오후": "오후", "저녁": "저녁"}


class StdCatalogError(RuntimeError):
    pass


# ---------------------------------------------------------------- 카탈로그

class _RowParser(HTMLParser):
    """<tr> 단위로 셀 텍스트와 속성값 전체를 모은다."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[dict] = []
        self._row: dict | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "tr":
            self._row = {"cells": [], "attrs": []}
        if self._row is not None:
            self._row["attrs"].extend(v for _, v in attrs if v)
            if tag in ("td", "th"):
                self._cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row["cells"].append(re.sub(r"\s+", " ", "".join(self._cell)).strip())
            self._cell = None
        if tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def parse_catalog_page(html: str) -> list[dict]:
    """한 페이지 HTML → [{uddi, name, org, update_date}]. uddi 가 없는 행은 버린다."""
    parser = _RowParser()
    parser.feed(html)
    found: list[dict] = []
    for row in parser.rows:
        blob = " ".join(row["attrs"] + row["cells"])
        m = UDDI_RE.search(blob)
        if not m:
            continue
        cells = [c for c in row["cells"] if c and not c.isdigit()]
        date_m = DATE_IN_TEXT.search(" ".join(row["cells"]))
        text_cells = [c for c in cells if not DATE_IN_TEXT.fullmatch(c)]
        found.append({
            "uddi": m.group(0),
            "name": BADGE_RE.sub("", text_cells[0]) if text_cells else "",
            "org": text_cells[1] if len(text_cells) > 1 else "",
            "update_date": parse_date(date_m.group(0)) if date_m else None,
        })
    return found


def fetch_catalog(failures: Failures | None = None, *, raw_dir: Path = RAW_DIR,
                  refresh: bool = False) -> list[dict]:
    """「표준데이터 목록」을 페이지 순회해 uddi 전량을 모은다. raw_dir/catalog.json 에 캐시.

    쪽 이동은 POST pageIndex(쪽당 5건, 2026-10-10 실페이지 확인). 0건이면 오류.
    """
    cache = Path(raw_dir) / "catalog.json"
    if cache.exists() and not refresh:
        cached = json.loads(cache.read_text(encoding="utf-8"))
        for it in cached:
            it["name"] = BADGE_RE.sub("", it.get("name", ""))
        cache.write_text(json.dumps(cached, ensure_ascii=False, indent=2), encoding="utf-8")
        return cached
    seen: dict[str, dict] = {}
    for page in range(1, MAX_PAGES + 1):
        html = http.post(CATALOG_LIST_URL, {"pageIndex": str(page), "publicDataPk": PUBLIC_DATA_PK, "searchKeyword2": ""},
                         referer=DATASET_URL, source=SOURCE, failures=failures).decode(
            "utf-8", errors="replace")
        new = [it for it in parse_catalog_page(html) if it["uddi"] not in seen]
        if not new:
            break
        for it in new:
            seen[it["uddi"]] = it
    catalog = list(seen.values())
    if not catalog:
        raise StdCatalogError(
            "표준데이터 목록에서 uddi 를 한 건도 찾지 못했다. 페이지 구조/파라미터 확인 필요: " + CATALOG_URL)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    return catalog


# ---------------------------------------------------------------- 다운로드

def safe_name(name: str) -> str:
    return re.sub(r'[/\\:*?"<>|]', "_", name)


def download(catalog: list[dict], raw_dir: Path = RAW_DIR,
             failures: Failures | None = None) -> list[Path]:
    """카탈로그 항목마다 CSV 를 raw_dir 에 저장한다. 이미 있으면 스킵, 실패는 기록 후 계속."""
    raw_dir = Path(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for item in catalog:
        name = item.get("name") or item["uddi"]
        out = raw_dir / f"{safe_name(name)}.csv"
        if out.exists() and out.stat().st_size > MIN_FILE_BYTES:
            paths.append(out)
            continue
        meta_url = META_URL.format(pk=PUBLIC_DATA_PK, uddi=item["uddi"])
        try:
            meta = json.loads(http.get(meta_url, referer=DATASET_URL, source=SOURCE, failures=failures))
            atch = meta["fileDataRegistVO"]["atchFileId"]
            data = http.get(FILE_URL.format(atch=atch), referer=DATASET_URL, timeout=60,
                            source=SOURCE, failures=failures)
            if len(data) <= MIN_FILE_BYTES:
                raise ValueError(f"응답이 너무 작음: {len(data)} bytes")
        except Exception as e:  # noqa: BLE001 - 한 파일 실패가 전체를 막지 않게
            if failures is not None:
                failures.add(SOURCE, "download_error", meta_url, repr(e))
            continue
        out.write_bytes(data)
        paths.append(out)
    return paths


# ---------------------------------------------------------------- 정규화

def region_from_filename(stem: str) -> tuple[str, str]:
    """파일명 → (시도, 시군구). 교육청 파일은 시군구 ''."""
    parts = BADGE_RE.sub("", stem).replace("_평생학습강좌", "").split("_")
    first = parts[0]
    if first.endswith("교육청"):
        return first[: -len("교육청")], ""
    if first.endswith(SIDO_SUFFIXES):
        return first, parts[1] if len(parts) > 1 else ""
    return "", ""


def _region(stem: str, address: str) -> tuple[str | None, str | None]:
    sido, sigungu = region_from_filename(stem)
    tokens = address.split()
    if not sido and tokens:
        cand = normalize_sido(tokens[0])
        if cand.endswith(SIDO_SUFFIXES):
            sido = cand
    if not sigungu and len(tokens) > 1 and tokens[1].endswith(("시", "군", "구")):
        sigungu = tokens[1]
    return (normalize_sido(sido) or None, normalize_sigungu(sigungu) or None)


def extract_dong(*texts: str) -> str | None:
    for text in texts:
        for m in DONG_RE.finditer(text or ""):
            if m.group(1) not in DONG_STOP:
                return m.group(1)
    return None


def _to_int(raw: str) -> int | None:
    digits = re.sub(r"[^\d]", "", raw or "")
    return int(digits) if digits else None


def _is_always_open(method: str, start: str | None, end: str | None, raw_dates: str) -> int:
    if ALWAYS_RE.search(method) or ALWAYS_RE.search(raw_dates):
        return 1
    if end in ALWAYS_OPEN_ENDS:
        return 1
    # contract §5: 접수 기간이 한 해 전체(1/1 ~ 12/31)면 상시
    if start and end and start[:4] == end[:4] and start[5:] == "01-01" and end[5:] == "12-31":
        return 1
    return 0


def _selection(raw: str) -> str | None:
    if "추첨" in raw:
        return "추첨"
    if "선착순" in raw:
        return "선착순"
    return None


def normalize(path: Path, *, collected_at: str, failures: Failures | None = None) -> list[dict]:
    """CSV 한 파일 → courses 컬럼 키 dict 목록. 파생 컬럼은 None/기본값으로 둔다(derive.py 몫)."""
    path = Path(path)
    rows, _enc = read_csv_rows(path)
    stem = path.stem
    if rows:
        header = {(k or "").replace("﻿", "").strip() for k in rows[0]}
        missing = [c for c in EXPECTED_COLS if c not in header]
        if missing and failures is not None:
            failures.add(SOURCE, "schema_mismatch", str(path), "없는 컬럼: " + ",".join(missing))
    out: list[dict] = []
    unknown_sido: set[str] = set()
    for raw in rows:
        r = {(k or "").replace("﻿", "").strip(): (v or "").strip()
             for k, v in raw.items() if k is not None}
        title = r.get("강좌명", "")
        if not title:
            continue
        address = r.get("교육장도로명주소", "")
        institution = r.get("운영기관명", "")
        venue = r.get("교육장소", "")
        start_date = parse_date(r.get("교육시작일자", ""))
        start_time = parse_time(r.get("교육시작시각", ""))
        apply_start = parse_date(r.get("접수시작일자", ""))
        apply_end = parse_date(r.get("접수종료일자", ""))
        method = r.get("접수방법구분", "")
        days_raw = r.get("운영요일", "")
        days = parse_weekdays(days_raw)
        fee_raw = r.get("수강료", "")
        fee_won, is_free, fee_period = parse_fee(fee_raw) if fee_raw else (None, 0, None)
        sido, sigungu = _region(stem, address)
        if sido and sido not in SIDO_FULL and sido not in unknown_sido:
            unknown_sido.add(sido)
            if failures is not None:
                failures.add(SOURCE, "unknown_sido", str(path), sido)
        bucket = time_bucket(start_time)
        homepage = r.get("홈페이지주소") or None
        row = dict.fromkeys(COURSE_KEYS)
        row.update({
            "id": make_id(title, institution, start_date, start_time, venue),
            "source": SOURCE,
            "source_file": path.name,
            "source_url": DATASET_URL,
            "detail_url": homepage,
            "collected_at": collected_at,
            "data_date": parse_date(r.get("데이터기준일자", "")),
            "title": title,
            "description": r.get("강좌내용") or None,
            "institution": institution or None,
            "institution_phone": r.get("운영기관전화번호") or None,
            "sido": sido,
            "sigungu": sigungu,
            "dong": extract_dong(venue, institution),
            "venue": venue or None,
            "address": address or None,
            "start_date": start_date,
            "end_date": parse_date(r.get("교육종료일자", "")),
            "start_time": start_time,
            "end_time": parse_time(r.get("교육종료시각", "")),
            "weekdays_raw": days_raw or None,
            "weekdays": days or None,
            "weekday_bits": weekday_bits(days),
            "time_bucket": _TIME_BUCKET_KO.get(bucket) if bucket else None,
            "capacity": _to_int(r.get("강좌정원수", "")),
            "fee_raw": fee_raw or None,
            "fee_won": fee_won,
            "fee_period": fee_period,
            "is_free": is_free,
            "is_online": 1 if ONLINE_RE.search(r.get("교육방법구분", "")) else 0,
            "target_raw": r.get("교육대상구분") or None,
            "apply_start": apply_start,
            "apply_end": apply_end,
            "apply_method": method or None,
            "selection_method": _selection(r.get("선정방법구분", "")),
            "is_always_open": _is_always_open(
                method, apply_start, apply_end,
                r.get("접수시작일자", "") + r.get("접수종료일자", "")),
            "homepage_url": homepage,
            "is_dong_center": 0,
            "signals": "[]",
        })
        out.append(row)
    return out
