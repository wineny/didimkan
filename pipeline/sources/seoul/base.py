"""소스4: 서울 구 예약사이트 공통 파서 프레임.

흐름(구 하나): robots 판정(http 모듈) → 상태 필터·동(shard)·페이지 순회 → 행 파싱 → 상태/기관 거름
→ 정규화(courses 키, description NULL 강제) → 껍데기 판정 → 실패 기록.
한 구가 실패해도 collect_all 은 다음 구로 넘어간다. 브라우저 우회는 하지 않는다.
구별 차이는 adapters.py 의 데이터 표(Adapter)로만 표현한다.
"""
from __future__ import annotations

import re
from html.parser import HTMLParser
from urllib.parse import urlencode, urljoin, urlsplit, urlunsplit, parse_qsl

from pipeline.common import http
from pipeline.common.failures import Failures
from pipeline.common.parse import (
    make_id, parse_date, parse_fee, parse_time, parse_weekdays, time_bucket, weekday_bits,
)
from pipeline.sources.std import COURSE_KEYS, _TIME_BUCKET_KO, extract_dong

SIDO = "서울특별시"
APPLY_METHOD = "온라인(구 예약사이트)"
SHELL_BYTES = 2048
SHELL_MARKERS = ("sabFingerPrint", "location.replace", "document.cookie")
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
             "param", "source", "track", "wbr"}
DATE_ANY = re.compile(r"(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})")
TIME_ANY = re.compile(r"(\d{1,2})\s*:\s*(\d{2})")
WS = re.compile(r"\s+")


# ---------------------------------------------------------------- 작은 DOM

class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag: str, attrs: dict | None = None, parent: "Node | None" = None):
        self.tag = tag
        self.attrs = attrs or {}
        self.children: list = []  # Node 또는 str
        self.parent = parent

    def iter(self):
        for c in self.children:
            if isinstance(c, Node):
                yield c
                yield from c.iter()

    def text(self) -> str:
        parts: list[str] = []
        for c in self.children:
            parts.append(c if isinstance(c, str) else " " + c.text() + " ")
        return WS.sub(" ", "".join(parts)).strip()

    def classes(self) -> set[str]:
        return set((self.attrs.get("class") or "").split())

    def select(self, selector: str) -> list["Node"]:
        return select(self, selector)

    def select_one(self, selector: str) -> "Node | None":
        found = select(self, selector)
        return found[0] if found else None


class _TreeBuilder(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("#root")
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, {k: (v or "") for k, v in attrs}, self.cur)
        self.cur.children.append(node)
        if tag not in VOID_TAGS:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, {k: (v or "") for k, v in attrs}, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:  # 짝이 맞는 여는 태그가 있을 때만 닫는다(엉성한 HTML 대비)
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def parse_html(html: str) -> Node:
    b = _TreeBuilder()
    b.feed(html)
    b.close()
    return b.root


_SIMPLE = re.compile(r"^([a-zA-Z0-9]*)((?:[.#][\w-]+|\[[\w-]+(?:[*^$]?=[^\]]*)?\])*)$")
_PART = re.compile(r"([.#])([\w-]+)|\[([\w-]+)(?:([*^$]?=)([^\]]*))?\]")


def _match_simple(node: Node, simple: str) -> bool:
    m = _SIMPLE.match(simple)
    if not m:
        raise ValueError(f"지원하지 않는 선택자: {simple!r}")
    tag, rest = m.group(1), m.group(2)
    if tag and node.tag != tag.lower():
        return False
    for p in _PART.finditer(rest):
        if p.group(1) == ".":
            if p.group(2) not in node.classes():
                return False
        elif p.group(1) == "#":
            if node.attrs.get("id") != p.group(2):
                return False
        else:
            name, op, val = p.group(3), p.group(4), (p.group(5) or "").strip("'\"")
            if name not in node.attrs:
                return False
            have = node.attrs[name]
            if op == "=" and have != val:
                return False
            if op == "*=" and val not in have:
                return False
            if op == "^=" and not have.startswith(val):
                return False
            if op == "$=" and not have.endswith(val):
                return False
    return True


def select(root: Node, selector: str) -> list[Node]:
    """CSS 부분집합: 자손(공백)·자식(>) 결합, tag/.class/#id/[attr]/[attr=v]/[attr*=v]/[attr^=v]."""
    tokens = selector.replace(">", " > ").split()
    nodes = [root]
    child_only = False
    for tok in tokens:
        if tok == ">":
            child_only = True
            continue
        nxt: list[Node] = []
        seen: set[int] = set()
        for n in nodes:
            cands = (c for c in n.children if isinstance(c, Node)) if child_only else n.iter()
            for c in cands:
                if id(c) not in seen and _match_simple(c, tok):
                    seen.add(id(c))
                    nxt.append(c)
        nodes = nxt
        child_only = False
    return nodes


def to_html(node: Node) -> str:
    from html import escape
    if node.tag == "#root":
        return "".join(c if isinstance(c, str) else to_html(c) for c in node.children)
    attrs = "".join(f' {k}="{escape(v, quote=True)}"' for k, v in node.attrs.items())
    if node.tag in VOID_TAGS:
        return f"<{node.tag}{attrs}>"
    inner = "".join(escape(c, quote=False) if isinstance(c, str) else to_html(c)
                    for c in node.children)
    return f"<{node.tag}{attrs}>{inner}</{node.tag}>"


# ---------------------------------------------------------------- 요청·디코딩

def shard_url(adapter, shard) -> str:
    """동별 URL 자리표시 `{dong}` 을 shard 이름으로 채운다(없으면 list_url 그대로)."""
    if shard is not None and "{dong}" in adapter.list_url:
        return adapter.list_url.replace("{dong}", shard[0])
    return adapter.list_url


def build_request(adapter, shard, flt, page_no: int | None) -> tuple[str, str, list | None]:
    """(method, url, form data) 하나를 만든다(요청은 하지 않음). page_no None = 페이지 파라미터 없음."""
    params = list(adapter.params) + list(flt)
    if shard is not None:
        params += list(shard[1])
    if adapter.page_key and page_no is not None:
        params.append((adapter.page_key, str(page_no)))
    base = shard_url(adapter, shard)
    if adapter.method == "POST":
        return "POST", base, params
    parts = urlsplit(base)
    q = parse_qsl(parts.query, keep_blank_values=True) + params
    return "GET", urlunsplit(parts._replace(query=urlencode(q))), None


def decode(data: bytes, encoding: str | None) -> str:
    if encoding:
        return data.decode(encoding, errors="replace")
    head = data[:2048].decode("ascii", errors="ignore").lower()
    m = re.search(r"charset=[\"']?([\w-]+)", head)
    if m and m.group(1) in ("euc-kr", "ks_c_5601-1987", "cp949"):
        return data.decode("cp949", errors="replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp949", errors="replace")


def fetch(adapter, method: str, url: str, data, failures: Failures | None) -> str:
    if method == "POST":
        raw = http.post(url, data=data, referer=adapter.list_url, source=adapter.source,
                        failures=failures)
    else:
        raw = http.get(url, referer=adapter.list_url, source=adapter.source, failures=failures)
    return decode(raw, adapter.encoding)


def visible_text_len(root: Node) -> int:
    total = 0
    stack = [root]
    while stack:
        n = stack.pop()
        for c in n.children:
            if isinstance(c, str):
                total += len(c.strip())
            elif c.tag not in ("script", "style", "noscript"):
                stack.append(c)
    return total


def is_js_shell(html: str, n_rows: int) -> bool:
    """행이 0개인데 본문이 2KB 미만이거나 봇 차단 스크립트 표식이 있거나 보이는 글자가 거의 없으면 껍데기."""
    if n_rows:
        return False
    if len(html.encode("utf-8")) < SHELL_BYTES:
        return True
    if any(m in html for m in SHELL_MARKERS) and visible_text_len(parse_html(html)) < 500:
        return True
    return visible_text_len(parse_html(html)) < 200


# ---------------------------------------------------------------- 행 파싱

def _cells(row: Node) -> list[Node]:
    """표 행이면 td/th, 아니면(div 열 구조) 자식 요소 전부."""
    kids = [c for c in row.children if isinstance(c, Node)]
    tds = [c for c in kids if c.tag in ("td", "th")]
    return tds or kids


def _field_text(row: Node, rule) -> str | None:
    if rule is None:
        return None
    if rule.const is not None:
        return rule.const
    target: Node | None = row
    if rule.cell is not None:
        target = _cells(row)[rule.cell] if rule.cell < len(_cells(row)) else None
    if target is not None and rule.sel:
        target = target.select_one(rule.sel)
    if target is None:
        return None
    if rule.attr:
        text = target.attrs.get(rule.attr)
    else:
        text = target.text()
    if text is None:
        return None
    if rule.regex:
        m = re.search(rule.regex, text, re.S)
        if not m:
            return None
        text = m.group(1) if m.groups() else m.group(0)
    if rule.template:
        text = rule.template.format(text)
    text = WS.sub(" ", text).strip()
    return text or None


def parse_rows(adapter, html: str) -> list[dict]:
    """페이지 HTML → [{필드명: 원문 문자열}] (거르기 전)."""
    root = parse_html(html)
    out = []
    for row in root.select(adapter.row_selector):
        if row.select_one("th") is not None and row.select_one("td") is None:
            continue  # 표 머리 행
        rec = {name: _field_text(row, rule) for name, rule in adapter.fields.items()}
        if not rec.get("title"):
            continue
        if adapter.skip_title and re.search(adapter.skip_title, rec["title"]):
            continue
        out.append(rec)
    return out


def _dates(text: str | None) -> list[str]:
    if not text:
        return []
    found = []
    for y, m, d in DATE_ANY.findall(text):
        iso = parse_date(f"{y}-{m}-{d}")
        if iso:
            found.append(iso)
    return found


def _times(text: str | None) -> list[str]:
    if not text:
        return []
    return [t for t in (parse_time(f"{h}:{mi}") for h, mi in TIME_ANY.findall(text)) if t]


def _to_int(text: str | None) -> int | None:
    if not text:
        return None
    m = re.search(r"\d+", text.replace(",", ""))
    return int(m.group(0)) if m else None


def _selection(text: str | None) -> str | None:
    if not text:
        return None
    if "추첨" in text:
        return "추첨"
    if "선착순" in text:
        return "선착순"
    return None


def keep_row(adapter, rec: dict) -> bool:
    if adapter.status_allow and not re.search(adapter.status_allow, rec.get("status") or ""):
        return False
    if adapter.institution_pattern and not re.search(
            adapter.institution_pattern, rec.get("institution") or ""):
        return False
    return True


def normalize(adapter, rec: dict, *, collected_at: str, page_url: str,
              source_url: str | None = None) -> dict:
    title = rec["title"]
    institution = rec.get("institution")
    if institution and adapter.institution_sub:
        institution = re.sub(adapter.institution_sub[0], adapter.institution_sub[1], institution).strip() or None
    venue = rec.get("venue") or institution
    apply_dates = [] if adapter.no_apply_period else _dates(rec.get("apply_period"))
    edu_dates = _dates(rec.get("edu_period"))
    times = _times(rec.get("time"))
    days_raw = rec.get("weekdays")
    days = parse_weekdays(days_raw or "")
    fee_raw = rec.get("fee")
    fee_won, is_free, fee_period = parse_fee(fee_raw) if fee_raw else (None, 0, None)
    start_date = edu_dates[0] if edu_dates else None
    start_time = times[0] if times else None
    bucket = time_bucket(start_time)
    detail = rec.get("detail_url")
    if detail:
        detail = urljoin(page_url, detail)
    row = dict.fromkeys(COURSE_KEYS)
    row.update({
        "id": make_id(title, institution, start_date, start_time, venue),
        "source": adapter.source,
        "source_file": None,
        "source_url": source_url or adapter.list_url,
        "detail_url": detail,
        "collected_at": collected_at,
        "data_date": collected_at,
        "title": title,
        "description": None,  # R5: 재게시 금지 — 어떤 경우에도 저장하지 않는다
        "institution": institution,
        "sido": SIDO,
        "sigungu": adapter.gu,
        "dong": extract_dong(institution or "", venue or "", rec.get("dong") or ""),
        "venue": venue,
        "start_date": start_date,
        "end_date": edu_dates[1] if len(edu_dates) > 1 else None,
        "start_time": start_time,
        "end_time": times[1] if len(times) > 1 else None,
        "weekdays_raw": days_raw,
        "weekdays": days or None,
        "weekday_bits": weekday_bits(days),
        "time_bucket": _TIME_BUCKET_KO.get(bucket) if bucket else None,
        "capacity": _to_int(rec.get("capacity")),
        "fee_raw": fee_raw,
        "fee_won": fee_won,
        "fee_period": fee_period,
        "is_free": is_free,
        "is_online": 1 if re.search(r"온라인|비대면|원격", rec.get("online") or "") else 0,
        "apply_start": apply_dates[0] if apply_dates else None,
        "apply_end": apply_dates[1] if len(apply_dates) > 1 else None,
        "apply_method": APPLY_METHOD,
        "selection_method": _selection(rec.get("selection")),
        "is_always_open": 0,
        "homepage_url": None,
        "is_dong_center": 0,  # 파생은 derive 단계(A7) 몫
        "signals": "[]",
    })
    return row


# ---------------------------------------------------------------- 수집

def collect_gu(adapter, *, failures: Failures | None = None, collected_at: str,
               max_pages: int | None = None) -> list[dict]:
    """구 하나 수집. 실패(robots·http·껍데기·행 없음)는 failures 에 남기고 그때까지 모은 행을 돌려준다."""
    f = failures if failures is not None else http.failures
    if not adapter.list_url or not adapter.row_selector or not adapter.fields.get("title"):
        f.add(adapter.source, "todo", adapter.list_url or "", "; ".join(adapter.todo) or "어댑터 미완성")
        return []
    limit = min(adapter.max_pages, max_pages) if max_pages else adapter.max_pages
    rows: list[dict] = []
    parsed_any = False
    for shard in adapter.shards or (None,):
        for flt in adapter.status_filters or ((),):
            prev_titles: list[str] | None = None
            for i in range(limit if adapter.page_key else 1):
                page_no = adapter.page_start + i if adapter.page_key else None
                method, url, data = build_request(adapter, shard, flt, page_no)
                try:
                    html = fetch(adapter, method, url, data, f)
                except http.RobotsBlocked:
                    return _dedupe(rows)  # http 모듈이 'robots' 기록. 같은 호스트라 더 요청하지 않는다
                except Exception:  # noqa: BLE001 - http 모듈이 'http_error' 기록
                    if not parsed_any:
                        return _dedupe(rows)
                    break
                recs = parse_rows(adapter, html)
                if not recs:
                    if not parsed_any and is_js_shell(html, 0):
                        f.add(adapter.source, "js_shell", url, f"bytes={len(html.encode('utf-8'))}")
                        return _dedupe(rows)
                    break  # 이 필터·동은 끝(0건 필터는 정상일 수 있다)
                parsed_any = True
                titles = [r["title"] for r in recs]
                if titles == prev_titles:
                    break  # 서버가 페이지 값을 무시하고 같은 목록을 준다
                prev_titles = titles
                for rec in recs:
                    if keep_row(adapter, rec):
                        rows.append(normalize(adapter, rec, collected_at=collected_at, page_url=url,
                                              source_url=shard_url(adapter, shard)))
                if adapter.page_size and len(recs) < adapter.page_size:
                    break
    if not parsed_any:
        f.add(adapter.source, "no_rows", adapter.list_url, "목록 행을 한 건도 찾지 못함(구조 변경 의심)")
    return _dedupe(rows)


def _dedupe(rows: list[dict]) -> list[dict]:
    """같은 강좌가 필터 두 개(접수중·접수예정)나 페이지 경계에 겹쳐 나오면 하나만 남긴다."""
    out, ids = [], set()
    for r in rows:
        key = (r["id"], r["detail_url"])
        if key in ids:
            continue
        ids.add(key)
        out.append(r)
    return out


def collect_all(adapters=None, *, failures: Failures | None = None, collected_at: str,
                max_pages: int | None = None) -> list[dict]:
    from pipeline.sources.seoul.adapters import ADAPTERS
    f = failures if failures is not None else http.failures
    out: list[dict] = []
    for ad in adapters or ADAPTERS:
        try:
            out.extend(collect_gu(ad, failures=f, collected_at=collected_at, max_pages=max_pages))
        except Exception as e:  # noqa: BLE001 - 한 구 실패가 전체를 멈추지 않게
            f.add(ad.source, "parse_error", ad.list_url or "", repr(e))
    return out
