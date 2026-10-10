import json

import pytest

from pipeline.common import http
from pipeline.common.failures import Failures


class Clock:
    def __init__(self):
        self.t = 100.0
        self.sleeps = []

    def monotonic(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s


@pytest.fixture
def env(monkeypatch):
    clock = Clock()
    calls = []
    monkeypatch.setattr(http, "_monotonic", clock.monotonic)
    monkeypatch.setattr(http, "_sleep", clock.sleep)
    monkeypatch.setattr(http, "_last_request", {})
    monkeypatch.setattr(http, "_robots_cache", {})
    monkeypatch.setattr(http, "failures", Failures())

    def fake_request(method, url, headers, data, timeout):
        calls.append((method, url, headers))
        return b"ok"

    monkeypatch.setattr(http, "_do_request", fake_request)
    monkeypatch.setattr(http, "_fetch_robots", lambda origin: "")
    return clock, calls


def test_same_host_min_interval(env):
    clock, calls = env
    http.get("https://example.org/a")
    http.get("https://example.org/b")
    assert len(calls) == 2
    assert max(clock.sleeps) >= 1.0 - 1e-9


def test_data_go_kr_interval_and_no_robots(env, monkeypatch):
    clock, calls = env
    monkeypatch.setattr(http, "_fetch_robots", lambda o: pytest.fail("robots 조회 금지"))
    http.get("https://www.data.go.kr/x")
    http.get("https://www.data.go.kr/y")
    assert len(calls) == 2
    assert clock.sleeps and 0.3 - 1e-9 <= max(clock.sleeps) < 1.0


def test_robots_disallow_blocks_request(env, monkeypatch):
    clock, calls = env
    monkeypatch.setattr(http, "_fetch_robots", lambda o: "User-agent: *\nDisallow: /private\n")
    with pytest.raises(http.RobotsBlocked):
        http.get("https://example.org/private/x", source="s1")
    assert calls == []
    assert http.failures.items[0]["reason"] == "robots"
    assert http.failures.items[0]["source"] == "s1"
    assert http.get("https://example.org/public") == b"ok"
    assert len(calls) == 1


def test_robots_unavailable_blocks_with_note(env, monkeypatch):
    # RFC 9309: robots.txt 가 5xx·네트워크 오류면 그 호스트 전체를 막는다.
    clock, calls = env
    monkeypatch.setattr(http, "_fetch_robots", lambda o: None)
    with pytest.raises(http.RobotsBlocked):
        http.get("https://example.org/x", source="s2")
    assert calls == []
    assert [f["reason"] for f in http.failures.items] == ["robots_unavailable", "robots"]
    # 캐시돼서 두 번째도 막히고 robots.txt 를 다시 받지 않는다.
    monkeypatch.setattr(http, "_fetch_robots", lambda o: pytest.fail("재조회 금지"))
    with pytest.raises(http.RobotsBlocked):
        http.get("https://example.org/y")


def test_robots_network_error_blocks(env, monkeypatch):
    clock, calls = env

    def down(origin):
        raise OSError("timeout")

    monkeypatch.setattr(http, "_fetch_robots", down)
    assert http.robots_allowed("https://example.org/x") is False
    assert http.failures.items[0]["reason"] == "robots_unavailable"
    assert "OSError" in http.failures.items[0]["detail"]


def test_robots_missing_4xx_allows(monkeypatch):
    class Resp:
        status_code = 404
        text = "not found"

    monkeypatch.setattr(http, "_robots_cache", {})
    monkeypatch.setattr(http, "_last_request", {})
    monkeypatch.setattr(http, "failures", Failures())
    monkeypatch.setattr(http.requests, "get", lambda *a, **k: Resp())
    assert http._fetch_robots("https://example.org") == ""
    assert http.robots_allowed("https://example.org/x") is True
    assert http.failures.items == []


def test_robots_5xx_is_unavailable(monkeypatch):
    class Resp:
        status_code = 503
        text = ""

    monkeypatch.setattr(http.requests, "get", lambda *a, **k: Resp())
    assert http._fetch_robots("https://example.org") is None


def test_retry_then_fail(env, monkeypatch):
    clock, calls = env

    def boom(*a, **k):
        calls.append(1)
        raise OSError("down")

    monkeypatch.setattr(http, "_do_request", boom)
    with pytest.raises(OSError):
        http.get("https://www.data.go.kr/x")
    assert len(calls) == 3  # 최초 1 + 재시도 2
    assert http.failures.items[-1]["reason"] == "http_error"


def test_post_headers(env):
    clock, calls = env
    http.post("https://www.data.go.kr/p", data={"a": 1}, referer="https://www.data.go.kr/")
    method, _, headers = calls[0]
    assert method == "POST"
    assert headers["User-Agent"].startswith("didimkan-collector/0.1")
    assert headers["Referer"] == "https://www.data.go.kr/"


def test_failures_write(tmp_path):
    f = Failures()
    f.add("src", "robots", "https://e.org/x", "d")
    out = f.write(tmp_path / "out" / "failures.json")
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data[0]["source"] == "src" and "at" in data[0]


def test_network_blocked():
    import socket
    with pytest.raises(RuntimeError):
        socket.getaddrinfo("example.org", 80)
