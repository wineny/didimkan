"""소스3: 강남구 통합예약(life.gangnam.go.kr) REST 수집·정규화.

실 응답 구조(2026-10-10 확인):
- 센터 목록 `/rest/common/company?type=L` → [{comcd, comnm}] 30곳(체육시설 포함).
- 강좌 목록 `/rest/lecture/list?company_code=GNCCxx&page=1&page_size=1000` → 강좌 dict 의 평평한 배열.
  페이지 정보는 없고 모든 행의 `total_count` 가 센터 전체 강좌 수다. 설명·소개·비고 필드는 없다.
- 강좌 필드: comcd comnm class_cd class_nm train_stime train_etime train_day_nm course_fee capa
  reg_person target_age_name status receive_kind receive_etime sports_cd teacher_no teacher_name total_count.
  강좌 시작·종료일, 선정방법, 전화번호, 주소 필드는 없다.

접수 창 기준월(코드 주석 + 보고 필수): 응답에 개강월이 없다. contract §11 에 따라 「빌드일이 속한 달의
신규 창」(예: 빌드 2026-10-10, 1권역 → 10-26~10-31)을 저장한다. 이는 gangnam_window 에
ref = 빌드일의 다음 달 1일 을 넣은 값이다(목록 자체는 이달분이지만 사용자가 노리는 건 곧 열리는 신규 창).
"""
import json
import re
from datetime import date
from pathlib import Path

from pipeline import derive
from pipeline.common import http
from pipeline.common.failures import Failures
from pipeline.common.parse import (
    make_id, parse_fee, parse_time, parse_weekdays, time_bucket, weekday_bits,
)
from pipeline.sources.std import COURSE_KEYS, _TIME_BUCKET_KO

SOURCE = "gangnam"
BASE = "https://life.gangnam.go.kr"
COMPANY_URL = BASE + "/rest/common/company?type=L"
LIST_URL = BASE + "/rest/lecture/list?company_code={code}&page={page}&page_size={size}"
DETAIL_URL = BASE + "/fmcs/52?action=read&comcd={comcd}&classcd={classcd}&type=R"
PAGE_SIZE = 1000
MAX_PAGES = 20
RAW_DIR = Path(__file__).resolve().parent.parent / "raw" / "gangnam"
APPLY_METHOD = "온라인(강남구 통합예약)"

# capture() 가 저장 전에 지우는 키: 설명·소개·비고 류 + 강사 개인 이름(스키마에 쓰지 않음).
DESCRIPTION_KEY_RE = re.compile(
    r"desc|content|cont$|intro|memo|remark|note|etc|detail|summary|comment|goal|plan|curri"
    r"|teacher|instructor|bigo|info", re.I)
DONG_RE = re.compile(r"([가-힣]+?\d?동)")


def _list_url(code: str, page: int) -> str:
    return LIST_URL.format(code=code, page=page, size=PAGE_SIZE)


def _json(data: bytes):
    return json.loads(data.decode("utf-8"))


def fetch_companies(failures: Failures | None = None) -> list[dict]:
    return _json(http.get(COMPANY_URL, referer=BASE, source=SOURCE, failures=failures))


def fetch_lectures(company_code: str, failures: Failures | None = None,
                   *, raw_dir: Path = RAW_DIR) -> list[dict]:
    """센터 한 곳의 강좌 전부. 한 페이지가 가득 차고 total_count 에 못 미치면 다음 페이지."""
    lectures: list[dict] = []
    for page in range(1, MAX_PAGES + 1):
        rows = _json(http.get(_list_url(company_code, page), referer=BASE,
                              source=SOURCE, failures=failures))
        lectures.extend(rows)
        total = int(rows[0].get("total_count") or 0) if rows else 0
        if len(rows) < PAGE_SIZE or len(lectures) >= total:
            break
    raw_dir = Path(raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / f"{company_code}.json").write_text(
        json.dumps(lectures, ensure_ascii=False, indent=1), encoding="utf-8")
    return lectures


def _to_int(raw) -> int | None:
    digits = re.sub(r"[^\d]", "", str(raw or ""))
    return int(digits) if digits else None


def _window_ref(today: date) -> date:
    """빌드일의 다음 달 1일. gangnam_window(ref) 는 ref 의 전달 창을 주므로 빌드일이 속한 달의 창이 된다."""
    y, m = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
    return date(y, m, 1)


def normalize(lecture: dict, company: dict, *, collected_at: str, today: date) -> dict:
    """강좌 한 건 → courses 컬럼 키 dict. description 은 항상 None, 파생 컬럼은 비워 둔다."""
    comcd = company.get("comcd") or lecture.get("comcd")
    institution = (company.get("comnm") or lecture.get("comnm") or "").strip() or None
    title = (lecture.get("class_nm") or "").strip()
    classcd = lecture.get("class_cd")
    days = parse_weekdays(lecture.get("train_day_nm") or "")
    start_time = parse_time(lecture.get("train_stime") or "")
    fee_raw = (lecture.get("course_fee") or "").strip()
    fee_won, is_free, fee_period = parse_fee(fee_raw) if fee_raw else (None, 0, None)
    if fee_won:  # 강남 수강료는 1개월 단위(조사원자료 V4)
        fee_period = "월"
    bucket = time_bucket(start_time)
    dong_m = DONG_RE.search(institution or "")
    zone = derive.gangnam_zone(institution)
    apply_start = apply_end = None
    if zone:
        apply_start, apply_end, _note = derive.gangnam_window(_window_ref(today), zone)
    row = dict.fromkeys(COURSE_KEYS)
    row.update({
        "id": make_id(title, institution, None, start_time, institution),
        "source": SOURCE,
        "source_file": None,
        "source_url": _list_url(comcd, 1),
        "detail_url": DETAIL_URL.format(comcd=comcd, classcd=classcd),
        "collected_at": collected_at,
        "data_date": collected_at,
        "title": title,
        "description": None,
        "institution": institution,
        "institution_phone": None,
        "sido": "서울특별시",
        "sigungu": "강남구",
        "dong": dong_m.group(1) if dong_m else None,
        "venue": institution,
        "start_time": start_time,
        "end_time": parse_time(lecture.get("train_etime") or ""),
        "weekdays_raw": (lecture.get("train_day_nm") or None),
        "weekdays": days or None,
        "weekday_bits": weekday_bits(days),
        "time_bucket": _TIME_BUCKET_KO.get(bucket) if bucket else None,
        "capacity": _to_int(lecture.get("capa")),
        "fee_raw": fee_raw or None,
        "fee_won": fee_won,
        "fee_period": fee_period,
        "is_free": is_free,
        "is_online": 0,
        "target_raw": lecture.get("target_age_name") or None,
        "apply_start": apply_start,
        "apply_end": apply_end,
        "apply_method": APPLY_METHOD,
        "selection_method": None,
        "is_always_open": 0,
        "is_dong_center": derive.is_dong_center(institution, institution),
        "signals": "[]",
    })
    return row


def collect(failures: Failures | None, collected_at: str, today: date,
            *, raw_dir: Path = RAW_DIR) -> list[dict]:
    """센터 전부 순회. 한 센터가 실패하면 기록하고 다음으로 넘어간다."""
    try:
        companies = fetch_companies(failures)
    except Exception as e:  # noqa: BLE001
        if failures is not None:
            failures.add(SOURCE, "companies_error", COMPANY_URL, repr(e))
        return []
    rows: list[dict] = []
    for company in companies:
        try:
            lectures = fetch_lectures(company["comcd"], failures, raw_dir=raw_dir)
            rows.extend(normalize(lec, company, collected_at=collected_at, today=today)
                        for lec in lectures)
        except Exception as e:  # noqa: BLE001
            if failures is not None:
                failures.add(SOURCE, "center_error", _list_url(company.get("comcd", "?"), 1), repr(e))
    return rows


def capture(lectures: list[dict], n: int) -> list[dict]:
    """fixture 용 축약: 앞 n 건만, 설명류·강사 키를 지운다."""
    return [{k: v for k, v in lec.items() if not DESCRIPTION_KEY_RE.search(k)}
            for lec in lectures[:n]]
