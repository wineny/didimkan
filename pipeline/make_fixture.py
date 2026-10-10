"""e2e·로컬용 fixture.db 와 e2e/fixture-ids.json 을 만든다(네트워크 0).

- std: 옛 DB(kakao-mcp-공모전/data/courses.db)의 실제 강좌 10건 → 표준데이터 원자료 25컬럼 CSV →
  std.normalize (실제 코드 경로 재사용)
- gangnam·seoul·portal: tests/fixtures 축약본 → build.py 의 오프라인 입력 함수
- today: 9632 가 접수 전/중, 2722 가 추첨, 8218 이 상시가 되는 실제 날짜를 옛 DB 값으로 계산해 고른다.
"""
from __future__ import annotations

import argparse
import csv
import json
import sqlite3
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import build, derive  # noqa: E402
from pipeline.common.failures import Failures  # noqa: E402
from pipeline.sources import std  # noqa: E402

OLD_DB = ROOT.parent.parent / "kakao-mcp-공모전" / "data" / "courses.db"
OUT_DB = ROOT / "data" / "fixture.db"
IDS_JSON = ROOT / "e2e" / "fixture-ids.json"
OLD_IDS = (8218, 8243, 9407, 9632, 9788, 9635, 9639, 10132, 10096, 2722)
MAX_ROWS = 300
# 옛 DB 한글 컬럼 중 이름이 달라진 것(원문 컬럼 → 표준데이터 컬럼)
RENAMED = {"운영요일_원문": "운영요일", "수강료_원문": "수강료"}


def old_rows(old_db: Path) -> list[dict]:
    con = sqlite3.connect(f"file:{old_db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    marks = ",".join("?" for _ in OLD_IDS)
    found = [dict(r) for r in con.execute(f"SELECT * FROM courses WHERE id IN ({marks})", OLD_IDS)]
    con.close()
    missing = set(OLD_IDS) - {int(r["id"]) for r in found}
    if missing:
        raise SystemExit(f"옛 DB 에 없는 id: {sorted(missing)}")
    return sorted(found, key=lambda r: OLD_IDS.index(int(r["id"])))


def normalize_old(rows: list[dict], work: Path, collected_at: str) -> dict[int, dict]:
    """옛 행 → 출처파일별 CSV(utf-8-sig) → std.normalize. 옛 id → 정규화된 행."""
    by_file: dict[str, list[dict]] = {}
    for r in rows:
        by_file.setdefault(r["출처파일"], []).append(r)
    result: dict[int, dict] = {}
    for name, group in by_file.items():
        path = work / f"{name}.csv"
        with path.open("w", encoding="utf-8-sig", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=std.EXPECTED_COLS)
            w.writeheader()
            for r in group:
                rec = {c: "" for c in std.EXPECTED_COLS}
                for key, val in r.items():
                    col = RENAMED.get(key, key)
                    if col in rec:
                        rec[col] = "" if val is None else str(val)
                w.writerow(rec)
        out = std.normalize(path, collected_at=collected_at)
        if len(out) != len(group):
            raise SystemExit(f"{name}: CSV {len(group)}행 → 정규화 {len(out)}행")
        for r, norm in zip(group, out):
            result[int(r["id"])] = norm
    return result


def pick_today(std_rows: dict[int, dict]) -> tuple[date, str]:
    """2026 한 해를 훑어 조건을 가장 많이 만족하는 날 중 9632 접수 창 한가운데를 고른다."""
    derived = {k: derive.derive_all([v], date(2026, 1, 1))[0] for k, v in std_rows.items()}
    lottery = derived[2722]["selection_method"] == "추첨"
    best: list[tuple[int, int, date]] = []
    d = date(2026, 1, 1)
    while d.year == 2026:
        s9632 = derive.apply_status(derived[9632], d)
        score = (s9632 in ("before", "open")) + lottery + (derive.apply_status(derived[8218], d) == "always")
        best.append((score, 1 if s9632 == "open" else 0, d))
        d += timedelta(days=1)
    top = max(b[0] for b in best)
    days = [b for b in best if b[0] == top]
    open_days = [b[2] for b in days if b[1]]
    pool = open_days or [b[2] for b in days]
    chosen = pool[len(pool) // 2]
    a = derived[9632]
    reason = (f"점수 {top}/3. 9632 접수 {a['apply_start']}~{a['apply_end']} 의 가운데 날. "
              f"2722 선정방법={derived[2722]['selection_method']}, 8218 상시={derived[8218]['is_always_open']}")
    return chosen, reason


def build_fixture(old_db: Path = OLD_DB, out_db: Path = OUT_DB, ids_json: Path = IDS_JSON) -> dict:
    rows_old = old_rows(old_db)
    with tempfile.TemporaryDirectory(prefix="didim-fixture-") as tmp:
        probe = normalize_old(rows_old, Path(tmp), "2026-01-01")
        today, reason = pick_today(probe)
        stamp = today.isoformat()
        std_rows = normalize_old(rows_old, Path(tmp), stamp)

    failures = Failures()
    rows: list[dict] = list(std_rows.values())
    rows += build.offline_gangnam(stamp, today)
    rows += build.offline_seoul(stamp, failures)
    rows += build.offline_portal(stamp, failures)
    if not 1 <= len(rows) <= MAX_ROWS:
        raise SystemExit(f"fixture 행 수가 범위 밖: {len(rows)}")
    if any(r.get("description") for r in rows if r["source"] == "gangnam" or r["source"].startswith("seoul_")):
        raise SystemExit("R5 위반: gangnam·seoul 행에 description 이 있다")

    final, _counts, skipped = build.finalize(rows, today, out_db, failures, today_hint=stamp)
    ids = {str(k): v["id"] for k, v in std_rows.items()}  # assign_unique_ids 가 id 를 제자리에서 바꾼다
    ids_json.parent.mkdir(parents=True, exist_ok=True)
    ids_json.write_text(json.dumps(
        {"today": stamp, "sido": "서울특별시", "sigungu": "강남구", "ids": ids},
        ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"fixture {len(final)}행 → {out_db} (건너뜀 {skipped}, 실패 기록 {len(failures.items)})", file=sys.stderr)
    print(f"today={stamp}: {reason}", file=sys.stderr)
    return {"today": stamp, "reason": reason, "rows": len(final), "ids": ids}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="e2e fixture.db 생성")
    ap.add_argument("--old-db", default=str(OLD_DB))
    ap.add_argument("--out", default=str(OUT_DB))
    ap.add_argument("--ids", default=str(IDS_JSON))
    args = ap.parse_args(argv)
    build_fixture(Path(args.old_db), Path(args.out), Path(args.ids))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
