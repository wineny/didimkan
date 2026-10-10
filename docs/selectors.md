# e2e 셀렉터 계약 (C1 ↔ B4·B5·B6·A7)

e2e(`e2e/flow.spec.ts`)가 이 속성으로 화면을 찾는다. 화면 구현은 **이 이름을 그대로** 쓴다.

| 속성 | 위치 | 설명 |
|---|---|---|
| `data-choice="1|2|3"` | `/` | 상태 선택 3개. 1 = 「아직은 집에서」(1단), 2 = 「한 번 나가 볼 수 있어요」(기본), 3 = 「정기적으로」. 선택된 것은 `aria-pressed="true"` |
| `data-next` | `/`, `/where` | 다음으로 가는 버튼 |
| `data-sido="값"`, `data-sigungu="값"` | `/where` | 시도·시군구 선택 버튼. 값은 DB 의 전체 명칭(예 `서울특별시`·`강남구`) |
| 「동네는 건너뛰기」(보이는 글자) | `/where` | 1단을 고른 사람에게만. 클릭하면 `/home?st=1` |
| `data-step="1|2|3"` | `/home` | 계단 칸. 일반 3개, 크게 보기 2개 |
| `data-now="true"` | `/home` | 지금 칸 |
| `data-course` | `/home` | 강좌 카드(링크) |
| `data-tile` | `/course/[id]` | 신호 타일 6개 |
| `a[data-apply]` | `/course/[id]` | 외부 신청 링크(`target="_blank" rel="noopener noreferrer"`) |
| `a[href^="tel:"]` | `/course/[id]` | 전화 버튼(번호 없으면 렌더하지 않음) |
| `data-notify` | `/course/[id]` | 파란 「관심 강좌로 접수 알림 받기」 버튼. 접수 전(`before`)일 때만. 누르면 `POST /api/alerts` → 200 `/alert/<id>`, 401 `/login?course=…` |
| `[role=dialog][data-sheet]` | 바텀시트 | `/me` 의 「내 번호 지우기」 확인 시트(글귀 「번호와 알림을 모두 지워요. 되돌릴 수 없어요」) |
| `data-big-toggle` | TopBar | 크게 보기 토글(아이콘+「가 크게보기」) |
| `html[data-big]` | `<html>` | 크게 보기 켜짐 |
| `main p` | 본문 | 글자 크기 측정 대상 — 모든 화면 `main` 안에 `<p>` 가 하나 이상 있어야 함 |
| `main button`, `main a[role="button"]`, `main a[data-apply]` | 본문 | 크게 보기 버튼 높이 ≥ 64px 측정 대상(첫 번째) |

`e2e/fixture-ids.json`(A7 가 만든다) 형식:

```json
{ "today": "YYYY-MM-DD", "sido": "서울특별시", "sigungu": "강남구",
  "ids": { "9632": "<새 id>", "8218": "<새 id>", "10096": "<새 id, 3단 예시>", "10132": "<새 id, 규칙상 2단>", "2722": "<새 id>", "...": "..." } }
```


## M2-a 로그인 · 알림 (갈래 C)

| 속성 | 위치 | 설명 |
|---|---|---|
| `data-login` | TopBar | 로그인 전에만. `/login` 링크 「로그인」 |
| `data-me` | TopBar | 로그인 후에만. `/me` 링크 「내 알림」 |
| `data-phone` | `/login` 1단계 | 휴대전화 입력(`type=tel`). 화면엔 하이픈, 서버엔 숫자만 보낸다 |
| `data-send` | `/login` 1단계 | 「문자 보내기」 → `POST /api/auth/send-code` |
| `data-code` | `/login` 2단계 | 6자리 입력(`autocomplete=one-time-code`) |
| `data-verify` | `/login` 2단계 | 「확인하고 알림 정하기」 → `POST /api/auth/verify`, 성공 뒤 `course` 가 있으면 `POST /api/alerts` → `/alert/<id>`, 없으면 `next`(안전한 경로) 또는 `/me` |
| `data-resend` | `/login` 2단계 | 「다시 보내기」. 보낸 뒤 30초 동안 비활성 |
| `data-done` | `/alert/[id]` | 「이대로 알려주세요」 → `/me` |
| `data-sms-preview` | `/alert/[id]` | 「문자 미리보기」 링크 → `/alert/<id>/sms` |
| `data-slot="d3|d0"` | `/alert/[id]` | 문자 날짜 줄(3일 전·당일). 이미 지난 줄은 「지났어요」, 보낸 줄은 「보냈어요」 |
| `data-sms="d3|d0"` | `/alert/[id]/sms` | 말풍선(문자 본문 `[디딤칸] …`) 2개 |
| `data-sms-when="d3|d0"` | `/alert/[id]/sms` | 말풍선 위 날짜·시각 줄 |
| `data-alert` | `/me` | 알림 카드. `data-alert-id`, `data-on="true|false"` 도 붙는다 |
| `data-alert-toggle` | `/me` | 「알림 끄기/켜기」 → `PATCH /api/alerts/<id>` `{isOn}`. 꺼지면 카드에 「꺼짐」 |
| `data-alert-remove` | `/me`, `/alert/[id]`(강좌가 사라진 때) | 「빼기」 → `DELETE /api/alerts/<id>` |
| `data-delete-me` | `/me` | 「내 번호 지우기」 → 바텀시트 |
| `data-delete-confirm` | `/me` 시트 | 「지우기」 → `DELETE /api/me` → `/` |
| `data-logout` | `/me` | 「로그아웃」 → `POST /api/auth/logout` → `/` |
| `data-notify-confirm` | `/login?course=` | 이미 로그인한 사람이 강좌 링크로 왔을 때 「알림 받기」 버튼(링크만 열어서는 등록되지 않음) |

화면 경로: `/login`(04+05) · `/alert/[id]`(06) · `/alert/[id]/sms`(09) · `/me`(08) · `/privacy`(개인정보 처리 안내 초안). 모두 `main` 안에 `<p>` 가 있고, 크게 보기에서 입력·버튼 높이는 64px 이상이다.
