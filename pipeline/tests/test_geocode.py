"""geocode.py 의 오프라인 판정 규칙(카카오 호출 없음)."""
from pipeline.tools.geocode import ROOM, ROADLIKE, clean_addr, course_point, in_gu, km, near_enough, region_point


class FakeKakao:
    """질의 → 문서 목록을 미리 정해 둔 가짜."""

    def __init__(self, table: dict[str, list[dict]]) -> None:
        self.table = table
        self.asked: list[str] = []

    def search(self, kind: str, query: str) -> list[dict]:
        self.asked.append(f"{kind}:{query}")
        return self.table.get(f"{kind}:{query}", [])


def doc(addr: str, lat: float, lng: float, type_: str = "ROAD_ADDR", r3: str = "", r2: str = "") -> dict:
    return {"name": addr, "addr": addr, "road": "", "type": type_, "r2": r2, "r3": r3, "r3h": "", "lat": lat, "lng": lng}


CEN = {
    "dong": {"서울특별시|강남구|도곡1동": [37.4883, 127.0390]},
    "gu": {"서울특별시|강남구": [37.5173, 127.0474], "부산광역시|중구": [35.1063, 129.0323]},
    "sido": {"세종특별자치시": [36.4801, 127.2892]},
}


def test_clean_addr_drops_parens_and_detail() -> None:
    assert clean_addr("경기도 수원시 팔달구 월드컵로 381번길 2(우만동 582)") == "경기도 수원시 팔달구 월드컵로 381번길 2"
    assert clean_addr("서울시 양천구 목동서로 192") == "서울시 양천구 목동서로 192"
    assert clean_addr("서울 강남구 테헤란로 7길 22 3층") == "서울 강남구 테헤란로 7길 22"


def test_room_and_roadlike() -> None:
    assert ROOM.sub("", "원미2동 행정복지센터 2층 회의실").strip() == "원미2동 행정복지센터"
    assert ROOM.sub("", "센터 지하1층 강의실").strip() == "센터"
    assert ROADLIKE.search("팔공로31길 6-3")
    assert not ROADLIKE.search("청담동복합문화센터")


def test_in_gu_matches_token_not_substring() -> None:
    assert in_gu(doc("서울 강남구 도곡동 1", 0, 0), "강남구")
    assert not in_gu(doc("서울 서초구 강남대로 1", 0, 0), "강남구")
    assert in_gu(doc("세종 어진동", 0, 0), None)


def test_km_and_near_enough() -> None:
    assert abs(km([37.0, 127.0], [38.0, 127.0]) - 111.2) < 0.5
    near = doc("서울 강남구 도곡동", 37.49, 127.04)
    far = doc("서울 강남구 세곡동", 37.4883 + 6 / 111.2, 127.0390)
    assert near_enough(near, CEN, "서울특별시", "강남구", "도곡1동")
    assert not near_enough(far, CEN, "서울특별시", "강남구", "도곡1동")


def test_course_point_address_then_keyword_and_rejects_other_gu() -> None:
    k = FakeKakao({
        "address:서울 강남구 남부순환로 1": [doc("서울 강남구 도곡동 1", 37.49, 127.04)],
        "address:서울 강남구 남부순환로 2": [doc("서울 서초구 서초동 2", 37.48, 127.01)],
        "keyword:강남구 도곡1동 주민센터": [doc("서울 강남구 도곡동 3", 37.488, 127.039, "")],
    })
    assert course_point(k, CEN, "서울 강남구 남부순환로 1", None, None, "서울특별시", "강남구", "도곡1동") == (37.49, 127.04, "address")
    # 주소가 다른 구로 잡히면 버리고 기관 이름으로 찾는다(동 주민센터 기관명이 장소보다 먼저)
    got = course_point(k, CEN, "서울 강남구 남부순환로 2", "2층 대회의실", "강남구 도곡1동 주민센터", "서울특별시", "강남구", "도곡1동")
    assert got == (37.488, 127.039, "keyword")
    assert "keyword:강남구 강남구 도곡1동 주민센터" not in k.asked  # 기관명에 이미 구가 있으면 다시 붙이지 않는다
    assert course_point(k, CEN, None, "없는곳", None, "서울특별시", "강남구", "도곡1동") is None


def test_course_point_rejects_road_only_same_name_gu_and_far_sido() -> None:
    k = FakeKakao({
        "address:서울 중구 세종대로 110": [doc("서울 중구 태평로1가 31", 37.5663, 126.9779)],  # 서울 중구인데 강좌는 부산 중구
        "address:서울 강남구 테헤란로": [doc("서울 강남구 테헤란로", 37.50, 127.04, "ROAD")],
        "keyword:세종특별자치시 복지관": [doc("대전 유성구 어딘가 1", 36.36, 127.36, "")],  # 세종 시청에서 20km 안
        "keyword:세종특별자치시 먼곳": [doc("서울 중구 어딘가 1", 37.56, 126.98, "")],
    })
    assert course_point(k, CEN, "서울 중구 세종대로 110", None, None, "부산광역시", "중구", None) is None
    assert course_point(k, CEN, "서울 강남구 테헤란로", None, None, "서울특별시", "강남구", None) is None
    assert course_point(k, CEN, None, "먼곳", None, "세종특별자치시", None, None) is None
    assert course_point(k, CEN, None, "복지관", None, "세종특별자치시", None, None) == (36.36, 127.36, "keyword")


def test_region_point_short_eup_and_no_cross_gu_fallback() -> None:
    k = FakeKakao({
        "address:전북특별자치도 완주군": [doc("전북 완주군", 35.9, 127.16, "REGION", r2="완주군")],
        "address:완주군 봉동읍": [doc("전북 완주군 봉동읍", 35.94, 127.16, "REGION", r3="봉동읍")],
        "address:경상남도 거창군": [doc("경남 거창군", 35.68, 127.9, "REGION", r2="거창군")],
        "address:경상남도 안동": [doc("경북 안동시 안동", 36.5, 128.7, "REGION", r3="안동")],
    })
    assert region_point(k, "전북특별자치도", "완주군", "봉동") == [35.94, 127.16]
    # 거창군은 카카오가 아는 구라서, 시도 안 같은 이름 동으로 넘어가지 않는다
    assert region_point(k, "경상남도", "거창군", "안동") is None
