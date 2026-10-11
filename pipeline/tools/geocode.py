"""카카오 로컬 API 로 좌표를 채운다 (「가까운 순」 실제 거리용).

두 가지 일을 한다.
  regions : DB 의 시도·시군구·동 이름마다 카카오 「행정구역 대표 위치」를 받아 src/lib/centroids.json 으로 쓴다.
  courses : 강좌마다 주소 검색 → 실패하면 장소·기관 이름 키워드 검색으로 lat·lng 를 채운다(주어진 DB 파일만 고친다).

    python pipeline/tools/geocode.py regions --db ../didimkan/data/didimkan.db
    python pipeline/tools/geocode.py courses --db data/geo-test.db

키는 .env.local 의 KAKAO_REST_API_KEY. 응답은 pipeline/out/geocode_cache.json 에 쌓아 같은 질의를 다시 보내지 않는다
(실패도 저장한다. 다시 시도하려면 캐시 파일을 지운다).
검색 결과가 그 강좌의 시군구 밖이면 버린다(동명 장소 오인 방지). 못 찾은 강좌는 lat·lng 를 비워 둔다.
"""
import argparse
import json
import math
import re
import sqlite3
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "pipeline" / "out" / "geocode_cache.json"
CENTROIDS = ROOT / "src" / "lib" / "centroids.json"
API = "https://dapi.kakao.com/v2/local/search"
TIMEOUT = 10
WORKERS = 6
RETRY_WAITS = (1, 2, 4, 8, 0)  # 429·5xx 재시도 간격(초), 마지막은 포기
PROTECTED = {"didimkan.db"}  # 실제 빌드 결과는 courses 모드로 직접 고치지 않는다


def load_key() -> str:
    env = ROOT / ".env.local"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip().removeprefix("export ").strip()
            if line.startswith("KAKAO_REST_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("KAKAO_REST_API_KEY 가 .env.local 에 없다")


class Kakao:
    def __init__(self, key: str) -> None:
        self.key = key
        self.local = threading.local()  # requests.Session 은 스레드마다 따로
        self.cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
        self.lock = threading.Lock()
        self.calls = 0

    def search(self, kind: str, query: str) -> list[dict]:
        """kind = address | keyword. 문서 목록(실패면 [])."""
        ck = f"{kind}:{query}"
        with self.lock:
            if ck in self.cache:
                return self.cache[ck]
        if not hasattr(self.local, "s"):
            self.local.s = requests.Session()
            self.local.s.headers["Authorization"] = f"KakaoAK {self.key}"
        for wait in RETRY_WAITS:
            r = self.local.s.get(f"{API}/{kind}.json", params={"query": query, "size": 5}, timeout=TIMEOUT)
            if r.status_code not in (429, 500, 502, 503, 504):
                break
            time.sleep(wait)
        if r.status_code != 200:
            raise RuntimeError(f"카카오 {r.status_code}: {r.text[:200]}")
        docs = [
            {
                "name": d.get("place_name") or d.get("address_name"),
                "addr": d.get("address_name") or "",
                "road": d.get("road_address_name") or (d.get("road_address") or {}).get("address_name") or "",
                "type": d.get("address_type"),
                "r2": (d.get("address") or {}).get("region_2depth_name", ""),
                "r3": (d.get("address") or {}).get("region_3depth_name", ""),
                "r3h": (d.get("address") or {}).get("region_3depth_h_name", ""),
                "lat": round(float(d["y"]), 6),
                "lng": round(float(d["x"]), 6),
            }
            for d in r.json().get("documents", [])
        ]
        with self.lock:
            self.cache[ck] = docs
            self.calls += 1
        return docs

    def save(self) -> None:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        tmp = CACHE.with_suffix(".tmp")  # 쓰다 끊겨도 캐시가 깨지지 않게
        with self.lock:
            tmp.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")
        tmp.replace(CACHE)


def in_gu(doc: dict, sigungu: str | None) -> bool:
    """결과 주소가 그 시군구 안인가. 시군구가 없으면(세종 등) 통과."""
    if not sigungu:
        return True
    return sigungu in f"{doc['addr']} {doc['road']}".split()


# ---------- regions ----------

def region_point(k: Kakao, sido: str, sigungu: str | None = None, dong: str | None = None) -> list[float] | None:
    if dong:
        names = {dong, f"{dong}읍", f"{dong}면"}  # 원본이 「봉동읍」을 「봉동」으로 줄여 둔 경우
        for q in (f"{sido} {sigungu} {dong}", f"{sigungu} {dong}", f"{sigungu} {dong}읍", f"{sigungu} {dong}면"):
            for d in k.search("address", q):
                if d["type"] == "REGION" and names & {d["r3"], d["r3h"]} and in_gu(d, sigungu):
                    return [d["lat"], d["lng"]]
        # 구가 나뉘어 이름이 바뀐 곳(예: 인천 서구 → 서해구·검단구): 카카오가 그 구를 모를 때만, 시도 안에서 그 동이 하나뿐이면 받는다
        if region_point(k, sido, sigungu):
            return None
        hits = [d for d in k.search("address", f"{sido} {dong}") if d["type"] == "REGION" and dong in (d["r3"], d["r3h"])]
        return [hits[0]["lat"], hits[0]["lng"]] if len(hits) == 1 else None
    q = f"{sido} {sigungu}" if sigungu else sido
    for d in k.search("address", q):
        if d["type"] == "REGION" and (in_gu(d, sigungu) if sigungu else not d["r2"]):
            return [d["lat"], d["lng"]]
    return None


def cmd_regions(args: argparse.Namespace, k: Kakao) -> None:
    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT DISTINCT sido, sigungu, dong FROM courses WHERE sido IS NOT NULL"
    ).fetchall()
    sidos = sorted({r[0] for r in rows})
    gus = sorted({(r[0], r[1]) for r in rows if r[1]})
    dongs = sorted({(r[0], r[1], r[2]) for r in rows if r[1] and r[2]})
    out = {"sido": {}, "gu": {}, "dong": {}}
    miss = {"sido": [], "gu": [], "dong": []}
    jobs = [("sido", (s,)) for s in sidos] + [("gu", g) for g in gus] + [("dong", d) for d in dongs]
    with ThreadPoolExecutor(WORKERS) as ex:
        res = list(ex.map(lambda j: region_point(k, *j[1]), jobs))
    for (lvl, key), p in zip(jobs, res):
        (out[lvl].__setitem__("|".join(key), p) if p else miss[lvl].append("|".join(key)))
    derived = []
    for g in list(miss["gu"]):
        pts = [v for kk, v in out["dong"].items() if kk.startswith(f"{g}|")]
        if pts:
            out["gu"][g] = [round(sum(p[0] for p in pts) / len(pts), 6), round(sum(p[1] for p in pts) / len(pts), 6)]
            miss["gu"].remove(g)
            derived.append(f"{g}: 카카오에 없는 옛 이름이라 그 구 동 대표점 {len(pts)}개 평균")
    k.save()
    payload = {
        "source": "카카오 로컬 API 주소 검색(행정구역 대표 위치, address_type=REGION)",
        "fetchedAt": date.today().isoformat(),
        "derived": derived,
        "missing": miss,
        **{lvl: dict(sorted(v.items())) for lvl, v in out.items()},
    }
    CENTROIDS.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for lvl in ("sido", "gu", "dong"):
        n = len(out[lvl]) + len(miss[lvl])
        print(f"{lvl}: {len(out[lvl])}/{n} 찾음, 못 찾음 {miss[lvl][:10]}{' …' if len(miss[lvl]) > 10 else ''}")
    print(f"→ {CENTROIDS.relative_to(ROOT)} (API 호출 {k.calls}회)")


# ---------- courses ----------

PAREN = re.compile(r"\s*[(（][^)）]*[)）]")
DETAIL = re.compile(r"^(.*?\d+(?:-\d+)?)(?!\s*(?:번길|길))(?:\s|,|$).*")  # 도로명·지번 번호까지만(「7 길」의 7 은 아님)
ROOM = re.compile(r"\s*(?:지하\s*)?\d+\s*층.*$|\s*\d+호.*$")  # 「… 2층 회의실」 같은 층·호실 꼬리
ROADLIKE = re.compile(r"\d*(?:번길|길|로)\s*\d")  # 장소 칸에 도로명 주소가 들어 있는 경우
DONG_CENTER = ("주민센터", "행정복지센터")  # 파이프라인이 만든 「구 ○○동 주민센터」 기관명은 믿을 만하다
MAX_KM_DONG, MAX_KM_GU, MAX_KM_SIDO = 5, 25, 60
ADDR_TYPES = {"ROAD_ADDR", "REGION_ADDR"}  # 건물·지번까지 맞은 결과만(도로 전체 ROAD·행정구역 REGION 은 버림)


def clean_addr(a: str) -> str:
    a = PAREN.sub("", a).strip()
    m = DETAIL.match(a)
    return m.group(1) if m else a


def km(p: list[float], q: list[float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (p[0], p[1], q[0], q[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def near_enough(d: dict, cen: dict, sido: str, sigungu: str | None, dong: str | None, use_dong: bool = True) -> bool:
    """결과가 그 동(use_dong 일 때) → 구 → 시도 대표점에서 너무 멀면 엉뚱한 곳(같은 이름 다른 구 등)으로 본다."""
    pt = [d["lat"], d["lng"]]
    for ref, lim in (
        (cen["dong"].get(f"{sido}|{sigungu}|{dong}") if use_dong else None, MAX_KM_DONG),
        (cen["gu"].get(f"{sido}|{sigungu}"), MAX_KM_GU),
        (cen["sido"].get(sido), MAX_KM_SIDO),
    ):
        if ref:
            return km(pt, ref) <= lim
    return False


def course_point(k: Kakao, cen: dict, address: str | None, venue: str | None, institution: str | None,
                 sido: str, sigungu: str | None, dong: str | None) -> tuple[float, float, str] | None:
    """(lat, lng, how) 또는 None. how = address | keyword."""
    place = PAREN.sub("", venue or "").strip()
    addrs = [address.strip(), clean_addr(address)] if address else []
    if place and ROADLIKE.search(place):
        addrs.append(f"{sido} {sigungu or ''} {clean_addr(place)}")
    for q in dict.fromkeys(addrs):
        for d in k.search("address", q):
            # 주소는 운영 기관 주소일 때가 있어 동이 아니라 구(없으면 시도) 거리로만 본다
            if d["type"] in ADDR_TYPES and in_gu(d, sigungu) and near_enough(d, cen, sido, sigungu, dong, use_dong=False):
                return d["lat"], d["lng"], "address"
    names = [ROOM.sub("", place).strip(), institution or ""]
    if institution and any(w in institution for w in DONG_CENTER):
        names.reverse()
    for name in dict.fromkeys(n for n in names if len(n) >= 3):
        q = name if sigungu and name.startswith(f"{sigungu} ") else f"{sigungu or sido} {name}"
        for d in k.search("keyword", q):
            if in_gu(d, sigungu) and near_enough(d, cen, sido, sigungu, dong):
                return d["lat"], d["lng"], "keyword"
    return None


def cmd_courses(args: argparse.Namespace, k: Kakao) -> None:
    db = Path(args.db).resolve()
    if db.name in PROTECTED and not args.force:
        sys.exit(f"{db.name} 는 직접 고치지 않는다. 복사본에 돌리거나 --force")
    if not db.exists():
        sys.exit(f"{db} 가 없다")
    con = sqlite3.connect(f"file:{db}?mode=rw", uri=True)
    rows = con.execute(
        "SELECT address, venue, institution, sido, sigungu, dong, COUNT(*) FROM courses"
        " WHERE stair IS NOT NULL AND is_online = 0"
        " GROUP BY address, venue, institution, sido, sigungu, dong"
    ).fetchall()
    cen = json.loads(CENTROIDS.read_text(encoding="utf-8"))
    with ThreadPoolExecutor(WORKERS) as ex:
        res = list(ex.map(lambda r: course_point(k, cen, *r[:6]), rows))
    k.save()
    stat = {"address": 0, "keyword": 0, "miss": 0}
    total = sum(r[6] for r in rows)
    upd = []
    for r, p in zip(rows, res):
        stat[p[2] if p else "miss"] += r[6]
        upd.append((p[0], p[1], *r[:6]) if p else (None, None, *r[:6]))  # 못 찾으면 옛 좌표도 지운다
    con.executemany(
        "UPDATE courses SET lat = ?, lng = ? WHERE address IS ? AND venue IS ? AND institution IS ?"
        " AND sido IS ? AND sigungu IS ? AND dong IS ? AND stair IS NOT NULL AND is_online = 0",
        upd,
    )
    con.commit()
    pct = lambda n: f"{n} ({n * 100 / max(total, 1):.1f}%)"
    print(f"강좌 {total}건(장소 묶음 {len(rows)}개): 주소 {pct(stat['address'])} · 이름 {pct(stat['keyword'])} · 못 찾음 {pct(stat['miss'])}")
    print(f"API 호출 {k.calls}회 → {db.name} lat·lng 갱신")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["regions", "courses"])
    ap.add_argument("--db", required=True)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    k = Kakao(load_key())
    try:
        (cmd_regions if args.mode == "regions" else cmd_courses)(args, k)
    finally:
        k.save()


if __name__ == "__main__":
    main()
