"""derive.py 파생 규칙 테스트. 날짜는 모두 인자로 넣는다(하드코딩된 오늘 없음)."""
import json
import re
from datetime import date

import pytest

from pipeline import derive
from pipeline.derive import (
    SIGNAL_KEYS, apply_status, build_patterns, category, derive_all, gangnam_window,
    gangnam_zone, is_dong_center, sessions_per_week, signals, stair, stair_reason, term_days,
)

BANNED = re.compile(r"창구|대신|고독사 위험|수강생 [0-9]+명")


def course(**kw) -> dict:
    base = {
        "source": "std", "title": "강좌", "description": "설명", "institution": "어느 기관",
        "sigungu": "강남구", "venue": None, "capacity": None, "is_free": 0, "fee_won": None,
        "fee_period": None, "is_online": 0, "selection_method": None, "start_date": None,
        "end_date": None, "weekday_bits": 0, "apply_start": None, "apply_end": None,
        "is_always_open": 0,
    }
    base.update(kw)
    return base


# ---------- 단순 함수 ----------

def test_is_dong_center():
    assert is_dong_center("역삼1동주민센터", None) == 1
    assert is_dong_center("구청", "대치2동 행정복지센터 3층") == 1
    assert is_dong_center("도곡2동복합문화센터", None) == 1
    assert is_dong_center("국립국악원", "예악당") == 0
    assert is_dong_center(None, None) == 0


def test_term_days_and_sessions():
    assert term_days("2026-10-01", "2026-10-01") == 1
    assert term_days("2026-10-01", "2026-10-28") == 28
    assert term_days("2026-10-05", "2026-10-01") is None
    assert term_days(None, "2026-10-01") is None
    assert sessions_per_week(0) is None
    assert sessions_per_week(0b0000101) == 2  # 월·수
    assert sessions_per_week(127) == 7


@pytest.mark.parametrize("title,expected", [
    ("요가댄스", "춤"),                 # 춤 > 몸 풀기
    ("한국무용 기초", "춤"),
    ("실버 건강체조", "몸 풀기"),
    ("통기타 노래교실", "악기"),        # 악기 > 노래
    ("노래교실", "노래"),
    ("서양화(회화)", "미술·서예"),      # 미술 > 어학(회화)
    ("영어회화 초급", "어학"),
    ("캘리그라피", "미술·서예"),
    ("기타 교양 강좌", None),           # 「기타 교양」은 악기 아님
    ("그림책 읽기", None),
    ("컴퓨터 활용", None),
    (None, None),
])
def test_category_priority(title, expected):
    assert category(title) == expected


# ---------- 신호 ----------

def test_signal_keys_subset_of_contract():
    row = course(is_free=1, title="왕초보 요가", description="처음 오셔도 누구나 환영, 준비물 없음",
                 capacity=12, selection_method="추첨", start_date="2026-10-10",
                 end_date="2026-10-10", is_online=1)
    got = signals(row)
    assert set(got) <= set(SIGNAL_KEYS)
    assert got == list(SIGNAL_KEYS)  # 8개 모두, 계약 순서대로


def test_no_description_source_has_no_description_signals():
    for src in ("gangnam", "seoul_gangdong"):
        row = course(source=src, title="기초 서예", description=None)
        got = signals(row)
        assert "basic" in got  # 제목 기반은 허용
        assert "welcome" not in got and "no_supplies" not in got
    # 설명이 있어도 gangnam 이면 설명 기반 신호를 만들지 않는다
    row = course(source="gangnam", title="서예", description="처음 누구나 준비물 없음")
    assert signals(row) == []


def test_description_basic_only_from_description_sources():
    assert "basic" in signals(course(title="서예", description="입문 과정입니다"))
    assert "basic" not in signals(course(title="서예", description=None))


def test_once_by_term_days():
    assert "once" in signals(course(start_date="2026-10-01", end_date="2026-10-07"))
    assert "once" not in signals(course(start_date="2026-10-01", end_date="2026-10-08"))


# ---------- 계단 ----------

def test_stair_1_online_free():
    assert stair(course(is_online=1, is_free=1)) == 1


def test_stair_online_paid_is_null():
    assert stair(course(is_online=1, is_free=0, fee_won=10000)) is None


def test_stair_2_basic():
    assert stair(course(title="기초 요가", fee_won=30000)) == 2


def test_stair_2_monthly_fee():
    # fee_period 와 무관(수강료 조건 자체가 없다, 2026-10-11)
    assert stair(course(title="입문 서예", fee_won=18000, fee_period="월")) == 2


def test_stair_3_regular():
    row = course(title="서예", is_free=1, start_date="2026-10-01", end_date="2026-12-31",
                 weekday_bits=0b0000101)
    assert stair(row) == 3


def test_stair_both_match_prefers_2():
    row = course(title="기초 서예", is_free=1, start_date="2026-10-01", end_date="2026-12-31",
                 weekday_bits=0b0000001)
    assert stair(row) == 2


def test_stair_2_3_have_no_fee_condition():
    # 2026-10-11: 2·3단에 수강료 조건 없음. 비싸도, 몰라도 올린다(1단만 무료 조건).
    assert stair(course(title="기초 서예", fee_won=60000, start_date="2026-10-01",
                        end_date="2026-12-31", weekday_bits=1)) == 2
    assert stair(course(title="기초 서예", fee_won=None, is_free=0)) == 2
    assert stair(course(title="서예", fee_won=None, is_free=0, weekday_bits=0b101)) == 3
    assert stair(course(title="서예", fee_won=350000, start_date="2026-10-01", end_date="2026-12-31",
                        weekday_bits=1)) == 3


def test_stair_3_needs_weekdays():
    row = course(title="서예", is_free=1, start_date="2026-10-01", end_date="2026-12-31",
                 weekday_bits=0)
    assert stair(row) is None


def test_stair_3_no_dates_weekly():
    # 상시 운영: 날짜가 둘 다 없고 요일만 있으면 3단(동주민센터 프로그램 꼴)
    assert stair(course(title="서예", fee_won=10000, weekday_bits=0b101)) == 3
    assert stair(course(title="서예", is_free=1, weekday_bits=1)) == 3


def test_stair_3_no_dates_still_needs_weekdays():
    assert stair(course(title="서예", is_free=1, weekday_bits=0)) is None
    assert stair(course(title="서예", is_free=1, weekday_bits=None)) is None


def test_stair_no_dates_other_rules_still_first():
    # 2단 우선, 온라인은 1단 규칙, 어린이 전용은 NULL — 날짜 없는 행에서도 그대로
    assert stair(course(title="기초 서예", is_free=1, weekday_bits=1)) == 2
    assert stair(course(title="서예", is_online=1, is_free=1, weekday_bits=1)) == 1
    assert stair(course(title="서예", is_online=1, fee_won=10000, weekday_bits=1)) is None
    assert stair(course(title="어린이 서예", is_free=1, weekday_bits=1)) is None


@pytest.mark.parametrize("title", [
    "헬스월수금", "자유수영11시_매일", "자율탁구4", "★탁구개인레슨2", "독서실", "자치회관 공유물품 대여",
    "새벽배드민턴(자유이용)", "락커 월이용",
])
def test_stair_3_no_dates_excludes_facility_use(title: str):
    # 시설 이용권·대여·개인레슨은 「같은 시간에 만나는」 모임이 아니다
    assert stair(course(title=title, is_free=1, weekday_bits=0b11111)) is None


def test_stair_3_dated_rows_not_affected_by_facility_words():
    # 날짜가 있던 행은 기간 조건이 걸러 왔으므로 규칙을 바꾸지 않는다(후속 과제)
    row = course(title="헬스월수금", is_free=1, start_date="2026-10-01", end_date="2026-12-31",
                 weekday_bits=0b10101)
    assert stair(row) == 3


def test_stair_3_one_sided_or_reversed_dates_is_null():
    assert stair(course(title="서예", is_free=1, start_date="2026-10-01", weekday_bits=1)) is None
    assert stair(course(title="서예", is_free=1, end_date="2026-12-31", weekday_bits=1)) is None
    reversed_ = course(title="서예", is_free=1, start_date="2026-12-31", end_date="2026-10-01",
                       weekday_bits=1)
    assert stair(reversed_) is None


# ---------- 계단 이유 ----------

def test_stair_reason_texts():
    assert stair_reason(course(is_online=1, is_free=1), 1) == "집에서 무료로 들어 볼 수 있어요"
    # 2단: 소규모 > 1회 > 기초
    once_small = course(capacity=15, start_date="2026-10-10", end_date="2026-10-10")
    assert stair_reason(once_small, 2) == "15명 소규모라 얼굴을 익히기 쉬워요"
    once = course(capacity=30, title="기초", start_date="2026-10-10", end_date="2026-10-10")
    assert stair_reason(once, 2) == "한 번으로 끝나 부담이 적어요"
    assert stair_reason(course(title="왕초보 서예"), 2) == "강좌명에 「왕초보」 표시가 있어 처음이어도 괜찮아요"
    assert stair_reason(course(title="서예", description="입문 과정"), 2) == \
        "설명에 「입문」 표시가 있어 처음이어도 괜찮아요"
    # 3단: N주 동안 요일
    reg = course(start_date="2026-10-01", end_date="2026-12-31", weekdays="월,수", weekday_bits=0b101)
    assert stair_reason(reg, 3) == "13주 동안 월·수 같은 시간에 만나요"
    four = course(start_date="2026-10-01", end_date="2026-10-28", weekday_bits=0b0010001)
    assert stair_reason(four, 3) == "4주 동안 월·금 같은 시간에 만나요"
    # 3단 상시 운영: 날짜가 없으니 주 수를 지어내지 않고 「매주」
    always = course(weekdays="화,목", weekday_bits=0b1010)
    assert stair_reason(always, 3) == "매주 화·목 같은 시간에 만나요"
    assert stair_reason(course(start_date="2026-10-01", weekday_bits=1), 3) is None
    assert stair_reason(course(), None) is None


def test_stair_reason_max_40_chars():
    row = course(title="왕초보", start_date="2026-01-01", end_date="2026-12-31", weekday_bits=127,
                 weekdays="월,화,수,목,금,토,일")
    for s in (1, 2, 3):
        assert len(stair_reason(row, s)) <= 40


def test_stair_reason_no_banned_words():
    rows = [
        course(is_online=1, is_free=1),
        course(capacity=3, title="기초"), course(capacity=99, weekday_bits=127),
        course(start_date="2026-10-10", end_date="2026-10-10"), course(title="입문"),
        course(capacity=25, weekday_bits=0b1000000),
    ]
    for r in rows:
        for s in (1, 2, 3):
            text = stair_reason(r, s) or ""
            assert not BANNED.search(text), text


# ---------- 접수 상태 ----------

def test_apply_status_boundaries():
    row = course(apply_start="2026-10-05", apply_end="2026-10-15")
    assert apply_status(row, date(2026, 10, 4)) == "before"
    assert apply_status(row, date(2026, 10, 5)) == "open"   # 시작 당일
    assert apply_status(row, date(2026, 10, 15)) == "open"  # 마감 당일
    assert apply_status(row, date(2026, 10, 16)) == "closed"


def test_apply_status_always_and_unknown():
    today = date(2026, 10, 10)
    assert apply_status(course(is_always_open=1, apply_end="2020-01-01"), today) == "always"
    assert apply_status(course(), today) == "unknown"
    assert apply_status(course(end_date="2026-10-09"), today) == "closed"
    assert apply_status(course(end_date="2026-10-10"), today) == "unknown"


def test_apply_status_partial_dates():
    # contract §10: 시작일 없이 마감일만 있고 안 지났으면 unknown, 시작만 있고 지났으면 open
    today = date(2026, 10, 10)
    assert apply_status(course(apply_end="2026-10-12"), today) == "unknown"
    assert apply_status(course(apply_end="2026-10-09"), today) == "closed"
    assert apply_status(course(apply_start="2026-10-01"), today) == "open"
    assert apply_status(course(apply_start="2026-10-11"), today) == "before"
    # (c) 시작일 > 마감일(거꾸로)은 날짜 오류 → unknown
    assert apply_status(course(apply_start="2026-10-20", apply_end="2026-10-01"), today) == "unknown"
    assert apply_status(course(apply_start="2026-10-05", apply_end="2026-10-01"), today) == "unknown"


def test_apply_status_unified_rules():
    # 리드 결정 C3: status.ts 와 같은 입력 → 같은 결과
    today = date(2026, 10, 10)
    # (a) 시작일 없이 마감일만 → unknown(예측은 조회 쪽)
    assert apply_status(course(apply_end="2026-10-31", end_date="2026-12-31"), today) == "unknown"
    # (b) 시작일만: 강좌 종료일 지났으면 closed, 아니면 open
    assert apply_status(course(apply_start="2026-09-01", end_date="2026-10-09"), today) == "closed"
    assert apply_status(course(apply_start="2026-09-01", end_date="2026-10-10"), today) == "open"
    assert apply_status(course(apply_start="2026-09-01"), today) == "open"
    # 마감일이 있으면 강좌 종료일은 보지 않는다
    assert apply_status(course(apply_start="2026-09-01", apply_end="2026-10-20", end_date="2026-10-01"), today) == "open"
    # (c) 거꾸로 → unknown
    assert apply_status(course(apply_start="2026-11-01", apply_end="2026-10-20"), today) == "unknown"


# ---------- 강남 권역 ----------

def test_gangnam_window_october_course():
    s1, e1, n1 = gangnam_window(date(2026, 10, 1), 1)
    s2, e2, n2 = gangnam_window(date(2026, 10, 15), 2)
    assert (s1, e1) == ("2026-09-26", "2026-09-30")
    assert (s2, e2) == ("2026-09-27", "2026-09-30")
    assert n1.startswith("1권역 신규회원은 매월 26일") and "기존회원은 16~25일" in n1
    assert n2.startswith("2권역 신규회원은 매월 27일") and "기존회원은 16~26일" in n2
    assert "fmcs/421" in n1 and "fmcs/421" in n2


def test_gangnam_zone_table():
    assert gangnam_zone("역삼1동복합문화센터") == 1
    assert gangnam_zone("논현2동 복합문화센터") == 1
    assert gangnam_zone("대치4동복합문화센터") == 2
    assert gangnam_zone("세곡커뮤니티센터") == 2
    assert gangnam_zone("압구정동복합문화센터") is None
    # C4: 동 복합문화센터·커뮤니티센터가 아니면 동 이름이 들어 있어도 권역 없음
    assert gangnam_zone("강남세곡체육공원 체육시설") is None
    assert gangnam_zone("청담 평생학습관") is None


@pytest.mark.parametrize("today,z1,z2", [
    (date(2026, 9, 25), "before", "before"),
    (date(2026, 9, 26), "open", "before"),
    (date(2026, 9, 27), "open", "open"),
    (date(2026, 9, 30), "open", "open"),
    (date(2026, 10, 1), "closed", "closed"),
])
def test_gangnam_window_boundaries(today, z1, z2):
    for zone, expected in ((1, z1), (2, z2)):
        s, e, _ = gangnam_window(date(2026, 10, 1), zone)
        assert apply_status(course(apply_start=s, apply_end=e), today) == expected


def test_gangnam_window_february_end():
    assert gangnam_window(date(2027, 3, 1), 1)[:2] == ("2027-02-26", "2027-02-28")
    assert gangnam_window(date(2028, 3, 10), 2)[:2] == ("2028-02-27", "2028-02-29")
    assert gangnam_window(date(2027, 1, 5), 1)[:2] == ("2026-12-26", "2026-12-31")


def test_gangnam_window_bad_zone():
    with pytest.raises(ValueError):
        gangnam_window(date(2026, 10, 1), 3)


# ---------- 접수일 예측 ----------

def _hist(*dates, inst="A복지관", sigungu="영등포구"):
    return [course(institution=inst, sigungu=sigungu, apply_start=d) for d in dates]


def test_patterns_two_history_no_row():
    rows = _hist("2026-03-02", "2026-06-01")
    assert build_patterns(rows, date(2026, 7, 1)) == []


def test_patterns_three_history_value():
    rows = _hist("2026-03-02", "2026-06-01", "2026-09-01", "2026-09-01")  # 중복 제거
    [p] = build_patterns(rows, date(2026, 9, 10))
    assert p["cycle_days"] == 91
    assert p["next_open_estimate"] == "2026-12-01"
    assert p["basis_count"] == 3 and p["is_estimate"] == 1
    assert json.loads(p["open_history"]) == ["2026-03-02", "2026-06-01", "2026-09-01"]
    assert p["institution"] == "A복지관" and p["sigungu"] == "영등포구"


def test_patterns_past_estimate_rolls_over():
    rows = _hist("2026-01-01", "2026-02-01", "2026-03-04")  # 간격 31·31 → 31
    [p] = build_patterns(rows, date(2026, 6, 1))
    assert p["cycle_days"] == 31
    # 3/4+31=4/4, 5/5, 6/5 → 오늘(6/1) 이후 첫 회차
    assert p["next_open_estimate"] == "2026-06-05"


def test_patterns_ignore_future_and_cluster():
    # 7일 이내 연속 오픈은 한 번으로 본다 → 실제 오픈 2회뿐이라 예측 안 함
    rows = _hist("2026-03-02", "2026-03-04", "2026-06-01", "2026-06-03", "2026-12-01")
    assert build_patterns(rows, date(2026, 7, 1)) == []


def test_patterns_group_by_sigungu():
    rows = _hist("2026-01-05", "2026-04-05", "2026-07-05", sigungu="중구") + \
        _hist("2026-01-05", "2026-04-05", sigungu="동구")
    got = build_patterns(rows, date(2026, 8, 1))
    assert [(p["institution"], p["sigungu"]) for p in got] == [("A복지관", "중구")]


def test_patterns_gangnam_rule():
    rows = [course(source="gangnam", description=None, institution="역삼1동복합문화센터")]
    [p] = build_patterns(rows, date(2026, 10, 10))
    assert p["is_estimate"] == 0 and p["cycle_days"] is None and p["basis_count"] == 0
    assert p["next_open_estimate"] == "2026-10-26"
    assert p["rule_note"].startswith("1권역")
    z2 = [course(source="gangnam", description=None, institution="대치2동복합문화센터")]
    [p2] = build_patterns(z2, date(2026, 10, 27))
    assert p2["next_open_estimate"] == "2026-10-27"  # 오늘이 오픈일이면 오늘
    [p3] = build_patterns(z2, date(2026, 12, 28))
    assert p3["next_open_estimate"] == "2027-01-27"  # 연도 넘김


def test_patterns_gangnam_zone_from_apply_start():
    # 권역표에 없는 센터는 저장된 접수 시작일(27일 → 2권역)로 판정
    rows = [course(source="gangnam", description=None, institution="새동복합문화센터",
                   apply_start="2026-09-27", apply_end="2026-09-30")]
    [p] = build_patterns(rows, date(2026, 10, 10))
    assert p["next_open_estimate"] == "2026-10-27" and p["rule_note"].startswith("2권역")


def test_patterns_gangnam_non_dong_center_skipped():
    rows = [course(source="gangnam", description=None, institution="강남세곡체육공원 체육시설"),
            course(source="gangnam", description=None, institution="청담 평생학습관",
                   apply_start="2026-09-26", apply_end="2026-09-30")]
    assert build_patterns(rows, date(2026, 10, 10)) == []


def test_patterns_gangnam_zone_unknown():
    rows = [course(source="gangnam", description=None, institution="새동복합문화센터")]
    [p] = build_patterns(rows, date(2026, 10, 10))
    assert p["next_open_estimate"] is None and p["is_estimate"] == 0
    assert "권역은 확인 안 됨" in p["rule_note"]


# ---------- 한 번에 ----------

def test_derive_all_fills_columns():
    rows = [course(title="왕초보 요가", institution="역삼1동주민센터", is_free=1, capacity=12,
                   start_date="2026-10-01", end_date="2026-12-31", weekday_bits=0b0000101,
                   signals="[]")]
    [r] = derive_all(rows, date(2026, 10, 10))
    assert r["is_dong_center"] == 1
    assert r["category"] == "몸 풀기"
    assert r["term_days"] == 92 and r["sessions_per_week"] == 2
    assert r["stair"] == 2 and r["stair_reason"] == "12명 소규모라 얼굴을 익히기 쉬워요"
    assert isinstance(r["signals"], str)
    assert json.loads(r["signals"]) == ["free", "basic", "small"]
    assert rows[0]["signals"] == "[]"  # 입력은 바꾸지 않는다


def test_derive_all_gangnam_is_dong_center():
    rows = [course(source="gangnam", description=None, institution="세곡커뮤니티센터")]
    assert derive_all(rows, date(2026, 10, 10))[0]["is_dong_center"] == 1


def test_no_banned_words_in_source():
    from pathlib import Path
    text = Path(derive.__file__).read_text(encoding="utf-8")
    assert not BANNED.search(text)


def test_derive_all_filters_unsafe_urls():
    rows = derive_all([
        course(detail_url="javascript:;", homepage_url="www.x.go.kr"),
        course(detail_url="https://a.go.kr/1", homepage_url="data:text/html,x"),
    ], date(2026, 10, 10))
    assert rows[0]["detail_url"] is None
    assert rows[0]["homepage_url"] == "https://www.x.go.kr"
    assert rows[1]["detail_url"] == "https://a.go.kr/1"
    assert rows[1]["homepage_url"] is None


def test_children_courses_excluded_from_stairs():
    from pipeline.derive import is_for_children, stair
    base = {"is_online": 1, "is_free": 1, "title": "독서교실", "target_raw": "성인", "description": None,
            "source": "std", "capacity": None, "fee_won": 0, "start_date": None, "end_date": None, "weekday_bits": 0}
    assert stair(base) == 1
    assert is_for_children("어린이 독서퀴즈", None)
    assert is_for_children("독서교실", "만7세-만12세")
    assert is_for_children("독서교실", "초등학생")
    assert is_for_children("독서교실", "6-13세")
    assert not is_for_children("독서교실", "초·중고및 성인")   # 성인 포함
    assert not is_for_children("독서교실", "누구나")
    assert not is_for_children("독서교실", "만 65세 이상")
    assert not is_for_children("성인 독서교실", None)
    assert stair({**base, "title": "어린이 독서퀴즈", "target_raw": None}) is None
    assert stair({**base, "title": "어린이 독서퀴즈"}) == 1  # 대상이 「성인」으로 명시되면 제목보다 대상을 따른다
    assert stair({**base, "target_raw": "초등학생"}) is None
    assert stair({**base, "target_raw": "초·중고및 성인"}) == 1
