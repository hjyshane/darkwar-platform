# 함정 모음 (날짜 없는 것만)

2026-11-12에 `docs/handover.md` 일지에서 **본문 수정 없이** 뽑았다. 한 번 이상 실제로 밟은 것들이고, 각 항목 아래에 원 위치(`docs/log/`)를 적었다. 새 함정은 여기에 추가한다. CLAUDE.md "Traps"에 이미 있는 것(`RAISE EXCEPTION` 롤백, 스키마 변경 시 전체 grep, scoring_version 고정, `captured_at` 배치, 번호 충돌)은 중복하지 않는다 — 아래 "반복되는 함정 셋"은 그 배경 설명이다.

## 반복되는 함정 셋 — 다음에 또 밟지 말 것

**1. 테스트에 scoring_version을 고정하지 마라.** 43·90이 걸렸는데, 40 파일 안에
이미 *"버전 3으로 고정했다가 0075가 4를 쓰는 순간 깨졌다"*는 주석이 있다.
**같은 사고가 세 번째다.** 셋 다 `rank_period_latest`를 읽도록 통일했다.

**2. 부재를 검사하는 단언은 조용히 만족된다.** 90의 assertion 7과 40의 assertion
3은 null을 기대하는데 **행이 사라진 내내 통과했다.** 버전 고정은 단언을 깨뜨리기만
하는 게 아니라, null을 기대하는 단언을 진공으로 통과시킨다. 실패 목록만 보면 안 
보인다.

**3. 로스터 픽스처는 한 배치에 한 captured_at.** `alliance_roster_latest`는 최신
순간을 **공유하는** 행들을 낸다. 두 멤버를 한 순간 어긋나게 쓰면 2인 로스터가 아니라
1인 로스터다. 28·40·91이 전부 이걸로 걸렸다.


*출처: log/2026-09.md, 2026-09-08 상태 (9)*

---

## 함정 — `database is locked` 하나에 ingest가 죽고, 5분 반복은 한 번도 돌지 않았다

2026-11-19 01:45 UTC. 맵 스윕 부하로 ingest가 7분쯤 밀려 있었고 `dw-sync`가 같은
`live.db`(WAL)에 1,000행 배치를 쓰고 있었다. `Journal.record`의 쓰기 하나가 sqlite3
기본 busy 대기 **5초**를 넘겨 `OperationalError: database is locked`를 냈다. `ingest-dir`
루프는 `except (PcapError, OSError, ValueError)`만 잡는데 sqlite 오류는 그 어느 것도
아니라서 프로세스가 exit 1로 끝났다. 약 16시간 — Frankie 두 라운드와 피해 보드 읽기가
대시보드에 오지 않았다.

**두 겹이 동시에 비어 있었다.**

1. **코드.** 연결에 busy timeout을 준 적이 없었고, 잠금을 재시도하는 곳도 없었다.
   이제 `Journal`은 `BUSY_TIMEOUT_SECONDS`(60초)로 연결하고, 그래도 잠겨 있으면
   `ingest-dir`가 **같은 파일을** 늘어나는 간격으로 다시 시도한다(`LOCKED` 줄). 잠긴
   동안 그 파일은 `ingested_captures`에 안 들어가고 지워지지도 않는다. 잠금을
   UNREADABLE처럼 "0건으로 표시하고 넘어가기"로 잡으면 그게 데이터 유실이다 —
   데스크톱 사이드카의 ingest가 바로 그렇게 하고 있었고 같이 고쳤다. 역할이 뒤바뀐
   경우(ingest가 잠금을 쥐고 `dw-sync`가 `mark_sent`에서 막힘)도 같은 크래시였다.
   이제 `dw-sync`는 그 드레인을 버리고(`sync.journal_locked`) 간격 뒤에 다시 돈다.
   이미 올라간 행은 pending으로 남아 한 번 더 가고, 클라우드의 `ignore-duplicates`가
   받아낸다. 하트비트 스레드도 잠금에 죽지 않는다.
2. **작업 스케줄러.** `RestartCount`는 종료 코드 ≠ 0을 실패로 치지 않는다(시작을 못
   했을 때만). 되살리는 것은 5분 반복인데, 그 반복은 **로그온 트리거에 붙어 있어서
   등록 뒤에 로그온이 있어야 무장된다.** `register-tasks.ps1`은 로그온된 세션에서
   돌리므로 등록 순간부터 다음 재부팅까지 반복이 없다. 11-17 18:58(그날 로그온
   17:58의 한 시간 뒤)에 등록한 네 작업 모두 그 상태였고, 크래시 뒤 ingest.log에는
   재시작 시도가 **한 줄도** 없었다. 트리거 목록에는 `PT5M`이 멀쩡히 보인다.
   이제 같은 반복을 단 시간 트리거를 함께 등록하고, `NextRunTime`이 비면 FAIL.

**알아채는 법:** `(Get-ScheduledTaskInfo DarkWar-Ingest).NextRunTime`이 비어 있다.
`LastTaskResult` 1 + `Ready` + 로그 끝이 traceback이고 그 뒤로 아무 줄이 없다.

**고르지 않은 것:** `run-*.cmd`의 `goto` 루프. `Stop-ScheduledTask`가 wscript만
끝내므로 루프 cmd가 고아로 남아 워커를 되살린다 — prune·vacuum 도중에도.

`register-iphone-task.ps1`도 반복을 로그온 트리거에만 달고 있었다 — 같이 고쳤다.
**새 등록 스크립트를 쓸 때:** 되살리기용 반복은 시간 트리거에 달고, 등록 뒤
`NextRunTime`이 비어 있지 않은지 확인한다.

*출처: 2026-11-19 사고 — ingest.log, `Get-ScheduledTaskInfo`·`Export-ScheduledTask` 조회.
코드 `storage/journal.py`(`is_locked`), `cli.py`(`_until_unlocked`), `scripts/windows/register-tasks.ps1`*

---

## 함정 — BlueStacks 터치 장치(event4)에 직접 쓰면 사람의 클릭이 죽는다

2026-11-18 지금의 BlueStacks는 `/dev/input/event4`("BlueStacks Virtual Touch")가 **멀티터치 프로토콜 B**
(`ABS_MT_SLOT`·`ABS_MT_TRACKING_ID`·`BTN_TOUCH`)다. `zoom.py`는 슬롯이 없던 시절의 프로토콜 A로 쓰므로
**핀치가 아무 일도 하지 않는다**(기존 `dw-ui-worker sweep`의 줌 설정도 같이 죽어 있다).

프로토콜 B로 고쳐 쓰려던 시험이 더 나빴다. 이 장치는 BlueStacks 자신의 마우스 클릭과 **커널 상태를 공유**하고,
커널은 같은 값의 연속 이벤트를 버린다(MT 슬롯 추적이 없는 장치라 축마다 값이 하나뿐). 결과:
제스처가 탭으로 읽혀 빈 타일(Build/Teleport/March)·몬스터(Rally) 메뉴가 열렸고, 마지막 `BTN_TOUCH 0`이 남아
**사람의 클릭이 전부 "hovering"으로 처리돼 BlueStacks에서 아무것도 눌리지 않았다.** 복구는
`dumpsys input`으로 상태를 보고, 슬롯마다 다른 id를 줬다가 `-1`로 떼고(반복 값 회피) `BTN_TOUCH 1`로 되돌리는 것.

**규칙:** 자동화는 event4에 쓰지 않는다. 탭·입력은 `adb shell input`(별도 주입 경로), 줌은 가상 마우스
`/dev/input/event5`의 휠(`AdbClient.wheel`, 상대 이벤트라 남는 상태가 없다).

*출처: log/2026-11.md, 2026-11-18*

---

## 함정 — 게임 업데이트가 압축 코덱을 바꾸면 수집기는 건강해 보이며 큰 응답만 버린다

1.250.672(2026-11-17)에서 압축 프레임(0x20)이 zlib에서 APS zstd v1로 바뀌자 디코더가 그 본문을
resync 바이트로 넘겼다. 평문 프레임(push 대부분)과 요청은 계속 들어와서 ingest 로그도 저널도
살아 보였고, 빠진 것은 `al.rank`·`world.get.new`·`get.al.info`·로그인처럼 **압축될 만큼 큰 응답뿐**이었다.

**알아채는 법:** 업데이트 직후 큰 응답 명령의 raw 행이 0이 되거나 `resync_bytes`가 뛴다.
다음 업데이트에서 키만 바뀌면 같은 모양으로 다시 온다 — `aps_zstd_key_loaded`는 찍히는데 압축 응답이
없다. 그때는 `C:\DW_data\aps\README.md` 순서로 새 APK에서 키를 다시 뽑고 `aps_check.py`가
`decoded N, failed 0`을 내는지 본다. 이미 ingest된 파일은 통째로 다시 넣지 말고 `backfill_aps.py`로
(평문 이벤트가 중복된다 — 이유는 그 파일 머리말).

*출처: log/2026-11.md, 2026-11-17*

**같은 모양, 다른 원인 (2026-11-24).** 키는 저장소 밖 파일이라 **머신마다** 놓아야 한다. 메인 PC
(`June_PC_home`)의 `.env`에는 `DW_APS_ZSTD_KEY_FILE`이 없었고, `ingest.log`는 11-20부터 매 시작마다
`aps_zstd_key_unset`을 찍었다 — 경고 한 줄일 뿐 아무도 못 봤다. 그 PC에서 11-20 이후 압축 응답은 전부
버려졌다(`lucky.card.act.flip` 응답 등). deps PR 뒤 `register-tasks.ps1`로 재등록할 때 **`.env`에 키
경로가 있는지**도 같이 본다. 확인: `grep aps_zstd_key_loaded C:\DW_data\logs\ingest.log`.

---

## 함정 — 15초 pcap 파일마다 TCP 재조립을 새로 시작하면 경계에 걸친 응답이 사라진다

`ingest-dir`는 파일마다 reassembler를 새로 만들었다(의도: 멈춘 스트림이 한 파일로 끝나게). dumpcap은
15초마다 파일을 끊고 프레임 경계를 모르니, 그 순간 날아가던 응답은 앞 반이 앞 파일 끝에, 뒤 반이 다음
파일 머리에 들어간다 — 앞 반은 파일과 함께 버려지고 뒤 반은 새 디코더가 resync로 넘긴다. 2026-11-24
`cap_01363..01366`(4개, 1분)을 파일마다 읽으면 프레임 74개, 한 스트림으로 읽으면 165개. 큰 응답일수록
잘 걸린다. `scan-capture`로 파일 하나를 다시 넣어도 똑같이 안 나오니 "그 응답이 안 왔다"고 믿기 쉽다.

고침: `iter_extension_events(path, streams=...)`가 재조립 테이블을 받아 다음 파일로 이어 간다.
멈춘 스트림의 상한은 reassembler의 gap 타임아웃(패킷 시각 기준, 10초)과 `prune_idle_streams`(5분
침묵)이 대신 맡는다. 데스크톱 앱 ingest 루프도 같은 테이블을 쓴다. 읽을 수 없는 파일을 만나면
테이블을 비운다 — 그 바이트는 없어졌으니 들고 있는 반쪽은 쓰레기다. 테이블이 파일보다 오래 살면서
드러난 둘: ① 저널 잠김으로 파일을 다시 읽을 때 테이블은 이미 그 세그먼트를 먹었으므로 재읽기는 전부
재전송으로 보여 0건 — 파일마다 스냅샷을 떠서 실패하면 되돌린다. ② 같은 포트로 재접속한 연결의 ISN이
옛 위치보다 낮으면 전부 재전송으로 버려지고 끝까지 살아남는다 — 16 MiB 넘게 뒤로 간 세그먼트는 새
연결로 보고 스트림을 리셋한다(32비트 wrap도 같이 잡힘).

*출처: log/2026-11.md, 2026-11-24*

---

## 함정 — loose index scan의 조건 하나가 인덱스 밖에 있으면 그 스캔은 "전부 읽기"다

`map_atlas`의 `uids_old`(0318)는 `where server_id = p and map_server_id is null order by game_uid limit 1`을
uid마다 반복하는 loose index scan이다. 인덱스는 `(server_id, game_uid, captured_at)`이고 `map_server_id`는
없다 — 그래서 `is null`은 **힙 행마다 거르는 필터**가 되고, 옛 행이 없는 서버에서는 첫 프로브가 그 서버의
모든 행을 읽고 0행을 돌려준다(로컬 144만 행: 180,000행 필터, 7,579 힙 페이지). 답이 같아서 pgTAP은 몰랐고,
지도는 "canceling statement due to statement timeout"을 자주 냈다.

- 반복 프로브(`limit 1`)의 **모든** 조건이 인덱스 안에 있는지 본다. 하나라도 밖이면 비용은 행 수에 비례한다.
- 고치는 법은 그 조건을 담는 부분 인덱스(0346: `... where map_server_id is null`). 함수는 안 바꾼다.
- 비용을 믿지 말고 플랜을 핀한다(59·60·346): `Filter: (<열> IS NULL)`이 그 CTE 아래 보이면 회귀다.
- 로컬 재현은 `scripts/pgtap/run.py`의 클러스터에 generate_series로 서버 모양대로 채우고 member 세션에서
  함수 본문을 `explain (analyze, buffers)`로 본다(prosrc에서 `p_server_id`를 치환; `map_server_id`도 매치되니
  단어 경계로).

*출처: log/2026-11.md, 2026-11-21*

---

## 함정 — 무거운 RPC의 시간 상한은 브라우저가 부르는 함수 정의에 쓴다

authenticated 역할의 `statement_timeout`은 8초다. 무거운 함수 하나를 풀어 주려면
`set statement_timeout = '50s'`를 **REST로 불리는 그 함수의 정의 안에** 쓴다(Supabase가 클라이언트
호출에 적용, 최대 60초). 두 가지가 틀리기 쉽다.

- **안쪽 함수에 걸면 안 먹는다.** 타이머는 클라이언트가 보낸 문장이 시작될 때 이미 켜진다.
  `rebuild_rank_period`(래퍼)가 `build_rank_period`(채점기)를 부르므로 래퍼에 건다.
- **`ALTER FUNCTION … SET`으로 붙이면 사라진다.** `create or replace function`은 SET 절을 새
  정의의 것으로 **통째로 바꾼다.** 채점기는 스코어링 버전마다 다시 만들어진다(0309·0316·0328·0329·0335).
  정의 안에 쓰고, pgTAP으로 `proconfig`를 고정한다(336).

*출처: log/2026-11.md, 2026-11-19 (0336)*

---

## 함정 — `select *` 뷰의 별은 생성 시점에 한 번 펼쳐진다

0156 첫 push가 `column latest.below_minimum does not exist`로 실패했다.
`rank_period_latest`가 `select distinct on (...) *`로 쓰여 있는데, **뷰의
별표는 만들 때 한 번 확장되고 그대로 굳는다.** 0155가 테이블에 추가한 컬럼이
그 뷰에는 없고, 그 위의 모든 독자가 그걸 물려받는다. `create or replace`로
다시 만들면 별이 재확장되면서 새 컬럼이 **뒤에** 붙는다(그래서 기존 계약도
안 깨진다).

컬럼을 추가하면 **그 테이블을 `*`로 읽는 뷰를 전부 다시 만들어야 한다.** 이건
어제 배운 "뷰의 현재 정의는 마지막 마이그레이션"과 같은 계열의 다른 얼굴이다.


*출처: log/2026-08.md, 2026-08-27 상태 (7)*

---

## 함정 추가 — 로컬 더미 admin이 56번을 깨뜨린다

브라우저 검증용 `scout@dev.invalid`를 **admin**으로 심어 두면
`56_leaving_test`의 19번 "the last admin cannot lock everybody out"이 빨간불이
된다. admin이 둘이 되어 "마지막"이 아니게 되기 때문이다. 코드 회귀가 아니다 —
`supabase db reset` 후 792/792. 앞서 적은 47·65·68·69·70의 전역 count 함정과
같은 부류이고, **이 스위트는 깨끗한 DB를 전제한다**는 규칙의 다섯 번째 사례다.

---

*출처: log/2026-08.md, 2026-08-15 상태 (3)*

---

## 주의 — 로컬 `supabase test db`는 깨끗한 DB를 전제한다

브라우저 검증용으로 넣은 더미 유저·가이드·댓글이 남아 있으면 **47·56·65·68이
전역 count 단언에서 빨간불**이 된다(59는 원래 알려진 블로트 문제). 코드
회귀가 아니다 — `supabase db reset` 후 재실행하면 751/751이다. 68번의 멤버
목록 단언은 이 일을 겪고 전역 count에서 **픽스처 uuid 지정**으로 바꿨다.

머지 후 절차(이번에 그대로 밟았다): `git -C C:/darkwar-platform pull` →
`supabase db push --workdir C:/darkwar-platform` (포워드 슬래시 — 백슬래시는
Git Bash가 먹는다). `--dry-run`이 0113·0114 둘만, seeds·roles 0건으로 나오는
것을 먼저 확인했다.

**남은 것**: 한가한 시간에 `db diff --linked` 1회(드리프트 확인). 점수는
백필이 없으므로 표가 당분간 거의 0이다 — 이벤트는 적용 시점부터만 쌓인다.

---


*출처: log/2026-08.md, 2026-08-14 상태*

---

## 작업 방식 — 이번에 배운 것

**워크트리의 마이그레이션은 `db push`에 안 보인다.** `--workdir C:\darkwar-platform`
는 **메인 체크아웃의** `supabase/migrations/`를 읽는다. 브랜치에만 있는 파일은
없는 것과 같고, push는 "up to date"라고 말한다(0108 때 한 번 당했다). 급하면
**그 파일만 메인 체크아웃에 복사 → push → 삭제**. 머지 후엔 메인 체크아웃에서
`git pull`. 이걸 안 하면 다음 push가
`LegacyDbPushMissingLocalError`(원격에만 있는 버전)로 막힌다 — 이번에 그렇게 막혔다.

**push 로그의 Docker 에러 벽은 무시해도 된다.** 마이그레이션 카탈로그 캐시일
뿐이고, 판단은 마지막 줄 `"message":"Finished supabase db push."`로 한다.


*출처: log/2026-08.md, 2026-08-27 상태 (6)*

---

## Docker Desktop이 안 뜨면 — dockerInference 고아 소켓

`starting services: initializing Inference manager: ... dockerInference: The
file cannot be accessed by the system`으로 엔진이 영영 안 올라오는 상태를
이번에 밟았다. `%LOCALAPPDATA%\Docker\run\dockerInference`가 지워지지 않는
고아 AF_UNIX 소켓인데, **파일 삭제는 어떤 방법으로도 안 되고**(del,
`\\?\` 경로, fsutil 전부 Error 1920) **부모 `run` 디렉터리 rename은 된다.**
Docker 프로세스 전부 종료 → `run`을 `run.stale`로 rename → 재시작.

---

*출처: log/2026-08.md, 2026-08-12 상태*

---

## 사고: `uv run`이 상시 작업 둘을 서로 죽인다

`DarkWar-Ingest`가 `Ready`인 채로 있었고 outbox가 **288,471행**까지 밀렸다.
5분 반복 트리거는 정상이었다 — **매번 살아나서 1초 안에 죽고 있었다.**

```
error: failed to remove file `...\.venv\Lib\site-packages\../../Scripts/dw-sync.exe`:
The process cannot access the file because it is being used by another process. (os error 32)
```

`uv run`은 실행 전에 프로젝트 환경을 재동기화하고, 동기화는 `.venv\Scripts`의
콘솔 스크립트를 다시 쓴다. 상시 실행 중인 `dw-sync`가 자기 `.exe`를 잡고 있으니
**같은 프로젝트 디렉터리를 쓰는 ingest는 sync가 살아 있는 한 절대 못 뜬다.**
간헐적이 아니라 영구 고장이다.

고침: `uv run --no-sync`. 환경 동기화는 register 스크립트가 **전부 멈춘 그 순간에
한 번**만 한다. 의존성을 바꿨으면 register 스크립트를 다시 돌린다.

**같이 드러난 둘**:

1. `run-hidden.vbs`가 자식 종료 코드를 버려서 실패가 `LastTaskResult=0`,
   즉 **성공으로 기록됐다**. 이제 `WScript.Quit code`.
2. 스크립트 안의 `schtasks ... 2>&1`. `$ErrorActionPreference='Stop'`에서
   네이티브 명령의 stderr는 **종료 오류가 된다.** 등록 안 된 작업에
   `schtasks /end`를 걸자 재등록 도중 스크립트가 죽고 **세 작업이 전부 등록
   해제된 채로 남았다.** `& $uv sync 2>&1`도 같은 이유로 터졌다(uv는 진행
   상황을 stderr로 쓴다). **이 저장소의 PowerShell에서 네이티브 명령에
   `2>&1`을 붙이지 않는다.**

`register-tasks.ps1`은 이제 저장소에 있다 —
[`scripts/windows/register-tasks.ps1`](../scripts/windows/register-tasks.ps1).
전에는 `C:\DW_data`에만 있어서 고쳐도 리뷰도 복구도 불가능했다. 등록 뒤
**띄우고 10초 후에 정말 `Running`인지 다시 본다** — 이 사고가 "시작은 성공,
실행은 아님"의 모양이었다.

**진단할 때 헷갈리는 코드 둘**: `0x800710E0`은 실행 중이라 `IgnoreNew`가 반복을
거절한 것으로 **정상**. `0x0` + `Ready`는 방금 죽었을 수도 있으니 로그를 본다.


*출처: log/2026-08.md, 2026-08-07 상태*

---

## 목 PostgREST: `204 No Content`에 본문을 실으면 브라우저가 연결을 끊는다

curl은 통과시키므로 놓치기 쉽다. 즐겨찾기 해제가 안 되는 것처럼 보인 원인이 이것이었고 앱은 정상이었다. (목 서버로 앱을 돌릴 때만 해당.)

*출처: log/2026-08-and-earlier-tail.md, "Mac에서 만든 것 중 저장소에 없는 것"*

---

## 함정 — 게임 포트는 서버마다 다르다: 8100 + 서버 번호

`tcp port 8680`은 **580 서버 하나**의 포트다(579 → 8679, 615 → 8715; `account.login.new`의
`accountArr[].port`). 메인 PC에서 BlueStacks 세 개를 돌리는데 대시보드에 한 계정만 보이던 원인:
dumpcap 필터와 리더(`protocol/pcapng.py`, `capture/session.py`)가 둘 다 8680에 고정이라 579·629
계정의 패킷은 파일에 들어가지도 않았고, 그 파일은 `ingested=0`으로 조용한 1분과 똑같이 보였다
(2026-11-24).

- **확인법**: `Get-NetTCPConnection -State Established`에서 HD-Player PID의 원격 포트를 본다.
  8680이 아니면 그 인스턴스는 수집되지 않는다(필터 설계, 파이프라인 고장이 아니다).
- **고침**: dumpcap `tcp portrange 8600-8899`(서버 500–799)와 리더 기본값 `GAME_PORTS`. 둘은
  같은 범위여야 한다 — 하나만 바꾸면 아무 일도 안 일어난다. 데스크톱 앱은 한 계정이라 단일 포트
  그대로.
- `--follow-login-server`가 연결마다 `init.user.serverId`로 라벨하므로 포트만 열리면 계정별
  `collected_from_server_id`는 따라온다. sync의 `ensure_servers()`가 모르는 서버(629)를 등록해
  FK도 통과.

*출처: log/2026-11.md, 2026-11-24 (게임 포트 범위)*
