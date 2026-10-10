"""R5: 재게시 금지 소스(gangnam·seoul) fixture 에 설명류 키·긴 본문이 없는지 검사."""
import json
import re
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"
BAD_KEY = re.compile(r"desc|content|intro|memo|remark|note|detail|summary|comment|bigo|teacher", re.I)
MAX_LEN = 120


def _walk(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            yield from _walk(k, f"{path}/key")
            yield from _walk(v, f"{path}/{k}")
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v, path)
    else:
        yield path, node


def _files():
    found = []
    for sub in ("gangnam", "seoul"):
        d = FIXTURES / sub
        if d.is_dir():
            found += sorted(d.glob("*.json"))
    return found


@pytest.mark.parametrize("path", _files() or [pytest.param(None, marks=pytest.mark.skip("fixture 없음"))])
def test_no_description_keys_or_long_text(path):
    data = json.loads(path.read_text(encoding="utf-8"))

    def keys(n):
        if isinstance(n, dict):
            for k, v in n.items():
                yield k
                yield from keys(v)
        elif isinstance(n, list):
            for v in n:
                yield from keys(v)

    bad = [k for k in keys(data) if BAD_KEY.search(k)]
    assert not bad, f"{path.name}: 설명류 키 {bad}"
    long_ = [(p, len(v)) for p, v in _walk(data) if isinstance(v, str) and len(v) > MAX_LEN]
    assert not long_, f"{path.name}: {MAX_LEN}자 넘는 문자열 {long_[:3]}"
