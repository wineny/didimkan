"""로컬 SQLite 를 Turso 에 올린다 (계획 R4: 무중단 교체).

흐름: 안전장치 → <표>_new 생성 → 200행씩 INSERT → 한 트랜잭션에서 DROP·RENAME·인덱스 재생성 → COUNT 비교.
--dump 는 같은 내용을 SQL 파일로 만든다(turso db shell 백업 경로).

안전장치(--force 로 건너뜀): 로컬 courses 에 소스(std·portal·gangnam·seoul_*)가 하나라도 0행이면 중단,
원격 기존 courses 가 있고 로컬 행 수가 그 50% 미만이면 중단.

교체는 Hrana 스트림(baton)으로 문장을 하나씩 보내 결과를 확인한다. Hrana pipeline 은 한 문장이 실패해도
다음 문장을 계속 실행하므로, 한 요청에 몰아 보내면 RENAME 실패 뒤에도 COMMIT 이 돌 수 있기 때문이다.
하나라도 오류면 바로 ROLLBACK 을 보내고 끝낸다.
"""
import argparse
import base64
import re
import sqlite3
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = Path(__file__).resolve().parent / "schema.sql"
TABLES = ["courses", "institutions", "enrollment_patterns", "meta"]
TIMEOUT = 60
EXPECTED_SOURCES = ("std", "portal", "gangnam", "seoul")  # seoul = source LIKE 'seoul_%'
MIN_RATIO = 0.5
REMOTE_COUNT_SQL = "SELECT COUNT(*) AS n FROM courses"


def load_env(path):
    env = {}
    p = Path(path)
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def schema_statements():
    """schema.sql 을 (종류, 문장) 목록으로. 종류: drop | table | index."""
    text = re.sub(r"--[^\n]*", "", SCHEMA.read_text(encoding="utf-8"))
    out = []
    for stmt in (s.strip() for s in text.split(";")):
        if not stmt:
            continue
        head = stmt.upper()
        kind = "drop" if head.startswith("DROP") else "index" if head.startswith("CREATE INDEX") else "table"
        out.append((kind, stmt))
    return out


def staging_ddl():
    """(a) 임시 이름 표 생성 DDL, 교체 뒤에 만들 인덱스 DDL.

    RENAME 은 인덱스·CHECK 이름을 바꾸지 않고 인덱스 대상만 새 표로 따라간다.
    그래서 인덱스는 교체 뒤에 최종 이름으로 만든다. CHECK 이름은 표 안에서만 쓰여 충돌이 없다.
    """
    tables, indexes = [], []
    for kind, stmt in schema_statements():
        if kind == "table":
            tables.append(re.sub(r"^CREATE TABLE (\w+)", r"CREATE TABLE \1_new", stmt, count=1))
        elif kind == "index":
            indexes.append(stmt)
    return tables, indexes


def read_rows(conn, table):
    cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
    rows = conn.execute(f"SELECT {', '.join(cols)} FROM {table}").fetchall()
    return cols, rows


def insert_sql(table, cols):
    return f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})"


def to_arg(v):
    if v is None:
        return {"type": "null"}
    if isinstance(v, bool):
        return {"type": "integer", "value": str(int(v))}
    if isinstance(v, int):
        return {"type": "integer", "value": str(v)}
    if isinstance(v, float):
        return {"type": "float", "value": v}
    if isinstance(v, bytes):
        return {"type": "blob", "base64": base64.b64encode(v).decode()}
    return {"type": "text", "value": str(v)}


def execute(sql, args=None):
    stmt = {"sql": sql}
    if args is not None:
        stmt["args"] = [to_arg(a) for a in args]
    return {"type": "execute", "stmt": stmt}


def build_requests(conn, batch):
    """(이름, 요청 본문) 목록. 순서: 생성 → INSERT 배치들 → 교체 → COUNT."""
    new_tables, indexes = staging_ddl()
    reqs = []
    setup = [execute(f"DROP TABLE IF EXISTS {t}_new") for t in TABLES] + [execute(s) for s in new_tables]
    reqs.append(("create", {"requests": setup + [{"type": "close"}]}))
    counts = {}
    for t in TABLES:
        cols, rows = read_rows(conn, t)
        counts[t] = len(rows)
        sql = insert_sql(f"{t}_new", cols)
        for i in range(0, len(rows), batch):
            chunk = [execute(sql, list(r)) for r in rows[i:i + batch]]
            reqs.append((f"insert:{t}", {"requests": chunk + [{"type": "close"}]}))
    swap = [execute("BEGIN")]
    for t in TABLES:
        swap += [execute(f"DROP TABLE IF EXISTS {t}"), execute(f"ALTER TABLE {t}_new RENAME TO {t}")]
    swap += [execute(s) for s in indexes] + [execute("COMMIT")]
    reqs.append(("swap", {"requests": swap}))  # run_swap 이 문장 하나씩 보낸다
    count_q = [execute(f"SELECT COUNT(*) FROM {t}") for t in TABLES] + [{"type": "close"}]
    reqs.append(("count", {"requests": count_q}))
    return reqs, counts


def post_raw(url: str, token: str, body: dict) -> dict:
    """pipeline 요청 1건. HTTP 오류만 RuntimeError 로 올리고, 문장 결과는 호출자가 본다(토큰은 안 담음)."""
    r = requests.post(url, json=body, headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT)
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:500]}")
    return r.json()


def stmt_error(res: dict) -> str | None:
    if res.get("type") == "error":
        return str(res.get("error", {}).get("message", res))
    return None


def post(url, token, body):
    """pipeline 요청 1건. HTTP 오류와 문장 단위 오류를 모두 RuntimeError 로 올린다(토큰은 안 담음)."""
    data = post_raw(url, token, body)
    for i, res in enumerate(data.get("results", [])):
        if res.get("type") == "error":
            raise RuntimeError(f"문장 {i} 오류: {res.get('error', {}).get('message', res)}")
    return data


def local_source_counts(conn: sqlite3.Connection) -> dict[str, int]:
    counts = dict.fromkeys(EXPECTED_SOURCES, 0)
    for src, n in conn.execute("SELECT source, COUNT(*) FROM courses GROUP BY source"):
        key = "seoul" if src.startswith("seoul_") else src
        counts[key] = counts.get(key, 0) + n
    return counts


def remote_course_count(endpoint: str, token: str) -> int | None:
    """원격 기존 courses 행 수. 표가 없으면(첫 배포, 「no such table」) None.
    그 밖의 문장 오류·HTTP 오류는 RuntimeError 로 올려 중단한다(행 수를 모르는 채로 덮어쓰지 않게)."""
    data = post_raw(endpoint, token, {"requests": [execute(REMOTE_COUNT_SQL), {"type": "close"}]})
    res = data["results"][0]
    err = stmt_error(res)
    if err is not None:
        if "no such table" in err.lower():
            return None
        raise RuntimeError(f"원격 courses 행 수 조회 오류: {err}")
    return int(res["response"]["result"]["rows"][0][0]["value"])


def safety_problems(sources: dict[str, int], local_courses: int, remote_courses: int | None) -> list[str]:
    problems = [f"로컬 courses 에 소스 {s} 행이 0개" for s, n in sources.items() if n == 0]
    if remote_courses and local_courses < remote_courses * MIN_RATIO:
        problems.append(f"로컬 courses {local_courses}행이 원격 {remote_courses}행의 50% 미만")
    return problems


def _endpoint_from(data: dict, current: str) -> str:
    base = data.get("base_url")
    return base.rstrip("/") + "/v2/pipeline" if base else current


def run_swap(endpoint: str, token: str, stmts: list[dict]) -> bool:
    """교체 트랜잭션을 한 스트림에서 문장 하나씩 보낸다. 오류가 나면 ROLLBACK 을 보내고 False."""
    baton: str | None = None
    for i, stmt in enumerate(stmts):
        body: dict = {"requests": [stmt]}
        if baton:
            body["baton"] = baton
        try:
            data = post_raw(endpoint, token, body)
            err = stmt_error(data["results"][0])
            baton = data.get("baton") or baton
            endpoint = _endpoint_from(data, endpoint)
        except (RuntimeError, requests.RequestException, KeyError, IndexError, ValueError) as e:
            err = repr(e)
        if err is None:
            continue
        print(f"[swap] 문장 {i} 「{stmt['stmt']['sql']}」 오류: {err}", file=sys.stderr)
        if i == 0:
            print("[swap] BEGIN 이 실패해 아무것도 바뀌지 않음(원격 기존 표는 그대로)", file=sys.stderr)
            return False
        rollback(endpoint, token, baton)
        return False
    if baton:  # 스트림 닫기(실패해도 COMMIT 은 이미 끝남)
        try:
            post_raw(endpoint, token, {"baton": baton, "requests": [{"type": "close"}]})
        except (RuntimeError, requests.RequestException):
            pass
    return True


def rollback(endpoint: str, token: str, baton: str | None) -> bool:
    """ROLLBACK 을 보내고 실제로 성공했을 때만 「롤백됨」을 찍는다."""
    body: dict = {"requests": [execute("ROLLBACK"), {"type": "close"}]}
    if baton:
        body["baton"] = baton
    try:
        data = post_raw(endpoint, token, body)
        err = stmt_error(data["results"][0])
    except (RuntimeError, requests.RequestException, KeyError, IndexError, ValueError) as e:
        err = repr(e)
    if err is None:
        print("[swap] 롤백됨(원격 기존 표는 그대로)", file=sys.stderr)
        return True
    print(f"[swap] ROLLBACK 도 실패: {err} — 원격 DB 상태를 직접 확인하세요", file=sys.stderr)
    return False


def remote_counts(data):
    out = {}
    for t, res in zip(TABLES, data["results"]):
        out[t] = int(res["response"]["result"]["rows"][0][0]["value"])
    return out


def to_literal(conn, v):
    return conn.execute("SELECT quote(?)", (v,)).fetchone()[0]


def dump_sql(conn):
    parts = ["BEGIN;", SCHEMA.read_text(encoding="utf-8").rstrip()]
    for t in TABLES:
        cols, rows = read_rows(conn, t)
        for r in rows:
            vals = ", ".join(to_literal(conn, v) for v in r)
            parts.append(f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({vals});")
    parts.append("COMMIT;")
    return "\n".join(parts) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", default=str(ROOT / "data" / "didimkan.db"))
    ap.add_argument("--dump", help="SQL 파일만 만들고 종료")
    ap.add_argument("--env", default=str(ROOT / ".env.local"))
    ap.add_argument("--batch", type=int, default=200)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="안전장치(소스 0행·원격 대비 50%% 미만)를 건너뛴다")
    a = ap.parse_args(argv)

    if not Path(a.db).exists():
        print(f"DB 없음: {a.db}", file=sys.stderr)
        return 1
    conn = sqlite3.connect(a.db)

    if a.dump:
        Path(a.dump).write_text(dump_sql(conn), encoding="utf-8")
        print(f"dump 완료: {a.dump}")
        return 0

    reqs, local = build_requests(conn, a.batch)
    if a.dry_run:
        for name, body in reqs:
            n = len(body["requests"]) - (0 if name == "swap" else 1)
            print(f"{name}: 문장 {n}개")
        print(f"요청 {len(reqs)}건, 행 수 " + ", ".join(f"{t}={n}" for t, n in local.items()))
        return 0

    env = load_env(a.env)
    url = env.get("TURSO_DATABASE_URL", "").replace("libsql://", "https://", 1).rstrip("/")
    token = env.get("TURSO_AUTH_TOKEN", "")
    if not url or not token:
        print(f"{a.env} 에 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 이 필요합니다.", file=sys.stderr)
        return 1
    endpoint = url + "/v2/pipeline"

    try:
        remote_before = remote_course_count(endpoint, token)
    except (RuntimeError, requests.RequestException) as e:
        print(f"[check] 원격 행 수 확인 실패: {e}", file=sys.stderr)
        return 1
    problems = safety_problems(local_source_counts(conn), local["courses"], remote_before)
    if problems and not a.force:
        for msg in problems:
            print(f"[check] 중단: {msg} (그래도 올리려면 --force)", file=sys.stderr)
        return 1

    count_data = None
    for name, body in reqs:
        if name == "swap":
            if not run_swap(endpoint, token, body["requests"]):
                return 1
            continue
        try:
            data = post(endpoint, token, body)
        except (RuntimeError, requests.RequestException) as e:
            print(f"[{name}] 교체 전 실패(원격 기존 표는 그대로): {e}", file=sys.stderr)
            return 1
        if name == "count":
            count_data = data
    remote = remote_counts(count_data)
    ok = True
    for t in TABLES:
        print(f"{t} local={local[t]} remote={remote[t]}")
        ok &= local[t] == remote[t]
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
