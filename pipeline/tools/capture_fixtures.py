"""서울 어댑터 fixture 캡처: 구마다 첫 페이지 1장만 받아 축약·정화해 tests/fixtures/seoul/{코드}.html 로 저장.

- 요청은 pipeline/common/http.py 로만 한다(robots 자동 판정, 같은 호스트 요청 간 ≥1s). 브라우저 자동화 금지.
- 원본은 pipeline/raw/seoul/{코드}.html(.gitignore 대상)에 남기고, 다시 돌리면 원본을 재사용한다
  (네트워크 0). 새로 받으려면 --refresh.
- robots 차단·껍데기·HTTP 오류·행 규칙 미작성(todo) 구는 fixture 를 만들지 않고 pipeline/out/failures.json 에 기록.
- 정화(R5): script/style/img 등 제거, 목록 행 ≤5, 표 머리·행 컨테이너만 남김, 120자 넘는 글은 「(설명 생략)」.

실행: .venv/bin/python pipeline/tools/capture_fixtures.py [--refresh] [--only seoul_guro,...]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.common import http  # noqa: E402
from pipeline.common.failures import DEFAULT_PATH, Failures  # noqa: E402
from pipeline.sources.seoul.adapters import ADAPTERS  # noqa: E402
from pipeline.sources.seoul.base import (  # noqa: E402
    Node, build_request, fetch, is_js_shell, parse_html, parse_rows, to_html,
)

RAW_DIR = ROOT / "pipeline" / "raw" / "seoul"
FIXTURE_DIR = ROOT / "pipeline" / "tests" / "fixtures" / "seoul"
MAX_ROWS = 5
MAX_TEXT = 120
MAX_BYTES = 60_000
DROP_TAGS = {"script", "style", "noscript", "img", "svg", "iframe", "link", "meta", "picture",
             "video", "audio", "object", "embed", "canvas", "map", "template", "button"}
KEEP_SIBLINGS = {"thead", "caption", "colgroup"}
OMIT = "(설명 생략)"
TEACHER_LABELS = {"강사", "강사명"}


def fixture_name(adapter) -> str:
    return adapter.source.removeprefix("seoul_") + ".html"


def first_request(adapter):
    shard = adapter.shards[0] if adapter.shards else None
    flt = adapter.status_filters[0] if adapter.status_filters else ()
    page = adapter.page_start if adapter.page_key else None
    return build_request(adapter, shard, flt, page)


def _strip(node: Node) -> None:
    kept = []
    for c in node.children:
        if isinstance(c, str):
            text = re.sub(r"\s+", " ", c)
            if not text.strip() and kept and isinstance(kept[-1], str):
                continue
            kept.append(text if len(text.strip()) <= MAX_TEXT else OMIT)
        elif c.tag in DROP_TAGS or c.tag.startswith("!"):
            continue
        else:
            for k in [k for k in c.attrs if k.startswith("on") and k not in ("onclick",)]:
                del c.attrs[k]
            c.attrs.pop("style", None)
            _strip(c)
            kept.append(c)
    node.children = kept


def _bare(text: str) -> str:
    return re.sub(r"\s+", "", text)


def _blank_teacher(root: Node, rows: list[Node]) -> None:
    """강사 이름은 저장 대상이 아니다: 표의 「강사」 열 칸과 dl 의 「강사」 dd 를 「(생략)」 으로."""
    for table in root.select("table"):
        heads = [_bare(th.text()) for th in table.select("thead th")]
        idx = [i for i, h in enumerate(heads) if h in TEACHER_LABELS]
        for tr in table.select("tbody tr"):
            cells = [c for c in tr.children if isinstance(c, Node) and c.tag in ("td", "th")]
            for i in idx:
                if i < len(cells):
                    cells[i].children = ["(생략)"]
    for row in rows:
        for dl in row.select("dl"):
            kids = [c for c in dl.children if isinstance(c, Node)]
            for a, b in zip(kids, kids[1:]):
                if a.tag == "dt" and b.tag == "dd" and _bare(a.text()) in TEACHER_LABELS:
                    b.children = ["(생략)"]


def sanitize(adapter, html: str) -> str:
    """행 ≤5 와 그 조상 뼈대·표 머리만 남긴 축약본. 행이 없으면 ValueError."""
    root = parse_html(html)
    rows = root.select(adapter.row_selector)[:MAX_ROWS]
    if not rows:
        raise ValueError("행 0개")
    keep: set[int] = set()
    for r in rows:
        keep.add(id(r))
        n = r.parent
        while n is not None:
            keep.add(id(n))
            n = n.parent

    def prune(node: Node) -> None:
        out = []
        for c in node.children:
            if isinstance(c, str):
                continue
            if id(c) in keep:
                if c not in rows:
                    prune(c)
                out.append(c)
            elif c.tag in KEEP_SIBLINGS and node.tag == "table":
                out.append(c)
        node.children = out

    prune(root)
    _blank_teacher(root, rows)
    _strip(root)
    body = to_html(root)
    doc = ('<!doctype html>\n<html lang="ko"><head><meta charset="utf-8">'
           f"<title>{adapter.gu} fixture</title></head>\n"
           f"<!-- 축약 fixture: {adapter.source} 첫 페이지 목록 행 {len(rows)}개만. 원문 재게시 아님(R5). -->\n"
           f"<body>\n{body}\n</body></html>\n")
    if len(doc.encode("utf-8")) > MAX_BYTES:
        raise ValueError(f"축약본이 너무 큼: {len(doc.encode('utf-8'))}B")
    return doc


def capture(adapter, failures: Failures, refresh: bool) -> tuple[str, str]:
    """(결과, 메모). 결과: saved / robots / js_shell / http_error / todo / no_rows / skip."""
    if not adapter.list_url:
        failures.add(adapter.source, "todo", "", "; ".join(adapter.todo))
        return "todo", "목록 URL 없음"
    method, url, data = first_request(adapter)
    raw_path = RAW_DIR / f"{adapter.source}.html"
    origin = "cache"
    if raw_path.exists() and not refresh:
        html = raw_path.read_text(encoding="utf-8")
    else:
        origin = "net"
        try:
            html = fetch(adapter, method, url, data, failures)
        except http.RobotsBlocked:
            return "robots", url
        except Exception as e:  # noqa: BLE001 - http 모듈이 http_error 기록
            return "http_error", repr(e)[:120]
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(html, encoding="utf-8")
    size = len(html.encode("utf-8"))
    if not adapter.row_selector or "title" not in adapter.fields:
        if is_js_shell(html, 0):
            failures.add(adapter.source, "js_shell", url, f"bytes={size}")
            return "js_shell", f"{origin} {size}B"
        failures.add(adapter.source, "todo", url, "행 규칙 미작성: " + "; ".join(adapter.todo))
        return "todo", f"{origin} {size}B (원본은 raw 에 저장)"
    recs = parse_rows(adapter, html)
    if not recs:
        reason = "js_shell" if is_js_shell(html, 0) else "no_rows"
        failures.add(adapter.source, reason, url, f"bytes={size}")
        return reason, f"{origin} {size}B"
    doc = sanitize(adapter, html)
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    out = FIXTURE_DIR / fixture_name(adapter)
    out.write_text(doc, encoding="utf-8")
    return "saved", f"{origin} {size}B → {out.name} {len(doc.encode('utf-8'))}B, 행 {len(recs)}"


def merge_failures(new: Failures, touched: set[str], path: Path = DEFAULT_PATH) -> Path:
    """기존 failures.json 에서 이번에 다룬 서울 소스 기록만 갈아 끼운다(다른 소스 기록은 보존)."""
    old = []
    if path.exists():
        try:
            old = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            old = []
    merged = Failures()
    merged.items = [it for it in old if it.get("source") not in touched] + new.items
    return merged.write(path)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--refresh", action="store_true", help="raw 캐시를 무시하고 다시 받는다")
    ap.add_argument("--only", default="", help="쉼표로 구분한 source 코드만")
    args = ap.parse_args(argv)
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    failures = Failures()
    print(f"{'source':<18} {'구':<5} {'결과':<10} 메모")
    counts: dict[str, int] = {}
    touched: set[str] = set()
    for ad in ADAPTERS:
        if only and ad.source not in only:
            continue
        touched.add(ad.source)
        try:
            result, memo = capture(ad, failures, args.refresh)
        except Exception as e:  # noqa: BLE001 - 한 구 실패가 전체를 멈추지 않게
            failures.add(ad.source, "capture_error", ad.list_url or "", repr(e))
            result, memo = "error", repr(e)[:120]
        counts[result] = counts.get(result, 0) + 1
        print(f"{ad.source:<18} {ad.gu:<5} {result:<10} {memo}")
    path = merge_failures(failures, touched)
    print("합계:", ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    print(f"failures → {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
