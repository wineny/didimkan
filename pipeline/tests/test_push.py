"""push_turso: --dump 재적재와 HTTP 요청 순서 검증 (네트워크 0)."""
import sqlite3

import pytest

from pipeline import push_turso as pt


def make_db(path, n_courses=3):
    conn = sqlite3.connect(path)
    conn.executescript(pt.SCHEMA.read_text(encoding="utf-8"))
    for i in range(n_courses):
        conn.execute(
            "INSERT INTO courses (id, source, collected_at, title, description, lat, category) "
            "VALUES (?, 'std', '2026-10-10', ?, 'it''s; ok', ?, '춤')",
            (f"c{i}", f"강좌{i}", 37.5 + i),
        )
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


def ok_body(body):
    res = []
    for r in body["requests"]:
        if r["type"] == "close":
            res.append({"type": "ok", "response": {"type": "close"}})
        else:
            sql = r["stmt"]["sql"]
            rows = [[{"type": "integer", "value": "3" if "courses" in sql else "1"}]] if sql.startswith("SELECT COUNT") else []
            res.append({"type": "ok", "response": {"type": "execute", "result": {"rows": rows}}})
    return {"results": res}


def run_http(tmp_path, monkeypatch, fail_on=None, batch=2):
    db, env = tmp_path / "a.db", tmp_path / "env"
    make_db(db)
    env.write_text("TURSO_DATABASE_URL=libsql://x.turso.io\nTURSO_AUTH_TOKEN=secret-token\n")
    sent = []

    def fake_post(url, json=None, headers=None, timeout=None):
        sent.append((url, json, headers))
        sqls = " ".join(r["stmt"]["sql"] for r in json["requests"] if r["type"] == "execute")
        if fail_on and fail_on in sqls:
            return FakeResp(500, {"error": "boom"})
        return FakeResp(200, ok_body(json))

    monkeypatch.setattr(pt.requests, "post", fake_post)
    code = pt.main(["--db", str(db), "--env", str(env), "--batch", str(batch)])
    return code, sent


def kind(body):
    s = " ".join(r["stmt"]["sql"] for r in body["requests"] if r["type"] == "execute")
    if "ALTER TABLE" in s:
        return "swap"
    if s.startswith("SELECT COUNT"):
        return "count"
    if s.startswith("INSERT"):
        return "insert"
    return "create"


def test_http_order_and_batches(tmp_path, monkeypatch, capsys):
    code, sent = run_http(tmp_path, monkeypatch)
    assert code == 0
    kinds = [kind(b) for _, b, _ in sent]
    assert kinds[0] == "create" and kinds[-2:] == ["swap", "count"]
    assert set(kinds[1:-2]) == {"insert"}
    inserts = [b for _, b, _ in sent if kind(b) == "insert"]
    assert all(len(b["requests"]) - 1 <= 2 for b in inserts)  # 배치 크기 2
    assert sum(len(b["requests"]) - 1 for b in inserts) == 3 + 1 + 1 + 1
    assert all(u == "https://x.turso.io/v2/pipeline" for u, _, _ in sent)
    assert all("Authorization" in h for _, _, h in sent)
    assert "courses local=3 remote=3" in capsys.readouterr().out


def test_http_failure_before_swap(tmp_path, monkeypatch):
    code, sent = run_http(tmp_path, monkeypatch, fail_on="INSERT INTO courses_new")
    assert code == 1
    assert "swap" not in [kind(b) for _, b, _ in sent]
