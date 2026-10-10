"""빌드 오케스트레이터: 소스 수집 → id 충돌 접미사 → 파생 → SQLite(schema.sql) 적재 → 보고서.

    python pipeline/build.py --today 2026-10-10 --offline --out data/didimkan.db

--offline 은 네트워크를 쓰지 않고 pipeline/tests/fixtures 의 축약본을 입력으로 쓴다.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import derive  # noqa: E402
from pipeline.common import http  # noqa: E402
from pipeline.common.failures import Failures  # noqa: E402
from pipeline.sources import gangnam, portal, std  # noqa: E402
from pipeline.sources.seoul import base as seoul_base  # noqa: E402

PIPE = ROOT / "pipeline"
SCHEMA = PIPE / "schema.sql"
FIXTURES = PIPE / "tests" / "fixtures"
OUT_DIR = PIPE / "out"
ALL_SOURCES = ("std", "portal", "gangnam", "seoul")
COURSE_KEYS = std.COURSE_KEYS
DEFAULTS = {"weekday_bits": 0, "signals": "[]", "is_free": 0, "is_online": 0,
            "is_always_open": 0, "is_dong_center": 0}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- 오프라인 입력(tests/fixtures 축약본)

def offline_std(collected_at: str, failures: Failures) -> list[dict]:
    rows: list[dict] = []
    for path in sorted((FIXTURES / "std").glob("*.csv")):
        rows.extend(std.normalize(path, collected_at=collected_at, failures=failures))
    return rows


def offline_portal(collected_at: str, failures: Failures) -> list[dict]:
    rows: list[dict] = []
    manifest = {e["key"]: e for e in portal.load_manifest()}
    for path in sorted((FIXTURES / "portal").iterdir()):
        key = path.name.split("__")[0]
        if key in manifest:
            rows.extend(portal.normalize(manifest[key], path, collected_at=collected_at,
                                         failures=failures))
    return rows


def offline_gangnam(collected_at: str, today: date) -> list[dict]:
    fix = FIXTURES / "gangnam"
    companies = {c["comcd"]: c for c in json.loads((fix / "companies.json").read_text("utf-8"))}
    sample = json.loads((fix / "lectures_sample.json").read_text("utf-8"))
    return [gangnam.normalize(lec, companies[code], collected_at=collected_at, today=today)
            for code, lecs in sample.items() for lec in lecs]


def offline_seoul(collected_at: str, failures: Failures) -> list[dict]:
    """구마다 fixture HTML 을 http.get/post 응답으로 돌려주고 실제 수집 경로(collect_gu)를 탄다.
    fixture 는 마감 행도 담은 스냅샷이라 상태·기관 거르기는 끈 어댑터로 읽는다(test_seoul 과 같은 방식)."""
    import dataclasses

    from pipeline.sources.seoul.adapters import ADAPTERS
    from pipeline.tools import capture_fixtures as cap

    state: dict = {}
    real_get, real_post = http.get, http.post

    def fake_get(url, **kw):
        return state["body"]

    def fake_post(url, data=None, **kw):
        return state["body"]

    http.get, http.post = fake_get, fake_post
    rows: list[dict] = []
    try:
        for ad in ADAPTERS:
            fix = FIXTURES / "seoul" / cap.fixture_name(ad)
            if not fix.exists():
                continue
            state["body"] = fix.read_text("utf-8").encode(ad.encoding or "utf-8")
            loose = dataclasses.replace(ad, status_allow=None, institution_pattern=None)
            try:
                rows.extend(seoul_base.collect_gu(loose, failures=failures, collected_at=collected_at))
            except Exception as e:  # noqa: BLE001
                failures.add(ad.source, "parse_error", ad.list_url or "", repr(e))
    finally:
        http.get, http.post = real_get, real_post
    return rows


# ---------------------------------------------------------------- 온라인 수집

def online_std(raw: Path, collected_at: str, failures: Failures) -> list[dict]:
    raw_dir = raw / "std"
    catalog = std.fetch_catalog(failures, raw_dir=raw_dir)
    rows: list[dict] = []
    for path in std.download(catalog, raw_dir, failures):
        try:
            rows.extend(std.normalize(path, collected_at=collected_at, failures=failures))
        except Exception as e:  # noqa: BLE001
            failures.add("std", "normalize_failed", str(path), repr(e))
    return rows


def collect(name: str, *, today: date, collected_at: str, offline: bool, raw: Path,
            failures: Failures) -> list[dict]:
    if name == "std":
        return offline_std(collected_at, failures) if offline else online_std(raw, collected_at, failures)
    if name == "portal":
        return (offline_portal(collected_at, failures) if offline else
                portal.collect_all(failures, raw_dir=raw / "portal", collected_at=collected_at))
    if name == "gangnam":
        return (offline_gangnam(collected_at, today) if offline else
                gangnam.collect(failures, collected_at, today, raw_dir=raw / "gangnam"))
    if name == "seoul":
        return (offline_seoul(collected_at, failures) if offline else
                seoul_base.collect_all(failures=failures, collected_at=collected_at))
    raise ValueError(f"알 수 없는 소스: {name}")


# ---------------------------------------------------------------- 합치기·id 접미사

def assign_unique_ids(rows: list[dict]) -> list[dict]:
    """contract §2: 같은 id 가 또 나오면 뒤에 오는 행에 -2, -3 …. 순서는 source → source_file →
    원본 행 번호(입력 순서, 강남은 classcd 가 든 detail_url). 행 dict 는 제자리에서 바뀌고 정렬된 목록을 돌려준다."""
    ordered = sorted(rows, key=lambda r: (
        r.get("source") or "", r.get("source_file") or "",
        (r.get("detail_url") or "") if r.get("source") == "gangnam" else ""))  # 정렬은 안정적
    seen: dict[str, int] = {}
    for r in ordered:
        base = r["id"]
        n = seen.get(base, 0) + 1
        seen[base] = n
        if n > 1:
            r["id"] = f"{base}-{n}"
    return ordered


def build_institutions(rows: list[dict]) -> list[tuple]:
    seen: dict[tuple, None] = {}
    for r in rows:
        if r.get("institution") and r.get("institution_phone"):
            seen[(r["institution"], r.get("sigungu"), r["institution_phone"], r["source"])] = None
    return list(seen)


# ---------------------------------------------------------------- DB 적재

def write_db(rows: list[dict], patterns: list[dict], out: Path, *, build_date: str,
             source_counts: dict, today_hint: str | None, failures: Failures) -> int:
    """schema.sql 로 새 DB 를 만들고 한 트랜잭션으로 적재한다. CHECK 위반 행은 실패 기록 후 건너뛴다. 건너뛴 수를 돌려준다."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    con = sqlite3.connect(out)
    skipped = 0
    try:
        con.executescript(SCHEMA.read_text(encoding="utf-8"))
        cols = ", ".join(COURSE_KEYS)
        marks = ", ".join("?" for _ in COURSE_KEYS)
        con.execute("BEGIN")
        for r in rows:
            vals = [r.get(k) if r.get(k) is not None else DEFAULTS.get(k) for k in COURSE_KEYS]
            try:
                con.execute(f"INSERT INTO courses ({cols}) VALUES ({marks})", vals)
            except sqlite3.Error as e:
                skipped += 1
                failures.add(r.get("source") or "?", "db_insert_skipped",
                             r.get("detail_url") or r.get("source_file") or "", f"{r.get('id')}: {e}")
        con.executemany("INSERT INTO institutions (institution, sigungu, phone, source) VALUES (?,?,?,?)",
                        build_institutions(rows))
        con.executemany(
            "INSERT INTO enrollment_patterns (institution, sigungu, open_history, cycle_days,"
            " next_open_estimate, basis_count, rule_note, is_estimate) VALUES (?,?,?,?,?,?,?,?)",
            [(p["institution"], p["sigungu"], p["open_history"], p["cycle_days"],
              p["next_open_estimate"], p["basis_count"], p["rule_note"], p["is_estimate"])
             for p in patterns])
        con.executemany("INSERT INTO meta (key, value) VALUES (?, ?)", [
            ("build_date", build_date),
            ("source_counts", json.dumps(source_counts, ensure_ascii=False)),
            ("today_hint", today_hint)])
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
    return skipped


def make_report(rows: list[dict], source_counts: dict, failures: Failures, skipped: int) -> dict:
    total = len(rows)
    dong = sum(1 for r in rows if r.get("is_dong_center"))
    stairs = {"1": 0, "2": 0, "3": 0, "none": 0}
    for r in rows:
        stairs[str(r["stair"]) if r.get("stair") in (1, 2, 3) else "none"] += 1
    return {
        "total": total,
        "by_source": source_counts,
        "dong_center_count": dong,
        "dong_center_ratio": round(dong / total, 4) if total else 0,
        "by_stair": stairs,
        "seoul_gu_count": len({r["sigungu"] for r in rows
                               if r.get("sido") == "서울특별시" and r.get("sigungu")}),
        "failures_count": len(failures.items),
        "skipped_rows": skipped,
    }


def finalize(raw_rows: list[dict], today: date, out: Path, failures: Failures, *,
             today_hint: str | None = None) -> tuple[list[dict], dict, int]:
    """id 접미사 → 파생 → 패턴 → DB. (파생 행, source_counts, 건너뛴 수) 를 돌려준다."""
    rows = assign_unique_ids([dict(r) for r in raw_rows])
    rows = derive.derive_all(rows, today)
    patterns = derive.build_patterns(rows, today)
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["source"]] = counts.get(r["source"], 0) + 1
    skipped = write_db(rows, patterns, out, build_date=today.isoformat(), source_counts=counts,
                       today_hint=today_hint, failures=failures)
    return rows, counts, skipped


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="디딤칸 데이터 빌드")
    ap.add_argument("--sources", default=",".join(ALL_SOURCES), help="쉼표 구분: std,portal,gangnam,seoul")
    ap.add_argument("--today", required=True, help="기준일 YYYY-MM-DD (기본값 없음)")
    ap.add_argument("--offline", action="store_true", help="네트워크 없이 tests/fixtures 축약본 사용")
    ap.add_argument("--out", default=str(ROOT / "data" / "didimkan.db"))
    ap.add_argument("--raw", default=str(PIPE / "raw"))
    ap.add_argument("--out-dir", default=str(OUT_DIR), help="build_report.json·failures.json 위치")
    args = ap.parse_args(argv)

    today = date.fromisoformat(args.today)
    names = [s.strip() for s in args.sources.split(",") if s.strip()]
    bad = [s for s in names if s not in ALL_SOURCES]
    if bad:
        ap.error(f"알 수 없는 소스: {','.join(bad)}")

    failures = Failures()
    raw_rows: list[dict] = []
    for name in names:
        log(f"[{name}] 수집 시작{' (offline)' if args.offline else ''}")
        try:
            got = collect(name, today=today, collected_at=args.today, offline=args.offline,
                          raw=Path(args.raw), failures=failures)
        except Exception as e:  # noqa: BLE001 - 한 소스의 예외가 전체를 멈추지 않는다
            failures.add(name, "source_failed", name, repr(e))
            log(f"[{name}] 실패: {e!r}")
            continue
        log(f"[{name}] {len(got)}행")
        raw_rows.extend(got)

    rows, counts, skipped = finalize(raw_rows, today, Path(args.out), failures)
    report = make_report(rows, counts, failures, skipped)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "build_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    failures.write(out_dir / "failures.json")
    log(f"완료: {report['total']}행 → {args.out} (실패 기록 {report['failures_count']}건, 건너뜀 {skipped}행)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
