# Packs 탭 값 보정 — 남은 7가지 작업 계획 (2026-11-26)

전제: #686(0353, shop_offers 1.2.0, shop 1.2.0) 머지 + `db push` + 두 PC Ingest 재시작. 그 뒤에도 상점 화면과 다른 것 일곱 가지(`2026-11-25-handover-tasks.md` §6의 대조). 조사는 전부 로컬 데이터(저널·클라이언트 덤프 11-20)로 했고 프로덕션 탭은 못 봤다.

**먼저 안 것 — 셋은 이미 절반 돼 있다.** 0278 `game_pack_picks`가 클라이언트 표에서 픽을 만든다: `custom_dailypackage`(154행)는 Daily Sale 팩 `82000–82003`·`83018–83029` 전부에 "고른 영웅 조각 2/3/5/10"을, `custom_weekly_card`는 `name_key` 1140003(Value)·1140004(Elite)에 슬롯 2/3 × 선택지 10을 준다. 뷰는 이 픽을 **한 번만** 센다.

## 순서 제안

머지·적용 → ③⑥⑦ (코드 없음, 탭에서 확인·입력) → ① (뷰 한 줄) → `game_pack_extras` 표 (②④⑤ 한꺼번에) → ⑤ 조사 → Flash Sale(덤프 갱신 뒤).

## ① Custom Weekly Pass — 매일 픽을 7일치로 — **했음 (11-26, #686: 파서 1.3.0 + 0354 + `pick_days` 캡션)**

- **현상:** 픽(2 또는 4 슬롯)은 하루치로 한 번 계산. 실제는 7일 매일.
- **근거:** `custom_weekly_card` slotnum 2/3(덤프 11-20; 화면은 Elite 4 → 덤프가 낡았거나 서버 차이. 새 덤프 뒤 `game-catalog` 재업로드로 확인), `get.week.card.info` 커스텀 패스 행은 `reward` 없음 → 1.1.0 `track='daily'` 행 안 생김.
- **할 일:** (a) 파서: `reward`가 없어도 `time`이 있으면 `track='daily'`, `levels=time`, 내용물 빈 행 → 뷰가 일수를 안다. (b) 뷰(0354): `choices` CTE에서 `name_key` 픽의 `picked_rubies`에 `coalesce(offer.levels,1)` 곱, 슬롯 표시는 1일치 + 대시보드 캡션 "× 7일". (c) pgTAP: daily 오퍼 + name_key 픽 → 7배.
- **크기:** 파서 10줄 + 마이그레이션 1 + 캡션 1 + 테스트. 반나절.

## ② Super Monthly Pass — 매일 수령분 (10개 아이템·VIP 1·루비 100 × 30)

- **근거:** 서버 응답 없음(화면 열 때 요청 없음 확인). 클라이언트 `monthcard` 9007: `right_name` 특전 5개(New Crops·Huge Storage·Special Decor·Zombie Shooter·미번역 1), `reward_show` `15;5;500|250000;7;10|200201;7;60|230100;7;2|230104;7;1000` — 형식 추정 `id;type;num`, 화면의 매일 수령분과 안 맞음(표시용). `item_use` 셋(VIP 일수·Formation IV·Deluxe Cosmetic)은 특전 토큰이라 루비 가치 없음.
- **할 일:** 서버에서 못 받는 값은 임원이 넣는다 — **`game_pack_extras (match_kind, match_value, item_id, qty, repeat, note)`** 표를 0278 픽과 같은 매칭(`pack_id` / `name_key`)으로 만들고 뷰가 `items`에 합산. Settings › Shop value에 편집기(`game_pack_names` 편집기 복제, 임원 쓰기·멤버 읽기 RLS + pgTAP 부정 테스트). 이 표 하나로 ④⑤도 해결.
- **크기:** 마이그레이션 1(+RLS, pgTAP) + 뷰 CTE 1 + 편집기. 하루.

## ③ Daily Sale 메달 — 이미 됨, 확인만

- 0278이 `custom_dailypackage`로 83022/23/24에 "고른 영웅 조각 2/3/5" 픽을 준다. 화면(Guy ×2/×3/×5)과 같음.
- **할 일:** 머지 뒤 탭에서 Pioneer/Commander/Overlord 행에 픽 1개가 보이는지. 안 보이면 `game_pack_picks`가 안 올라간 것 → `dw-collector game-catalog` 마지막 업로드 날짜 확인.

## ④ 100-Ruby Pack 첫 구매 2배

- **근거:** `get.first.charge.info` `startTime 0`, `exchange.info`의 `goldprices`·`exchange_vip` 빈 값. 2배 규칙은 클라이언트(`recharge`·`firsttime_recharge` rechargeid 10025)인데 덤프에 플래그 없음. 평생 1회라 상시 가치가 아님.
- **할 일:** 무시하거나(설명 한 줄: "첫 구매 2배는 1회라 안 셈") ②의 extras에 `repeat`=1회 메모로. 권장: 무시.

## ⑤ Mega Bargain 누적 구매 트랙 (1/3/6/9/12회 → 200 아이템·광석 3,000·5,000·설계도 5·…)

- **근거:** 로그인 묶음에 없음(`get.yang.act.info`는 스테이지 활동), 탭 열 때 요청 없음, 클라이언트 `gift*` 표는 다른 것. 팩은 t16(`2025120416` 등).
- **할 일:** 덤프 전 표에서 `2025120416`(또는 그 활동 id)을 포함하는 표를 전수 검색(스크립트 10줄) → 누적 보상 표를 찾으면 picks처럼 extras 소스로 자동 생성(활동 단위라 "n개 구매 시" 주석). 못 찾으면 ②의 표에 임원 입력.
- **크기:** 조사 1시간, 표 파싱 반나절.

## ⑥ Dawn Badge 9990012

- **근거:** `goods`에 있음 → 이름은 `game-catalog`가 올린다(확인). 값만 없음. 100배지 = $0.99 = 루비 100.
- **할 일:** `game_item_values` 9990012 = 1 (`source='game'`) 시드 한 줄(마이그레이션 또는 관리자 입력). 비율이 정확히 1.0이 되어 환율 기준선 역할 — t46은 숨기지 않음.

## ⑦ 미평가 아이템

- 새로 내용물이 생긴 것: Hero Code 30일(210454 조각·230104 광석·230101 책 등), Choice Pack 조각 253066–253074, `item_use` 222027/222028/222031, `105100`(goods에 없음).
- **할 일:** 적용 뒤 Packs 탭에서 unvalued 순 정렬 → Settings › Shop value에서 값 입력(또는 0278 추정). 세션은 prod `game_item_values`를 못 읽으니 목록은 주인이 탭에서.

## 덤으로 — Flash Sale과 Treasure

- **Flash Sale:** 클라이언트 `rush_buy`가 그 표다 — `id → gift_id`(3210000xx Super Value Pack), `show_discount`, `buy_time`. 덤프(11-20)는 id 1–35뿐인데 응답 `roundArr` id는 73·57·49·63 → **새 덤프가 먼저**. 그 뒤 `get.flash.sale.activity.info` 파서: 라운드별 4팩 오퍼 행(`track` 없이), 할인율은 `raw`.
- **Treasure of the Day:** 매일 바뀌는 1종은 어느 응답에도 없음(`get.month.pay.act.info` `stageArr`는 충전일 달력). 보류.
