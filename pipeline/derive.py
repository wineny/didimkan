"""파생 규칙(명세 §4-3 + 계획 §7 R3·R7·R15·R17·R18). 모두 순수 함수, 기준일은 `today` 인자로만 받는다.

세부 규칙(이 파일에서 정한 것):
- term_days = 종료일 - 시작일 + 1 (양 끝 포함). 시작=종료면 1. 날짜가 없거나 거꾸로면 None.
- category 우선순위: 춤 > 몸 풀기 > 악기 > 노래 > 미술·서예 > 어학.
  예) 「요가댄스」→춤, 「통기타 노래교실」→악기, 「서양화(회화)」→미술·서예, 「영어회화」→어학.
  「기타」는 뒤에 「등·교양·과정·강좌·프로그램·활동」이 오면 악기로 보지 않는다. 「그림책」은 미술 아님.
- 설명 기반 신호(basic 의 설명 부분·welcome·no_supplies)는 description 이 None 이거나
  source 가 gangnam·seoul_* 이면 만들지 않는다. 제목 기반 basic 은 허용.
- 3단은 term_days ≥ 28 또는 「시작·종료일이 둘 다 없음」(기간 없는 정기 운영) + weekday_bits > 0. 한쪽 날짜만
  있거나 거꾸로인 행은 NULL. 날짜 없는 쪽은 제목이 NON_COURSE_RE(대여·독서실·자유이용·헬스·개인레슨 등
  시설 이용)에 걸리면 NULL — 날짜가 있던 행은 기간 조건이 이 구실을 해 왔으므로 그쪽은 손대지 않는다.
- stair_reason 은 docs/contract.md §9 표 그대로: 1단 고정 문장 / 2단 소규모 > 1회 > 기초 / 3단 「N주 동안」,
  날짜 없는 정기 운영은 「매주 {요일}」. N = term_days/7 반올림(0.5 는 올림).
- apply_status 는 contract §10 판정 순서 1~6·8·9(7번 예측은 조회 쪽 몫). src/lib/status.ts 와 같은 결과.
- 예측: 접수시작일(today 이하) 중복 제거 → 7일 이내 이웃은 한 번의 오픈으로 묶음(build_patterns.py 방식)
  → 묶음 수 ≥ 3 일 때만 간격 중앙값으로 예측. 예상일이 today 보다 과거면 주기를 더한다(today 당일은 유지).
- 강남(source=gangnam): 권역은 contract §11 센터표(GANGNAM_ZONE_STEMS)로, 표에 없으면 강좌의
  apply_start 날짜(26→1권역, 27→2권역)로 판정. 그래도 모르면 next_open_estimate 없이 rule_note 만.
"""
from __future__ import annotations

import calendar
import json
import re
from datetime import date, timedelta
from statistics import median

from pipeline.common.parse import safe_http_url

WEEKDAYS = "월화수목금토일"
SIGNAL_KEYS = ("free", "basic", "small", "lottery", "once", "online", "welcome", "no_supplies")
FEE_LIMIT = 50_000
SMALL_MAX = 15

DONG_CENTER_RE = re.compile(r"동주민센터|행정복지센터|자치회관|주민자치|동\s*복합문화센터|복합문화센터|주민센터|커뮤니티센터")

CATEGORY_RULES: list[tuple[str, re.Pattern]] = [
    ("춤", re.compile(r"댄스|무용|에어로빅|줌바|탱고|살사|발레|벨리")),
    ("몸 풀기", re.compile(r"요가|필라테스|필라|단전|태극권|체조|헬스|스트레칭|기공|국선도")),
    ("악기", re.compile(
        r"기타(?!\s*(?:등|교양|과정|강좌|프로그램|활동))|우쿨렐레|가야금|사물놀이|피아노|오카리나"
        r"|하모니카|색소폰|드럼|바이올린|첼로|플루트|대금|해금|단소|장구|난타|칼림바")),
    ("노래", re.compile(r"노래|합창|가요|성악|보컬|민요|트로트|가곡")),
    ("미술·서예", re.compile(
        r"서예|수채화|그림(?!책)|캘리|미술|드로잉|유화|한국화|민화|서양화|문인화|크로키|스케치|붓글씨")),
    ("어학", re.compile(
        r"영어|일본어|일어|중국어|스페인어|프랑스어|독일어|베트남어|러시아어|한국어|토익|회화")),
]

BASIC_RE = re.compile(r"기초|입문|초급|초보|왕초보|처음")
WELCOME_RE = re.compile(r"처음|누구나|환영")
NO_SUPPLIES_RE = re.compile(r"준비물\s*[:：]?\s*없")

GANGNAM_RULE_NOTE = {
    1: "1권역 신규회원은 매월 26일 09시~말일 인터넷 접수. "
       "기존회원은 16~25일(주말·공휴일이면 그 전 평일까지) (fmcs/421)",
    2: "2권역 신규회원은 매월 27일 09시~말일 인터넷 접수. "
       "기존회원은 16~26일(주말·공휴일이면 그 전 평일까지) (fmcs/421)",
}
GANGNAM_NEW_START_DAY = {1: 26, 2: 27}
GANGNAM_UNKNOWN_NOTE = ("신규회원은 매월 26일(1권역)·27일(2권역) 09시~말일 인터넷 접수. "
                        "이 센터의 권역은 확인 안 됨 (fmcs/421)")
# contract §11 권역표. 기관명에서 공백을 뺀 뒤 이 낱말이 들어 있으면 그 권역.
GANGNAM_ZONE_STEMS = {
    1: ("신사", "논현1", "논현2", "청담", "삼성1", "삼성2", "역삼1", "역삼2", "도곡1", "도곡2"),
    2: ("대치1", "대치2", "대치4", "개포2", "개포4", "세곡", "자곡"),
}


def _d(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _no_description_source(row: dict) -> bool:
    src = row.get("source") or ""
    return row.get("description") is None or src == "gangnam" or src.startswith("seoul_")


def is_dong_center(institution: str | None, venue: str | None) -> int:
    text = f"{institution or ''} {venue or ''}"
    return 1 if DONG_CENTER_RE.search(text) else 0


def category(title: str | None) -> str | None:
    if not title:
        return None
    for name, pattern in CATEGORY_RULES:
        if pattern.search(title):
            return name
    return None


def term_days(start_date, end_date) -> int | None:
    s, e = _d(start_date), _d(end_date)
    if s is None or e is None or e < s:
        return None
    return (e - s).days + 1


def sessions_per_week(weekday_bits: int | None) -> int | None:
    if not weekday_bits:
        return None
    return bin(weekday_bits & 0x7F).count("1") or None


def _has_basic(row: dict) -> bool:
    if BASIC_RE.search(row.get("title") or ""):
        return True
    return not _no_description_source(row) and bool(BASIC_RE.search(row["description"]))


def _is_once(row: dict) -> bool:
    s, e = _d(row.get("start_date")), _d(row.get("end_date"))
    if s is not None and s == e:
        return True
    td = term_days(s, e)
    return td is not None and td <= 7


def signals(row: dict) -> list[str]:
    found: set[str] = set()
    if row.get("is_free"):
        found.add("free")
    if _has_basic(row):
        found.add("basic")
    cap = row.get("capacity")
    if cap is not None and 0 < cap <= SMALL_MAX:
        found.add("small")
    if row.get("selection_method") == "추첨":
        found.add("lottery")
    if _is_once(row):
        found.add("once")
    if row.get("is_online"):
        found.add("online")
    if not _no_description_source(row):
        desc = row["description"]
        if WELCOME_RE.search(desc):
            found.add("welcome")
        if NO_SUPPLIES_RE.search(desc):
            found.add("no_supplies")
    return [k for k in SIGNAL_KEYS if k in found]


def _fee_ok(row: dict) -> bool:
    # R18: fee_period(월·총)와 무관하게 fee_won 에 적용
    if row.get("is_free"):
        return True
    fee = row.get("fee_won")
    return fee is not None and fee <= FEE_LIMIT


CHILD_RE = re.compile(r"어린이|영유아|유아|초등|청소년|키즈|아동|미취학|초·중|초중|중학생|고등학생|초등학생")
ADULT_RE = re.compile(r"성인|어르신|노인|일반|주민|누구나|시민|중장년|시니어|고객|구민|군민|도민|성년|직장인|경력단절|부모|학부모|(?:만\s*)?(?:1[89]|[2-9]\d)세\s*이상")
AGE_RANGE_RE = re.compile(r"(?:만\s*)?(\d{1,2})\s*세?\s*[-~–]\s*(?:만\s*)?(\d{1,2})\s*세")


def is_for_children(title: str | None, target_raw: str | None) -> bool:
    """어린이·청소년 전용 강좌 판정(디딤칸 대상은 성인). 성인 표현이 함께 있으면 전용이 아니다."""
    t = title or ""
    g = target_raw or ""
    if ADULT_RE.search(g):
        return False
    if CHILD_RE.search(g) or CHILD_RE.search(t):
        return True
    m = AGE_RANGE_RE.search(g)
    if m and int(m.group(2)) < 19:
        return True
    return False


def stair(row: dict) -> int | None:
    if is_for_children(row.get("title"), row.get("target_raw")):
        return None  # 어린이·청소년 전용은 계단에 올리지 않는다
    online = bool(row.get("is_online"))
    if online:
        return 1 if row.get("is_free") else None
    if not _fee_ok(row):
        return None
    if _has_basic(row) or _is_once(row):
        return 2
    if (row.get("weekday_bits") or 0) <= 0:
        return None
    if _no_dates(row):
        # 기간 없는 정기 운영(동주민센터 프로그램 등): 날짜 없이 요일만 있으면 정기 모임으로 본다.
        # 단 시설 이용권·대여·개인레슨은 「같은 시간에 만나는」 모임이 아니므로 뺀다.
        return None if NON_COURSE_RE.search(row.get("title") or "") else 3
    td = term_days(row.get("start_date"), row.get("end_date"))
    if td is not None and td >= 28:
        return 3
    return None


NON_COURSE_RE = re.compile(r"대여|독서실|자유이용|자유수영|자율|개인레슨|헬스|락커|사물함")


def _no_dates(row: dict) -> bool:
    """시작·종료일이 둘 다 없음. 한쪽만 있거나 거꾸로인 행은 해당 없음(term_days None 과 다르다)."""
    return not row.get("start_date") and not row.get("end_date")


def _weekday_text(row: dict) -> str:
    if row.get("weekdays"):
        return row["weekdays"].replace(",", "·")
    bits = row.get("weekday_bits") or 0
    return "·".join(WEEKDAYS[i] for i in range(7) if bits & (1 << i))


def _basic_reason(row: dict) -> str | None:
    m = BASIC_RE.search(row.get("title") or "")
    where = "강좌명"
    if m is None and not _no_description_source(row):
        m = BASIC_RE.search(row["description"])
        where = "설명"
    if m is None:
        return None
    return f"{where}에 「{m.group(0)}」 표시가 있어 처음이어도 괜찮아요"


def stair_reason(row: dict, stair: int | None) -> str | None:
    """contract §9: 계단별로 위에서부터 처음 맞는 문장 하나. 저장된 값으로만 만든다."""
    if stair == 1:
        return "집에서 무료로 들어 볼 수 있어요"
    if stair == 2:
        cap = row.get("capacity")
        if cap is not None and 0 < cap <= SMALL_MAX:
            return f"{cap}명 소규모라 얼굴을 익히기 쉬워요"
        if _is_once(row):
            return "한 번으로 끝나 부담이 적어요"
        return _basic_reason(row)
    if stair == 3:
        if _no_dates(row):
            return f"매주 {_weekday_text(row)} 같은 시간에 만나요"
        td = term_days(row.get("start_date"), row.get("end_date"))
        if td is None:
            return None
        weeks = int(td / 7 + 0.5)
        return f"{weeks}주 동안 {_weekday_text(row)} 같은 시간에 만나요"
    return None


def apply_status(row: dict, today: date) -> str:
    """contract §10 판정 순서. 7번(예측 → before)은 enrollment_patterns 를 조인하는 조회 쪽이 한다."""
    if row.get("is_always_open"):
        return "always"
    start, end = _d(row.get("apply_start")), _d(row.get("apply_end"))
    course_end = _d(row.get("end_date"))
    if start is not None and end is not None and start > end:
        return "unknown"  # 날짜 오류: 지어내지 않는다
    if end is not None and today > end:
        return "closed"
    if start is not None:
        if today < start:
            return "before"
        if end is None and course_end is not None and today > course_end:
            return "closed"
        return "open"
    if course_end is not None and today > course_end:
        return "closed"
    return "unknown"


def gangnam_zone(institution: str | None) -> int | None:
    """강남 권역(1·2). 기관명만으로 is_dong_center(institution, None)=1 인 곳(동 복합문화센터·커뮤니티센터)만 판정한다.
    체육시설·평생학습관 등은 이름에 동 이름이 들어 있어도(「청담 평생학습관」) 접수 창이 달라 None."""
    if not is_dong_center(institution, None):
        return None
    name = (institution or "").replace(" ", "")
    for zone, stems in GANGNAM_ZONE_STEMS.items():
        if any(stem in name for stem in stems):
            return zone
    return None


def gangnam_window(ref: date, zone: int) -> tuple[str, str, str]:
    """신규회원 창(R17). ref = 강좌 시작일(시작월의 아무 날) → 그 전달 26/27일~말일.
    contract §11 「빌드일이 속한 달의 창」이 필요하면 ref 에 빌드일의 다음 달 날짜를 넣는다."""
    if zone not in GANGNAM_NEW_START_DAY:
        raise ValueError(f"권역은 1 또는 2: {zone}")
    prev = ref.replace(day=1) - timedelta(days=1)
    last_day = calendar.monthrange(prev.year, prev.month)[1]
    start = prev.replace(day=GANGNAM_NEW_START_DAY[zone])
    end = prev.replace(day=last_day)
    return start.isoformat(), end.isoformat(), GANGNAM_RULE_NOTE[zone]


def _next_gangnam_open(zone: int, today: date) -> date:
    day = GANGNAM_NEW_START_DAY[zone]
    candidate = today.replace(day=day)
    if candidate < today:
        nxt = today.replace(day=1) + timedelta(days=32)
        candidate = nxt.replace(day=day)
    return candidate


def _merge_clusters(days: list[date], max_gap: int = 7) -> list[date]:
    anchors: list[date] = []
    prev: date | None = None
    for d in days:
        if prev is None or (d - prev).days > max_gap:
            anchors.append(d)
        prev = d
    return anchors


def _gangnam_zone(inst: str, rows: list[dict]) -> int | None:
    zone = gangnam_zone(inst)
    if zone is not None:
        return zone
    zones = set()
    for r in rows:
        d = _d(r.get("apply_start"))
        if d is not None and d.day in (26, 27):
            zones.add(1 if d.day == 26 else 2)
    return zones.pop() if len(zones) == 1 else None


def build_patterns(rows: list[dict], today: date) -> list[dict]:
    groups: dict[tuple[str, str | None], list[dict]] = {}
    for r in rows:
        inst = r.get("institution")
        if not inst:
            continue
        groups.setdefault((inst, r.get("sigungu")), []).append(r)

    out: list[dict] = []
    for (inst, sigungu), items in groups.items():
        if any(r.get("source") == "gangnam" for r in items):
            if not is_dong_center(inst, None):
                continue  # 강남 체육시설·평생학습관 등: 신규 창 규칙이 없으니 패턴 행도 만들지 않는다
            zone = _gangnam_zone(inst, items)
            out.append({
                "institution": inst,
                "sigungu": sigungu,
                "open_history": "[]",
                "cycle_days": None,
                "next_open_estimate": _next_gangnam_open(zone, today).isoformat() if zone else None,
                "basis_count": 0,
                "rule_note": GANGNAM_RULE_NOTE[zone] if zone else GANGNAM_UNKNOWN_NOTE,
                "is_estimate": 0,
            })
            continue
        history = sorted({d for d in (_d(r.get("apply_start")) for r in items)
                          if d is not None and d <= today})
        anchors = _merge_clusters(history)
        if len(anchors) < 3:
            continue
        cycle = int(median((b - a).days for a, b in zip(anchors, anchors[1:])))
        expected = anchors[-1] + timedelta(days=cycle)
        while expected < today:
            expected += timedelta(days=cycle)
        out.append({
            "institution": inst,
            "sigungu": sigungu,
            "open_history": json.dumps([d.isoformat() for d in anchors]),
            "cycle_days": cycle,
            "next_open_estimate": expected.isoformat(),
            "basis_count": len(anchors),
            "rule_note": None,
            "is_estimate": 1,
        })
    return out


def derive_all(rows: list[dict], today: date) -> list[dict]:
    """파생 컬럼을 채운 새 dict 목록. today 는 계약상 받지만 courses 저장 컬럼은 today 에 의존하지 않는다."""
    out: list[dict] = []
    for r in rows:
        row = dict(r)
        # 링크는 http(s) 만 남긴다(javascript:·data: 차단). 소스 모듈마다 거르지 않고 여기 한 곳에서.
        row["detail_url"] = safe_http_url(row.get("detail_url"))
        row["homepage_url"] = safe_http_url(row.get("homepage_url"))
        # contract §6(수정 2026-10-10): 강남 REST 에는 체육관·테니스장도 섞여 있어
        # 기관명으로 판정한다(「복합문화센터」 포함 시 1).
        row["is_dong_center"] = is_dong_center(row.get("institution"), row.get("venue"))
        row["category"] = category(row.get("title"))
        row["term_days"] = term_days(row.get("start_date"), row.get("end_date"))
        row["sessions_per_week"] = sessions_per_week(row.get("weekday_bits"))
        row["signals"] = json.dumps(signals(row), separators=(",", ":"))
        row["stair"] = stair(row)
        row["stair_reason"] = stair_reason(row, row["stair"])
        out.append(row)
    return out
