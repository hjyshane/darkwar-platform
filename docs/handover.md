# 인수인계

**갱신 2026-11-20** (`main` `b90a0512` 기준; 재작성 11-15, 전체 재구성은 11-12). 이 문서는 일지가 아니라 **덮어쓰는 현재 상태**다 — 해결된 항목은 지우고, 사연은 `docs/log/`에 남긴다. 4,243줄이던 이전 버전은 달별로 `docs/log/`에 옮겼다(내용 수정 없음). 분할 근거: [handover-split-proposal.md](handover-split-proposal.md).

> 줄마다 **확인함**(이 문서를 쓰며 파일·git으로 봄) / **미확인**(일지·PR 제목에서 가져옴, 지금 상태를 모름)을 구분한다.

## 1. 한 문단

수집(Windows 수집기 + 맥 아이폰 체인) → SQLite 저널 → Supabase → 대시보드(cbfw.us, main 머지 시 CI `deploy` 잡이 배포)가 운영 중이다. 11-09 시즌 4(Sealed Island)가 시작됐다. 클라우드 부계정 무인 수집·게임 내 동작(ADR-0002/0003)은 **코드와 수동 검증까지**이고 상시 운영은 아직 확인되지 않았다. **11-20 확인함:** `main`은 열린 PR 0개, 최근 CI 5건 success, cbfw.us가 `index-DOuRJeZK.js`(deploy 잡이 일치 확인).

## 2. 사람 몫 / 막힌 것

- **0343 대기 (11-20, 게임 데이터 테이블 브라우저).** 클라이언트 datatable 473개 전부를 Settings › Shared › Game data tables에서 읽는 화면(관리자 전용)과 `dw-collector game-dump`. 순서: ① 주인이 `db push`로 0343 적용 → ② 주 PC 체크아웃을 머지된 `main`으로 당긴 뒤 `uv run dw-collector game-dump --bundles C:/DW_data/gamedata/base --bundles C:/DW_data/gamedata/bundles`(몇 분; `--dry-run`은 11-20에 473 테이블·131.7 MB·실패 0 확인함). 그 전에는 화면이 "No tables have been dumped yet"를 낸다. 화면은 둘러보기 빌드(픽스처)로만 봤고 **실 DB로는 미확인** — 14 MB짜리 `building`이 11조각으로 얼마나 걸리는지, 이름 검색 `ilike`가 8만 행에서 느린지는 올린 뒤 볼 것. `runbooks/game-data.md` 「전체 테이블 브라우저」.
- **맵 스윕(`goto-sweep`) — 보류 (11-18, 주인 결정, 확인함).** 코드는 #623으로 main에 있다(게임의 좌표 이동 창으로 566–588을 서버당 70점, 이동 한 번 11.2초, 전체 약 5시간). 8시간 예약 `DarkWar-MapSweep`은 11-18에 등록했다가 주인 요청으로 **지웠다**(작업 스케줄러에 없음 확인). 지금은 주인이 자기 BlueStacks 매크로로 맵을 훑는다. 다시 켜려면 관리자 PowerShell에서 `powershell -ExecutionPolicy Bypass -File .\scripts\windows\register-map-sweep.ps1`(이 PC는 실행 정책 미설정이라 `-ExecutionPolicy Bypass`가 필요). BlueStacks 창 제목에 `collector`가 있어야 가드가 그 인스턴스를 고른다. `runbooks/map-sweep.md`.
- **압축 응답(APS zstd v1) — 끝 (11-18, 확인함).** 디코더는 #604로 main에 머지, Windows Ingest는 11-18 01:27부터 그 코드로 돈다(`aps_zstd_key_loaded sha256=e9ed2813695e`), 그 전 파일은 `C:\DW_data\aps\backfill_aps.py`로 전부 채웠다. 키 경로는 `.env`의 `DW_APS_ZSTD_KEY_FILE`(키 파일은 저장소 밖). 맥(아이폰 체인)과 데스크톱 앱은 키가 없어 계속 버린다(§3, 주인이 보류).
- **게임 데이터가 Lua 5.5 (11-18, 확인함; 11-19 갱신).** 1.250.672부터 datatable이 5.5(표식 `0xa8`, opcode 재번호). 고친 코드(PR #622)는 11-19에 `main`에 머지됐다. **11-19 `main`으로 다시 돌림(확인함):** 기기 클라이언트·번들 버전(`datatable 1645` 등)이 11-18 사본과 같아 `game-catalog`(steps 18,444)·`game-values`(game 175, estimated 59)·`game-names`(written 0)는 변화 없음, `game-event-guide`만 저널이 이틀치라 섹션 9 → 11. `game-icons`는 같은 팩이라 안 돌렸다. Production `game_season`은 2,241스텝(주제 2·3·4·6·8·10)으로 차 있다. 11-18에 그 브랜치로 `game-catalog`(`game_season` 주제 64개 확인)·`game-names`(새 이름 34, 임원 이름 5 보존 — 1,000행 잘림 버그도 같은 PR에서 고침)·`game-values`(game 175, estimated 59)·`game-event-guide`(가이드 3개 처음 생성, 비공개; 저널이 그날 것뿐이라 테마 9)·`game-icons`(1,056개)를 돌렸다. 듀얼 다른 요일 섹션은 캡처가 쌓인 뒤 `game-event-guide`를 다시 돌려야 채워진다. 다음 업데이트에서 `decode`가 `marker`/`opcode N`으로 실패하면 `C:\DW_data\lua55\README.md`(런북 "Lua 5.5 datatable").
- **이벤트 알람 배포됨 (11-15, 확인함).** 주인이 `db push`로 0321–0327을 적용했다(21:29 UTC 무렵, `schema_migrations`로 확인). 대시보드 Alarms 탭은 #597로 머지(`590bf9fd`), CI `deploy` 성공, cbfw.us가 탭이 든 `index-IQHQGTwp.js`를 낸다.
  - 푸시 뒤 확인 4가지 통과(21:44 UTC에 읽음): `alerts-reconcile`은 21:28이 마지막 실패(옛 `extensions.net._http_response` 오류)이고 21:29부터 매분 성공, `alerts-detect`·`alarms-calendar`(5분마다, 첫 실행 21:30) 실패 0; anon은 `alarm_deliveries` 실행 불가(authenticated는 가능); 자기 연맹 둘 다 달력 보드 셋; `cron.job`에 `alarms-calendar`.
  - **디스코드로 나간 알람은 아직 없다.** 11-15 21:00 이후 outbox 행 0. 첫 전송은 Frankie 1의 1시간 단계, **11-16 01:30 UTC**, 보드 채널 `frankie`(켜짐). 그 outbox 행에 `delivered_at`이 차고 `last_error`가 비었는지 본다. 그때까지 `alarm_deliveries`가 빈 목록인 것은 정상이다.
  - 두 번째 자기 연맹(`b9daa299…`)은 보드는 있지만 다가오는 항목이 0이라 알람이 안 나간다. 이유는 안 봄.
  - 주인에게 열린 질문: 시간대 선택 기본값이 서버 시각(08-16 사이트 전체 결정)인데 스펙 §8은 읽는 사람의 시간대; 감시 목록에서 Siege를 빼는 id 41008의 근거가 커밋 안 된 `plan/website-restructure-2026-11.md`뿐(프로덕션 달력 한 줄로 확인 가능).
- **탭 확인 6가지 (미실시, 주인 몫).** 탭 쿼리를 로그인 상태로 실 DB에 돌린 적은 아직 없다(§3). 1번은 주인이 직접 보기로 했다(11-15).
  1. 간부와 멤버 각각으로 `#/alarms`가 400 없이 열린다(시각 `.or()` 필터, 항목에 붙은 reminders).
  2. 간부로 부른 `alarm_deliveries`가 200을 돌려준다 — 첫 전송 뒤엔 그 항목의 행이 있다.
  3. 칩 하나 끄고 Save → `schedule_reminders.enabled`가 바뀐다(`db query --linked`로 본다).
  4. Send now → `once:` outbox 행이 생기고, Refresh 뒤 칩이 sent.
  5. 보드 저장이 `channel_is_ours`를 통과한다. 게임 이벤트 감시가 맞는 연맹에 보드를 넣는다.
  6. 숨긴 게임 항목이 다음 `alarms-calendar` 실행 뒤에도 숨겨져 있다.
- **알람 실제 시험 (Task 10 Step 3, 주인 몫, 미실시).** 시험용 역할(한 명만 보유)과 시험용 채널을 Zombie Siege 보드에 걸고, 다음 Siege나 Frankie에서 12시간/1시간/5분 알림이 오는지, 폰에 역할 푸시가 오는지, 두 시간대에서 시각이 맞는지 본다. 멘션은 보이는데 푸시가 안 오면 역할의 "Allow anyone to @mention this role"을 켠다.
- **0334 대기 — 순서가 있다 (11-18, 지도 연맹·이동·트럭).** ① 주인이 `db push`로 0334 적용 → ② 그 **뒤에** Windows Ingest·Sync 재시작(`collector-operations.md` 레시피). 거꾸로 하면 새 파서(world_map 1.7.0)가 `in_alliance`·`alliance_code`를 보내는데 DB에 열이 없어 Sync가 막힌다. 확인: 재시작 뒤 `world_city_snapshots`에 `in_alliance`가 찬 행, `world_truck_snapshots`에 `source_command = 'push.world.march.world.get.new'` 행, 566 지도에 연맹 랭킹. 미션 좌표(타일 그대로 복사)가 게임 좌표와 같은지는 **미확인** — 게임에서 미션 공유 링크 하나와 대조. `log/2026-11.md`. **11-19 재시작 뒤 Sync는 막히지 않았다(확인함, 저널 기준):** 로컬 outbox에서 `in_alliance`가 든 행 39,400개와 `march.world.get.new` 트럭 300개가 오류 없이 sent — sync는 모르는 열을 거르지 않으니 프로덕션에 0334 열이 있다. `schema_migrations` 기록과 위 화면 확인 셋은 안 봄.
- **0342 대기 (11-20, 연맹 페이지 설정).** 타워 레벨·"since" 시작일을 Settings › Display › Alliance page에서 정한다(연맹별 공유 설정 `alliance_trends`), Ranking·Against the server는 Activity 안으로. 주인이 `db push`로 0342 적용 전에는 **저장이 거부되고**(`not a per-alliance setting`) 화면은 기본값(35, 첫 캡처)으로 그대로 동작한다. pgTAP 342는 이 PC에서 못 돌림(미확인) — CI `db` 확인할 것. 둘러보기 빌드로는 우리 연맹만 봄, 남의 연맹 Activity는 화면 미확인.
- **0335–0340 프로덕션 적용 완료 (11-19 23:08 EST 무렵, 확인함).** 주인이 `main` `274205b8`에서 `db push --remote`로 여섯 개를 한 번에 적용했다(`Finished supabase db push.`). 푸시 직전 `migration list --linked`에서 원격은 0334까지였고 0337은 비어 있었다 — 번호가 둘이던 동안(#646으로 이벤트 설명이 0338로 옮겨짐) 잘못 들어간 것은 없다. 그 뒤 Ingest·Sync를 §4-2 레시피로 재시작(프로세스 시작 23:07:53·23:08:01, 옛 워커 없음, `sync.start`와 새 파일 ingest 확인).
  - **남은 확인(미실시):** 로그인 한 번 → `shop_pack_offers`에 줄, Packs 탭에서 배틀패스가 값과 함께 8개 안팎. 0338(이벤트 설명 카드)·0339(hive 앵커 재설정)·0340(떠난 미션이 목록에서 빠짐)도 화면에서는 안 봄. 0337 pgTAP은 Windows PC에서 못 돌렸지만(PostgreSQL 17 없음) **11-20 맥에서 전체 통과(확인함: 마이그레이션 336개, 파일 232개, 실패 0, 13초)**, CI `db`도 초록. 두 팩짜리 패스의 트랙 대응은 추론(미확인), 데일리 패키지 4단계는 여전히 임원 선택 — `log/2026-11.md`.
  - **이 PC에서 `db push` 하는 법:** supabase CLI가 설치돼 있지 않고 실행 정책이 `npx.ps1`을 막는다 → `npx.cmd supabase …`. 이 CLI 버전은 기본 대상이 로컬 스택이라 `--remote`가 필요하다. 링크는 11-19에 함(`link --project-ref`는 URL이 아니라 20자 ref).
- **0328 적용 완료 (11-15, PR #598 머지·푸시).** v10으로 두 연맹 현재 기간 리빌드함(HELLBOUND는 11-16 00:17Z에 2주차 측정 뒤 재빌드). 11-15 21:42Z~00:00Z 사이 주간 보드 스윕이 없어 2주차 읽기는 21:31Z 캡처.
- **0335·0336 — 이제 `schema_migrations`에 있다 (11-19).** 먼저 SQL Editor로 적용됐던 둘(0335: 끝난 기간 리빌드에서 부재가 사라지던 버그, v12 / 0336: Rebuild 50초 상한)은 위 푸시가 다시 돌리며 기록했다(함수 교체뿐). 남은 것: CBFW 11-02~16 Rebuild로 v12 행이 생기고 부재 R1이 돌아오는지(11-18 14:49Z 이후 Rebuild 성공 0), R1 37명(44%)의 원인 — `log/2026-11.md` 11-19.
- **Windows 수집기 — 11-19 재등록·재시작 (확인함).** 11-19 01:45Z ingest가 `database is locked` 하나에 죽고 16시간 안 살아났다(#628·#631로 고침, `log/2026-11.md`). 주인이 13:21 EST에 `register-tasks.ps1`로 네 작업을 `main` `4580bb37`로 재등록, Sync만 #631 뒤 13:37 EST에 `a3ea389d`로 재시작. 넷 다 로그온+**시간** 트리거, `NextRunTime` 있음 — 죽으면 5분 안에 되살아난다(전엔 반복이 무장 안 돼 있었다). 크래시 구간 파일은 전부 들어갔고 outbox 0 대기·0 dead. 체크아웃에 남아 있던 다른 세션의 커밋 안 된 대시보드 변경(이벤트 가이드 Guides·Duel scores 탭 삭제)은 11-19에 브랜치 `feat/event-guide-drop-guides-scores`로 옮겼다(확인함, 검사 통과). 역분석 작업물 `analysis/`·`tools/`(Ghidra 등, 1.3GB)는 Ghidra가 열려 있어 저장소 폴더에 그대로 두고 `.gitignore`로 막았다. 반영하려면 `git pull`만으로는 안 된다(editable install) — `collector-operations.md` §4-2. **재시작 전에 `git -C C:\darkwar-platform branch --show-current`가 `main`인지 본다**(11-19에도 한때 `feat/hive-map-zoom-size-rank`였다).
- **Windows 두 대 다 — 11-20.** 메인 PC(`June_PC_home`, collector `…c001`)는 11-18 deps PR 뒤 `uv sync`가 안 돌아 Ingest·iPhone이 `No module named 'zstandard'`로 하루 죽어 있었다 → 11-19 20:51 EST 관리자 PowerShell에서 `register-tasks.ps1` + `register-iphone-task.ps1 -Start`로 고침(다섯 작업 revive 트리거 있음). 0337 푸시 전에 dead_letter로 떨어진 `shop_pack_offers` 41건은 `retry-outbox --dead-letters`로 992건 전부 재전송(failed=0). **여러 계정 라벨**: 캡처는 원래 머신 전체(dumpcap)라 BlueStacks 인스턴스 전부 들어오지만 `collected_from_server`가 580 상수였다 — 이제 `--follow-login-server`가 TCP 연결마다 로그인 서버를 기억해 계정별로 라벨하고, `register-tasks.ps1`의 Ingest가 그 플래그로 뜬다. **머지 뒤 두 PC 모두 재등록해야 적용**(ingest 재시작 전에 로그인한 연결은 다음 재접속까지 580).
- **맥**: `git pull` + `install-iphone-agent.sh`(체인이 옛 체인을 먼저 죽임, #551).
- **머지 안 된 것 (11-20 워크트리 정리 때 확인함).** 머지·클린 워크트리 30개는 지웠다. 남은 것: 브랜치 `llm-features-design`(0322, 보류), `immigration-tab-analytics`(대시보드 2커밋, PR 없음), `supabase-storage-overflow`(0317 아레나 보드 60일 — **0317은 main에서 `player_squad_power`가 씀, 새 번호로**), `cloud-alliance-help`(tcpdump 그룹 종료, 1커밋). 커밋 안 된 파일: `setup-minipc.ps1`, `direct-send-feasibility.md`, `gift-redeem.user.js`+테스트+`gift-codes.md` 수정(각각 `4gb-…`·`angry-gould`·`gift-code-redeem-…` 워크트리).
- **VM(GCE `dw-emu-test`)은 맥에서만 닿는다.** Windows엔 gcloud도 SSH 항목도 없다.

## 3. 실데이터로 한 번도 안 돌린 것

각 항목은 이후 PR로 바뀌었을 수 있다 — 확인되면 이 줄을 지운다.

| 항목 | 마지막으로 안 것 | 위치 |
|---|---|---|
| `dw-cloud` 감시(패킷 침묵 → 재실행)와 설치 스크립트 | 11-08: "VM에서 한 번도 실행 안 했다". 11-11에 에뮬에서 수동 검증은 함 | `cloud-unattended.md` §8 |
| 연맹 도움·기술 기부·선물 수령 루틴(#591) | 코드 있음, **실계정 무인 운영 미확인** | `cloud-actions.md`, ADR-0003 |
| 알람 전송(pg_net POST) 경로 | 로컬·CI에서 돌릴 수 없다. 11-15 푸시 뒤 cron은 성공하나 보낼 행이 아직 없었다. 첫 시도 11-16 01:30 UTC | `0322`–`0327`, `log/2026-11.md` |
| 알람 탭의 쿼리 | 11-15 배포됨. 로그인 상태로 연 적 아직 없음(§2 탭 확인) | `apps/dashboard` Alarms 탭 |
| 웹훅이 "Allow anyone to @mention this role" 없이 역할을 알릴 수 있는가 | 모름 (스펙 §4). 주인의 실제 시험에서 가려진다 | `docs/superpowers/specs/2026-11-14-event-alarms-design.md` |
| 업데이트 신호 필드 이름 | **추측** (11-04 로그인 응답엔 `picVer`뿐) | `watchdog/update_signal.py` |
| 아이폰 조각 교대 틈 수정 | 10-13: "실제 폰에서는 미확인" | `log/2026-10.md` |
| 데스크톱 앱 두 번째 머신 설치 | 개발 머신 한 대만 성공 | `log/2026-09.md` (09-11) |
| `dw-capture` 재접속 멈춤 | 원인 미확인 (계측만 있음) | `log/…-tail.md` |
| `arena_matches` writer 없음 | 08-03에 로컬 0건 확인, 프로덕션 미확인 | `capture-backlog.md` |
| `goto-sweep` 무인 반복(566–588 전체 회차) | 11-18: 582–586에서 110점 시험만, 전체 회차 없음(보류, §2). 거절되는 서버 유무 모름 | `runbooks/map-sweep.md` |
| 잠긴 저널 재시도(ingest `LOCKED`, sync `sync.journal_locked`) | 11-19: 진짜 잠금으로 테스트만. 재시작 뒤 라이브에서 잠금 아직 없음 | `collector-operations.md` §4-3 |
| 시간 트리거가 죽은 작업을 되살림 | 11-19: 등록·`NextRunTime`까지 확인. 실제로 죽은 작업을 살린 적은 아직 없음 | `register-tasks.ps1` |
| 기존 스와이프 스윕(`dw-ui-worker sweep`)의 줌 | 11-18: BlueStacks 터치가 프로토콜 B라 `zoom.py` 핀치 무효 | `traps.md` |
| 아이폰(iOS) 클라이언트의 APS zstd 키 | 모름. Android APK에서만 뽑았다. 맥 `.env`에 `DW_APS_ZSTD_KEY_FILE`이 없으면 그 체인은 압축 응답을 버린다 | `C:\DW_data\aps\README.md` |

## 4. 문서가 서로 어긋난 곳

- `cloud-actions.md` 첫 줄 "아직 루틴 코드로 만들지 않았다" ↔ #591이 `ui_worker` 루틴을 넣음.
- ADR-0002의 "송신 코드 없음"은 11-10 핸드셰이크 스파이크(로그인 서명, 능동 경로 no-go; `docs/superpowers`/plan 커밋 `39980601`·`80f820ba`)와 ADR-0003 이후 다시 읽어야 한다.
- `game-data.md`의 "연맹 밖 플레이어" 절은 ADR-0002 **이전** 조사다(문서에 주의 문구 추가함).
- CLAUDE.md의 수집 계정 불릿은 11-12에 ADR-0003에 맞춰 고쳤다(확인함).

## 5. 머신 지도

| 머신 | 돌리는 것 | 메모 |
|---|---|---|
| Windows `C:\darkwar-platform` | Capture(dumpcap) · Ingest · Sync · Notify 작업 스케줄러. `DarkWar-iPhone`은 11-19 기준 **등록 안 됨** | 재시작: `Stop-ScheduledTask` → 명령줄 패턴으로 체인 kill → `Start-ScheduledTask`. 죽으면 시간 트리거가 5분 안에 살림 — `NextRunTime`이 비면 안 산다. 한 번 `uv run` 재동기화가 상시 작업을 죽인 적 있어 `--no-sync`([traps.md](runbooks/traps.md)) |
| Mac | 아이폰 에이전트, 개발 | pgTAP 전체 가능(`mac-setup.md`, Docker 없음). 캡처·로컬 스택·`db:types`는 Windows/CI |
| GCE VM | 에뮬레이터 + `dw-cloud` (예정) | `DW_COLLECTOR_ID`는 Windows와 달라야 함(하트비트 upsert 키) |
| CI | `web`·`guard`·`db`·`deploy` | **`db` 잡을 읽고 머지**(CLAUDE.md) |

## 6. 최근 2주 (자세한 것은 `log/2026-11.md`)

- 11-20 `main` 상태 점검·워크트리 정리·0335–0340 pgTAP 맥 통과; 0337 번호 중복(#645)·hive 도구 모음(#646)·홈 hive(#643)·맵 hunt 탭(#644) 머지 — `log/2026-11.md`
- 11-19 `database is locked` 하나에 ingest가 16시간 죽음 — 잠금 재시도, 무장 안 된 되살리기 트리거 (#628·#631) — `log/2026-11.md`
- 11-19 끝난 등급 기간을 다시 빌드하면 부재가 사라지던 버그 (0335, v12); CBFW 등급 대거 변동의 진단 — `log/2026-11.md`
- 11-18 맵 스윕을 게임의 좌표 이동 창으로(`goto-sweep`), 직접 요청·딥링크는 안 됨, BlueStacks 터치 사고 — `log/2026-11.md`
- 11-18 게임 데이터가 Lua 5.5(패딩 기준·opcode 재번호) → 읽기 고침, `game-names` 1,000행 잘림 (#622) — `log/2026-11.md`
- 11-17 게임 1.250.672의 APS zstd v1: 압축 응답 전부 유실 → 디코더·키 추출·백필 (#604) — `log/2026-11.md`
- 11-16 수동 기간의 중도 가입자 점수 산정, 재적 비율로 보정 (0329, v11) — `log/2026-11.md`
- 11-15 등급 측정 시각 월요일 00:00 UTC(리셋 2시간 전) + 듀얼 `days` 모드 (0328, v10) — `log/2026-11.md`
- 11-09~10 콘솔 키트 + 이벤트 가이드·계산기·플레이어 헤더·연맹 페이지 Phase A/B (#568~#581)
- 11-09 마이그레이션 번호 충돌로 main이 빨개짐(#574) — 함정 재발
- 11-10 플레이어 서버 이동 이력 0320, 아틀라스·기지가 이민을 따라감 (#587~#589)
- 11-10 능동 `world.get.new` no-go (#580) → 11-11 ADR-0003, 게임 내 동작 허용 (#591)
- 11-13~15 이벤트 알람: 스펙·계획(`62f85e90`·`1b65faef`), DB 쪽 #596 머지(0322–0327, 프로덕션 pg_net 호출 버그 수정), 11-15 프로덕션 푸시와 Alarms 탭 #597 배포 — `log/2026-11.md`

## 7. 어디를 읽을지

| 알고 싶은 것 | 문서 |
|---|---|
| 요구사항 | `DarkWar_Platform_Technical_Specification_v1.0.md` |
| 결정 | `docs/adr/` (0001~0003) |
| 함정 | `docs/runbooks/traps.md`, CLAUDE.md "Traps" |
| 마이그레이션 / 명령 승격 절차 | 스킬 `new-migration`, `promote-command` (`.claude/skills/`) |
| 자동 가드(legacy·PCAP·.env 차단, 번호 검사) | `.claude/hooks/guard.mjs`, `.claude/settings.json` |
| DB가 느릴 때 | `docs/runbooks/db-performance.md` |
| 수집기 운영 | `collector-operations.md`, `continuous-collection.md`, `season-4-capture.md`, 맵 스윕 `map-sweep.md` |
| 클라우드 | `cloud-unattended.md`, `cloud-actions.md` |
| 주간 자동 점검(CI·마이그레이션·handover 신선도) | `docs/runbooks/scheduled-routines.md` |
| 일지 | `docs/log/2026-08.md` … `2026-11.md` |
| 옛 TODO 목록(08-02, 낡음) | `docs/log/2026-08-and-earlier-tail.md` |
| 작업 방식 | `docs/runbooks/working-agreements.md` |

## 8. 이 문서를 쓰는 규칙

- 120줄을 넘기지 않는다. 넘으면 항목을 `log/`로 보낸다.
- 새 항목은 **확인함/미확인**을 적는다. 모르면 "모름"이라고 쓴다.
- 일이 끝나면 §3·§4의 줄을 **지운다.** 사연은 `docs/log/YYYY-MM.md` 맨 위에 새 항목으로 쓴다.
