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
| `data-notify` | `/course/[id]` | 파란 「관심 강좌로 접수 알림 받기」 버튼 |
| `[role=dialog][data-sheet]` | 바텀시트 | 글귀에 「접수 알림은 11월에 열려요」 |
| `data-big-toggle` | TopBar | 크게 보기 토글(아이콘+「가 크게보기」) |
| `html[data-big]` | `<html>` | 크게 보기 켜짐 |
| `main p` | 본문 | 글자 크기 측정 대상 — 모든 화면 `main` 안에 `<p>` 가 하나 이상 있어야 함 |
| `main button`, `main a[role="button"]`, `main a[data-apply]` | 본문 | 크게 보기 버튼 높이 ≥ 64px 측정 대상(첫 번째) |

`e2e/fixture-ids.json`(A7 가 만든다) 형식:

```json
{ "today": "YYYY-MM-DD", "sido": "서울특별시", "sigungu": "강남구",
  "ids": { "9632": "<새 id>", "8218": "<새 id>", "10096": "<새 id, 3단 예시>", "10132": "<새 id, 규칙상 2단>", "2722": "<새 id>", "...": "..." } }
```
