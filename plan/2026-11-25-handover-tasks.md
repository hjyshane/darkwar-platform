# 2026-11-25 handover 작업 노트 (Windows 메인 PC)

handover.md §2의 항목을 이 PC에서 할 수 있는 만큼 진행한 기록. db push·배포·시크릿 설정은 하지 않음.

## 1. main 최신화 — 할 일 없음 (확인함)

`C:\darkwar-platform`은 `main`, HEAD `a14ff283` = `origin/main` (#685 머지). `git fetch` 뒤 `main..origin/main` 0 커밋.
#669~#685 전부 이미 들어 있음. 미추적 파일 둘(`plan/2026-11-14-event-alarms-ledger.md`, `services/collector/.claude/`)은 그대로.

## 2. 0343 `game-dump` — 실행함 (11-25 17:36 EST, 주인 승인 뒤)

**드라이런(쓰기 없음) 11-25 실행 결과:** `tables=473 rows=214147 json=131.7MB localised=210 failed=0 version=1645,22513,4220438827` — 11-20과 동일.
**실제 업로드 결과:** `uploaded tables=473 removed=0`, exit 0. 관리자 화면 실 DB 확인은 미실시(앱 브라우저에 cbfw.us 세션 없음).

실제 실행 시 쓰는 곳 (`services/collector/src/dw_collector/gamedata/dump.py` `upload`):

| 테이블 | 동작 |
|---|---|
| `game_datatables` | 테이블당 1행 upsert (`on_conflict=name`, merge-duplicates). 끝나면 덤프에 없는 이름은 **delete** (자식은 cascade) |
| `game_datatable_rows` | 테이블별로 **delete 후** 1,000행 jsonb 조각씩 insert (요청 1건 = 조각 1개) |
| `game_datatable_strings` | 테이블별로 delete 후 insert (en·ko) |
| `game_datatable_names` | 테이블별로 delete 후 1,000행 배치 insert |

- 인증: `C:\darkwar-platform\.env`의 `SUPABASE_URL` + `SUPABASE_SECRET_KEY`(서비스 키, RLS 우회). 다른 테이블은 건드리지 않음.
- 요청 수: 테이블당 3~14건 → 수천 건, 수 분. 타임아웃 300 s.
- **전제: 0343이 프로덕션에 적용돼 있어야 함.** 이 세션은 `migration list --linked`가 거부돼 확인 못 함. 주인 보고(11-25 0347–0352 push)가 맞으면 `db push`는 미적용을 전부 올리므로 0343·0346도 들어갔을 것 — 주인이 `npx.cmd supabase migration list --linked`로 확인.
- 실행 명령 (cwd `C:\darkwar-platform\services\collector`):
  ```
  uv run --no-sync --with "UnityPy>=1.25" --with "lupa>=2.8" dw-collector game-dump --bundles C:/DW_data/gamedata/base --bundles C:/DW_data/gamedata/bundles
  ```
- 실행 뒤 볼 것: 출력 `uploaded tables=473 removed=0`; 대시보드 Settings › Shared › Game data tables에서 `building`(14 MB, 11조각) 열리는 시간, 이름 검색 `ilike` 속도.

## 3. 0346 지도 타임아웃 — 프로덕션 member 측정 방법

전제 확인: `migration list --linked`에 `20260728000346` 있음. 없으면 측정은 "전" 수치가 된다(그것도 가치 있음 — 전후 비교).

SQL Editor(postgres로 실행됨)에서 한 트랜잭션으로. 대시보드는 `supabase.rpc('map_atlas', { p_server_id: 580 })`를 authenticated로 부른다. `current_app_role()`(0193)은 `auth.uid()` → `app_users` → `alliance_memberships`로 역할을 정하므로 **실제 멤버 계정의 `user_id`**를 `sub`에 넣어야 member 플랜이 나온다.

```sql
-- 1) 멤버 한 명의 uid (간부 아닌 member)
select m.user_id, m.role, a.current_name
  from public.alliance_memberships m join public.alliances a on a.alliance_id = m.alliance_id
 where a.is_own and m.role = 'member' limit 3;

-- 2) 그 uid로 member 세션 흉내 + 측정
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"<위 user_id>","role":"authenticated"}', true);
select public.current_app_role();            -- 'member'가 나와야 함
set local statement_timeout = '60s';         -- 8 s 타임아웃에 explain이 잘리지 않게 (USERSET)
explain (analyze, buffers, format text) select public.map_atlas(580);
rollback;
```

보는 것 (로컬 144만 행 기준치: 전 156/546 ms, 후 58 ms / 32k buffers):

1. 플랜에 `CTE uids_old` 아래 `Filter: (map_server_id IS NULL)`가 **없고** `world_city_old_rows_uid_idx`로 Index Only Scan.
2. `Execution Time`과 `shared hit/read` 합계. `read`가 크면 첫 실행은 콜드 — 두 번 돌려 두 번째를 기록.
3. RLS 포장 `(select current_app_role())`이 InitPlan으로 한 번만 평가되는지.
4. `set local role` 없이(postgres) 한 번 더 — 둘이 크게 다르면 RLS가 범인(db-performance.md 규칙 2).

함수 안의 CTE 플랜이 `explain select map_atlas(580)`에 안 펼쳐지면(plpgsql이면 그렇다) `auto_explain`은 쓸 수 없으니 함수 본문의 쿼리를 꺼내 직접 explain — 본문은 `20260728000334_…sql:79`부터. 그리고 ② 단계: 로그인한 member로 580 지도를 3~5번 열어 타임아웃 문구가 나오지 않는지.

주의: `explain analyze`는 실제로 실행한다 — micro 인스턴스에서 사용자 체감(메모리 `prod-introspection-load`). 한산한 시각에.

## 4. 메인 PC 압축 응답 백필 — 범위와 위험 (결정은 주인)

**범위 (확인함, 이 PC 로그·링 기준):**

- 키 없던 구간: `ingest.log.prev` 첫 줄 `2026-11-20 19:57:30 aps_zstd_key_unset` ~ `ingest.log` `2026-11-24 00:41:45 aps_zstd_key_loaded` (로컬 시각). 11-20 19:57 이전은 로그가 돌아가 **모름** — handover는 "11-20부터".
- 링 `C:\DW_data\live`: 8,712파일 / 928 MB, 가장 오래된 것 11-18 22:39. **11-20 00:00 ~ 11-24 00:41 파일 5,816개** 전부 아직 링에 있음.
- 링 보존은 약 6.7일(하루 ~1,300파일) → **11-20 파일은 11-26~27쯤 밀려 나간다.** 백필을 하려면 그 전에, 아니면 해당 파일을 먼저 다른 폴더로 복사.
- 규모 추정: 11-17 미니 PC는 1,109파일 → 14,904건. 비례하면 5,816파일 → **약 7~8만 건** inbound(파서 있는 것 ~40%). sync 1,000행 배치로 수십 분.

**위험:**

1. `backfill_aps.py`가 **이 PC에 없다** (`C:\DW_data\aps\`는 미니 PC). 미니 PC에서 복사해 와야 함. 저장소 밖 스크립트라 버전 관리 없음 — 미니 PC의 사본이 11-18 이후 바뀌었는지 모름.
2. 스크립트는 **파일별 디코딩**이다(11-17 시점). #669가 고친 "15초 경계에 걸친 프레임"은 백필에서도 빠진다 — 경계 손실분(11-24 측정: 네 파일에서 프레임 74 → 165, 즉 절반 가까이)은 회수 못 함. 스크립트를 `iter_extension_events(streams=)`로 고치면 회수되지만 그건 새 작업.
3. 중복: 압축 프레임에서 나온 inbound만, id 접두사 `dw-backfill-aps:`로 넣으므로 평문 중복은 없음. 단 `--ingested-before 2026-11-24T00:41:45-05:00`를 꼭 줘야 키 로드 뒤 정상 ingest된 파일과 겹치지 않음.
4. 저널 잠금: Ingest가 같은 SQLite에 쓰는 중. 11-19 `database is locked` 하나로 16시간 죽은 전력 — Ingest 쪽은 #628/#631로 재시도가 있지만 백필 스크립트 쪽 재시도는 모름. 11-17엔 Ingest와 같이 돌아 문제 없었음.
5. 메모리 `repair-data-after-restarting-writers`: Ingest·Sync 재시작 없이 돌려도 되지만, 백필 뒤 outbox 수만 행이 sync 큐에 쌓이는 동안 라이브 지연.
6. 이 PC 체크아웃은 `main` 최신이라 코드 전제는 충족. `uv run`은 **`--no-sync`** 필수(traps).

**하지 않으면 잃는 것:** 11-20~24 메인 PC 본계정(580)의 압축 응답 — `world.get.new`, `al.rank`, `get.new.user.info`, `get.al.info`, 럭키 매직하우스 `lucky.card.act.flip` 응답 등. 미니 PC도 580을 수집하므로 랭킹·연맹 정보는 대부분 겹치고, 이 PC만의 것은 본계정이 연 화면(이벤트 응답, 뷰포트)이다.

## 5. 알람 — 첫 전송 결과와 탭 확인

**첫 디스코드 전송 결과 — 이 세션은 못 봤다.** PostgREST 읽기(서비스 키)와 `db query --linked` 둘 다 분류기에 거부됨. 주인이 SQL Editor에서:

```sql
-- Frankie 1, 11-16 01:30 UTC 1시간 단계와 그 뒤 모든 알람 outbox 행
select notification_id, channel, event, alarm_step, anchor_at, created_at,
       delivered_at, expired_at, attempts, last_error
  from public.notification_outbox
 where created_at >= '2026-11-15'
 order by created_at;
```

읽는 법: `delivered_at` 있음 = 웹훅 2xx. `delivered_at` null + `last_error` = 실패 사유(`not queued: …`는 pg_net 큐 전 실패, `expired: not sent within 15 minutes…`는 15분 만료). 행이 하나도 없으면 cron `alarms-deliver`가 뜰 행을 못 골랐다는 뜻 → `cron.job_run_details`에서 `alarms-*` 최근 상태.

두 번째 자기 연맹(`b9daa299…`) 알람 0건의 이유 후보: `schedule_events`에 그 연맹의 다가오는 항목이 없거나 `schedule_reminders.enabled`가 꺼져 있음:
```sql
select e.schedule_event_id, e.title, e.starts_at, count(r.*) filter (where r.enabled) as on_reminders
  from public.schedule_events e left join public.schedule_reminders r using (schedule_event_id)
 where e.alliance_id::text like 'b9daa299%' and e.starts_at > now()
 group by 1,2,3 order by 3 limit 20;
```
(`schedule_events.alliance_id`는 0192, `schedule_reminders.enabled`는 0322에 있음 — 확인함.)

**탭 확인 6가지 (handover §2, 로그인 상태로, 미실시):**

1. 간부와 멤버 각각으로 `#/alarms`가 400 없이 열린다 (시각 `.or()` 필터, 항목에 붙은 reminders). — 주인이 직접 보기로(11-15).
2. 간부로 부른 `alarm_deliveries`가 200 — 첫 전송 뒤엔 그 항목의 행이 있다.
3. 칩 하나 끄고 Save → `schedule_reminders.enabled`가 바뀐다 (`db query --linked`).
4. Send now → `once:` outbox 행이 생기고, Refresh 뒤 칩이 sent.
5. 보드 저장이 `channel_is_ours`를 통과한다. 게임 이벤트 감시가 맞는 연맹에 보드를 넣는다.
6. 숨긴 게임 항목이 다음 `alarms-calendar` 실행 뒤에도 숨겨져 있다.

브라우저로 1·2·4·6은 이 세션이 할 수 있다 — cbfw.us에 로그인된 세션이 앱 브라우저에 있어야 함(11-15엔 없었다).

## 6. Packs 탭 vs 실제 상점 화면 — 로컬 데이터로 대조 (11-26)

주인이 본계정 상점 스크린샷 31장을 보냄. 탭을 열지 않고 주 PC 저널(`live.db`)의 `exchange.info` 카탈로그(11-26 02:00Z 277행, 11-21 357행)·당일 `shop_pack_offers` 53행·번들 로컬라이즈 사전으로 대조. 스크립트와 중간 파일은 세션 스크래치(`compare.py`, `compare.out`), 저장소 밖.

**맞는 것(확인함).** 가격은 전부 일치(배지/100 = `dollars`; Dawn Badge Pack 10단계가 $0.99=100부터 선형). Hero Battle Pass `250325001` 내용물 6종 수량까지 정확(금상자 70·1K루비 2·책 1,200·보라 400·금괴 30·빨간상자 16). Event Monthly Pass `240000007` 즉시 지급 4종 정확. Mod Vehicle Combo Pack 3상자 = `26032445/50/55`. Mega Bargain·Pack Shop·Flash Sale·Daily Sale 묶음(`Integrated Daily Sale Package` 700루비)·Exclusive Equipment Choice Pack·Customize Equipment(`3020xx`/`30204x` 두 회차)·Login Value Gift·Road to Dawn·Industrial Age BP 전부 카탈로그에 있고 내용물 있음.

**비어 있는 것(탭이 내용물 없이 보이거나 숨김).**

1. **Hero Code `9008` $24.99 (t666)** — `items` 빈 값, 화면 명령 없음 → `contents_listed=false`로 **숨겨짐**. 실제: 30일 달력(10/31–11/29) 매일 조각 10 / 빨간상자 5 / 금괴 10 / 책 200 / 부스트 광석 1,000 순환. 명령 미확인(캡처 스윕 필요).
2. **Super Monthly Pass `9007` $9.99 rb=1000 (t5)** — `items` 빈 값 → 루비 1,000만 계산. 실제(Troop Skin: Revenge, 30일): 스킨·루비 1,000·30d 아이템·프레임 + **매일 ×30: 10개 아이템·VIP 1·루비 100 → 루비만 +3,000**. 명령 미확인.
3. **Treasure of the Day `80983`(rb 100)·`80969`(rb 0) $0.99** — 둘 다 빈 값, `get.month.pay.act.info` `para2/para3`. rb=0 쪽은 $0.99에 아무것도 없는 행으로 보임. 실제(Apoca Treasure Guide): 루비 100 + 날마다 바뀌는 1종(정밀부품 8 / 코어 5 / 설계도 3+티타늄 12+기어 600 / 별 250 / 1h×6) + 자원 100×3, 그리고 충전일 달력 30단계가 `stageArr[].reward`에 있다. 파서가 의도적으로 내용물을 안 쓴다(0337 주석).
4. Dawn Badge Pack t46 ×10 — 빈 값·숨김. 배지 상점이니 그대로 둬도 됨.

**과소평가(내용물 일부만).**

5. **주간 패스 7종(t27, SOLD)** — 탭은 "구매 즉시" 분만 계산. `get.week.card.info` `weekCards[].reward`(매일 수령분)와 `time`(7)이 페이로드에 있는데 파서가 안 읽음("the pack lists its own"). Precision Parts Weekly Pass: 즉시 부품 10 vs 매일 부품 8·1h×3·보라 50 ×7일. Custom Weekly Pass: 매일 2(Value)/4(Elite) 슬롯 선택 ×7 — 9개 선택지(칩 30·부품 10·펫책 2·코어 3·장비상자 2·별 150·광석 1,200·1h×8·금 1M×6).
6. **Event Monthly Pass `240000007`** — 카탈로그 `items`(즉시 4종)가 있어서 뷰가 오퍼 `items`(목표 보상: 부품 60·3h×15·빨간상자 10, `scoreRewardArr[].payReward`)를 버림(`latest` CTE: pack items 비어 있을 때만 offer items). 둘 다 더해야 함.
7. Daily Sale(Guy 메달 99/199/399) = Pioneer/Commander/Overlord Package `83022/23/24` — 영웅 조각 2/3/5가 `items`에 없음(새로고침으로 영웅이 바뀌는 항목).
8. `<b>100</b>-Ruby Pack` `250000002` rb=100 — 첫 구매 2배(100+100, 6단계 전부 평생 1회)가 반영 안 됨.

**무해.** 오퍼만 있고 카탈로그에 없는 id 4개(`26032430/35/40`, `83012`) — 뷰가 카탈로그에서 출발하니 안 보임. 이름 없는 `261000001/2`는 $0이라 `dollars > 0` 필터에 걸러짐. 아이템 이름은 `catalog.py`가 `{0}`를 `name_value`로 치환하니 문제 없음.

**고침(11-26, 이 가지).** ⑥ 0353 `shop_pack_value`: `pack_items` CTE가 팩 목록과 화면 목록을 아이템별로 합산(pgTAP `353_…` 9개, 전체 244파일 로컬 통과). ⑤ `shop_offers` 1.1.0: `weekCards[].reward × time` → `track='daily'`, `levels`=일수(파서 테스트 43개). 대시보드는 'daily'일 때 문구 하나. 적용은 `db push`(0353) + 두 PC Ingest 재시작, 순서 무관.

**스윕 결과(11-26 23:20–00:05Z 저널, rowid 13735945–13764725, 28,781행; 확인함).** 상점 탭을 여는 동안 본계정(580)이 보낸 요청은 `get.package.choose.activity.info`(23:40:05)·`growth.plan.cur.exchange`·`get.flash.sale.activity.info`(23:41:08)·`lucky.card.act.info`·`select.battlepass.series`(23:41:23, 영웅 선택)·`custom.package.choose.reward`×7(23:42–43)뿐. **Weekly/Monthly Pass·Hero Code·Ruby Shop·Dawn Badge·Daily Sale·Mega Bargain·Apoca 화면은 요청을 안 보낸다** — 전부 로그인 응답으로 그린다.

| 화면 | 명령 / 자리 | 증거 | 판정 |
|---|---|---|---|
| Hero Code `9008` | `get.hero.month.card.info` (로그인; `activityId` 330001, `rewardArr[30]{day,reward,state}`, `buy`) | 1–5일차가 스크린샷과 동일(조각 10·Food Level Chest 5·Prime Recruitment Ticket 10·책 200·광석 1,000). 페이로드에 exchange id 없음 → 클라이언트 `hero_monthcard.exchange`가 24행 전부 `9008` | **승격 후보**: 팩 9008 오퍼 행, 30일 합산, 상수 `9008`(출처 주석) |
| Super Monthly Pass `9007`/`9009` (t5) | `exchange.info` 행의 `item_use` `222027;1|222028;1|222031;1`(VIP {0}일·Formation IV·Deluxe Cosmetic) + `reward` `105100;1` | `shop.py`는 `item`만 읽음. 매일 수령분은 클라이언트 `monthcard` 9007 `reward_show`(특전 표시용), 서버 응답 없음 | `shop.py`에 `item_use`+`reward` 추가(카탈로그 12행: t5 둘, Dawn Badge t46 열 — `9990012`=배지 ×N). 특전 가치는 별도 |
| Treasure of the Day `80983`/`80969` | `get.month.pay.act.info` (`stageArr` 30 = 충전일 달력) | 매일 바뀌는 1종은 어느 응답에도 없음; 화면 열어도 요청 없음 | 보류 |
| Exclusive Equipment Choice Pack `25070701–05` | `get.package.choose.activity.info` (로그인+열 때; `packageArr[].item` `"조각id;수;exchangeId;1|…"`, `chooseId`=고른 영웅) | 9영웅 × 5단계, 각 항목에 exchange id가 박혀 있음 | **승격 후보**: 오퍼 행 + 고른 조각 내용물 |
| Flash Sale | `get.flash.sale.activity.info` (`roundArr[24]{roundStartTime, exchangeArr[4]{id}}`) | `id`가 `73`·`57` 같은 작은 정수 — exchange id 아님, 클라이언트 표 대응 필요(덤프에 flash 이름 표 없음) | 조사 필요 |
| Legend BP 영웅 선택 | `select.battlepass.series` (`battlePass`, `series`, `stateInfo`) | `get.battlepass.info`와 같은 모양 | 별칭 등록이면 됨 |
| 무료 팩 | `free.exchange.info` (34개, `dollar` 0, 이름·`item` 있음) | `exchange.info`에서 이름 없던 `261000001/2`는 여기에도 없음 | 가치 0, 보류 |

**승격함(11-26, 이 가지, shop_offers 1.2.0 · shop 1.2.0).** Hero Code → `get.hero.month.card.info`(팩 9008 상수, 30일 합산, `track='daily'`); Choice Pack → `get.package.choose.activity.info`(고른 영웅의 5단계, 조각 내용물, `track='choice'`); `shop.py`가 `item_use`도 읽음(Super Monthly Pass·Dawn Badge 12행; `reward`는 0337 이래 "모든 팩이 같은 id"라 뺐다 — 11-26엔 9007·9009만 `105100;1`, 이름 없는 아이템). 픽스처 셋(`hero_code_v1`·`choice_pack_v1`·`item_use_v1`, 수집 계정 579의 로그인 응답), 파서 테스트 70개, 대시보드 'choice' 문구. **남음:** Flash Sale 표 대응(유망), `select.battlepass.series` 별칭(참고), Treasure of the Day 매일 1종, ⑦⑧ 보류.
