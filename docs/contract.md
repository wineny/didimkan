# 디딤칸 데이터·값 계약 (0-2, 2026-10-10)

모든 레인(파이프라인 A · 웹 B · 인프라 C)이 이 문서를 따른다. 근거는 명세 §4-2·§4-3·§5, 실행 계획 0-2 표와 §7 수정안(R3·R5·R7·R8·R9·R15·R17·R18·R19). 계획과 이 문서가 어긋나면 리드에게 알린다.

- DDL: `pipeline/schema.sql` (SQLite) · Drizzle: `src/db/schema.ts`. 두 파일의 테이블·컬럼·타입·NOT NULL·인덱스·CHECK 이름은 `pipeline/tests/test_contract.py` 가 같다고 확인한다. 한쪽을 바꾸면 다른 쪽도 같이 바꾼다.
- 이름: DB 컬럼은 snake_case. TS(Drizzle 결과 객체·API JSON)는 같은 이름의 camelCase(`apply_start` → `applyStart`).
- **빈 문자열 금지**. 모르는 값은 `""` 이 아니라 NULL. 예외는 기본값이 있는 컬럼(`weekday_bits` 0, `signals` `[]`, 불리언 0).

## 1. 테이블

| 테이블 | 용도 | 키 |
|---|---|---|
| `courses` | 강좌 한 줄 = 한 강좌 | `id` 기본키 |
| `institutions` | 기관 전화번호 보조 | (institution, sigungu, phone, source) |
| `enrollment_patterns` | 기관별 다음 접수일 예측·강남 권역 규칙 | 조인 키 `institution` + `sigungu` |
| `meta` | 빌드 정보 | `key` 기본키 |

`courses` 컬럼(46개): id · source · source_file · source_url · detail_url · collected_at · data_date · title · description · institution · institution_phone · sido · sigungu · dong · venue · address · start_date · end_date · start_time · end_time · weekdays_raw · weekdays · weekday_bits · time_bucket · capacity · fee_raw · fee_won · fee_period · is_free · is_online · target_raw · apply_start · apply_end · apply_method · selection_method · is_always_open · homepage_url · lat · lng · is_dong_center · category · stair · stair_reason · signals · term_days · sessions_per_week.

NOT NULL: `id`·`source`·`collected_at`·`title`·`weekday_bits`·`signals`·불리언 4개. 나머지는 NULL 허용.

## 2. id 규칙 (R8)

```python
import hashlib, re, unicodedata

def norm(s: str | None) -> str:
    """NFKC → 소문자 → 글자·숫자 아닌 것(공백·특수문자·밑줄) 전부 제거. None → ''."""
    if s is None:
        return ""
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", s).lower())

def make_id(title, institution, start_date, start_time, venue) -> str:
    key = "|".join([norm(title), norm(institution), start_date or "", start_time or "", norm(venue)])
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
```

- `start_date`·`start_time` 은 정규화가 끝난 값(`YYYY-MM-DD`·`HH:MM`)을 넣는다. NULL 은 빈 문자열.
- 한 빌드 안에서 같은 id 가 또 나오면 뒤에 오는 행에 `-2`, `-3` … 을 붙인다. 순서는 결정적으로: `source` → `source_file` → 원본 행 번호(강남은 `classcd`).
- 같은 입력이면 다시 수집해도 같은 id. 제목만 달라도 다른 id.

## 3. source 코드와 출처 필드

| `source` | 소스 | `source_url` | `detail_url` | `description` |
|---|---|---|---|---|
| `std` | 공공데이터포털 전국평생학습강좌표준데이터(#15013110) | 데이터셋 페이지 `https://www.data.go.kr/data/15013110/standard.do` | 원본 홈페이지주소(있으면) | 원문 저장 가능 |
| `portal` | 공공데이터포털 지자체 개별 파일 32곳 | 해당 데이터셋 페이지 URL | 원본 링크(있으면) | 원문 저장 가능 |
| `gangnam` | 강남구 통합예약 REST | 목록 REST URL(센터 코드 포함) | `https://life.gangnam.go.kr/fmcs/52?action=read&comcd={센터}&classcd={강좌}&type=R` | **항상 NULL** |
| `seoul_{구}` | 서울 구 예약사이트 | 목록 URL | 강좌 상세 URL | **항상 NULL** |

서울 구 영문 코드(소문자, 로마자 표기): `seoul_jongno`(종로) · `seoul_junggu`(중구) · `seoul_seongdong`(성동) · `seoul_dongdaemun`(동대문) · `seoul_gangbuk`(강북) · `seoul_gwanak`(관악) · `seoul_gangdong`(강동) · `seoul_yongsan`(용산) · `seoul_seongbuk`(성북) · `seoul_seodaemun`(서대문) · `seoul_guro`(구로) · `seoul_songpa`(송파) · `seoul_seocho`(서초) · `seoul_nowon`(노원).

- `source_file`: std·portal 은 내려받은 파일 이름(확장자 포함), 그 외 NULL.
- `collected_at`: 수집(빌드)한 날 `YYYY-MM-DD`(KST). `data_date`: 원자료의 데이터기준일자, 없으면 NULL(강남·서울은 수집일과 같게 둔다).
- 화면의 「출처 · 수집일」 = source 한국어 이름 + `collected_at`.

## 4. 법적 규칙 (R5)

- `gangnam`·`seoul_*` 행은 `description` 이 **항상 NULL**. DB CHECK `courses_no_repost_description` 이 막고, 파이프라인·`make_fixture.py` 도 다시 확인한다.
- 이 소스에서 저장하는 것: 강좌명·접수일·교육기간·요일·시간·장소·정원·수강료·센터·상세 링크뿐.
- 테스트 fixture(`tests/fixtures/gangnam/*.json`·`tests/fixtures/seoul/*.html`)도 허용 필드만 남긴 축약본. 설명류 필드는 `"(설명 생략)"`.
- 설명이 없으니 설명 기반 신호(`welcome`·`no_supplies`, 설명에서 찾은 `basic`)를 만들지 않는다. 화면 「설명에서 찾은 문턱 신호」 칸은 「찾은 신호가 없어요」.

## 5. 값 형식

| 항목 | 형식 | 모르면 |
|---|---|---|
| 날짜 (`start_date`·`end_date`·`apply_start`·`apply_end`·`collected_at`·`data_date`·`next_open_estimate`) | `YYYY-MM-DD`, 한국 시간 기준 날짜 | NULL |
| 시각 (`start_time`·`end_time`) | `HH:MM` 24시간제 | NULL |
| `weekdays` | 「월,수」 — 쉼표 구분, 월화수목금토일 순서, 공백 없음 | NULL |
| `weekday_bits` | 월=1 · 화=2 · 수=4 · 목=8 · 금=16 · 토=32 · 일=64 의 합(0~127) | 0 |
| `time_bucket` | `오전`(시작 < 12:00) · `오후`(12:00~17:59) · `저녁`(18:00~) | NULL |
| `capacity` | 정수(명). 9999 이상(「999999」 같은 무제한 표기)은 NULL | NULL |
| `fee_won` | 표기된 금액 그대로 정수(원) | NULL |
| `fee_period` (R18) | `월`(매달 내는 돈) · `총`(한 번에 내는 돈) · NULL(무료이거나 모름) | NULL |
| `is_free` | `fee_won = 0` 또는 원문이 「무료·무상」 이면 1 | 0 |
| `selection_method` | `선착순` · `추첨` | NULL |
| `term_days` | `end_date − start_date + 1`(양 끝 포함 일수). 1회 강좌 = 1 | NULL |
| `sessions_per_week` | `weekdays` 의 요일 수 | NULL |
| `sido` (R19) | 공식 전체 명칭(아래 표) | NULL |
| `sigungu` | 접미사 포함(「강남구」·「수원시」) | NULL |
| `dong` | 「도곡1동」처럼 동 이름(있을 때만) | NULL |
| `lat`·`lng` | M1 은 항상 NULL(지오코딩은 M2) | NULL |

- 불리언(`is_free`·`is_online`·`is_always_open`·`is_dong_center`·`is_estimate`): DB 는 INTEGER 0/1, TS 는 `boolean`(Drizzle `mode: "boolean"`).
- `is_online`: 교육방법구분이 「온라인」 이면 1(「온·오프라인 병행」은 0).
- `is_always_open`: 원문에 「상시·수시·연중」 이 있거나, 접수 기간이 한 해 전체(1/1 ~ 12/31)면 1.
- 수강료 화면 표기: `fee_period='월'` → 「월 1만 8천 원」, `'총'` → 「3만 원」, 무료 → 「무료」. 2단·3단의 「5만 원 이하」 기준은 `fee_period` 와 상관없이 `fee_won ≤ 50000`.

### 시도 전체 명칭 (R19)

| 약칭·옛 이름 | 저장 값 |
|---|---|
| 서울 | 서울특별시 |
| 부산 | 부산광역시 |
| 대구 | 대구광역시 |
| 인천 | 인천광역시 |
| 광주 · 광주광역시 · 광주특별시 | 전남광주통합특별시 (2026-07-01 광주광역시+전라남도 통합, 약칭 광주특별시) |
| 대전 | 대전광역시 |
| 울산 | 울산광역시 |
| 세종 · 세종시 | 세종특별자치시 |
| 경기 | 경기도 |
| 강원 · 강원도 | 강원특별자치도 |
| 충북 | 충청북도 |
| 충남 | 충청남도 |
| 전북 · 전라북도 | 전북특별자치도 |
| 전남 · 전라남도 | 전남광주통합특별시 |
| 경북 | 경상북도 |
| 경남 | 경상남도 |
| 제주 · 제주도 | 제주특별자치도 |

표에 없는 값(예 「전남광주통합특별시」)은 원문을 그대로 두고 `failures.json` 에 기록한다. 시도를 알 수 없는 전국 단위 온라인 강좌(국립기관 등)는 `sido`·`sigungu` NULL.

## 6. 동주민센터 판정 `is_dong_center`

운영기관명(`institution`) 또는 장소(`venue`)에 다음 중 하나가 있으면 1: 「동주민센터」 · 「행정복지센터」 · 「자치회관」 · 「주민자치」 · 「동복합문화센터」 · 「주민센터_」(노원). 「복합문화센터」·「커뮤니티센터」(강남 동 단위 센터). 강남 REST 에는 체육관·테니스장도 섞여 있으므로 기관명으로 판정한다(2026-10-10 수정).

## 7. 분야 `category` 와 사진

판정은 강좌명(`title`) 키워드. 여러 개가 맞으면 **표 위쪽이 우선**.

| 우선 | `category` | 키워드 | 사진(`public/cat/`) |
|---|---|---|---|
| 1 | `춤` | 댄스 · 무용 · 에어로빅 · 라인댄스 | `dance.jpg` |
| 2 | `몸 풀기` | 요가 · 필라테스 · 단전 · 태극권 · 체조 · 헬스 | `yoga.jpg` |
| 3 | `악기` | 기타 · 우쿨렐레 · 가야금 · 사물놀이 · 피아노 · 오카리나 | `instrument.jpg` |
| 4 | `노래` | 노래 · 합창 · 가요 | `sing.jpg` |
| 5 | `미술·서예` | 서예 · 수채화 · 그림 · 캘리 | `art.jpg` |
| 6 | `어학` | 영어 · 일본어 · 중국어 · 회화 | `lang.jpg` · `lang-b.jpg`(같은 분야가 나란히 나오면 번갈아) |
| — | NULL | 맞는 키워드 없음 | 사진 없이 옅은 면(`--surface`) |

- 값의 가운뎃점은 `·`(U+00B7) 한 글자, 「몸 풀기」 는 띄어쓰기 한 칸. DB CHECK 가 6개 값 외에는 막는다.
- 사진은 모두 AI 생성 시범 이미지. 사진을 쓰는 화면에 「AI 생성 시범 이미지」 표기.

## 8. 문턱 신호 `signals`

JSON 배열 문자열. 키는 아래 8개만, **아래 순서대로** 넣는다. 해당 없음 = `[]`.

| 키 | 조건 | 설명이 없는 소스(gangnam·seoul_*) |
|---|---|---|
| `free` | `is_free = 1` | 그대로 |
| `basic` | 제목 또는 설명에 「기초·입문·초급·초보·왕초보·처음」 | **제목만** 본다 |
| `small` | `capacity ≤ 15` | 그대로 |
| `lottery` | `selection_method = '추첨'` | 그대로 |
| `once` | `start_date = end_date` 또는 `term_days ≤ 7` | 그대로 |
| `online` | `is_online = 1` | 그대로 |
| `welcome` | 설명에 「처음·누구나·환영」 | 만들지 않음 |
| `no_supplies` | 설명에 「준비물 없」 | 만들지 않음 |

## 9. 계단 `stair` 와 `stair_reason`

- **1단** = `is_online` ∧ `is_free`
- **2단** = ¬`is_online` ∧ (`basic` ∨ `once`) ∧ (`is_free` ∨ `fee_won ≤ 50000`)
- **3단** = ¬`is_online` ∧ `term_days ≥ 28` ∧ `weekday_bits > 0` ∧ (`is_free` ∨ `fee_won ≤ 50000`)
- 2단과 3단이 둘 다 맞으면 **2단**. 어디에도 안 맞으면 NULL(화면에 안 나옴).
- 판정에 쓰는 `basic` 은 §8 의 신호 그대로(설명 포함). 그래서 설명에 「기초」 가 있는 정기 강좌는 2단이 된다.

`stair_reason` 은 저장된 값으로만 만든 한 줄(40자 이하). 날짜·숫자를 지어내지 않는다. 계단별로 위에서부터 처음 맞는 문장 하나.

| 계단 | 조건 | 문장 |
|---|---|---|
| 1 | (항상) | 「집에서 무료로 들어 볼 수 있어요」 |
| 2 | `small` | 「{capacity}명 소규모라 얼굴을 익히기 쉬워요」 |
| 2 | `once` | 「한 번으로 끝나 부담이 적어요」 |
| 2 | `basic` | 「{강좌명 또는 설명}에 「{찾은 낱말}」 표시가 있어 처음이어도 괜찮아요」 (제목에서 찾았으면 「강좌명」) |
| 3 | (항상) | 「{round(term_days/7)}주 동안 {weekdays 를 「·」 로 이은 것} 같은 시간에 만나요」 |

## 10. 접수 상태 (질의 시점 계산, 저장 안 함)

| 코드 | 화면 | 배지 |
|---|---|---|
| `before` | 접수 전 | D-n (예측이면 「예상」 함께) |
| `open` | 접수 중 | 마감일 있으면 「마감 D-n」, 당일은 「오늘 마감」 |
| `always` | 연중·수시 | — |
| `unknown` | 확인 안 됨 | — |
| `closed` | 마감 | 「지난 회차」 |

판정 순서(위에서 처음 맞는 것, `today` 는 인자로 받는다):

1. `is_always_open = 1` → `always`
2. `apply_end` 있음 ∧ `today > apply_end` → `closed`
3. `apply_start` 있음 ∧ `today < apply_start` → `before`
4. `apply_start` 있음(∧ `apply_end` 없거나 `today ≤ apply_end`) → `open`
5. `apply_start` 없음 ∧ 예측(`enrollment_patterns.next_open_estimate`) 있음 ∧ `next_open_estimate ≥ today` → `before`(예상)
6. `end_date` 있음 ∧ `today > end_date` → `closed`
7. 그 밖(시작일 없이 마감일만 있고 아직 안 지남 포함) → `unknown`

D-n 은 `날짜 − today` 의 달력 일수(한국 시간). 접수일이 없으면 「확인 안 됨」.

### 정렬 「가까운 순」 (R3·R9)

1. 지역 일치: 고른 동 일치 → 구 일치 → 시도 일치 → 나머지. **1단(온라인)은 지역을 보지 않는다.** 지역은 정렬에만 쓰고 걸러내지 않는다.
2. 그 안에서 상태: `open` → `before` → `always` → `unknown` → `closed`. 마감 강좌도 숨기지 않는다.
3. 같은 상태 안: `open` 은 `apply_end` 가까운 순(NULL 은 뒤), `before` 는 접수 시작일(예측이면 `next_open_estimate`) 가까운 순, `closed` 는 `apply_end` 최근 순.
4. 마지막으로 `id` 오름차순(결정적 순서).

목록 `limit` 기본 10.

### 0건 문구 (R9)

> 아직 이 칸에 맞는 강좌를 못 찾았어요. 다른 칸을 보거나 동네를 바꿔 보세요

홈 화면과 API(빈 배열과 함께 `empty_text`) 둘 다 이 문장.

## 11. 접수일 예측과 「예상」 표시 (R7·R17)

`enrollment_patterns` 한 줄 = 기관(+시군구) 하나.

| 컬럼 | 값 |
|---|---|
| `open_history` | 과거 `apply_start` 날짜 배열(JSON, 오름차순) |
| `cycle_days` | 이력 간격의 중앙값(일). 강남 권역 규칙은 NULL |
| `next_open_estimate` | 다음 접수 시작 예상일 `YYYY-MM-DD`. 빌드일보다 과거면 `cycle_days` 를 더해 다음 회차로 |
| `basis_count` | 근거가 된 과거 접수 횟수 |
| `rule_note` | 사람이 읽는 규칙 문장(강남 기존회원 창 등) |
| `is_estimate` | 1 = 이력으로 낸 예측 / 0 = 공식 규칙으로 계산(강남) |

- 이력이 3회 미만이면 줄을 만들지 않는다(예측 안 함 → 화면은 기관 전화 안내).
- 웹은 `courses` 를 `institution`(+`sigungu`, NULL 끼리도 같은 것으로)으로 LEFT JOIN 해서 `next_open_estimate`·`is_estimate`·`basis_count`·`rule_note` 를 함께 받는다.
- 앱 실행 시점에 `next_open_estimate < today` 면 그 예측은 쓰지 않는다(상태 `unknown`). 앱에서 회차를 다시 굴리지 않는다.
- 표시: `is_estimate = 1` → 「예상이며 확정 아님 · 과거 {basis_count}회 기준」. `is_estimate = 0` → `rule_note` 를 그대로.

### 강남 동복합문화센터 접수 창 (R17)

디딤칸 사용자는 신규회원이므로 **신규 창**을 `courses.apply_start`/`apply_end` 에 저장한다. 근거: `life.gangnam.go.kr/fmcs/421`, `조사원자료/V4-서울검증.md` 강남 행, `검증-0924.md` #8.

| 권역 | 센터 | 신규 창(저장) | 기존회원 창(`rule_note`) |
|---|---|---|---|
| 1권역 | 신사 · 논현1 · 논현2 · 청담 · 삼성1 · 삼성2 · 역삼1 · 역삼2 · 도곡1 · 도곡2 | 매월 26일 09시 ~ 말일 | 매월 16~25일 |
| 2권역 | 대치1 · 대치2 · 대치4 · 개포2 · 개포4 · 세곡 · 자곡 · 세곡커뮤니티센터 | 매월 27일 09시 ~ 말일 | 매월 16~26일 |

- 창은 다음 달 강좌용이다. 빌드일이 속한 달의 신규 창을 저장한다(예: 빌드 2026-10-10, 1권역 → `2026-10-26` ~ `2026-10-31`).
- 기존회원 마감일(25일·26일)이 주말·공휴일이면 그 전 평일까지. 이 내용은 `rule_note` 문장에만 넣는다.
- 강남 센터별 `enrollment_patterns` 행: `is_estimate = 0`, `cycle_days` NULL, `basis_count` 0, `next_open_estimate` = 다음 신규 창 시작일, `rule_note` 예 「1권역 신규회원은 매월 26일 09시~말일 인터넷 접수. 기존회원은 16~25일(주말·공휴일이면 그 전 평일까지)」.

## 12. 강좌 카드 신호 타일 6개 (R15)

| # | 타일 | 값 |
|---|---|---|
| ① | 수강료 | `free` → 「무료」 / 아니면 금액(§5 표기) / 모르면 「확인 안 됨」 |
| ② | 기초 여부 | `basic` → 「기초·입문」 / 아니면 「표시 없음」 |
| ③ | 정원 | `small` → 「{N}명 소규모」 / 정원 있음 → 「{N}명」 / NULL → 「확인 안 됨」 |
| ④ | 뽑는 방식 | `lottery` → 「추첨 · 서둘러 누르지 않아도 됩니다」 / `선착순` → 「선착순」 / NULL → 「확인 안 됨」 |
| ⑤ | 기간 | `once` → 「1회」 / 아니면 「{round(term_days/7)}주 · 주 {sessions_per_week}회」 / 모르면 「확인 안 됨」 |
| ⑥ | 장소 | `online` → 「집에서」 / 아니면 「직접 가요」 |

- `welcome`·`no_supplies` 는 타일이 아니라 「설명에서 찾은 문턱 신호」 칸에 원문을 인용한다. 없으면 「찾은 신호가 없어요」.
- 전화번호(`institution_phone`, 없으면 `institutions.phone`)가 없으면 `tel:` 버튼을 숨기고 「전화번호 확인 안 됨」.
- 외부 신청 버튼 링크: `detail_url` → 없으면 `homepage_url` → 둘 다 없으면 버튼 숨김.

## 13. 기준일 `today` (R3)

- **파이프라인**: `--today YYYY-MM-DD` 인자로 받는다. 기본값은 실행 시 `date +%F`. 규칙 함수는 모두 `today` 를 인자로 받고, 코드에 날짜를 박지 않는다.
- **앱**: 환경변수 `DIDIM_TODAY`(YYYY-MM-DD)가 있고 형식이 맞고 `DIDIM_ALLOW_TODAY_OVERRIDE=1` 이면 그 날짜. 단 `VERCEL_ENV=production` 이면 무시한다. 없으면 실제 오늘(Asia/Seoul 기준 날짜).
- **e2e**: `make_fixture.py` 가 고른 날짜를 `e2e/fixture-ids.json` 의 `today` 와 `meta.today_hint` 에 같이 쓴다. `playwright.config.ts` 가 그 값을 `DIDIM_TODAY` 로, `DIDIM_ALLOW_TODAY_OVERRIDE=1` 과 함께 넘긴다. 날짜는 9632 가 `open`/`before`, 2722 가 추첨 표시, 8218 이 `always` 가 되도록 실제 데이터에서 고른다.

## 14. meta 키

| key | value |
|---|---|
| `build_date` | 빌드한 날 `YYYY-MM-DD` |
| `source_counts` | JSON 문자열, 예 `{"std": 26334, "portal": 5507, "gangnam": 1128, "seoul_seocho": 110}` |
| `today_hint` | fixture 빌드만 `YYYY-MM-DD`. 실데이터 빌드는 NULL |

## 15. 문구 규칙

금지어(코드·화면 전체): 「창구」(→ 「복지관 담당자」) · 「대신」(→ 「함께」) · 「고독사 위험」 · 「수강생 N명」. 날짜를 지어내지 않는다. 모르는 값은 「확인 안 됨」.

```bash
grep -rnE "창구|대신|고독사 위험|수강생 [0-9]+명" src/   # 0건이어야 함
```

## 16. 예시 행 (레인 B 가 fixture 전에 쓰는 형식 예시)

DB 행 그대로(snake_case). 예시 2·3 은 옛 DB(`kakao-mcp-공모전/data/courses.db`) 실제 강좌 8218·10096 을 이 계약으로 옮긴 것이다. 예시 1 은 v4 시안의 실제 강남 강좌(일본어기초, 도곡1동)인데 **센터·강좌 코드(`GNCCxx`·`xxxxx`)는 자리표시**이고, 접수일은 §11 규칙(빌드 2026-10-10)으로 계산한 값이다. fixture.db 가 나오면 그 값을 쓴다. 예시 2·3 의 `source_file` 확장자(`.csv`)는 옛 DB 에 확장자가 없어 붙인 것이고, 실제 값은 내려받은 파일 이름을 따른다.

예시 1 — 2단, 강남 REST, 오프라인(설명 NULL):

```json
{
  "id": "211602f65f72f238",
  "source": "gangnam",
  "source_file": null,
  "source_url": "https://life.gangnam.go.kr/rest/lecture/list?company_code=GNCCxx&page=1&page_size=1000",
  "detail_url": "https://life.gangnam.go.kr/fmcs/52?action=read&comcd=GNCCxx&classcd=xxxxx&type=R",
  "collected_at": "2026-10-10",
  "data_date": "2026-10-10",
  "title": "일본어기초",
  "description": null,
  "institution": "도곡1동 복합문화센터",
  "institution_phone": null,
  "sido": "서울특별시",
  "sigungu": "강남구",
  "dong": "도곡1동",
  "venue": "도곡1동 복합문화센터",
  "address": null,
  "start_date": null,
  "end_date": null,
  "start_time": "16:00",
  "end_time": "17:20",
  "weekdays_raw": "금",
  "weekdays": "금",
  "weekday_bits": 16,
  "time_bucket": "오후",
  "capacity": 20,
  "fee_raw": "18000",
  "fee_won": 18000,
  "fee_period": "월",
  "is_free": 0,
  "is_online": 0,
  "target_raw": null,
  "apply_start": "2026-10-26",
  "apply_end": "2026-10-31",
  "apply_method": null,
  "selection_method": null,
  "is_always_open": 0,
  "homepage_url": null,
  "lat": null,
  "lng": null,
  "is_dong_center": 1,
  "category": "어학",
  "stair": 2,
  "stair_reason": "강좌명에 「기초」 표시가 있어 처음이어도 괜찮아요",
  "signals": "[\"basic\"]",
  "term_days": null,
  "sessions_per_week": 1
}
```

예시 2 — 1단, 온라인, 시도·시군구 NULL(국립국악원, 옛 DB 8218):

```json
{
  "id": "099a03a3206bc253",
  "source": "std",
  "source_file": "문화체육관광부_국립국악원_평생학습강좌.csv",
  "source_url": "https://www.data.go.kr/data/15013110/standard.do",
  "detail_url": "http://academy.gugak.go.kr/course/active/detail.do?courseActiveSeq=875&srchCategoryTypeCd=CATEGORY_TYPE::NONDEGREE&courseMasterSeq=875&currentMenuId=900001001",
  "collected_at": "2026-10-10",
  "data_date": "2026-06-01",
  "title": "우리악기 이해하기 1 (가야금,거문고,아쟁)",
  "description": "국악기 중 현악기인 가야금, 거문고, 아쟁의 역사와 특징에 대해 알 수 있다.각 국악기의 매력을 느낄 수 있는 국악곡을 감상할 수 있다.",
  "institution": "국립국악원",
  "institution_phone": "02-580-3086",
  "sido": null,
  "sigungu": null,
  "dong": null,
  "venue": "온라인",
  "address": "서울특별시 서초구 남부순환로 2364",
  "start_date": "2026-01-01",
  "end_date": "2026-12-31",
  "start_time": "10:00",
  "end_time": "23:59",
  "weekdays_raw": null,
  "weekdays": null,
  "weekday_bits": 0,
  "time_bucket": "오전",
  "capacity": null,
  "fee_raw": "0",
  "fee_won": 0,
  "fee_period": null,
  "is_free": 1,
  "is_online": 1,
  "target_raw": "국악기를 알고 싶은 누구나",
  "apply_start": "2026-01-01",
  "apply_end": "2026-12-31",
  "apply_method": "인터넷",
  "selection_method": "선착순",
  "is_always_open": 1,
  "homepage_url": "http://academy.gugak.go.kr/course/active/detail.do?courseActiveSeq=875&srchCategoryTypeCd=CATEGORY_TYPE::NONDEGREE&courseMasterSeq=875&currentMenuId=900001001",
  "lat": null,
  "lng": null,
  "is_dong_center": 0,
  "category": "악기",
  "stair": 1,
  "stair_reason": "집에서 무료로 들어 볼 수 있어요",
  "signals": "[\"free\",\"online\"]",
  "term_days": 365,
  "sessions_per_week": null
}
```

(원자료 정원 999999 → `capacity` NULL. 「누구나」 는 설명이 아니라 교육대상이라 `welcome` 이 아니다.)

예시 3 — 3단, 영등포 정기(옛 DB 10096):

```json
{
  "id": "7615528ea4ad4fcf",
  "source": "std",
  "source_file": "서울특별시_영등포구_평생학습강좌.csv",
  "source_url": "https://www.data.go.kr/data/15013110/standard.do",
  "detail_url": null,
  "collected_at": "2026-10-10",
  "data_date": "2026-06-12",
  "title": "바른 몸을 위한 요가&매트필라테스",
  "description": "요가와 맨몸으로하는 필라테스로 하는 건강강좌",
  "institution": "서울특별시 영등포구 미래교육과",
  "institution_phone": "02-2670-7581",
  "sido": "서울특별시",
  "sigungu": "영등포구",
  "dong": null,
  "venue": "YDP미래평생학습관",
  "address": "서울특별시 영등포구 도신로4길20",
  "start_date": "2026-07-08",
  "end_date": "2026-09-18",
  "start_time": "10:00",
  "end_time": "12:00",
  "weekdays_raw": "수+금",
  "weekdays": "수,금",
  "weekday_bits": 20,
  "time_bucket": "오전",
  "capacity": 20,
  "fee_raw": "30000",
  "fee_won": 30000,
  "fee_period": "총",
  "is_free": 0,
  "is_online": 0,
  "target_raw": "성인(영등포구민 우선)",
  "apply_start": "2026-06-01",
  "apply_end": "2026-06-30",
  "apply_method": "온라인",
  "selection_method": "선착순",
  "is_always_open": 0,
  "homepage_url": "https://www.ydp.go.kr",
  "lat": null,
  "lng": null,
  "is_dong_center": 0,
  "category": "몸 풀기",
  "stair": 3,
  "stair_reason": "10주 동안 수·금 같은 시간에 만나요",
  "signals": "[]",
  "term_days": 73,
  "sessions_per_week": 2
}
```

(기준일 2026-10-10 이면 이 강좌는 `closed` → 「지난 회차」 배지.)

예시 1 에 붙는 `enrollment_patterns` 행:

```json
{
  "institution": "도곡1동 복합문화센터",
  "sigungu": "강남구",
  "open_history": "[]",
  "cycle_days": null,
  "next_open_estimate": "2026-10-26",
  "basis_count": 0,
  "rule_note": "1권역 신규회원은 매월 26일 09시~말일 인터넷 접수. 기존회원은 16~25일(주말·공휴일이면 그 전 평일까지)",
  "is_estimate": 0
}
```
