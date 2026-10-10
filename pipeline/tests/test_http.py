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


def test_robots_unavailable_allows_with_note(env, monkeypatch):
    clock, calls = env
    monkeypatch.setattr(http, "_fetch_robots", lambda o: None)
    assert http.get("https://example.org/x") == b"ok"
    assert [f["reason"] for f in http.failures.items] == ["robots_unavailable"]


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
