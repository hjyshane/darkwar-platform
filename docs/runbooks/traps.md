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
