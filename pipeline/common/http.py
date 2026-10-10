"""예의 있는 HTTP: 호스트별 최소 간격, robots.txt 준수(data.go.kr 제외), 재시도 2회."""
import time
import urllib.robotparser
from urllib.parse import urlsplit

import requests

from .failures import Failures

USER_AGENT = "didimkan-collector/0.1 (+https://github.com/wineny/didimkan)"
ROBOTS_TOKEN = "didimkan-collector"
RETRIES = 2
BACKOFF_BASE = 1.0
DEFAULT_INTERVAL = 1.0
HOST_INTERVALS = {"data.go.kr": 0.3, "www.data.go.kr": 0.3}
NO_ROBOTS_HOSTS = {"data.go.kr", "www.data.go.kr"}

# 테스트에서 가짜 시계·가짜 요청으로 바꿀 수 있게 모듈 변수로 둔다.
_monotonic = time.monotonic
_sleep = time.sleep

failures = Failures()  # 기본 공용 기록기
_last_request: dict[str, float] = {}
_robots_cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}


class RobotsBlocked(Exception):
    pass


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def _throttle(host: str) -> None:
    interval = HOST_INTERVALS.get(host, DEFAULT_INTERVAL)
    last = _last_request.get(host)
    if last is not None:
        wait = interval - (_monotonic() - last)
        if wait > 0:
            _sleep(wait)
    _last_request[host] = _monotonic()


def _fetch_robots(origin: str) -> str | None:
    """robots.txt 본문. 없음(4xx)은 빈 문자열(전부 허용), 못 받으면 None."""
    resp = requests.get(origin + "/robots.txt", headers={"User-Agent": USER_AGENT}, timeout=15)
    if resp.status_code >= 500:
        return None
    if resp.status_code >= 400:
        return ""
    return resp.text


def robots_allowed(url: str, source: str = "http", failures_: Failures | None = None) -> bool:
    host = _host(url)
    if host in NO_ROBOTS_HOSTS:
        return True
    parts = urlsplit(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    if host not in _robots_cache:
        rp = None
        try:
            _throttle(host)
            body = _fetch_robots(origin)
        except Exception as e:  # noqa: BLE001 - 네트워크 오류는 모두 '못 받음'
            body = None
            detail = repr(e)
        else:
            detail = "status>=500"
        if body is None:
            (failures_ or failures).add(source, "robots_unavailable", origin + "/robots.txt", detail)
        else:
            rp = urllib.robotparser.RobotFileParser()
            rp.parse(body.splitlines())
        _robots_cache[host] = rp
    rp = _robots_cache[host]
    return True if rp is None else rp.can_fetch(ROBOTS_TOKEN, url)


def _do_request(method: str, url: str, headers: dict, data, timeout: int) -> bytes:
    resp = requests.request(method, url, headers=headers, data=data, timeout=timeout)
    resp.raise_for_status()
    return resp.content


def _send(method, url, data, referer, timeout, source, failures_):
    f = failures_ or failures
    if _host(url) not in NO_ROBOTS_HOSTS and not robots_allowed(url, source, f):
        f.add(source, "robots", url)
        raise RobotsBlocked(url)
    headers = {"User-Agent": USER_AGENT}
    if referer:
        headers["Referer"] = referer
    host = _host(url)
    last_exc: Exception | None = None
    for attempt in range(RETRIES + 1):
        if attempt:
            _sleep(BACKOFF_BASE * 2 ** (attempt - 1))
        _throttle(host)
        try:
            return _do_request(method, url, headers, data, timeout)
        except Exception as e:  # noqa: BLE001
            last_exc = e
    f.add(source, "http_error", url, repr(last_exc))
    raise last_exc  # type: ignore[misc]


def get(url, *, referer=None, timeout=30, source="http", failures=None) -> bytes:
    return _send("GET", url, None, referer, timeout, source, failures)


def post(url, data=None, *, referer=None, timeout=30, source="http", failures=None) -> bytes:
    return _send("POST", url, data, referer, timeout, source, failures)
