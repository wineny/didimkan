"""소스2: 공공데이터포털 지자체 개별 파일 32곳 수집·정규화.

흐름: load_manifest → download(entry) → normalize(entry, path) → collect_all.
매니페스트(portal_manifest.json)가 곳마다 형태(file|link|api)·컬럼 매핑·필터를 가진다.
파일 이름은 `{key}__{데이터셋pk}.{csv|html|json}` 이고, normalize 는 이 이름에서 pk 를 읽는다.
파생 컬럼(분야·계단·신호 등)은 비워 둔다. derive.py 몫이다.
"""
import json
import re
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

from pipeline.common import http
from pipeline.common.failures import Failures
from pipeline.common.parse import (
    decode_bytes, make_id, normalize_sido, normalize_sigungu, parse_date, parse_fee,
    parse_time, parse_weekdays, time_bucket, weekday_bits,
)
from pipeline.sources.std import extract_dong

SOURCE = "portal"
MANIFEST_PATH = Path(__file__).resolve().parent / "portal_manifest.json"
RAW_DIR = Path(__file__).resolve().parent.parent / "raw" / "portal"

DETAIL_PAGE = "https://www.data.go.kr/data/{pk}/fileData.do"
FILE_DATASET_URL = "https://www.data.go.kr/data/{pk}/fileData.do"
API_DATASET_URL = "https://www.data.go.kr/data/{pk}/openapi.do"
META_URL = "https://www.data.go.kr/tcs/dss/selectFileDataDownload.do"
LINK_URL = "https://www.data.go.kr/tcs/dss/selectLinkUrl.do?publicDataPk={pk}"
FILE_URL = "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId={atch}&fileDetailSn=1"
MIN_FILE_BYTES = 100
MAX_API_PAGES = 50

KINDS = {"file", "link", "api"}
LINK_RESOLVERS = {"csv_button", "href_type_csv", "direct_csv", "html_table"}

# 조사에서 제외하기로 한 데이터셋. 매니페스트에 들어 있으면 load_manifest 가 거부한다.
EXCLUDED_SUMMARY_PKS = {  # 동별 요약형(강좌명 나열만, 요일·시간 없음): 서대문·거제·남해
    "3080296", "15055508", "15101082",
}
EXCLUDED_STALE_PKS = {  # 기준일 2024년 이전: 동대문·성동·성북·송파·예산(구)·광산
    "15037715", "15037707", "15037787", "15037769", "15040791", "15087001",
}
EXCLUDED_PKS = EXCLUDED_SUMMARY_PKS | EXCLUDED_STALE_PKS

COURSE_KEYS = [
    "id", "source", "source_file", "source_url", "detail_url", "collected_at", "data_date",
    "title", "description", "institution", "institution_phone", "sido", "sigungu", "dong",
    "venue", "address", "start_date", "end_date", "start_time", "end_time", "weekdays_raw",
    "weekdays", "weekday_bits", "time_bucket", "capacity", "fee_raw", "fee_won", "fee_period",
    "is_free", "is_online", "target_raw", "apply_start", "apply_end", "apply_method",
    "selection_method", "is_always_open", "homepage_url", "lat", "lng", "is_dong_center",
    "category", "stair", "stair_reason", "signals", "term_days", "sessions_per_week",
]
# column_map 값(대상 이름)으로 쓸 수 있는 것. 합성 칸(*_range, day_time, contact, detail_text)은 여러 컬럼을 채운다.
TARGETS = {
    "title", "dong", "institution", "institution_phone", "venue", "address", "description",
    "target_raw", "capacity", "fee_raw", "fee_raw_month", "weekdays_raw", "time_range",
    "day_time", "start_time", "end_time", "date_range", "start_date", "end_date",
    "apply_range", "apply_start", "apply_end", "apply_method", "selection_method",
    "data_date", "contact", "detail_text",
}
# 헤더를 확인하지 못한 곳(column_map 이 비어 있음)에서 헤더 이름으로 짐작하는 규칙.
AUTO_ALIASES = [
    (r"^(강좌명|프로그램명|강의명|과정명)$", "title"),
    (r"^(동명|행정동|읍면동|동)$", "dong"),
    (r"요일", "weekdays_raw"),
    (r"시작시[각간]", "start_time"),
    (r"종료시[각간]", "end_time"),
    (r"(운영|강의|교육|강좌)?시간$", "time_range"),
    (r"장소|강의실", "venue"),
    (r"수강료|강좌료|금액|비용|이용료", "fee_raw"),
    (r"정원|모집인원", "capacity"),
    (r"대상", "target_raw"),
    (r"전화|연락처|문의", "institution_phone"),
    (r"기준일", "data_date"),
]

ALWAYS_RE = re.compile(r"상시|수시|연중")
DATE_IN_TEXT = re.compile(r"\d{4}[-./]\d{1,2}[-./]\d{1,2}|(?<!\d)\d{8}(?!\d)")
TIME_RANGE_RE = re.compile(
    r"(\d{1,2})\s*(?:[:시]\s*(\d{2})?\s*분?)?\s*(?:부터)?\s*[~∼～\-–]\s*"
    r"(\d{1,2})\s*(?:[:시]\s*(\d{2})?\s*분?)?"
)
EXCEPT_RE = re.compile(r"(?:\S+\s*및\s*)?\S+\s*제외")
MONTHLY_RE = re.compile(r"(?<!\d)1개월|매월|매달|/\s*월|\(월\)|(?<![개\d])월\s*\d|월\s*수강료|월\s*회비")
PHONE_RE = re.compile(r"\d{2,4}-\d{3,4}-\d{4}")
DETAIL_PLACE_RE = re.compile(r"(?:강의실|장소)\s*[:：]\s*([^,]+)")
FREE_WORDS = re.compile(r"무료|무상")
EUPMYEON_RE = re.compile(r"([가-힣]{1,6}[읍면])(?=[^가-힣]|주민|행정|사무|복지|$)")


class PortalError(RuntimeError):
    pass


# ---------------------------------------------------------------- 매니페스트

def load_manifest(path: Path = MANIFEST_PATH) -> list[dict]:
    entries = json.loads(Path(path).read_text(encoding="utf-8"))
    for e in entries:
        pks = {e["public_data_pk"]} | {x["public_data_pk"] for x in e.get("extra_files", [])}
        bad = pks & EXCLUDED_PKS
        if bad:
            raise ValueError(f"제외 대상 데이터셋이 매니페스트에 있음: {e['key']} {sorted(bad)}")
    return entries


def _spec_for(entry: dict, pk: str) -> dict:
    """pk 에 해당하는 파일 사양(column_map·header_fixes·filters). 추가 파일은 빠진 값을 본 항목에서 물려받는다."""
    base = {k: entry.get(k) for k in ("column_map", "header_fixes", "filters", "split_labels")}
    base["public_data_pk"] = entry["public_data_pk"]
    if pk == entry["public_data_pk"]:
        return base
    for extra in entry.get("extra_files", []):
        if extra["public_data_pk"] == pk:
            return {**base, **{k: v for k, v in extra.items() if v is not None}}
    raise PortalError(f"{entry['key']}: 매니페스트에 없는 pk {pk}")


def _dataset_url(pk: str, kind: str) -> str:
    return (API_DATASET_URL if kind == "api" else FILE_DATASET_URL).format(pk=pk)


# ---------------------------------------------------------------- 다운로드

def _sniff_ext(data: bytes) -> str:
    head = data[:200].lstrip()
    if data[:2] == b"PK":
        return "xlsx"
    if head[:1] in (b"{", b"["):
        return "json"
    if head[:1] == b"<":
        return "html"
    return "csv"


def _is_bot_block(data: bytes) -> bool:
    """대구 중구처럼 쿠키를 심고 새로고침하는 짧은 JS 응답."""
    head = data[:400].decode("utf-8", "replace")
    return "document.cookie" in head and "reload" in data[:1500].decode("utf-8", "replace")


def _save(raw_dir: Path, key: str, pk: str, data: bytes) -> Path:
    ext = _sniff_ext(data)
    raw_dir.mkdir(parents=True, exist_ok=True)
    out = raw_dir / f"{key}__{pk}.{ext}"
    out.write_bytes(data)
    return out


def _fetch_dataset_file(pk: str, failures: Failures) -> bytes:
    """포털 파일형: 상세 페이지에서 uddi → POST 메타(atchFileId) → fileDownload."""
    page = http.get(DETAIL_PAGE.format(pk=pk), source=SOURCE, failures=failures)
    m = re.search(r'name="publicDataDetailPk"\s+value="(uddi:[^"]+)"', page.decode("utf-8", "replace"))
    if not m:
        raise PortalError(f"{pk}: 상세 페이지에서 publicDataDetailPk 를 못 찾음")
    meta = http.post(
        META_URL,
        {"publicDataPk": pk, "publicDataDetailPk": m.group(1), "fileDetailSn": "1"},
        referer=DETAIL_PAGE.format(pk=pk), source=SOURCE, failures=failures,
    )
    atch = json.loads(meta)["fileDataRegistVO"]["atchFileId"]
    data = http.get(FILE_URL.format(atch=atch), referer=DETAIL_PAGE.format(pk=pk),
                    timeout=60, source=SOURCE, failures=failures)
    if len(data) < MIN_FILE_BYTES:
        raise PortalError(f"{pk}: 응답이 너무 작음 ({len(data)} bytes)")
    return data


def _find_link_url(obj: object) -> str | None:
    """selectLinkUrl 응답(JSON)에서 원본 주소. 보통 {"linkUrl": "...", "status": true}."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if "url" in k.lower() and isinstance(v, str) and v.startswith("http"):
                return v
        for v in obj.values():
            found = _find_link_url(v)
            if found:
                return found
    return None


def _resolve_link(entry: dict, failures: Failures) -> tuple[bytes, str]:
    """링크형: selectLinkUrl 로 원본 주소를 얻고 link_resolve 규칙에 따라 실제 데이터를 받는다."""
    pk = entry["public_data_pk"]
    meta = json.loads(http.get(LINK_URL.format(pk=pk), source=SOURCE, failures=failures))
    origin = _find_link_url(meta) or entry.get("url")
    if not origin:
        raise PortalError(f"{entry['key']}: 원본 주소 없음")
    how = entry.get("link_resolve", "direct_csv")
    if how == "direct_csv" or how == "html_table":
        return http.get(origin, referer=DETAIL_PAGE.format(pk=pk), timeout=60,
                        source=SOURCE, failures=failures), origin
    page = http.get(origin, referer=DETAIL_PAGE.format(pk=pk), source=SOURCE, failures=failures)
    html = page.decode("utf-8", "replace")
    if how == "csv_button":
        m = re.search(r'<a\s+href="([^"]+)"[^>]*>\s*<button[^>]*>\s*CSV\s*</button>', html, re.I)
    else:  # href_type_csv
        m = re.search(r'href="([^"]*type=csv[^"]*)"', html, re.I)
    if not m:
        raise PortalError(f"{entry['key']}: 원본 페이지에서 CSV 링크를 못 찾음 ({how})")
    href = m.group(1).replace("&amp;", "&")
    data = http.get(urljoin(origin, href), referer=origin, timeout=60, source=SOURCE, failures=failures)
    return data, origin


def _find_items(obj: object) -> list | None:
    if isinstance(obj, list) and (not obj or isinstance(obj[0], dict)):
        return obj
    if isinstance(obj, dict):
        for v in obj.values():
            found = _find_items(v)
            if found is not None:
                return found
    return None


def _find_total(obj: object) -> int | None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.lower() in ("totalcnt", "totalcount") and str(v).isdigit():
                return int(v)
        for v in obj.values():
            found = _find_total(v)
            if found is not None:
                return found
    return None


def _download_api(entry: dict, failures: Failures) -> bytes:
    """API형(키 없음): pageNo/numOfRows 로 전량을 받아 {"items": [...]} 하나로 합친다."""
    params = dict(entry.get("api_params") or {"pageNo": 1, "numOfRows": 1000})
    items: list = []
    total = None
    for page_no in range(1, MAX_API_PAGES + 1):
        params["pageNo"] = page_no
        qs = "&".join(f"{k}={v}" for k, v in params.items())
        body = json.loads(http.get(f"{entry['url']}?{qs}", source=SOURCE, failures=failures))
        got = _find_items(body) or []
        total = _find_total(body) if total is None else total
        items.extend(got)
        if not got or total is None or len(items) >= total:
            break
    if not items:
        raise PortalError(f"{entry['key']}: API 응답에 항목이 없음")
    return json.dumps({"totalCnt": total, "items": items}, ensure_ascii=False).encode("utf-8")


def download(entry: dict, raw_dir: Path = RAW_DIR, failures: Failures | None = None) -> list[Path]:
    """한 곳의 원본을 raw_dir 에 저장하고 파일 경로 목록을 돌려준다. 실패는 failures 에 적고 예외를 던진다."""
    f = failures if failures is not None else http.failures
    key, kind = entry["key"], entry["kind"]
    raw_dir = Path(raw_dir)
    try:
        if kind == "api":
            try:
                return [_save(raw_dir, key, entry["public_data_pk"], _download_api(entry, f))]
            except Exception as e:  # noqa: BLE001 - 키 없는 API 가 막히면 같은 원천의 파일본으로
                fallback = next((x for x in entry.get("extra_files", []) if x.get("only_as_fallback")), None)
                if not fallback:
                    raise
                f.add(SOURCE, "api_fallback_to_file", entry["url"], repr(e))
                data = _fetch_dataset_file(fallback["public_data_pk"], f)
                return [_save(raw_dir, key, fallback["public_data_pk"], data)]
        if kind == "link":
            data, origin = _resolve_link(entry, f)
            if _is_bot_block(data):
                f.add(SOURCE, "bot_block", origin, "쿠키 요구 JS 응답(sabSignature)")
                raise PortalError(f"{key}: 봇 차단 응답")
            return [_save(raw_dir, key, entry["public_data_pk"], data)]
        paths = []
        pks = [entry["public_data_pk"]] + [
            x["public_data_pk"] for x in entry.get("extra_files", []) if not x.get("only_as_fallback")]
        for pk in pks:
            paths.append(_save(raw_dir, key, pk, _fetch_dataset_file(pk, f)))
        return paths
    except Exception as e:
        if not isinstance(e, http.RobotsBlocked):  # robots 차단은 http 모듈이 이미 기록함
            f.add(SOURCE, "download_failed", entry.get("url") or key, f"{key}: {e!r}")
        raise


# ---------------------------------------------------------------- 원본 읽기

def _clean(text: object) -> str:
    return re.sub(r"\s+", " ", str(text if text is not None else "")).strip()


class _TableParser(HTMLParser):
    """첫 번째 <table> 의 헤더(th)와 본문 행(td)을 읽는다. <br> 은 줄바꿈, 행의 첫 링크는 __href."""

    def __init__(self) -> None:
        super().__init__()
        self.headers: list[str] = []
        self.rows: list[list[str]] = []
        self.hrefs: list[str | None] = []
        self._cell: list[str] | None = None
        self._row: list[str] | None = None
        self._href: str | None = None
        self._in_th = False
        self._table_done = False
        self._in_table = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._table_done:
            return
        if tag == "table":
            self._in_table = True
        elif not self._in_table:
            return
        elif tag == "tr":
            self._row, self._href = [], None
        elif tag in ("td", "th"):
            self._cell, self._in_th = [], tag == "th"
        elif tag == "br" and self._cell is not None:
            self._cell.append("\n")
        elif tag == "a" and self._row is not None and self._href is None:
            self._href = dict(attrs).get("href")

    def handle_endtag(self, tag: str) -> None:
        if self._table_done or not self._in_table:
            return
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            lines = [_clean(x) for x in "".join(self._cell).split("\n")]
            text = "\n".join(x for x in lines if x)
            if self._in_th:
                self.headers.append(_clean(text))
            else:
                self._row.append(text)
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
                self.hrefs.append(self._href)
            self._row = None
        elif tag == "table":
            self._table_done = True

    def handle_data(self, data: str) -> None:
        if self._cell is not None and not self._table_done:
            self._cell.append(data)


def _read_html_rows(data: bytes, spec: dict) -> list[dict]:
    parser = _TableParser()
    parser.feed(decode_bytes(data)[0])
    out = []
    for cells, href in zip(parser.rows, parser.hrefs):
        row = dict(zip(parser.headers, cells))
        for cell_name, labels in (spec.get("split_labels") or {}).items():
            text = _clean(row.get(cell_name, ""))
            pattern = "(" + "|".join(map(re.escape, labels)) + r")\s*(.*?)(?=\s*(?:" + "|".join(
                map(re.escape, labels)) + r")|$)"
            for m in re.finditer(pattern, text):
                row[m.group(1)] = m.group(2).strip()
        if href:
            row["__href"] = href
        out.append(row)
    return out


def _read_json_rows(data: bytes) -> list[dict]:
    return [{k: v for k, v in item.items()} for item in (_find_items(json.loads(data)) or [])]


def _read_csv_rows(data: bytes) -> list[dict]:
    import csv
    import io
    text = decode_bytes(data)[0]
    return [{k: v for k, v in r.items() if k is not None} for r in csv.DictReader(io.StringIO(text, newline=""))]


def _read_rows(path: Path, spec: dict) -> list[dict]:
    data = Path(path).read_bytes()
    ext = path.suffix.lower()
    if ext == ".html":
        raw_rows = _read_html_rows(data, spec)
    elif ext == ".json":
        raw_rows = _read_json_rows(data)
    elif ext == ".csv":
        raw_rows = _read_csv_rows(data)
    else:
        raise PortalError(f"지원하지 않는 형식: {path.name}")
    fixes = spec.get("header_fixes") or {}
    rows = []
    for raw in raw_rows:
        row = {}
        for k, v in raw.items():
            name = _clean(k)
            row[fixes.get(name, name)] = v if isinstance(v, str) else ("" if v is None else str(v))
        rows.append(row)
    return rows


# ---------------------------------------------------------------- 값 변환

def _blank(text: object) -> str | None:
    t = _clean(text)
    return t or None


def _date(raw: object) -> str | None:
    m = DATE_IN_TEXT.search(str(raw or ""))
    return parse_date(m.group(0)) if m else None


def _dates(raw: object) -> tuple[str | None, str | None]:
    found = [parse_date(m.group(0)) for m in DATE_IN_TEXT.finditer(str(raw or ""))]
    found = [d for d in found if d]
    return (found[0] if found else None, found[1] if len(found) > 1 else None)


def _time_range(raw: object) -> tuple[str | None, str | None, str]:
    """원문 → (시작 HH:MM, 종료 HH:MM, 시각을 뺀 나머지 글자). 범위가 없으면 첫 시각만."""
    text = str(raw or "")
    m = TIME_RANGE_RE.search(text)
    if m:
        h1, m1, h2, m2 = m.groups()
        start = parse_time(f"{h1}:{m1 or '00'}")
        end = parse_time(f"{h2}:{m2 or '00'}")
        return start, end, text[: m.start()] + " " + text[m.end():]
    single = re.search(r"\d{1,2}:\d{2}", text)
    return (parse_time(single.group(0)) if single else None), None, text


def _weekdays(raw: object) -> str:
    text = EXCEPT_RE.sub(" ", str(raw or "")).replace("공휴일", " ")
    return parse_weekdays(text)


def _capacity(raw: object) -> int | None:
    m = re.search(r"\d+", str(raw or "").replace(",", ""))
    if not m:
        return None
    n = int(m.group(0))
    return n if 0 < n < 9999 else None


def _fee(raw: object, monthly: bool = False) -> tuple[int | None, int, str | None]:
    text = _clean(raw)
    if not text:
        return None, 0, None
    if FREE_WORDS.search(text) or re.fullmatch(r"없음|해당\s*없음|0+", text):
        return 0, 1, None
    m = re.search(r"(\d[\d,]*)\s*원", text)
    amount = m.group(1) if m else None
    if amount is None:
        m = re.search(r"\d{1,3}(?:,\d{3})+|\d{3,}", text)
        amount = m.group(0) if m else None
    if amount is None:
        return None, 0, None
    won, is_free, _ = parse_fee(amount)
    if won is None or is_free:
        return won, is_free, None
    return won, 0, "월" if monthly or MONTHLY_RE.search(text) else "총"


def _selection(raw: object) -> str | None:
    text = str(raw or "")
    if "추첨" in text:
        return "추첨"
    if "선착" in text:
        return "선착순"
    return None


def _first_line(text: str) -> str:
    return re.split(r"[\n(（]", text)[0].strip()


def _apply_target(target: str, value: str, rec: dict) -> None:
    """원본 칸 하나(value)를 대상(target)에 따라 rec 에 채운다. 이미 채워진 칸은 덮어쓰지 않는다."""
    v = _clean(value)
    if target.endswith("_range") and v and ALWAYS_RE.search(v):
        rec["is_always_open"] = 1
    if not v:
        return

    def put(col: str, val: object) -> None:
        if val not in (None, "") and rec.get(col) in (None, ""):
            rec[col] = val

    if target == "title":
        put("title", v)
    elif target == "dong":
        put("dong", _first_line(value.strip()) or None)
    elif target in ("institution", "institution_phone", "venue", "address", "description",
                    "target_raw", "apply_method"):
        put(target, v)
    elif target == "capacity":
        put("capacity", _capacity(v))
    elif target in ("fee_raw", "fee_raw_month"):
        if rec.get("fee_raw") is None:
            rec["fee_raw"] = v
            rec["fee_won"], rec["is_free"], rec["fee_period"] = _fee(v, target == "fee_raw_month")
    elif target == "weekdays_raw":
        put("weekdays_raw", v)
    elif target == "time_range":
        start, end, _rest = _time_range(v)
        put("start_time", start)
        put("end_time", end)
    elif target in ("start_time", "end_time"):
        put(target, parse_time(v))
    elif target == "day_time":
        start, end, rest = _time_range(v)
        put("start_time", start)
        put("end_time", end)
        days = _weekdays(rest)
        if days:
            put("weekdays_raw", _clean(rest))
    elif target == "date_range":
        start, end = _dates(v)
        put("start_date", start)
        put("end_date", end)
    elif target in ("start_date", "end_date", "apply_start", "apply_end"):
        put(target, _date(v))
    elif target == "apply_range":
        start, end = _dates(v)
        put("apply_start", start)
        put("apply_end", end)
    elif target == "selection_method":
        put("selection_method", _selection(v))
    elif target == "data_date":
        put("data_date", _date(v))
    elif target == "contact":
        phone = PHONE_RE.search(v)
        put("institution_phone", phone.group(0) if phone else None)
        put("institution", _clean(re.split(r"[(（]", v)[0]))
    elif target == "detail_text":
        put("description", v)
        place = DETAIL_PLACE_RE.search(v)
        put("venue", _clean(place.group(1)) if place else None)


def _find_dong(*texts: str | None) -> str | None:
    """동 이름을 못 받았을 때 기관명·장소에서 찾는다. 동이 없으면 읍·면."""
    found = extract_dong(*[t or "" for t in texts])
    if found:
        return found
    for t in texts:
        m = EUPMYEON_RE.search(t or "")
        if m:
            return m.group(1)
    return None


def _auto_map(headers: list[str]) -> dict:
    mapping = {}
    for h in headers:
        for pattern, target in AUTO_ALIASES:
            if re.search(pattern, h):
                mapping[h] = target
                break
    return mapping


def _passes_filters(row: dict, filters: dict | None) -> bool:
    for col, pattern in ((filters or {}).get("include") or {}).items():
        if not re.search(pattern, _clean(row.get(col, ""))):
            return False
    for col, pattern in ((filters or {}).get("exclude") or {}).items():
        if re.search(pattern, _clean(row.get(col, ""))):
            return False
    return True


# ---------------------------------------------------------------- 정규화

def normalize(entry: dict, path: Path, *, collected_at: str,
              failures: Failures | None = None) -> list[dict]:
    """원본 한 파일 → courses 컬럼 키 dict 목록. 파생 컬럼은 None/기본값."""
    path = Path(path)
    m = re.search(r"__(\d+)\.", path.name)
    pk = m.group(1) if m else entry["public_data_pk"]
    spec = _spec_for(entry, pk)
    rows = _read_rows(path, spec)
    kind = "api" if path.suffix == ".json" and entry["kind"] == "api" else "file"
    source_url = _dataset_url(pk, kind)
    column_map = spec.get("column_map") or {}
    if not column_map and rows:
        column_map = _auto_map([h for h in rows[0] if not h.startswith("__")])
    if rows and failures is not None:
        has_title = any("title" in (t if isinstance(t, list) else [t]) for t in column_map.values())
        missing = [h for h in column_map if h not in rows[0]]
        if not has_title or missing:
            failures.add(SOURCE, "schema_mismatch", str(path),
                         f"{entry['key']}: 제목 칸 {'있음' if has_title else '없음'}, 없는 헤더 {','.join(missing) or '-'}")

    sido = normalize_sido(entry["sido"])
    sigungu = normalize_sigungu(entry["sigungu"])
    out: list[dict] = []
    for row in rows:
        if not _passes_filters(row, spec.get("filters")):
            continue
        rec: dict = {k: None for k in COURSE_KEYS}
        rec.update({"is_always_open": 0, "is_free": 0, "is_online": 0})
        for header, targets in column_map.items():
            for target in targets if isinstance(targets, list) else [targets]:
                _apply_target(target, row.get(header, ""), rec)
        title = _blank(rec["title"])
        if not title:
            continue
        rec["title"] = title
        href = row.get("__href")
        for col in ("dong", "institution", "venue"):
            rec[col] = _blank(rec[col])
        rec["dong"] = rec["dong"] or _find_dong(rec["institution"], rec["venue"])
        if not rec["institution"]:
            rec["institution"] = f"{sigungu} {rec['dong']} 주민센터" if rec["dong"] else f"{sigungu} 주민센터"
        days = _weekdays(rec["weekdays_raw"])
        bucket = time_bucket(rec["start_time"])
        rec.update({
            "source": SOURCE,
            "source_file": path.name,
            "source_url": source_url,
            "detail_url": urljoin(entry.get("url") or "", href) if href else None,
            "collected_at": collected_at,
            "sido": sido or None,
            "sigungu": sigungu or None,
            "weekdays": days or None,
            "weekday_bits": weekday_bits(days),
            "time_bucket": bucket,
            "is_dong_center": 1 if entry.get("default_is_dong_center") else 0,
            "signals": "[]",
        })
        rec["id"] = make_id(rec["title"], rec["institution"], rec["start_date"],
                            rec["start_time"], rec["venue"])
        out.append(rec)
    return out


# ---------------------------------------------------------------- 전체 수집

def collect_all(failures: Failures | None = None, *, raw_dir: Path = RAW_DIR,
                collected_at: str | None = None, manifest: list[dict] | None = None) -> list[dict]:
    """32곳 전부. 한 곳이 실패해도 나머지를 계속하고, 실패는 failures 에 남긴다."""
    f = failures if failures is not None else http.failures
    collected_at = collected_at or date.today().isoformat()
    courses: list[dict] = []
    for entry in manifest if manifest is not None else load_manifest():
        recorded = len(f.items)
        try:
            paths = download(entry, raw_dir, f)
        except http.RobotsBlocked:
            continue  # http 모듈이 robots 실패를 이미 기록함
        except Exception as e:  # noqa: BLE001 - 한 곳의 실패가 전체를 멈추지 않는다
            if len(f.items) == recorded:  # download() 가 기록하지 못한 예외만 여기서 기록
                f.add(SOURCE, "entry_failed", entry.get("url") or entry["key"], f"{entry['key']}: {e!r}")
            continue
        for path in paths:
            try:
                courses.extend(normalize(entry, path, collected_at=collected_at, failures=f))
            except Exception as e:  # noqa: BLE001
                f.add(SOURCE, "normalize_failed", str(path), f"{entry['key']}: {e!r}")
    return courses
