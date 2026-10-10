"""수집 실패·참고 기록기. 소스 모듈이 공용으로 쓴다."""
import json
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "out" / "failures.json"


class Failures:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def add(self, source: str, reason: str, url: str, detail: str | None = None) -> None:
        self.items.append(
            {
                "source": source,
                "reason": reason,
                "url": url,
                "detail": detail,
                "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
        )

    def write(self, path: Path | str = DEFAULT_PATH) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.items, ensure_ascii=False, indent=2), encoding="utf-8")
        return path
