# 인수인계

**재작성 2026-11-12.** 이 문서는 일지가 아니라 **덮어쓰는 현재 상태**다 — 해결된 항목은 지우고, 사연은 `docs/log/`에 남긴다. 4,243줄이던 이전 버전은 달별로 `docs/log/`에 옮겼다(내용 수정 없음). 분할 근거: [handover-split-proposal.md](handover-split-proposal.md).

> 줄마다 **확인함**(이 문서를 쓰며 파일·git으로 봄) / **미확인**(일지·PR 제목에서 가져옴, 지금 상태를 모름)을 구분한다.

## 1. 한 문단

수집(Windows 수집기 + 맥 아이폰 체인) → SQLite 저널 → Supabase → 대시보드(cbfw.us, main 머지 시 CI `deploy` 잡이 배포)가 운영 중이다. 11-09 시즌 4(Sealed Island)가 시작됐다. 클라우드 부계정 무인 수집·게임 내 동작(ADR-0002/0003)은 **코드와 수동 검증까지**이고 상시 운영은 아직 확인되지 않았다.

## 2. 사람 몫 / 막힌 것

- **프로덕션 `db push` 상태 — 미확인.** 0309(등급 측정 일요일 14:00 UTC, 스코어링 v9)부터 0320(플레이어 서버 이동 이력)까지. 푸시 전 `scripts/check-migration-order.sh`, 번호는 origin/main 기준.
- **수집기 재시작 — 미확인.** Windows는 11-08에 edaae1b로 올렸다. 그 뒤 #582(아이폰 체인이 서버를 따라감) 등이 머지됐다. 반영하려면 `git pull`만으로는 안 된다(editable install) — `collector-operations.md` 레시피. **재시작 전에 `git -C C:\darkwar-platform branch --show-current`가 `main`인지 본다**(다른 세션이 체크아웃을 바꾼 적 있음).
- **맥**: `git pull` + `install-iphone-agent.sh`(체인이 옛 체인을 먼저 죽임, #551).
- **VM(GCE `dw-emu-test`)은 맥에서만 닿는다.** Windows엔 gcloud도 SSH 항목도 없다.

## 3. 실데이터로 한 번도 안 돌린 것

각 항목은 이후 PR로 바뀌었을 수 있다 — 확인되면 이 줄을 지운다.

| 항목 | 마지막으로 안 것 | 위치 |
|---|---|---|
| `dw-cloud` 감시(패킷 침묵 → 재실행)와 설치 스크립트 | 11-08: "VM에서 한 번도 실행 안 했다". 11-11에 에뮬에서 수동 검증은 함 | `cloud-unattended.md` §8 |
| 연맹 도움·기술 기부·선물 수령 루틴(#591) | 코드 있음, **실계정 무인 운영 미확인** | `cloud-actions.md`, ADR-0003 |
| 업데이트 신호 필드 이름 | **추측** (11-04 로그인 응답엔 `picVer`뿐) | `watchdog/update_signal.py` |
| 아이폰 조각 교대 틈 수정 | 10-13: "실제 폰에서는 미확인" | `log/2026-10.md` |
| 데스크톱 앱 두 번째 머신 설치 | 개발 머신 한 대만 성공 | `log/2026-09.md` (09-11) |
| `dw-capture` 재접속 멈춤 | 원인 미확인 (계측만 있음) | `log/…-tail.md` |
| `arena_matches` writer 없음 | 08-03에 로컬 0건 확인, 프로덕션 미확인 | `capture-backlog.md` |

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

- 11-08 등급 측정 시각 일요일 14:00 UTC (0309, v9) — `log/2026-11.md`
- 11-08 시즌 4 전날 점검, Windows 수집기가 26일 묵은 코드였음 — 같은 파일
- 11-09~10 콘솔 키트 + 이벤트 가이드·계산기·플레이어 헤더·연맹 페이지 Phase A/B (#568~#581)
- 11-09 마이그레이션 번호 충돌로 main이 빨개짐(#574) — 함정 재발
- 11-10 플레이어 서버 이동 이력 0320, 아틀라스·기지가 이민을 따라감 (#587~#589)
- 11-10 능동 `world.get.new` no-go (#580) → 11-11 ADR-0003, 게임 내 동작 허용 (#591)

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
