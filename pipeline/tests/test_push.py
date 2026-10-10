"""push_turso: --dump 재적재와 HTTP 요청 순서 검증 (네트워크 0)."""
import sqlite3

import pytest

from pipeline import push_turso as pt


def make_db(path, n_courses=3):
    """std n_courses 행 + portal·gangnam·seoul_* 각 1행(안전장치의 소스별 0행 검사를 통과)."""
    conn = sqlite3.connect(path)
    conn.executescript(pt.SCHEMA.read_text(encoding="utf-8"))
    for i in range(n_courses):
        conn.execute(
            "INSERT INTO courses (id, source, collected_at, title, description, lat, category) "
            "VALUES (?, 'std', '2026-10-10', ?, 'it''s; ok', ?, '춤')",
            (f"c{i}", f"강좌{i}", 37.5 + i),
        )
    for src in ("portal", "gangnam", "seoul_gangdong"):
        conn.execute("INSERT INTO courses (id, source, collected_at, title) VALUES (?, ?, '2026-10-10', 'x')",
                     (f"s-{src}", src))
    conn.execute("INSERT INTO institutions VALUES ('센터', '강남구', NULL, 'std')")
    conn.execute("INSERT INTO enrollment_patterns (institution) VALUES ('센터')")
    conn.execute("INSERT INTO meta VALUES ('built', '2026-10-10')")
    conn.commit()
    conn.close()


def counts(path):
    c = sqlite3.connect(path)
    return {t: c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in pt.TABLES}


def test_dump_reloads(tmp_path):
    src, out, dst = tmp_path / "a.db", tmp_path / "d.sql", tmp_path / "b.db"
    make_db(src)
    assert pt.main(["--db", str(src), "--dump", str(out)]) == 0
    c = sqlite3.connect(dst)
    c.executescript(out.read_text(encoding="utf-8"))  # CHECK 위반이면 여기서 예외
    c.close()
    assert counts(dst) == counts(src)
    row = sqlite3.connect(dst).execute("SELECT description, lat FROM courses WHERE id='c1'").fetchone()
    assert row == ("it's; ok", 38.5)


class FakeResp:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, str(body)

    def json(self):
        return self._body


LOCAL_COURSES = 3 + 3


def result_for(sql, remote_before):
    if sql == pt.REMOTE_COUNT_SQL:
        if remote_before is None:
            return {"type": "error", "error": {"message": "no such table: courses"}}
        n = remote_before
    elif sql.startswith("SELECT COUNT"):
        n = LOCAL_COURSES if "courses" in sql else 1
    else:
        return {"type": "ok", "response": {"type": "execute", "result": {"rows": []}}}
    return {"type": "ok", "response": {"type": "execute",
                                       "result": {"rows": [[{"type": "integer", "value": str(n)}]]}}}


def run_http(tmp_path, monkeypatch, fail_on=None, stmt_error_on=(), remote_before=None, args=(),
             batch=2, n_courses=3):
    """가짜 Hrana 서버. fail_on: 그 SQL 이 든 요청은 HTTP 500. stmt_error_on: 그 SQL 문장만 오류 결과."""
    db, env = tmp_path / "a.db", tmp_path / "env"
    make_db(db, n_courses)
    env.write_text("TURSO_DATABASE_URL=libsql://x.turso.io\nTURSO_AUTH_TOKEN=secret-token\n")
    sent = []

    def fake_post(url, json=None, headers=None, timeout=None):
        sent.append((url, json, headers))
        sqls = " ".join(r["stmt"]["sql"] for r in json["requests"] if r["type"] == "execute")
        if fail_on and fail_on in sqls:
            return FakeResp(500, {"error": "boom"})
        res = []
        for r in json["requests"]:
            if r["type"] == "close":
                res.append({"type": "ok", "response": {"type": "close"}})
            elif any(e in r["stmt"]["sql"] for e in stmt_error_on):
                res.append({"type": "error", "error": {"message": "boom"}})
            else:
                res.append(result_for(r["stmt"]["sql"], remote_before))
        return FakeResp(200, {"baton": "b1", "base_url": None, "results": res})

    monkeypatch.setattr(pt.requests, "post", fake_post)
    code = pt.main(["--db", str(db), "--env", str(env), "--batch", str(batch), *args])
    return code, sent


def sqls_of(body):
    return [r["stmt"]["sql"] for r in body["requests"] if r["type"] == "execute"]


def kind(body):
    q = sqls_of(body)
    if not q:
        return "close"
    first = q[0]
    if first == pt.REMOTE_COUNT_SQL:
        return "check"
    if first.startswith("INSERT"):
        return "insert"
    if first.startswith("SELECT COUNT"):
        return "count"
    if first.startswith("DROP TABLE IF EXISTS") and first.endswith("_new"):
        return "create"
    return "swap"  # BEGIN·DROP·RENAME·CREATE INDEX·COMMIT·ROLLBACK


def test_http_order_and_batches(tmp_path, monkeypatch, capsys):
    code, sent = run_http(tmp_path, monkeypatch)
    assert code == 0
    kinds = [kind(b) for _, b, _ in sent]
    assert kinds[0] == "check" and kinds[1] == "create" and kinds[-1] == "count"
    first_swap = kinds.index("swap")
    assert set(kinds[2:first_swap]) == {"insert"}
    assert set(kinds[first_swap:-1]) == {"swap", "close"}
    inserts = [b for _, b, _ in sent if kind(b) == "insert"]
    assert all(len(b["requests"]) - 1 <= 2 for b in inserts)  # 배치 크기 2
    assert sum(len(b["requests"]) - 1 for b in inserts) == LOCAL_COURSES + 1 + 1 + 1
    assert all(u == "https://x.turso.io/v2/pipeline" for u, _, _ in sent)
    assert all("Authorization" in h for _, _, h in sent)
    # 교체는 한 문장씩, BEGIN 다음부터 같은 baton 으로
    swaps = [b for _, b, _ in sent if kind(b) == "swap"]
    assert all(len(sqls_of(b)) == 1 for b in swaps)
    assert sqls_of(swaps[0]) == ["BEGIN"] and "baton" not in swaps[0]
    assert all(b.get("baton") == "b1" for b in swaps[1:])
    assert sqls_of(swaps[-1]) == ["COMMIT"]
    assert f"courses local={LOCAL_COURSES} remote={LOCAL_COURSES}" in capsys.readouterr().out


def test_http_failure_before_swap(tmp_path, monkeypatch):
    code, sent = run_http(tmp_path, monkeypatch, fail_on="INSERT INTO courses_new")
    assert code == 1
    assert "swap" not in [kind(b) for _, b, _ in sent]


def test_rename_error_rolls_back_without_commit(tmp_path, monkeypatch, capsys):
    code, sent = run_http(tmp_path, monkeypatch, stmt_error_on=("ALTER TABLE institutions_new RENAME",))
    assert code == 1
    all_sqls = [q for _, b, _ in sent for q in sqls_of(b)]
    assert "COMMIT" not in all_sqls  # 교체 미확정
    assert all_sqls[-1] == "ROLLBACK"
    rb = sent[-1][1]
    assert rb["baton"] == "b1" and rb["requests"][-1]["type"] == "close"
    # 오류 뒤에는 다음 문장을 보내지 않는다
    assert all_sqls[all_sqls.index("ALTER TABLE institutions_new RENAME TO institutions") + 1] == "ROLLBACK"
    assert "count" not in [kind(b) for _, b, _ in sent]
    assert "롤백됨" in capsys.readouterr().err


def test_rollback_failure_is_not_reported_as_rolled_back(tmp_path, monkeypatch, capsys):
    code, sent = run_http(tmp_path, monkeypatch, stmt_error_on=("ALTER TABLE courses_new RENAME", "ROLLBACK"))
    assert code == 1
    err = capsys.readouterr().err
    assert "롤백됨" not in err and "ROLLBACK 도 실패" in err


def test_guard_missing_source_stops_before_writes(tmp_path, monkeypatch, capsys):
    code, sent = run_http(tmp_path, monkeypatch, n_courses=0)  # std 0행
    assert code == 1
    assert [kind(b) for _, b, _ in sent] == ["check"]
    assert "소스 std 행이 0개" in capsys.readouterr().err


def test_guard_shrink_vs_remote(tmp_path, monkeypatch, capsys):
    code, sent = run_http(tmp_path, monkeypatch, remote_before=LOCAL_COURSES * 2 + 1)
    assert code == 1
    assert [kind(b) for _, b, _ in sent] == ["check"]
    assert "50% 미만" in capsys.readouterr().err


def test_guard_exactly_half_passes(tmp_path, monkeypatch):
    code, _ = run_http(tmp_path, monkeypatch, remote_before=LOCAL_COURSES * 2)
    assert code == 0


def test_guard_force(tmp_path, monkeypatch):
    code, sent = run_http(tmp_path, monkeypatch, remote_before=1000, args=("--force",))
    assert code == 0
    assert "COMMIT" in [q for _, b, _ in sent for q in sqls_of(b)]
