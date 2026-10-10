"""서울 구별 어댑터 = 데이터 표. 코드 분기 없이 이 표만 바꿔 구를 고친다.

1차 출처: 조사원자료/C1-서울25구.md §1 표, 조사원자료/V4-서울검증.md §1·§4 (기준일 2026-09-24).
문서에 없는 값은 지어내지 않고 None + todo 로 남긴다. 추출 규칙(row_selector·fields)은
tools/capture_fixtures.py 로 받은 실제 첫 페이지 HTML 에 맞춰 채웠고, 못 받은 구는 todo.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Field:
    """행(Node)에서 값 하나를 뽑는 규칙. 순서: cell → sel → attr/텍스트 → regex(그룹1) → template."""
    cell: int | None = None       # 행의 n번째 td/th (0부터)
    sel: str | None = None        # 그 안(또는 행)에서 CSS 부분집합 선택자로 첫 요소
    attr: str | None = None       # 텍스트 대신 속성값
    regex: str | None = None      # 그룹 1(없으면 전체 일치)
    template: str | None = None   # "...{0}..." 로 감싸기(상세 URL 조립)
    const: str | None = None      # 고정값


@dataclass(frozen=True)
class Adapter:
    gu: str                                   # sigungu 값 그대로(「종로구」)
    source: str                               # contract §3 영문 코드
    list_url: str | None
    method: str = "GET"
    params: tuple = ()                        # 고정 쿼리/폼 파라미터 (키, 값) 쌍
    status_filters: tuple = ((),)             # 상태 필터 묶음마다 한 번씩 순회(접수중·접수예정)
    shards: tuple = ()                        # 동별 목록이면 (이름, ((키, 값),...)) 묶음
    page_key: str | None = None
    page_start: int = 1
    page_size: int | None = None              # 이보다 적으면 마지막 페이지
    max_pages: int = 30
    encoding: str | None = None               # None 이면 meta charset → utf-8 → cp949
    row_selector: str | None = None
    fields: dict = field(default_factory=dict)
    status_allow: str | None = None           # 상태 필터가 없는 구: status 필드가 이 정규식에 맞는 행만
    institution_pattern: str | None = None    # 기관명이 이 정규식에 맞는 행만
    institution_sub: tuple | None = None      # (정규식, 바꿀 값) — 기관명 정리(노원 「주민센터_X」 → 「X 주민센터」)
    skip_title: str | None = None             # 이 제목은 행이 아니다(div 표의 머리 행)
    no_apply_period: bool = False             # 목록에 접수기간이 없다 → apply_* NULL
    dong_center_only: bool = True             # 자치회관·동주민센터 목록만 대상(URL/필터/기관명으로 보장)
    expect_robots_block: bool = False         # 조사 기준 예상(판정은 실행 때 http 모듈이 매번)
    todo: tuple = ()
    notes: str = ""


# 접수중·접수예정 계열 상태 배지(상태 필터가 없거나 GET 반영이 미확인인 구의 안전망).
STATUS_OPEN = r"접수\s*중|접수\s*대기|접수\s*예정|접수\s*준비|모집\s*중|모집\s*대기|신청\s*가능|^\s*준비\s*$"
_D = r"\d{4}\s*[-.]\s*\d{1,2}\s*[-.]\s*\d{1,2}"
FIRST_PERIOD = rf"({_D}.*?{_D})"                   # 셀 안 첫 번째 「날짜 ~ 날짜」
SECOND_PERIOD = rf"{_D}.*?{_D}.*?({_D}.*?{_D})"    # 두 번째 「날짜 ~ 날짜」
NO_ROW_SAMPLE = "행 샘플 없음(2026-10-10 캡처 때 접수중·접수예정 0건) — 열 순서는 실제 thead 기준, 셀 형식은 실수집 때 확인"

ADAPTERS: list[Adapter] = [
    Adapter(
        gu="종로구", source="seoul_jongno",
        list_url="https://www.jongno.go.kr/reserv/search.do?site=1&cat=0",
        status_filters=((("stat", "1"),), (("stat", "2"),)),  # V4: stat=1 접수준비, stat=2 접수중
        expect_robots_block=True,
        todo=("robots `User-Agent: * Disallow: /` — 2026-10-10 실행에서도 차단. 행 규칙 미작성(개방 요청 대상)",
              "페이징 키 미확인"),
        notes="C1: 통합예약›자치회관, 서버 렌더. 247건 = 현행(V4).",
    ),
    Adapter(
        gu="중구", source="seoul_junggu",
        list_url="https://www.junggu.seoul.kr/community/content.do?cmsid=16380",
        # s_dong 값 15개: 캡처한 소공동 페이지의 동 탭 링크(content.do?...&s_dong=…)에서 그대로 옮김
        shards=tuple((d, (("s_dong", d),)) for d in (
            "소공동", "회현동", "명동", "필동", "장충동", "광희동", "을지로동", "신당동", "다산동",
            "약수동", "청구동", "신당5동", "동화동", "황학동", "중림동")),
        page_key="page", page_size=10, max_pages=15,
        row_selector="div.list_wrap > ul > li",
        fields={
            "title": Field(sel="strong.tit"),
            "status": Field(sel="div.condition"),
            "institution": Field(sel="div.black_tag", template="{0} 자치회관"),
            "venue": Field(sel="li.type5 dd"),
            "weekdays": Field(sel="li.type2 dd"),
            "time": Field(sel="li.type2 dd"),
            "fee": Field(sel="li.type3 dd"),
            "capacity": Field(sel="li.type4 dd"),
            "detail_url": Field(sel="a.class_go_link", attr="href"),
        },
        status_allow=STATUS_OPEN,
        todo=("목록에 접수·교육 기간 없음 → apply_*·start/end_date NULL(상세 myhand 페이지에만)",
              "상태 필터 파라미터 없음(V4) — 누적 목록을 상태 배지로 거름"),
        notes="V4: 동별 페이지 서버 렌더 10건/p, 누적 587 중 현행 52. 동 자치회관 프로그램 목록이라 기관명=「{동} 자치회관」.",
    ),
    Adapter(
        gu="성동구", source="seoul_seongdong",
        list_url="https://www.sd.go.kr/booking/webEduList4.do?key=4913&si1=99",
        expect_robots_block=True,
        todo=("2026-10-10: www.sd.go.kr TLS 인증서 체인 검증 실패(robots.txt·목록 모두 SSLError) — 검증 끄기 우회 안 함",
              "robots `User-agent: * Disallow: /`(C1) — 받아져도 차단 예상, 행 규칙 미작성",
              "상태 필터·페이징 파라미터 미확인"),
        notes="C1: 신속예약›자치회관, 16p×18.",
    ),
    Adapter(
        gu="동대문구", source="seoul_dongdaemun",
        list_url=("https://www.ddm.go.kr/reserve/selectDongdaemunUserCourseList.do"
                  "?key=3172&searchEduInstSe=INSTSE02"),
        # searchEdcKey: 캡처 페이지 메뉴의 「○○동 자치회관」 링크 값(9~22). 11=용두동은 C1 URL 과 일치
        shards=tuple((n, (("searchEdcKey", k),)) for n, k in (
            ("용두동", "11"), ("답십리1동", "9"), ("답십리2동", "10"), ("이문1동", "12"), ("이문2동", "13"),
            ("장안1동", "14"), ("장안2동", "15"), ("전농1동", "16"), ("전농2동", "17"), ("제기동", "18"),
            ("청량리동", "19"), ("회기동", "20"), ("휘경1동", "21"), ("휘경2동", "22"))),
        page_key="pageIndex", page_size=15, max_pages=5,
        row_selector="table.p-table tbody tr",
        fields={
            "title": Field(cell=1, sel="a"),
            "institution": Field(cell=2, template="{0} 자치회관"),
            "venue": Field(cell=3),
            "apply_period": Field(cell=4, regex=FIRST_PERIOD),
            "edu_period": Field(cell=4, regex=SECOND_PERIOD),
            "weekdays": Field(cell=5),
            "time": Field(cell=5),
            "selection": Field(cell=6),
            "capacity": Field(cell=7, regex=r"/\s*(\d+)"),   # 「신청 / 모집 (대기)」 의 모집
            "status": Field(cell=8),
            "detail_url": Field(cell=1, sel="a", attr="href"),
        },
        status_allow=STATUS_OPEN,
        todo=("상태 필터 파라미터 없음 — 목록 배지로 거름",),
        notes="C1 땐 curl 차단(81B)이었으나 2026-10-10 엔 서버 렌더로 열림(우회 없음). 수강료 열 없음.",
    ),
    Adapter(
        gu="강북구", source="seoul_gangbuk",
        list_url=("https://www.gangbuk.go.kr/rsvt/cntedu/lctre/list.do"
                  "?menuNo=800039&searchEclstGbnCd=CB01"),
        # 5=접수중(V4), 3=접수대기(캡처 페이지 fnSearchStatus 버튼)
        status_filters=((("searchStatus", "5"),), (("searchStatus", "3"),)),
        page_key="pageIndex", page_size=10, max_pages=10,
        row_selector="table tbody tr",
        fields={
            "title": Field(cell=0),
            "edu_period": Field(cell=1),
            "time": Field(cell=2),
            "weekdays": Field(cell=2),
            "apply_period": Field(cell=3),
            "fee": Field(cell=3, regex=r"([\d,]+\s*원|무료)"),
            "capacity": Field(cell=4, regex=r"(\d+)"),
            "status": Field(cell=5),
            "detail_url": Field(cell=0, sel="a", attr="href"),
        },
        status_allow=STATUS_OPEN,
        todo=(NO_ROW_SAMPLE,),
        notes="C1 땐 봇 차단(sabFingerPrint)이었으나 2026-10-10 엔 서버 렌더(표식 없음). 「데이터가 없습니다」.",
    ),
    Adapter(
        gu="관악구", source="seoul_gwanak",
        list_url="https://www.gwanak.go.kr/site/edu/lecture/Lecture_List.do?scLcOrganization1=29000500",
        # 2=접수중(V4), 1=접수대기(캡처 페이지 #statusTab data-value)
        status_filters=((("scClStsCode", "2"),), (("scClStsCode", "1"),)),
        page_key="pageIndex", max_pages=40,  # 폼 hidden 필드 이름. 페이지당 건수 미확인
        row_selector="table.list tbody tr",
        fields={
            "title": Field(cell=1),
            "apply_period": Field(cell=2, regex=FIRST_PERIOD),
            "edu_period": Field(cell=2, regex=SECOND_PERIOD),
            "venue": Field(cell=3),
            "fee": Field(cell=4),
            "capacity": Field(cell=5, regex=r"/\s*(\d+)"),
            "status": Field(cell=6),
            "detail_url": Field(cell=1, sel="a", attr="href"),
        },
        status_allow=STATUS_OPEN,
        todo=(NO_ROW_SAMPLE, "기관명 열 없음 — 장소 열로 대신", "pageIndex 를 GET 으로 받는지 미확인(폼은 POST)"),
        notes="V4: 전체 347 누적, scClStsCode=2 접수중 78(9/24). 2026-10-10 접수중 0건.",
    ),
    Adapter(
        gu="강동구", source="seoul_gangdong",
        list_url="https://jumin.gangdong.go.kr/program/ProgramBoardList.do?menucode=84",
        # 캡처 페이지 fn_recruit 버튼: RING=모집중, RWAIT=모집대기
        status_filters=((("search_recruit", "RING"),), (("search_recruit", "RWAIT"),)),
        page_key="pageIndex", page_size=5, max_pages=70,
        row_selector="ul.bbs-program > li",
        fields={
            "title": Field(sel="div.tit strong"),
            "institution": Field(sel="div.r strong"),
            "venue": Field(sel="strong.place"),
            "apply_period": Field(sel="ul.sort", regex=r"신청기간\s*(.*?)\s*교육기간"),
            "edu_period": Field(sel="ul.sort", regex=rf"교육기간\s*({_D}.*?{_D})"),
            "time": Field(sel="ul.sort", regex=r"교육시간\s*(.*?)\s*(?:신청인원|$)"),
            "weekdays": Field(sel="ul.sort", regex=r"교육시간\s*(.*?)\s*(?:신청인원|$)"),
            "capacity": Field(sel="ul.sort", regex=r"정원\s*\d+\s*명?\s*/\s*(\d+)"),
            "status": Field(sel="div.r", regex=r"((?:모집|접수)\S*)\s*$"),
            "detail_url": Field(sel="div.tit a", attr="onclick", regex=r"fn_view\('(\d+)'\)",
                                template="/program/ProgramClassroomView.do?menucode=84&gn_seq={0}"),
        },
        status_allow=STATUS_OPEN,
        todo=("상세 링크: 사이트는 POST 폼(fn_view) — GET 으로 열리는지 미확인",),
        notes="jumin 호스트 robots 는 2026-10-10 허용으로 판정. 전체 62p×5. 수강료 열 없음.",
    ),
    Adapter(
        gu="용산구", source="seoul_yongsan",
        list_url="https://www.yongsan.go.kr/jachi/pgm/pgmJachi/list.do?menuNo=500013",
        status_filters=((("rceptFlag", "1"),),),  # V4: 접수중 205, 접수예정 탭 없음
        expect_robots_block=True,
        todo=("robots `User-agent: * Disallow: /` — 2026-10-10 실행에서도 차단. 행 규칙 미작성", "페이징 키 미확인"),
        notes="V4: 3,135 누적 = 접수중 205 + 마감 2,930.",
    ),
    Adapter(
        gu="성북구", source="seoul_seongbuk",
        list_url=("https://www.sb.go.kr/yeyak/selectUnityProgrmWebList.do"
                  "?key=6508&insttTy=URINTY01&searchInsttNo=84&viewType=list&pageUnit=30"),
        status_filters=((("searchOperSttus", "URORST02"),), (("searchOperSttus", "URORST01"),)),
        page_key="pageIndex", page_size=30, max_pages=10,  # 캡처 페이지 페이징 링크 pageIndex=N
        row_selector="table.p-table tbody tr",
        fields={
            "title": Field(cell=1, regex=r"^(?:\[[^\]]*\]\s*)?(.*)$"),
            "apply_period": Field(cell=2),
            "edu_period": Field(cell=3),
            "institution": Field(cell=4),
            "weekdays": Field(cell=5),
            "capacity": Field(cell=6, regex=r"/\s*(\d+)"),
            "status": Field(cell=7),
            "detail_url": Field(cell=1, sel="a", attr="href", regex=r"fnView\(this,\s*(\d+)\)",
                                template="/yeyak/unityProgrmWebView.do?key=6508&progrmNo={0}"),
        },
        status_allow=STATUS_OPEN,
        todo=("상세 링크: 사이트는 POST 폼(fnView) — GET 으로 열리는지 미확인", "시간 열 없음"),
        notes="V4: 접수중(URORST02) 128, 접수대기(URORST01) 0, pageUnit=30.",
    ),
    Adapter(
        gu="서대문구", source="seoul_seodaemun",
        list_url="https://www.sdm.go.kr/dong/{dong}/acms/com/lecture.do?np=100&mode=list",
        shards=tuple((d, ()) for d in ("bah", "bgj1", "bgj2", "ch", "cy", "he1", "he2",
                                       "hj1", "hj2", "hj3", "ngj1", "ngj2", "sc", "yh")),
        page_key="cp", page_size=100, max_pages=8, encoding="cp949",
        row_selector="table.table_style_col tbody tr",
        fields={
            "title": Field(cell=3, sel="a", regex=r"^(?:\[[^\]]*\]\s*)?(.*)$"),
            "institution": Field(cell=3, sel="a", regex=r"^\[([^\]]+)\]", template="{0} 자치회관"),
            "status": Field(cell=7),
            "detail_url": Field(cell=3, sel="a", attr="href", regex=r"goView\('(\d+)'\)",
                                template="lecture.do?mode=view&lectureId={0}"),
        },
        status_allow=STATUS_OPEN,
        todo=("목록 모집기간·강의기간에 연도가 없음(「06-15~09-30」) — 추측하지 않고 NULL. 상세 페이지 확인 필요",
              "상태 필터 없음 — 목록 배지(접수중)로 거름", "상세 링크: 사이트는 POST 폼(goView) — GET 동작 미확인"),
        notes="V4: 14개 동 코드, cp=페이지·np=페이지당, EUC-KR. 접수중 163. 강사 열은 저장 안 함.",
    ),
    Adapter(
        gu="구로구", source="seoul_guro",
        list_url=("https://www.guro.go.kr/yeyak/webEdcLctreList.do"
                  "?key=3600&rep=1&jachi=1&searchCnd=all"),
        status_filters=((("searchRceptSttus", "RP1"),), (("searchRceptSttus", "W01"),)),
        row_selector="table.p-table tbody tr",
        fields={
            "status": Field(cell=0),
            "title": Field(cell=1, sel="a"),
            "venue": Field(cell=2),
            "institution": Field(cell=2),
            "apply_period": Field(cell=3),
            "edu_period": Field(cell=4, sel="p"),
            "time": Field(cell=4, regex=r"(\d{1,2}:\d{2}\s*~\s*\d{1,2}:\d{2})"),
            "weekdays": Field(cell=4, regex=r"\(([^)]*)\)\s*$"),
            "capacity": Field(cell=5, regex=r"^(\d+)"),
            "detail_url": Field(cell=1, sel="a", attr="href"),
        },
        status_allow=STATUS_OPEN,
        todo=("페이징 키 미확인(2026-10-10 모집중 2건·1페이지) — 필터마다 첫 페이지만 받음",),
        notes="V4: 모집중 RP1 12 · 모집대기 W01 1. C1 땐 봇 차단, V4·2026-10-10 엔 curl 로 열림.",
    ),
    Adapter(
        gu="송파구", source="seoul_songpa",
        list_url="https://www.songpa.go.kr/learn/youth/program/lecture_list.do",
        method="POST",
        params=(("searchKind4", "9998"),),
        # V4 는 searchVal7=1,2 를 함께 보냈으나 select 라 첫 값(1)만 반영됨 → 두 번 나눠 보낸다
        status_filters=((("searchVal7", "1"),), (("searchVal7", "2"),)),
        row_selector="div#moTable li section.table",
        skip_title=r"^제목$",
        fields={
            "title": Field(cell=1),
            "institution": Field(cell=2),
            "apply_period": Field(cell=3),
            "weekdays": Field(cell=4),
            "fee": Field(cell=5),
            "status": Field(cell=6),
            "detail_url": Field(cell=1, sel="a", attr="href"),
        },
        status_allow=STATUS_OPEN,
        todo=(NO_ROW_SAMPLE.replace("thead", "머리 행(div.col)"), "페이징 키 미확인 — 필터마다 첫 페이지만 받음"),
        notes="V4: POST searchKind4=9998, 접수대기·신청가능 = 24(9/24). 2026-10-10 접수대기 0건.",
    ),
    Adapter(
        gu="서초구", source="seoul_seocho",
        list_url="https://www.seocho.go.kr/site/seocho/ex/lecture/List.do",
        # 캡처 페이지 강좌상태 라디오: 2=접수중, 1=접수대기
        status_filters=((("scClStsCode", "2"),), (("scClStsCode", "1"),)),
        page_key="pageIndex", page_size=10, max_pages=118,
        row_selector="table.list tbody tr",
        fields={
            "title": Field(cell=1, sel="a", regex=r"^(.*?)\s*(?:요일\s*:|$)"),
            "weekdays": Field(cell=1, regex=r"요일\s*:\s*([^,]*?)\s*,"),
            "fee": Field(cell=1, regex=r"수강료\s*:\s*(무료|[\d,]+\s*원?)"),
            "online": Field(cell=1, regex=r"강의방법\s*:\s*(\S+)"),
            "institution": Field(cell=2),
            "edu_period": Field(cell=3),
            "apply_period": Field(cell=4),
            "status": Field(cell=5),
            "detail_url": Field(cell=1, sel="a", attr="href", regex=r"doLectureUserView\('([^']+)'\)",
                                template="/site/seocho/ex/lecture/View.do?clIdx={0}"),
        },
        status_allow=STATUS_OPEN,
        institution_pattern=r"자치회관|주민센터",
        todo=("scClStsCode 를 GET 으로 받는지 미확인(폼 라디오) — 안전망으로 상태 배지도 거름",),
        notes="V4: 1,178건 중 자치회관 1,000(교육기관 열). 강좌예약 통합이라 기관명으로 거름.",
    ),
    Adapter(
        gu="노원구", source="seoul_nowon",
        list_url=("https://www.nowon.kr/nwll/web/edc/program/listAjax"
                  "?searchTab=EDCANM&searchOnOff=ALL&areaCd=0"),
        page_key="pageIndex", page_size=4, max_pages=359,
        row_selector="ul.search_list > li",
        fields={
            "title": Field(sel="a.top_tit", regex=r"^(?:\d+\.\s*)?(.*)$"),
            "status": Field(sel="span.ask"),
            "institution": Field(sel="div.bottom_box", regex=r"기\s*관\s+(.*?)\s+(?:강\s*사|시\s*간|수강료|상세보기)"),
            "time": Field(sel="div.bottom_box", regex=r"시\s*간\s+(.*?)\s+(?:수강료|상세보기)"),
            "weekdays": Field(sel="div.bottom_box", regex=r"시\s*간\s+(.*?)\s+(?:수강료|상세보기)"),
            "fee": Field(sel="div.bottom_box", regex=r"수강료\s+(.*?)\s+(?:상세보기|바로신청|$)"),
        },
        status_allow=r"접수\s*중|^\s*준비\s*$",
        institution_pattern=r"^\s*주민센터_",
        institution_sub=(r"^\s*주민센터_\s*(.*)$", r"\1 주민센터"),
        no_apply_period=True,
        todo=("목록에 접수기간 없음 → apply_* NULL",
              "기관유형 필터(orgLtype)를 서버가 무시 — 전 페이지 순회 후 기관명 「주민센터_」로 거름",
              "상세 링크 함수(fnGoDetail)가 Ajax 조각 밖에 있어 URL 형식 미확인 → detail_url NULL"),
        notes="V4: 359p×4, 주민센터_* 19개 동 500건. Ajax 가 HTML 조각 반환. 상태 배지 「접수중」·「준비」.",
    ),
]

BY_SOURCE = {a.source: a for a in ADAPTERS}
