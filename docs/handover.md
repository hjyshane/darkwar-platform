# 인수인계

**재작성 2026-11-15** (알람 배포 반영; 전체 재구성은 11-12). 이 문서는 일지가 아니라 **덮어쓰는 현재 상태**다 — 해결된 항목은 지우고, 사연은 `docs/log/`에 남긴다. 4,243줄이던 이전 버전은 달별로 `docs/log/`에 옮겼다(내용 수정 없음). 분할 근거: [handover-split-proposal.md](handover-split-proposal.md).

> 줄마다 **확인함**(이 문서를 쓰며 파일·git으로 봄) / **미확인**(일지·PR 제목에서 가져옴, 지금 상태를 모름)을 구분한다.

## 1. 한 문단

수집(Windows 수집기 + 맥 아이폰 체인) → SQLite 저널 → Supabase → 대시보드(cbfw.us, main 머지 시 CI `deploy` 잡이 배포)가 운영 중이다. 11-09 시즌 4(Sealed Island)가 시작됐다. 클라우드 부계정 무인 수집·게임 내 동작(ADR-0002/0003)은 **코드와 수동 검증까지**이고 상시 운영은 아직 확인되지 않았다.

## 2. 사람 몫 / 막힌 것

- **압축 응답(APS zstd v1) — Windows Ingest 재시작·백필 끝 (11-18, 확인함).** 게임 1.250.672부터 압축 응답이 APS zstd v1. `DarkWar-Ingest`가 11-18 01:26:38에 브랜치 `fix/collector-aps-zstd-frames` 코드(59c61a0f 위)로 다시 떴고 `aps_zstd_key_loaded sha256=e9ed2813695e`를 찍었다. 그 전에 옛 코드가 읽은 파일은 `C:\DW_data\aps\backfill_aps.py`로 전부 채웠고 outbox 실패 0. **머지되기 전에는 상시 작업이 이 브랜치 체크아웃에서 돈다 — 머지 전에 `main`으로 바꾸고 재시작하면 다시 압축 응답을 버린다.** 키 경로는 `.env`의 `DW_APS_ZSTD_KEY_FILE`(키 파일은 저장소 밖). 맥(아이폰 체인)과 데스크톱 앱은 키가 없어 계속 버린다(§3).
- **게임 데이터가 Lua 5.5 (11-18, 확인함).** 1.250.672부터 datatable이 5.5(표식 `0xa8`, opcode 재번호). `main`의 `game-*` 명령은 하나도 못 읽는다 — 브랜치 `fix/gamedata-lua55`가 고친다(**머지 전**). `game-catalog`는 그 브랜치로 11-18에 돌렸고 `game_season` 주제 64개 확인. `game-names`·`game-values`·`game-event-guide`·`game-icons`는 안 돌림. 다음 업데이트에서 `decode`가 `marker`/`opcode N`으로 실패하면 `C:\DW_data\lua55\README.md`(런북 "Lua 5.5 datatable").
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
- **0328 적용 완료 (11-15, PR #598 머지·푸시).** v10으로 두 연맹 현재 기간 리빌드함(HELLBOUND는 11-16 00:17Z에 2주차 측정 뒤 재빌드). 11-15 21:42Z~00:00Z 사이 주간 보드 스윕이 없어 2주차 읽기는 21:31Z 캡처.
- **0329 대기.** 수동 설정 기간(0316)에서 기간 중 가입한 멤버도 점수를 받음, `measured_share`로 보정, v11. 머지되면 Rank report가 `rank_period_latest.measured_share`를 읽으므로 **푸시 전에는 그 화면이 400**. 푸시 뒤 수동 기간을 다시 빌드해야 가입자가 등급을 받는다. 그리드 2주 기간은 결과 불변.
- **수집기 재시작 — 미확인.** Windows Ingest만 11-18에 59c61a0f + APS 수정으로 다시 떴다(위). Sync·Notify·Capture는 11-17 19시대에 시작했고 그때 체크아웃은 확인 안 함. Windows는 11-08에 edaae1b로 올렸다. 그 뒤 #582(아이폰 체인이 서버를 따라감) 등이 머지됐다. 반영하려면 `git pull`만으로는 안 된다(editable install) — `collector-operations.md` 레시피. **재시작 전에 `git -C C:\darkwar-platform branch --show-current`가 `main`인지 본다**(다른 세션이 체크아웃을 바꾼 적 있음).
- **맥**: `git pull` + `install-iphone-agent.sh`(체인이 옛 체인을 먼저 죽임, #551).
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
| 아이폰(iOS) 클라이언트의 APS zstd 키 | 모름. Android APK에서만 뽑았다. 맥 `.env`에 `DW_APS_ZSTD_KEY_FILE`이 없으면 그 체인은 압축 응답을 버린다 | `C:\DW_data\aps\README.md` |

## 4. 문서가 서로 어긋난 곳

- `cloud-actions.md` 첫 줄 "아직 루틴 코드로 만들지 않았다" ↔ #591이 `ui_worker` 루틴을 넣음.
- ADR-0002의 "송신 코드 없음"은 11-10 핸드셰이크 스파이크(로그인 서명, 능동 경로 no-go; `docs/superpowers`/plan 커밋 `39980601`·`80f820ba`)와 ADR-0003 이후 다시 읽어야 한다.
- `game-data.md`의 "연맹 밖 플레이어" 절은 ADR-0002 **이전** 조사다(문서에 주의 문구 추가함).
- CLAUDE.md의 수집 계정 불릿은 11-12에 ADR-0003에 맞춰 고쳤다(확인함).

## 5. 머신 지도

| 머신 | 돌리는 것 | 메모 |
|---|---|---|
| Windows `C:\darkwar-platform` | Ingest · Sync · Notify · iPhone 작업 스케줄러 체인, dumpcap | 재시작: `Stop-ScheduledTask` → 명령줄 패턴으로 체인 kill → `Start-ScheduledTask`. 한 번 `uv run` 재동기화가 상시 작업을 죽인 적 있어 `--no-sync`([traps.md](runbooks/traps.md)) |
| Mac | 아이폰 에이전트, 개발 | pgTAP 전체 가능(`mac-setup.md`, Docker 없음). 캡처·로컬 스택·`db:types`는 Windows/CI |
| GCE VM | 에뮬레이터 + `dw-cloud` (예정) | `DW_COLLECTOR_ID`는 Windows와 달라야 함(하트비트 upsert 키) |
| CI | `web`·`guard`·`db`·`deploy` | **`db` 잡을 읽고 머지**(CLAUDE.md) |

## 6. 최근 2주 (자세한 것은 `log/2026-11.md`)

- 11-17 게임 1.250.672의 APS zstd v1: 압축 응답 전부 유실 → 디코더·키 추출·백필 — `log/2026-11.md`
- 11-16 수동 기간의 중도 가입자 점수 산정, 재적 비율로 보정 (0329, v11) — `log/2026-11.md`
- 11-15 등급 측정 시각 월요일 00:00 UTC(리셋 2시간 전) + 듀얼 `days` 모드 (0328, v10) — `log/2026-11.md`
- 11-08 등급 측정 시각 일요일 14:00 UTC (0309, v9) — `log/2026-11.md`
- 11-08 시즌 4 전날 점검, Windows 수집기가 26일 묵은 코드였음 — 같은 파일
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
| 수집기 운영 | `collector-operations.md`, `continuous-collection.md`, `season-4-capture.md` |
| 클라우드 | `cloud-unattended.md`, `cloud-actions.md` |
| 주간 자동 점검(CI·마이그레이션·handover 신선도) | `docs/runbooks/scheduled-routines.md` |
| 일지 | `docs/log/2026-08.md` … `2026-11.md` |
| 옛 TODO 목록(08-02, 낡음) | `docs/log/2026-08-and-earlier-tail.md` |
| 작업 방식 | `docs/runbooks/working-agreements.md` |

## 8. 이 문서를 쓰는 규칙

- 120줄을 넘기지 않는다. 넘으면 항목을 `log/`로 보낸다.
- 새 항목은 **확인함/미확인**을 적는다. 모르면 "모름"이라고 쓴다.
- 일이 끝나면 §3·§4의 줄을 **지운다.** 사연은 `docs/log/YYYY-MM.md` 맨 위에 새 항목으로 쓴다.
