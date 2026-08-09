# 인수인계

작성 2026-08-01, 갱신 2026-08-06. 다음 세션이 이 문서만 읽고 이어받을 수 있게 쓴다.

> **다음 세션은 바로 아래 「2026-08-08 상태」부터 읽는다.** 그 아래는 배경이고,
> 일부는 이미 낡았다.

---

## 2026-08-08 상태 — 0088 뷰의 3초가 무엇이었는지 알아냈고, 고쳤다

PR **#172**(뷰 수정 + #171 되돌림), **#173**(하트비트 프루너). 둘 다 머지,
0100·0101 프로덕션 적용 완료, `db diff --linked` 확인 완료.

### 0088 뷰 — 컬럼 수가 아니라 RLS 아래서의 재실행이었다 (0100)

프로덕션 통계를 로컬에서 재현했다: 기간×버전 7조합 × 96명(프로덕션과 같은
모양)을 시드하고 `analyze`. 같은 9컬럼 select가 **superuser 2 ms, member 세션
137 ms.** 차이는 전부 RLS다.

- `member_read`가 부르는 `current_app_role()`은 SECURITY DEFINER +
  `SET search_path`. **플래너가 인라인도 추정도 못 한다.** 스캔마다 기본
  선택도의 qual이 붙고 행 추정이 전부 1로 무너진다.
- rows=1이면 nested loop. 0088의 "같은 버전의 직전 기간" 서브쿼리가 최종
  조인의 안쪽에 앉아 **멤버마다 재실행**됐다: 그 노드 하나에서 96×96 =
  9,216번, 문장 전체 ~9,700번의 RLS qual 실행. 호출마다 search_path
  set/restore + `app_users` 조회. 프로덕션 호출 단가로 그게 3초 전부다.
- **#171의 "7컬럼은 빠르다"는 컬럼 수 문제가 아니었다.** 빠른 항목들은
  0087 정의(= `rank_period_latest` 경유, 행별 서브쿼리 없음) 시절 것이다.

고침은 추정이 아니라 **울타리**다: 네 개 읽기 전부 `as materialized`.
플래너가 뭐라고 믿든 각 스캔은 정확히 한 번이다(137 ms → 9 ms, 전 스캔
loops=1). 규칙은 0088 그대로이고, 출력 동등성은 네 모양(프로덕션형·같은 버전
선행 없음·단일 기간·빈 테이블)에서 `except all` 양방향 0행으로 확인했다.

`60_movement_plan_test`가 59와 같은 방식으로 **계획 텍스트**에 핀을 박는다.
materialized CTE는 롤·데이터와 무관하게 `CTE prior/latest/previous` 노드로
보이므로 픽스처가 필요 없다. 0088 정의로 red 확인함(1~3번 실패).

**#171 되돌림 포함.** 접힘 제거, 무조건 로드, 에러는 다시 침묵. 배포 번들에서
`Show rank changes` 마커 사라진 것 확인. 로컬 dev에서 멤버 화면 진입 시
`rank_period_movement` 200으로 즉시 오는 것도 확인.

**프로덕션 실측은 아직 없다** — 로그인 세션으로 members 화면을 열 일이
생기면 `pg_stat_statements`에서 이 select의 새 mean을 한 번 본다. 구조적
수정이라 안 빨라졌을 가능성은 낮지만, 숫자는 숫자다.

### 하트비트 프루너 (0101)

`collector_heartbeats` 42,162행 — 대시보드도 `sync_status`도 `collectors`
요약만 읽고, **이력은 아무도 안 읽고 아무도 안 지운다.** `prune_collector_heartbeats(p_confirm, p_keep)` —
0070/prune-journal 계약 그대로: 기본은 세기만, `p_confirm := true`일 때만
삭제, 기본 30일, **스케줄 없음.** service_role 전용이고 revoke는
`public, anon, authenticated` 셋 다 명시(0095·0096 규칙).
`db diff --linked`로 프로덕션 직접 grant가 `service_role`뿐인 것 확인.

실제 삭제는 안 돌렸다 — 숫자를 보고 결정하는 게 계약이다. SQL 에디터에서
`select * from prune_collector_heartbeats();`로 세고, 납득되면 confirm.

참고: 이 테이블은 realtime publication에 있다. 대량 confirm은 행당 delete
이벤트를 WAL에 쓴다. 지금 구독자는 없지만(확인함), 생기면 한가한 시간에.

### #170 캐시 — 체감 확인했다

로컬 dev + member 세션. 멤버 화면 첫 로드 후 **멤버→랭킹→멤버** 왕복에서
새 요청은 정확히 **1건**(`alliance_latest`, 랭킹 화면의 첫 fetch)이고,
**멤버 화면 복귀는 0건** — 20명 로스터가 캐시에서 즉시 그려진다.
staleTime 60s가 설계대로 작동한다.

### 이어서 (08-09 새벽) — 멤버 표가 요청 1개가 됐다 (0102, PR #175)

사용자가 "거의 모든 페이지 3–4초"를 보고했다. 둘로 갈라진다:

1. **일시적 전면 저속은 내 도구 탓이었다.** `db diff --linked` 2회 + type-gen +
   `inspect db`가 마이크로 인스턴스를 포화시켰고(증거: 평소 1ms 미만인
   reltuples 추정이 **19.4초**), 사용자가 그 시간대에 브라우징 중이었다.
   **교훈: push 후 확인은 diff 1회로 몰아서, 사용자가 안 쓰는 시간에.**
2. **상시 3–4초는 워터폴 × 왕복이었다.** 쿼리는 전부 ms인데 (0098~0100),
   us-east-2까지 요청당 ~150ms × preflight 2배 × 의존 3단계.

0102 `member_roster`: 멤버 표 8요청 3단계 → **뷰 join 1요청**. 0067 패턴의
**DEFINER + InitPlan 게이트** — invoker면 관계 7개 전부에 행별
`current_app_role()` qual이 붙는다(0100이 문서화한 그 병). 구독 컬럼은
CASE로 officer+ 게이트(0092 유지, 멤버는 null). 성장 폴백(0069)과 presence
축약이 SQL로 이동 — **두 성장 뷰 모두 퍼센트 단위**라 coalesce가 성립한다.
로스터 없을 때 stale players 폴백은 삭제했다(0067이 죽이려던 버그의 재림이라).

62_member_roster_test 12건이 경계를 고정. 프론트는 `fetchRoster` 하나로 교체,
브라우저 실측: 멤버 페이지 요청 8→1, 전 요청 단일 병렬 파, 렌더 동일.
클라우드 적용·배포 완료(`member_roster` 마커 확인).

### 그리고 0102가 프로덕션에서 한 시간 만에 타임아웃났다 — 0103·0104 (PR #177·#178)

**20행으로 검증하고 363k행에 배포한 것이 사고다.** 멤버 탭이 statement
timeout으로 죽었고, 사용자가 보고했다.

- **0103**: 0102의 계획이 프로덕션 규모(멤버 스냅샷 363k·player_snapshots
  43k/7.5k명)에서 (a) `alliance_roster_latest` 경유로 **전 연맹**의 최신 배치를
  계산(363k 인덱스 엔트리 전부), (b) growth 뷰 둘을 **전 플레이어**에 대해
  풀 계산 — join의 등가조건은 뷰의 per-player 집계 밑으로 안 밀린다. 로컬
  hot RAM에서 770ms = 프로덕션 콜드 316MB에서 타임아웃. 수정: own 연맹 최신
  배치는 (alliance_id, captured_at) 인덱스 하강 스칼라 max(), growth는
  **LATERAL … limit 1** — limit이 하중을 받는다, 없으면 플래너가 다시
  de-correlate해서 풀 계산으로 돌아간다(실측). 770ms → 14ms(94명 로스터).
- **0104**: 같은 병 세 번째 발병처. 플레이어 페이지 hero/pet 추이의
  `player_component_power_history`가 invoker×RLS라 `current_app_role()`이
  행마다 + `board_size` 상관 서브쿼리 안 보드 행마다(57보드면 ~5,700회,
  수집 잘 된 플레이어는 수만 회). DEFINER + InitPlan 게이트로 전환, 접근
  표(viewer 0행·member는 member 가시성·admin은 +admin 지표·board_size가
  독자 기준 카운트) 그대로 — 63 테스트가 행 단위로 고정. 193ms → 7ms.

62에 1,000명 규모 픽스처 + "player_snapshots Seq Scan 금지" 계획 핀 추가.
**교훈은 59가 이미 적어 뒀던 것이다: 계획 속성은 플래너에게 실제 선택지가
있는 크기에서만 증명된다.** 규모 시드 절차는 이 세션 스크래치에 있었고,
요지는: 프로덕션 행 수를 `inspect db table-sizes`로 뽑아 같은 자릿수로
시드하고, **member 세션으로** explain analyze — postgres로 재면 게이트가
one-time filter로 접혀서 아무것도 안 보인다.

### 그리고 0103도 프로덕션에선 실패했다 — 프론트를 8쿼리로 되돌림 (PR #181)

**0103이 로컬 프로덕션 규모 시드에서 14ms인데 프로덕션에선 여전히 statement
timeout.** 배제한 것: 인스턴스 스로틀 아님(기준 쿼리 92–145ms = 네트워크
바닥, 363k 테이블 인덱스 읽기 247ms), 인덱스 둘 다 존재, PG 버전 동일(17.6).
**남은 설명은 프로덕션 플래너가 다른 계획을 고른다는 것뿐인데, 실물 EXPLAIN
없이는 못 본다.** 취소된 쿼리는 pg_stat_statements에 안 남는다.

SQL 접근이 막혀 있다: pooler-url 파일에 비밀번호 없음, CLI 자격증명은 OS
키링(안 건드림), 관리 API 토큰도 키링. **다음 세션 1순위: Supabase 대시보드
SQL 에디터에서 아래를 돌려 계획을 뜬다** (member 세션 시뮬레이션 포함):

```sql
select set_config('request.jwt.claims',
  '{"sub":"<member uid>","role":"authenticated"}', false);
set role authenticated;
explain (analyze, buffers)
select * from member_roster order by power desc nulls last limit 100;
```

그때까지 프론트는 8쿼리 경로(#181). 느리지만(3–4초) 일주일 내내 살아 있던
모양이다. `member_roster`·`player_component_power_history` 뷰와 테스트
62·63은 남아 있다 — 0104는 프로덕션 검증 안 됐음을 유의(플레이어 페이지가
빨라졌는지 확인 필요. 같은 병이라 같은 의심).

**아마 진짜 결말은 읽기 시점 계산을 끝내는 것이다.** 사용자가 정확히 이
방향을 제안했다: 요약을 로컬(수집기)에서 계산해 올리자. 오늘 밤 타임아웃
셋 전부 마이크로 인스턴스에서의 read-time 계산이었다. 스케치:

- `member_roster_current` **테이블** (뷰 아님): 멤버당 1행, 로스터 배치가
  sync로 도착한 뒤 한 번 계산해 upsert (수집기 post-sync 훅 또는 서버 함수
  — 어느 쪽이든 배치당 1회, 읽기당 0회).
- 대시보드 멤버 탭 = 그 테이블 인덱스드 SELECT 1개. 플래너 룰렛·RLS 행별
  비용·뷰 중첩 전 클래스가 사라진다.
- raw 스냅샷은 그대로 올린다 — replay/renormalize와 히스토리 화면의 원천.
  "요약만 보내기"로 가면 파서 소급 수정이 죽는다. 무거운 건 raw 저장이
  아니라 읽기 계산이었다.
- 등급 스코어링(주기 리빌드)은 이미 이 모양이다(rank_period_snapshots =
  구체화된 계산 결과). 같은 원칙의 확장.

### 프로덕션 EXPLAIN을 받았고, 사건이 끝났다 (0105, PR #183·#184)

사용자가 대시보드 SQL 에디터에서 계획을 떠 줬다. **13.5초의 12초는
subscriptions였고, 근본 전제 하나가 뒤집혔다:**

> **호스티드 Supabase에선 DEFINER 뷰가 RLS를 안 벗는다.** 로컬 postgres는
> superuser라 RLS를 전부 무시한다 — 로컬 측정이 뷰를 미화한 이유 그 자체.
> 프로덕션 계획엔 테이블마다 `current_app_role()` RLS qual이 살아 있었다.

그 qual들의 기본 선택도가 추정을 1행으로 무너뜨렸고, 플래너가
`player_subscriptions` FULL JOIN을 Materialize 없이 nested loop 안쪽에 놓고
**92번 재계산**했다(루프마다 month_cards 3,291행 seq scan × 행별 role 호출).
LATERAL은 못 고친다 — 그 뷰의 player_id가 FULL JOIN 양쪽의 COALESCE라 필터가
안 밀린다. 0105가 뷰를 우회해 두 테이블을 **pkey로 직접 조인**.

프로덕션 재실측(사용자 손): **13,521ms → 1,214ms.** 프론트 재전환(#184),
멤버 첫 로드 3요청 파도 → 1파, 체감 ~1.5초.

수확 둘: (1) **계획 검증은 프로덕션 규모 + `set role authenticated`로도
부족하다 — 로컬 postgres가 superuser라 RLS가 아예 다르게 돈다.** 로컬에서
프로덕션과 같은 계획을 보려면 RLS를 강제로 태울 별도 비-owner 롤이 필요하다
(다음에 뷰 계획 작업하면 먼저 만들 것). (2) 읽기당 1.2초는 여전히 RLS 행별
비용이 깔린 read-time 계산이다 — 아래 precompute 스케치가 여전히 종착지.

### precompute 착지 (0106, PR #187) — 읽기 1.2초의 시대가 끝났다

`member_roster_current` 테이블: 로스터 멤버십 + growth + computed rank —
**member-readable 원천에서만 파생되는 컬럼만** (보안 속성: refresh는 쓰기를
유발한 호출자로 돌기 때문에, officer 전용 수치가 테이블에 있으면 member발
refresh가 null로 덮는다). 구독·assigned_rank는 뷰에서 라이브(0105 이후 싼
pkey probe, admin 등급 수정 즉시 반영).

refresh는 **쓰는 문장 안에서** 돈다 — 세 원천 테이블의 statement 트리거.
realtime 알림이 도착하기 전에 이미 신선 → staleness 창 없음, 스케줄러 없음,
수집기 변경 없음(service_role BYPASSRLS라 계획 깨끗). 가드: advisory
try-lock / 호출자 게이트 / 빈-답 prune 불가. 함정 둘을 밟고 고정했다:
`clock_timestamp()`를 인라인으로 쓰면 행마다 전진해 prune이 마지막 행 빼고
다 먹고, `now()`는 트랜잭션 내 고정이라 같은 트랜잭션의 두 번째 refresh가
prune을 못 한다 — **호출당 1회 변수 캡처**가 정답. own 연맹 선택은 최신
배치 기준 결정적(개발 DB는 0031이 is_own을 되살려 여럿이라).

프로덕션: service refresh 1회 실측 **219ms**(RTT 포함), 테이블 92행. 뷰
읽기는 이제 92행 테이블 + pkey probe들 — 수십 ms + RTT. 테스트: 64 신규
9건(트리거 충전·탈퇴 prune·viewer no-op·빈 가드·anon 차단), 62 무변경 통과,
스위트 688/688.

### 남은 것

플레이어 페이지(hero/pet)는 0104 적용 후 사용자가 프로덕션에서 정상 확인함
(08-09 새벽). board_size 상관 서브쿼리의 행별 RLS 비용은 프로덕션에도 남아
있지만 현재 데이터 규모에선 타임아웃 밖이다 — 느려지기 시작하면 0105와 같은
처방(뷰 우회 pkey/인덱스 probe).
1. **`prune-journal` 실행 시점** — 저널이 30일치 넘는 2026-09-03경.
2. **`prune_collector_heartbeats` confirm 실행** — 숫자 보고 결정. 급하지 않다.
3. **0100·0102의 프로덕션 체감 확인** — 로그인 세션으로 members 3–4초 →
   1–1.5초가 실제인지. `pg_stat_statements`도 같이.
4. **`db diff --linked` 밀린 1회** — 0101·0102 push 후 grant 확인을 아직 안
   돌렸다(사용자 사용 시간대라 미룸). 다음 한가할 때 1회. 뷰의 플랫폼 기본
   grant 부류는 0097이 무력함을 문서화한 종류라 급하지 않다.
5. **주간 보드 타이밍** — 다음 기회 8/10 (일 01:59 UTC 직전에 주간 보드 열기).
   9시(EDT) 원타임 클라우드 알림 걸어 둠.
6. **다른 화면 같은 패턴** — Overview/Rankings는 워터폴이 얕아 이득 작음.
   Members 체감 확인 후 결정.

---

## 2026-08-07 상태 — 수집이 26시간 멈춰 있었다. 원인은 `uv run` 한 줄

브랜치 `task-scheduler-admin-ui-809179`, 커밋 3개. **아직 머지되지 않았다** —
이게 아래 「지금 당장 할 일」의 이유다.

### 사고: `uv run`이 상시 작업 둘을 서로 죽인다

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

### sync 배치 — 7.4행/s → 231행/s

`sync`에 배치 옵션이 없었다. `batch_size=100` 하드코딩, drain 1회당 100행.
288k 백로그가 **11시간**이었다.

`DW_SYNC_BATCH_SIZE`(데몬) + `--batch-size` / `--until-empty`(운영 명령)를 넣었다.
실측: 배치 1000에서 **231행/s, 31배**. 백로그 251,033행을 16분에 비웠고
`failed=0`, 현재 pending **0**.

> **아직 안 듣는다.** `run-Sync.cmd`가 `DW_SYNC_BATCH_SIZE=1000`을 넣지만,
> 상시 작업은 `C:\darkwar-platform`(메인 체크아웃)의 코드를 돌린다. **머지
> 전까지 sync는 여전히 100행/drain이다.**

### 어드민 셋

- **등급 게이트**는 **capability별**로 했다. `game_rank`가 아니다 — 0045가
  "게임 R4가 대시보드 편집 권한이 아니다"를 명시적으로 정해 뒀고, 그걸 어기면
  게임 안 승진이 앱 쓰기 권한이 된다. 테스트가 `game_rank` 사용을 막는다.
  기존 배너는 `role === 'admin'` 하나를 5개 그룹 전부에 물어보고 "저장은 admin이
  필요"라고 했는데, **0045 이후로 거짓이었다** — `members.manage`를 받은 officer는
  멤버 표·권한 그리드·등급 열을 편집할 수 있다.
  `apps/dashboard/src/lib/adminAccess.ts`에 섹션→요구사항 지도가 있다.
  요구사항이 두 모양인 이유: `join_codes`(0021)와 `notification_channels`(0076)는
  아직 정책이 `current_app_role() = 'admin'`을 직접 쓴다. **없는 capability로
  분장하지 않고 role로 적었다.**
- **캐릭터 선택**: 승인 규칙(0066)은 그대로. `player_claims`·`app_users`에
  notify 트리거가 **아예 없어서** officer 승인이 화면에 도달할 경로가 없었다
  (0093이 추가). 문구는 캐릭터 이름을 되읽어 준다 — 100명 목록에서 잘못 고르는
  것이 이 폼의 유일한 실제 위험이고, 싸게 알아챌 순간이 그때다. rejected가
  중립 질문으로 떨어지던 것도 고쳤다(같은 클레임을 다시 내게 만들었다).
- **탈퇴·강제탈퇴**: `created_by` 하나가 아니라 **NO ACTION FK 9개**였다.
  전부 `set null`. **MembersSetting의 기존 `revoke`(viewer로 강등)를 대체한다** —
  강등된 행은 `display_name`·`game_rank`를 유지해서 `players.current_alliance_id`와
  같은 종류의 버그였고, 탈퇴 사실이 어디에도 안 남았다. `record_departure()`가
  이름이 닿는 마지막 순간에 감사 행을 쓴다. `leave_alliance()`는 강등으로는
  애초에 못 만든다 — `app_users`는 `members.manage`로 쓰는데 떠나는 사람에겐
  그게 없다. **마지막 admin은 못 나간다.** pgTAP 19건, 픽스처는 일부러 지저분하게
  (초대·감사·공지·가이드·설정) — 새 계정으로 짠 테스트는 이 버그를 못 잡는다.

### 끝난 것 (같은 날 이어서)

PR **#153** 머지(`a250aaf`), register 스크립트 재실행 — `sync.start
batch_size=1000`이 로그에 뜨고 ingest가 sync와 **동시에** 돈다(`os error 32`
0건). 0093·0094 클라우드 적용 완료.

### 그리고 그 push가 결함 하나를 드러냈다 — 0095

`db push` 뒤에 `db diff --linked`를 돌렸더니 이게 있었다:

```
GRANT ALL ON FUNCTION public.record_departure(uuid, text) TO anon;
```

호스팅 프로젝트에는 `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON ROUTINES TO
anon, authenticated`가 걸려 있다. **새 함수마다 그 두 롤에 EXECUTE가 직접
붙고**, `revoke ... from public`은 직접 붙은 grant를 안 건드린다. revoke는
돌고 성공을 보고하고 함수는 열려 있었다. `record_departure()`는 자체 권한
검사가 없어서(호출자가 SECURITY DEFINER라 grant가 필요 없다) **익명 요청이
`audit_logs`에 임의 행을 넣을 수 있었다.**

PR **#154** / 0095가 `from anon, authenticated`로 명시 revoke해 닫았다.
프로덕션 재확인: `record_departure`는 이제 `service_role`만.

`leave_alliance()`·`remove_member()`는 여전히 `anon`에 열려 있고 **그래도
안전하다** — 각자 첫 줄에서 거부한다(`auth.uid()` null / `members.manage`).
`approve_player_claim`도 같은 상태의 기존 함수다. 그 순서가 맞다: 함수를
안전하게 만드는 것은 grant가 아니라 가드다.

**로컬 pgTAP은 이걸 구조적으로 못 잡는다.** 로컬 스택엔 그 기본 권한이 없어서
`anon`은 어떤 함수에도 실행 권한이 없다. "anon은 못 부른다" 테스트는 수정이
있든 없든 통과한다. 56_leaving_test의 20~21번이 그 사실을 주석에 적고 있고,
잡는 방법은 `going-public.md`의 `db diff --linked` 절에 넣었다.

**규칙: 이 플랫폼에서 `revoke ... from public`은 함수를 비공개로 만들지 않는다.
롤을 이름으로 적어야 한다.**

### `anon`에 열린 함수 전수 조사 — 끝났다. 하나 더 나왔다 (0096)

프로덕션에서 `anon`이 실행할 수 있는 함수 29개를 전부 분류했다.
**가드 없는 writer는 하나뿐이었다.**

`resolve_own_alliance()`가 0032 이후로 **익명 쓰기 엔드포인트**였다. 0095와
원인이 반대다 — 그건 `public`에서 revoke했는데 플랫폼이 `anon`에 직접 붙인
것이고, 이건 **revoke를 아예 안 했다.** Postgres는 `CREATE FUNCTION` 시
PUBLIC에 EXECUTE를 기본 부여하고 `anon`은 PUBLIC이다.

영향은 작다. 인자가 없어서 호출자가 결과를 고를 수 없고, `void`라 읽히는 것도
없고, 권한 상승도 아니다. 할 수 있는 건 **DB에 쓰기를 일으키고 연결된
대시보드를 전부 refetch시키는 것**을 원하는 만큼. 닫은 이유는 크기가 아니라
함수 본문 어디에도 "트리거 전용"이라고 쓰여 있지 않다는 것이다.

PR **#156** / 0096이 `from public, anon, authenticated`로 닫았다. **셋 다
필요하다** — `public`만으로는 플랫폼 직접 grant를 못 막고(0095), 롤 이름만으로는
PUBLIC 기본값을 못 막는다(0096).

**나머지 28개는 전부 의도된 것으로 확인했다:**

| 부류 | 개수 | 근거 |
|---|---|---|
| 트리거·이벤트 트리거 | 15 | PostgREST가 `trigger` 반환 함수를 노출하지 않는다 |
| `members.manage` 검사 | 4 | `approve_player_claim`·`reject_player_claim`·`retention_report`·`remove_member` |
| 멤버 이상 검사 | 2 | `build_rank_period`(42501), `rebuild_rank_period`(첫 문장이 그걸 부른다) |
| `auth.uid()` null 거부 | 2 | `redeem_join_code`, `leave_alliance` |
| 호출자 본인으로 한정 | 1 | `linked_player_id()` |
| 순수 계산 | 4 | 날짜·등급 산술, `is_service_request()` |

`leave_alliance`·`remove_member`가 `anon`에 열린 채로 남은 것은 정상이다.
**함수를 안전하게 만드는 것은 grant가 아니라 가드다.**

지속되는 산출물은 `57_anon_callable_test`의 1번 단언이다 — **앞으로 추가될**
함수 중 anon이 부를 수 있고, 쓰고, 누가 부르는지 안 묻는 것이 있으면 실패한다.
0096을 빼고 reset해서 실제로 빨간불이 뜨는 것까지 확인했다.

다만 그 파일 머리말이 한계 둘을 명시한다. **0095가 고친 부류(호스팅
프로젝트의 `ALTER DEFAULT PRIVILEGES`)는 로컬에서 테스트가 불가능하다** —
로컬엔 그 기본 권한이 없어서 단언이 마이그레이션 유무와 무관하게 통과한다.
그건 `going-public.md`의 `db diff --linked` 절이 담당한다. 그리고 처음에 예시로
고른 `redeem_join_code`는 **프로덕션에선 anon이 부를 수 있고 로컬에선 아니라서**
잘못된 선택이었다 — 정확히 같은 함정이다.

### 브라우저 검증 — 했다. realtime이 처음으로 실증됐다

kong 컨테이너가 exit 127로 죽어 있었다. `supabase start`는 매번 "Stopped
services"만 보고하고 **되살리지 않는다.** `docker start
supabase_kong_darkwar-platform` 하나로 떴다. 이 스택이 반쯤 죽어 있으면 앞으로도
그 증상이다 — `docker ps -a`로 exit 코드를 먼저 본다.

실 픽스처 23개 → 3,681행, 로스터 93명, 역할 4개(viewer/member/officer/admin),
officer에 `members.manage` 부여. `is_own`이 **둘**이었다(합성 시드 + 픽스처) —
핀을 박아야 한다. 핀은 코드가 아니라 `alliance_id`로 고른다: 둘 다 코드가
`CBFW`라 코드로 고르면 합성 쪽이 잡힌다.

**어드민 배너 — 그룹마다 다른 문장이 나온다:**

| 그룹 | officer(+members.manage)가 보는 것 |
|---|---|
| Access | "**Some of** this group needs the admin role" |
| Alliance · Display | `"Change dashboard settings"` |
| Catalogue | `"Edit the hero and pet catalogues"` |
| Operations | "the admin role" |

admin은 다섯 그룹 어디서도 배너를 안 본다. capability 라벨은 DB의
`capabilities` 테이블에서 온다. 예전 문구였다면 Access에서 "저장은 admin이
필요"라고 **틀리게** 말했을 자리다.

콘솔 403 하나는 officer의 `GET /join_codes`이고 **버그가 아니다.** 0021이
`admin_all`로 잠갔고 authenticated에 SELECT를 준 적이 없다 — 배너가 예고한 바로
그 거절이다. 섹션은 숨지 않고 에러를 보고한다(AdminPage의 원칙 그대로).

**0093 realtime — 처음으로 실증됐다.** 이전까지는 주장만 있었다.

psql로 클레임을 승인하자 브라우저를 건드리지 않았는데 화면이
"Waiting for an officer to confirm that you are Member07" →
**"This account is linked to Member07."** 로 바뀌고 피커가 사라졌다.

그것만으로는 부족하다 — 앱은 `new QueryClient()` 기본값이라
`refetchOnWindowFocus`가 켜져 있어서 포커스 refetch일 수 있다. 그래서 페이지에
기록기를 심고 다시 쟀다:

```
focusEvents: []                                    ← 포커스 이벤트 0
hidden: true                                       ← 숨김 상태(=focus refetch 불가)
domChanges: [{ at: 28302, what: "Probe 424242" }]  ← psql로 쓴 마커가 그대로
```

남은 전송 경로는 소켓뿐이다. `app_users` 토픽이 Members 표까지 닿는 것도 같이
증명된다.

**탈퇴 — 설계대로 착지한다.** 첫 클릭은 확인만 띄우고, 두 번째에 역할이
`officer` → `viewer`로 **리로드 없이** 바뀌고 가입코드 입력창이 나타난다.
로그인은 살아 있다. DB: `app_users` 행 GONE, `player_claims` GONE,
`auth.users` 1행 유지.

**감사 로그가 두 모양을 구분한다** — 이게 강등 대신 삭제를 택한 이유다:

| | actor |
|---|---|
| `app_users.removed` (admin이 강제) | admin uid — **남는다** |
| `app_users.left` (본인 탈퇴) | `(NULL)` — 그 행이 지워지니 FK가 지운다 |

이름은 양쪽 다 `before->>'display_name'`에 남는다. `record_departure`가 이름이
닿는 마지막 순간에 쓰기 때문이다.

강제탈퇴는 UI에서 `POST /rpc/remove_member → 204`로 나가고 직후 무효화 refetch가
따라붙는다.

### `live` 정리 — 했고, 그게 잠복해 있던 버그를 깨웠다 (PR #160)

고아 캡처 **2,646개(0.34 GB)** 삭제. 지우기 전에 저널의 `ingested_captures`와
대조했다: **안 읽힌 파일 0개**, 구·신 시리즈 간 **이름 충돌 0건**. 현재 링
201개는 dumpcap 소유라 손대지 않았다.

삭제 방법이 중요하다. `mtime < dumpcap 기동시각` **그리고** 이름이
`ingested_captures`에 있는 것만 골라 명시 경로로 지운다. 글롭으로 지우면 현재
링을 먹는다.

**그런데 그 삭제가 ingest를 죽였다.** 그리고 그건 내 실수가 아니라 예약된 고장을
앞당긴 것이다.

```
FileNotFoundError: [WinError 2] ... 'cap_03067_20260807194352.pcapng'
```

`_ready_captures`가 방금 나열한 파일을 무방비로 `stat()`하는데, 이 함수는
폴링 루프의 파일별 `try` **바깥**이다. 한 파일이 스캔 도중 사라지면 명령 전체가
죽는다. 그리고 **`-b files:1440`은 링이 차면 회전마다 가장 오래된 파일을
지운다.** 30초마다 도는 스캔과 설계상 부딪힌다. 링이 201/1440이라 아직 안
터졌을 뿐, **하루쯤 뒤 저절로 터질 것이었다.**

PR #160이 경로당 `stat` 한 번 + `OSError` 통과로 고쳤다. 두 번째 경합도 같이
닫혔다 — 옛 코드는 거르려고 한 번, 정렬하려고 또 한 번 `stat`했다.

**"링이 차면 조용해지는 수집기"는 `ingest-dir`이 존재하는 이유 그 자체다.**
docstring이 "고장을 한 파일로 가둔다"고 적어 뒀는데, 한 파일이 런 전체를
가져갈 길이 있었다.

이번 세션에서 ingest가 조용히 죽은 것이 **세 번, 원인은 둘**이다:
`uv run` venv 락(0신규 없음, `--no-sync`), 그리고 이 경합.

재등록으로 수정이 반영됐다. `--no-sync`라 **머지만으로는 돌고 있는 작업에
안 닿는다** — 항상 register 스크립트를 다시 돌린다.

이번엔 dumpcap이 번호를 `cap_00208`로 **이어받아서** 새 고아 세트가 안 생겼다.
앞선 재등록 때는 `cap_00001`부터 다시 시작해 이전 링이 통째로 고아가 됐다.
어느 쪽이 되는지는 확인 안 했다 — **재등록 뒤에는 `live` 디렉터리 파일 수를
한 번 본다.**

### `live.db` 정리 — 1.58 GB 회수. 다만 **1.7일치를 산 것뿐이다**

**5.23 GB → 3.65 GB.** `sync_outbox`의 `status='sent'` 650,661행 삭제 후 VACUUM.
`integrity_check` 삭제 전후 모두 `ok`. 백업(`live.db.bak`, 5.23 GB)은 VACUUM 이후
관측 46,820건·캡처 361개가 무사히 들어가고 `integrity_check`·`foreign_key_check`가
깨끗한 것을 확인한 뒤 지웠다.

**VACUUM만으로는 아무것도 못 줄인다.** 손대기 전 `freelist_count = 3`이었다.
빈 페이지가 없으니 회수할 것도 없다. 지울 것을 먼저 지워야 VACUUM이 의미를
갖는다(삭제 후 freelist 381,114).

무엇을 지웠고 왜 안전한가:

| 테이블 | 크기 | 판단 |
|---|---|---|
| `raw_observations` | 1.86 GB | **건드리지 않음.** replay/renormalize의 원천이고 대체 불가 |
| `normalized_rows` | 0.79 GB | 남김. 파서로 재생성 가능하지만 지울 이유가 약함 |
| `sync_outbox` (sent) | 0.79 GB | **삭제.** 배달 끝난 큐 |

배달된 outbox 행은 클라우드가 이미 갖고 있고, 복구가 필요하면
`raw_observations`에서 `renormalize`가 전부 다시 만든다 — 이 문서가 실제로 쓰는
절차다. 잃는 것은 그 행들에 대한 `retry-outbox --already-sent` 지름길뿐이다.

절차: ingest·sync 정지 → `wal_checkpoint(TRUNCATE)` → 백업 → DELETE → VACUUM(45초)
→ 재기동 → **로그로 진짜 도는지 확인**. capture는 켜둔 채로 해도 된다(파일이
쌓이고 ingest가 따라잡는다).

### 이건 일회성 문제가 아니다 — 저널 보존 정책이 없다

실측 (4.5일):

```
observations  676,962  =  150,583/day

raw payload      1.94 GB   0.43 GB/day
normalized       0.87 GB   0.19 GB/day
outbox           0.08 GB   (배달되면 빠진다)
FILE TOTAL       4.12 GB   0.92 GB/day   <- 디스크를 채우는 건 이것
```

**payload 합계를 파일 크기로 읽지 마라.** 처음에 이 절을 "하루 0.5 GB"로
적었는데 그건 raw payload만 센 값이고, 인덱스와 행 오버헤드가 파일을 대략 두
배로 만든다. 실제 증가는 **0.92 GB/day**이고, 그래서 이번에 회수한 1.58 GB는
3.5일치가 아니라 **1.7일치**다. 두 배 틀리면 보존 기간 결정이 달라진다.

디스크 166 GB 여유 = **약 181일**. 급하지는 않다. 급하지 않은 것과 아무도 안
줄이는 것은 다르다 — **지금 이걸 줄이는 장치가 없다.**
0070의 `retention_report()`는 **클라우드 테이블용이지 이 SQLite용이 아니다.**
이름 때문에 반대로 읽기 쉽다.

**프루너를 만들었다 — `dw-collector prune-journal` (PR #164).** 절차는
[collector-operations.md 5-2](runbooks/collector-operations.md).

기본 30일. raw payload의 남은 용도가 "파서가 틀렸다는 걸 알아채는 데 걸리는
시간"이라서다. 줄이면 소급 수정이 닿는 범위가 줄 뿐 대시보드는 안 망가진다.

무엇이 남고 무엇이 가는가:

| | 정책 |
|---|---|
| `raw_observations` | 기간 내 무조건 보존. `renormalize`의 유일한 원천 |
| `normalized_rows` | 관측과 함께 간다 |
| `sync_outbox` (`sent`) | 기간 지나면 삭제 |
| `sync_outbox` (`pending`/`dead_letter`) | **절대 안 지운다. 그 관측도 나이와 무관하게 남는다** |

마지막 줄이 이 명령의 핵심이다. 클라우드에 못 간 행의 raw payload를 지우면
그 데이터는 **양쪽 어디에도 없고 재생성도 불가능하다.** 그래서 기간이 지나도
남기고, 그 수를 `held back: N`으로 **출력한다** — 조용히 건너뛰지 않는다.
**이 숫자가 회차마다 커지면 outbox가 막힌 것이고, 다른 어디보다 여기서 먼저
보인다.**

실 저널(630k행)에 카운트 모드로 돌려 확인했다. 2일 창 기준
관측 307,392건·행 167,671건, `held back` 0. 기본 30일로는 오늘 지울 것이 없다 —
저널이 4.5일치라서. 맞는 결과다.

**스케줄에 걸지 않았다.** 0070이 클라우드 쪽에서 같은 판단을 했다.

함정 하나: bash에서 `--db C:\DW_data\live.db`를 따옴표 없이 쓰면 백슬래시가
먹혀 **빈 저널이 새로 생기고 전부 0으로 보고된다.** 실제로 한 번 밟았고,
출력 첫 줄 `journal=`이 그걸 잡으라고 있는 것이다.

### 반응형·전 탭 — 확인했다. 문제 없다

admin 세션, 실 픽스처(플레이어 643 · 아레나 220 · 연맹 스냅샷 142),
**라우트 8개 × 1440·390.**

**본문이 가로로 미는 곳은 한 군데도 없다.** 두 폭 모두 전 라우트에서
`body.scrollWidth === body.clientWidth`. 390에서 표 4개가 자기 컨테이너 안에서만
스크롤한다 — 설계 그대로다.

끝까지 오른쪽으로 밀었을 때 신원 열이 남는가:

| 라우트 | 넘침 | sticky 열 | 밀어낸 뒤 |
|---|---|---|---|
| `#/members` | 1849px | Rank + Name | left 0 · 88, 보임 |
| `#/arena` | 398px | Name | 보임 |
| `#/rankings` | 265px | Alliance | 보임 |
| `#/cross-server` | 28px | Name | 보임 |

**스킬의 탭 목록이 낡아 있었다.** 4개라고 적혀 있는데 실제로는 8개고, 빠진
`#/members`가 **가장 넓은 표(18열)이자 sticky 경고가 실제로 겨냥하는 그 화면**
이다. 목록 대신 `nav`를 읽으라고 고쳤다.

**측정 함정 둘을 밟았고 스킬에 적었다.** 둘 다 "그럴듯한 오답"이라 위험하다:

1. **해시를 바꿔도 페이지가 바뀐 게 아니다.** `location.hash` 뒤에 `main table`을
   기다리면 **이전 탭의 표가 즉시 통과시킨다.** 처음 측정에서 `#/`가
   "표 0개"로 나온 게 그것이다. `main` 텍스트가 변한 것을 기다리고, 각 페이지의
   `h2`를 결과에 같이 남기게 고쳤다.
2. **sticky는 셀이 있는 행에서 재야 한다.** 멤버 표는 `td`가 0개인 그룹 구분
   행이 섞여 있어서 `querySelector('tbody tr td')`가 그걸 잡는다. 그 결과
   **"본문 sticky 없음, 끝까지 밀면 보이는 열 0개"** 라는 **존재하지 않는 버그**를
   보고할 뻔했다. `td` 수가 `th` 수와 같은 행을 골라야 한다.

콘솔 에러 둘은 과거 것이다 — websocket 실패는 kong이 죽어 있던 시간대,
403은 officer 세션의 `join_codes`(설계된 거절). 소켓은 지금 OPEN이고 잡아둔
네트워크 60건은 전부 200이다.

로컬에서 헤더가 `Real-time sync stopped`로 보이는 것도 정상이다 — 로컬 스택엔
수집기 하트비트가 없다.

### 남은 것

1. **`prune-journal`을 실제로 돌릴 시점.** 도구는 있고 스케줄은 없다. 저널이
   30일치를 넘기면(2026-09-03경) 처음으로 지울 것이 생긴다.

---

### 뷰·테이블 grant 전수 조사 — 문 세 개는 모양이 다르다 (0097)

`anon`은 **선언되지 않은 INSERT/UPDATE/DELETE를 66개 관계에** 갖고 있다. 전부
무력하다. 확인한 것:

| | |
|---|---|
| 테이블 47개 중 RLS 꺼진 것 | **0** |
| 쓰기 정책 23개의 대상 롤 | **전부 `{authenticated}`** — `anon`·`public` 없음 |
| `anon`의 선언되지 않은 SELECT | **0** (0065의 회수가 유지됨) |
| `anon`이 읽을 수 있는 뷰 | **0** |

**문 세 개의 차이가 이 조사의 결론이다:**

- **함수엔 RLS가 없다.** `anon` grant가 곧 경계다 — 0095·0096이 그래서 필요했다.
- **테이블엔 RLS가 있다.** grant가 남아 있어도 정책이 막는다.
- **뷰엔 둘 다 없다.** 자체 정책이 없고, `security_invoker`가 아니면 원천을
  **소유자로** 읽는다 — 밑에 깔린 모든 정책을 지나서.

그 셋째에서 하나 나왔다. **`alliance_growth`가 계정만 있으면 누구나 읽을 수
있었다.** 0073이 만들 때 `with (security_invoker = true)`가 빠졌다:

```
33행: create view public.alliance_power_history
34행: with (security_invoker = true) as
...
66행: create view public.alliance_growth as        ← with 절 없음
```

같은 마이그레이션, 30줄 간격, 같은 대상. 판단이 아니라 누락이다. 뷰 기본값이
`security_invoker = false`라 소유자로 실행됐고, 원천 `alliance_snapshots`는
`member_read`인데 131행의 `grant select to authenticated`가 결과를 **가입만
하고 코드는 안 받은 viewer에게까지** 넘겼다. 0081이 `create or replace`로
다시 낸 것이 reloptions를 보존해 누락도 같이 보존했다.

실측(viewer 세션, 스냅샷 2행):

```
alliance_snapshots  0    ← RLS 작동
alliance_growth     1    ← 우회
```

PR **#158** / 0097이 `alter view ... set (security_invoker = true)`로 고쳤다.
멤버는 그대로 본다(`alliance_snapshots`를 읽을 수 있으므로). viewer만 못 본다.

`sync_status`는 **의도적으로** `security_invoker = false`다 — 0060이 이유와 함께
적었고 0065가 참조한다. officer 전용 테이블에서 하트비트 시각 하나만 공개해
보드가 살아 있는지 말하게 한다. 58번 테스트가 그 하나를 **이름으로** 예외
처리한다 — 두 번째 예외를 만들려면 누군가 적어야 하게.

지속 산출물은 `58_relation_reach_test`다. 1·2번이 RLS 커버리지와 anon 쓰기 정책,
4번이 게이트 없는 DEFINER 뷰를 막는다. 3·5번은 **대조군**이다 — 앞 단언들이
빈 스키마에서 통과하는 것을 막으려고 "찾을 수 있다"를 먼저 증명한다. 0097을
빼고 reset하면 4번과 8번만 빨간불이 뜬다(확인함).

---

## 2026-08-06 상태 — 분석 화면이 생겼고, 등급 산정 버그 하나를 잡았다

마이그레이션 **0075**까지 클라우드 적용 완료. PR #110~#118 머지. 배포된 번들은
`workers.dev`에서 마커로 확인했다 (아래 「배포 확인법」).

### 등급 산정에서 나온 실제 버그 — 부재 시간을 미래까지 셌다 (0075)

0071이 부재를 `period_end - offline_since`로 쟀다. 기간은 2주다. **3일차에 열면
period_end가 11일 뒤**고, 그 11일이 전원 부재 시간에 더해졌다.

08-03 기간을 08-06에 읽은 실측:

```
offline_hours   min 0 · median 262.9 · max 683.4
83/95명이 7~30일 구간
```

262시간 = 10.9일 = **남은 기간 그 자체**. 1시간 전 접속자와 1주 잠수자가 구분되지
않았다. 등급 컷이 48시간이라 **95명 중 70명이 부재로 R1**이 됐다.

0075: `least(period_end, now())`. 끝난 기간은 불변, 진행 중인 기간만 현재까지.
scoring version **4**. 리빌드 후:

```
median 262.9h → 2.2h · 48h 미만 0 → 76명 · offline 강등 70 → 6명
등급 R1 70 → R1 16 · R2 36 · R3 28
```

**교훈**: 진행 중 기간에 `period_end`를 기준으로 쓰는 계산은 전부 의심한다.
`43_offline_hours_test`는 두 멤버 부재의 **비율**을 검사한다 — 잘못된 기준은 둘을
같은 양만큼 밀어올려서, 단일 기댓값은 언제든 통과하도록 조정될 수 있다.

### `players.current_alliance_id`는 "마지막으로 알던 연맹"이다 — 세 화면이 같이 틀렸다

0008 이후 모든 writer가 `coalesce(s.alliance_id, p.current_alliance_id)`로 쓴다.
**아무도 지우지 않는다.** 그래서 탈퇴자가 배지를 영구히 유지한다.

증거: 게임이 94명이라 하는 연맹에서 이 컬럼은 95행. 여분 1명은 명란젓고난(uid
1306723257000580), 2026-07-28 로스터 배치가 마지막 목격이고 그 뒤 26배치에 없다.

0067이 정확히 이걸 위해 있었는데(`alliance_roster_latest` = 최신 `al.rank` 응답 =
로스터 전체) 화면들이 안 읽고 있었다. 고친 곳:

- 연맹 페이지 `Members observed` (PR #113)
- 오버뷰 (PR #117) — **여기가 더 나빴다.** `memberIds`가 기여도 합계·온라인 수도
  결정해서 탈퇴 1명이 네 지표를 동시에 부풀렸다.

**다음에 멤버 집계를 쓸 때**: 로스터 배치를 먼저 읽고, 없을 때만 `players`로
떨어진다. 그 뷰는 member-gated라 로그아웃 상태에선 비어 온다.

### 분석 화면 — 연맹 탭 3개, 차트는 라이브러리 없이 SVG

`0073` 뷰 4개 + `0074` 뷰 1개:

| 뷰 | 접근 | 내용 |
|---|---|---|
| `alliance_power_history` | invoker | 모든 연맹의 전투력·순위·인원, 보드 캡처별 |
| `alliance_growth` | invoker | 연맹당 1행: 처음·마지막·변화·측정 기간 |
| `alliance_roster_history` | **DEFINER, member** | 로스터 배치별 집계 |
| `player_power_history` | invoker | 아무 플레이어의 관측 시계열 |
| `alliance_daily_contribution` | **DEFINER, member** | 게임 날짜별 기부·듀얼 총합 |

DEFINER인 둘은 0067의 이유다 — 0066이 `alliance_member_snapshots`를 officer로
좁혔고, 이 뷰들은 **집계만** 내보낸다(개인 식별 없음). `41_`/`42_` 테스트가 음성
케이스를 먼저 검사한다.

**`alliance_daily_contribution`이 반드시 맞춰야 하는 세 가지** — 각각 에러가 아니라
그럴듯한 오답을 만든다:

1. **게임 날짜는 02:00 UTC 시작.** 01:00 캡처는 전날 소속. 달력 날짜로 묶으면
   하루가 둘로 쪼개져 둘 다 반토막.
2. **보드는 누적된다.** 하루 총합은 그날 **최댓값**이고 캡처 합이 아니다. 08-05는
   43M·46M·52M·137M로 4번 읽혔다 — 합하면 279M, 실제는 137M.
3. **보드는 타 연맹을 포함한다.** `al.battle.rank.info`가 94명 연맹에 189행을
   준다. 우리 로스터에 나온 uid로 제한해야 한다.

차트는 `lib/series.ts`(순수 함수, 테스트 있음) + `components/LineChart.tsx`. 축을
두 개까지, 랭킹 축은 뒤집는다(6등이 9등보다 좋으니 올라가면 개선). 타워 레벨만
forward-fill한다 — 안 내려가는 값이라서. 전투력·순위·일간 총합은 진짜 떨어질 수
있으니 채우지 않는다.

### 데이터 현실 (2026-08-06 실측)

```
alliance_snapshots         580서버 221행 · 40연맹 중 12개만 2회 이상 관측
alliance_member_snapshots  우리 연맹 2,433행 · 26배치 · 20개만 94명 완주
player_snapshots           2,345행 · 373명 · 247명이 2회 이상
alliance_contribution      daily_donation 2일 · alliance_battle_daily 2일
rank_period_snapshots      5개 기간
player_ranks               23행뿐 (R4 11 · R5 1 · R3 7 · R2 4)
```

**짧은 배치를 탈퇴로 읽지 않는다.** 26배치 중 6개가 94명 미만이다. 전투력순 목록의
위쪽만 본 평균은 연맹 평균이 아니라 "강한 사람들"의 평균이다. `snapshot_complete`가
그걸 표시하고, 추이 화면은 그 6개를 빼고 **몇 개 뺐는지 화면에 쓴다**.

### 랭크 빈칸은 버그가 아니다

로스터 94명 중 **71명은 `player_ranks` 행 자체가 없다**. 수동 지정은 23명뿐.
그 71명 중 66명은 계산 등급이 있어서 셀에 흐리게 표시된다. 정렬은
`assigned_rank`가 아니라 **화면에 보이는 값**(`rank_shown`)으로 한다 — 저장 컬럼으로
정렬하면 71명이 계산값과 무관하게 뒤로 밀린다.

### 지금 남은 실제 제약 — 주간 보드 타이밍

08-03 기간의 `week2`가 여전히 null이다. 주간 측정 시점은 **일 01:59 UTC(= 월
10:59 KST)**, 02:00에 게임이 보드를 비운다. 그 직전에 연맹 기부·연맹 전투 주간
보드를 열지 않으면 그 주 기여도는 영구히 없다. week1은 08-06에 누군가 열어서
채워졌다 (실측: 기부 44,680 / 듀얼 2,239,192 같은 값).

**다음 기회는 8/10.** 이게 안 되면 등급이 presence와 전투력 성장만으로 결정된다.

### 오늘 나온 함정 넷

1. **`db push`는 원격 마지막 번호보다 앞선 마이그레이션을 그냥 건너뛴다.**
   0072가 안 올라간 상태로 0073이 올라가 있었고, 그 뒤 push가 "Found local
   migration files to be inserted before the last migration"만 뱉었다.
   `--include-all`이 필요하다. **`supabase migration list`로 `remote=''`를 먼저
   확인한다** — 함수가 안 올라간 걸 "리빌드하면 된다"고 잘못 진단했다.
2. **리빌드 버튼은 선택된 기간에만 적용된다.** 드롭다운 기본값은 *끝난* 기간 중
   최신(07-20)이다. 진행 중 기간(08-03)을 보려면 골라야 한다. 07-20에 v3를 만들고
   08-03은 v2로 남는 일이 실제로 있었다.
3. **`build_rank_period`는 서비스 키를 거부한다** (`42501 members only`). 스크립트로
   리빌드할 수 없다 — 로그인 세션이 필요하다.
4. **pgTAP에서 `scoring_version`을 고정하면 버전 올릴 때마다 깨진다.**
   `40_rank_cohort_test`가 v3를 고정해서 0075에서 무관한 이유로 5개가 `have: NULL`로
   실패했다. `rank_period_latest`(= 버전별 최신)를 읽게 바꿨다.

### 배포 확인법 — 날짜가 아니라 마커로

`https://darkwar-platform.hjyshane.workers.dev` (Pages가 아니라 Workers 자산).
`index.html`에서 `/assets/index-*.js`를 뽑아 문자열을 찾는다. 날짜는 Cloudflare가
**언제** 빌드했는지만 알려주고 **무엇을** 빌드했는지는 말해주지 않는다.

```
urllib으로 직접 받으면 403이다. User-Agent 헤더를 넣어야 200이 온다.
```

확인된 마커: `pinned-rank`(#118), `Shift-click to sort`(#118),
`Signed in as`(#117), `alliance_daily_contribution`(#116), `up is better`(#116),
`Against the server`(#114), `in progress`(#111).

---

## 2026-08-05 상태 — 막힌 것 셋 중 둘이 풀렸다

**캡처 링이 60초다** (전에는 5분). `dumpcap -b duration:60 -b files:1440` — 여전히
24시간 보관. 캡처→저널 지연 **실측 중앙값 71초, p90 120초** (전에는 5분 30초).
이게 routine의 `expect`를 성립시킨 변경이다. 디스크는 하루 ~84MB.

**저널이 122,620 관측 / 320 커맨드까지 왔다** (08-04 밤 47,846 → 무인으로 밤새).
세 작업 전부 `Running`, outbox pending 0, heartbeat 정상.

### 검증이 거짓 통과하던 버그 — 이게 가장 중요하다 (PR #104)

`commands_after(mark)`가 **rowid만** 봤다. 링 지연이 60초라 **탭 이전에 전송된
응답이 탭 이후에 저널에 쓰이고** 그 스텝의 증거로 인정됐다. 그래서 8개 연맹을
훑는 스윕이 "all steps verified"라고 보고하고 **실제로는 2개만 열었다**.

지금은 `captured_at`(전선 시각)도 같이 본다. **둘 다 필요하다** — rowid는 "이후에
쓰였나"(Windows 시계는 15.6ms 해상도라 같은 tick의 두 행을 못 가른다),
`captured_at`은 "이 탭이 원인일 수 있나". 같은 규칙이 콘솔 세션 카운트에도 쓰인다.

### routine — 좌표는 다 잡았고, 스윕은 아직 미완

`C:\DW_data\routines\alliance-rosters.json` (28탭, 1~8위). 확보한 사실:

- **`alliance.rank` 응답 하나에 연맹 100개가 다 온다.** 연맹 레벨 데이터(전투력·
  인원·맹주·서버)는 행을 하나도 안 눌러도 채워진다. 실제로 162/162 채워져 있다.
- **행 탭은 남의 연맹도 열린다.** 열면 팝업 → `멤버` 버튼 → `al.rank`(명단).
- **팝업 바깥 한 번** 누르면 두 팝업이 다 닫히고 목록으로 돌아온다. X 버튼 좌표로
  닫으려던 첫 버전은 실패해서 같은 연맹을 6번 열었다.
- **목록 맨 아래 고정 행(우리 연맹)은 버튼이 아니다.** 눌러도 안 열린다.
- **게임이 Android BACK을 무시한다.** 화면 자체의 뒤로가기(`76,1822`)를 써야 하고,
  월드맵에서 그 좌표는 `영웅` 버튼이다.
- **UI 트리로는 못 한다.** `uiautomator dump`가 2,122바이트 전부 빈 FrameLayout —
  Unity가 화면 전체를 SurfaceView 하나로 그린다. 좌표 아니면 OCR/템플릿 매칭뿐.

남은 것: 스와이프 거리 실측 → 9~100위. 실제 구멍은 **명단(9/162)과 플레이어
상세(5/1,305)**다.

### 보존 정책 — 정의가 정해졌다 (0070)

**"우리 사람"은 우리 연맹 멤버 스냅샷에 한 번이라도 나온 사람**이다. "현재 멤버"가
아니다 — 탈퇴 기록이 바로 지켜야 할 히스토리이고, 0067이 그 스냅샷에서 탈퇴를
파생한다. 현재 멤버로 정의하면 탈퇴 1주일 뒤에 탈퇴 증거가 사라진다.

`retention_report()`는 **기본이 세기만 하고**, `p_confirm := true`일 때만 지운다.
**아무것도 스케줄되어 있지 않다.** 켜기 전에 숫자를 먼저 보라.

건드리지 않는 것: `players`·`alliances`(삭제하면 사람이 입력한 등급이 cascade로
날아간다)·`player_names`·점수 관련 전부. 스냅샷 테이블만 대상이다.

크기는 급하지 않다 — 전체 ~47,000행 / 500MB 허용. 급한 건 증가율이다.

### 남은 막힌 것 하나

**`dw-capture` 재접속 멈춤.** 원인 미확인. `capture.health` 계측은 심어 뒀고, 운영은
dumpcap으로 우회 중이라 급하지 않다.

### 오늘 나온 함정 셋

**`is_own`은 트리거가 정한다.** 0031이 `alliance_member_snapshots.presence_redacted`
로 판정한다 — 은닉되지 않은 로스터는 우리 연맹뿐이라는 관찰. 픽스처에
`presence_redacted`를 안 주면 **기본값 false 때문에 남의 연맹이 우리 것으로 표시된다.**
39_retention_test가 이걸로 5개 실패했고, 마이그레이션이 아니라 테스트가 틀렸다.

**킬 스위치는 스텝 경계에서만 확인됐다** (PR #103). expect 대기 중이면 최대 150초
안 멈춘다. 사람이 앉았을 때 멈추라고 만든 장치인데 2분 반을 안 멈춰서 결국 pid로
죽였다. 이제 폴링 루프 안에서도 본다.

**pgTAP 절대 카운트는 시드와 충돌한다.** `count(*) from arena_entries`가 21을
반환했다. 픽스처 id로 범위를 좁혀야 한다.

---

## 2026-08-04 상태 — 클라우드에 올라갔고, 수집이 돌고 있다

**대시보드가 인터넷에 있다.** https://darkwar-platform.hjyshane.workers.dev
(Cloudflare Workers). Supabase는 `balpuvkvpiqvclibajje`, 리전 `us-east-2`
(오하이오 — 사용자 거주지 기준). 마이그레이션 66개, 실데이터 11,542행 이관 완료.

**로그인하지 않으면 아무것도 안 보인다.** 13개 관계 전부 `401` + `42501`
(권한 자체가 회수됨, 정책만 걸린 `[]`가 아니다). 0065가 호스팅 환경에서도
먹는다는 것이 이걸로 확인됐다.

**수집이 작업 스케줄러로 돌고 있다.** `DarkWar-Capture`(dumpcap 5분×288 링 —
**08-05에 60초×1440으로 바뀜, 위 참조**), `DarkWar-Ingest`(`ingest-dir` 60초 주기 —
**08-05에 min-age 20초·폴링 30초로 바뀜**), `DarkWar-Sync`. 등록 스크립트는
`C:\DW_data\register-tasks.ps1`(관리자 권한 필요). 절차와 확인법은
`docs/runbooks/continuous-collection.md` 맨 위.

**`dw-capture`는 쓰지 않는다.** 재접속 뒤 영구히 멈추는 버그가 있다(아래).

### 오늘 확인된 것 — 로스터는 화면을 열면 온다

```
al.rank 1건  2026-08-04T04:53:23
alliance_member_snapshots 94행 → 클라우드까지 전송됨
```

**연맹 센터 → 연맹 → 멤버**를 열면 나온다. 오늘 하루 "클라이언트가 요청을 안
보낸다"고 여러 번 결론 냈는데 **전부 틀렸다.** `dw-capture`가 게임 재시작
시점에 멈춰 있었고, 그때마다 "재시작하고 열어달라"고 요청했기 때문에 실험
자체가 무효였다. dumpcap 경로로 바꾸자마자 나왔다.

routine에 쓸 좌표(1080×1920, 이 기기 기준):

| 화면 | 좌표 |
|---|---|
| 셸터(도시로) | 985, 1845 |
| 연맹 센터 건물 | 1035, 945 |
| 연맹 버튼 | 695, 1063 |
| 멤버 탭 | 540, 172 |

**연맹 버튼 왼쪽 약 150px에 `레벨업`이 있다. 자원을 쓴다.** 좌표가 밀리면
그걸 누른다.

### 막힌 것 셋
> **08-05: 1번과 3번은 해결됐다. 2번만 남았다.** 맨 위 절을 먼저 읽어라.

**1. routine을 지금 짜면 돌아가지 않는다.**
> **해결됨.** 링을 60초로 줄이고 `timeout_seconds`를 150으로 올렸다 — 아래 세 선택
> 중 첫째. 실측 중앙값 71초, p90 120초. `dw-capture`로 돌아가지 않았다.

`dw-ui-worker`는 탭 후 **20초**
안에 저널에서 커맨드를 확인해야 다음으로 간다. dumpcap 경로는 저널 반영이
**5분 30초** 늦다(5분 파일 + `--min-age-seconds` 30). 모든 step이 검증 실패로
중단된다. 셋 중 하나를 골라야 한다 — 파일을 60초로 줄이고 `timeout_seconds`를
올린다 / 순회 때만 `dw-capture`를 띄운다(그 버그를 다시 들인다) / **디코더
멈춤을 고치고 `dw-capture`로 돌아간다(권장)**.

**2. `dw-capture` 재접속 멈춤.** 게임이 재접속하면 그 로그인 버스트까지
처리하고 영구히 멈춘다. 프로세스는 살아 있고 하트비트도 뛴다. 재현: 캡처를
띄운 채 게임을 두 번 재시작. 유력한 자리는 `SmartFoxStreamDecoder`의 프레임
길이 처리 — 상한도 resync도 없다. 상세는 continuous-collection 런북.

**3. 보존 정책 — 정의부터 정해야 한다.**
> **08-05에 해결됨. 0070이 정의와 `retention_report()`를 담고 있다. 아래는 그때의
> 우려이고, 어떻게 처리됐는지는 맨 위 「보존 정책」절에 있다.** 특히 셋째 항목의
> "정의가 없다"는 이제 틀렸다 — `own_player_ids`가 정의다.

사용자 요청은 "우리 연맹/플레이어는
3개월, 나머지는 7일". 그냥 지우면 안 되는 것들이 있다:

- **등급 점수는 덮어쓰지 않는다**(`CLAUDE.md`). 7일 정리가 `activity_facts`를
  지우면 과거 기간 점수의 근거가 사라진다. 점수 행은 남기고 원천만 지우는
  경계를 정해야 한다
- `rank_periods`가 참조하는 행은 그 기간이 닫히기 전에 못 지운다
- **"우리 플레이어"의 정의가 없다.** 연맹은 `alliances.is_own`으로 되지만
  플레이어에는 그런 표시가 없다. 현재 멤버만인지, 한 번이라도 멤버였으면인지,
  즐겨찾기 포함인지 — 탈퇴자 이력이 7일 뒤 사라지면 등급 비교가 깨진다
- 무료 티어 500MB, 현재 사용량은 아직 여유. **급하지 않으니 정의를 먼저
  정하고 마이그레이션 + pgTAP으로 한다**

### 오늘 고친 것 (PR #75~#84)

- cp949 인코딩 — pytest가 수집 단계에서 죽던 것
- 15.6ms 시계 해상도 — step 검증이 구조적으로 헛돌던 것
- 공개 사이트가 낯선 사람에게 "You are signed in"이라고 말하던 것
- `DW_ADB_EXECUTABLE`이 문서에만 있고 코드가 안 읽던 것
- 캡처 인터페이스 무검증
- **`dw-capture` 관측 40% 유실** — `prn` 콜백이 스니핑 루프에서 저널까지 썼다.
  `SegmentPump`로 분리, 측정으로 확인(45대27 → 42대42)
- `ingest-dir` 신설 — dumpcap 파일을 패킷 공급원으로

Node는 `.nvmrc`로 고정, 시간 동기화(w32time) 활성화됨.

### 조심할 것

**`scan-capture --discover-only`는 파서가 있는 커맨드를 숨긴다.** 오늘 결론
세 개가 이 플래그 하나 때문에 연쇄로 틀렸다. 로스터·기부·아레나를 찾을 때
쓰면 안 된다.

**`dw-capture`는 인터페이스 전체를 듣는다.** BlueStacks 인스턴스를 둘 돌리면
두 계정 트래픽이 한 저널에 섞이고, 저널은 `collector_id`로 출처를 새기므로
되돌릴 수 없다. 진단용은 반드시 `DW_SQLITE_PATH`를 따로 준다.

**살균 fixture가 아직 없다.** `darkwar_alrank.pcapng` → 93행 회귀 테스트는
저장소 밖 파일에 의존한다(없으면 건너뛴다). 커밋할 fixture를 만드는 것이 이
저장소의 방식이다(NFR-009).

---

## Windows에서 다시 시작하기 (2026-08-02 기준)

**전부 Windows에서 한다.** `CLAUDE.md`가 "Development is Windows-only. No WSL."
이라고 정해 둔 그대로다.

2026-08-02 세션은 그 결정에서 벗어나 WSL에서 진행됐고, 런북의 분담표까지
"데이터베이스·화면·테스트는 WSL"로 흘러 있었다. 되돌렸다.

**Windows에서 실제로 돌려본 것** (2026-08-02): Scoop으로 툴체인 설치 →
`supabase status` → `dw-collector renormalize` · `retry-outbox --already-sent`
· `sync`(11,542행) → `supabase test db` **329건 통과** → 합성 시드 제거 →
연맹 핀. 즉 데이터베이스와 수집기 경로는 검증됐다.

`pnpm install` · `pnpm dev`도 Windows에서 뜬다 (2026-08-02).

**2026-08-03에 나머지도 전부 Windows에서 돌렸다** — 아래 「Windows에서 처음
돌려서 나온 것」 참조. 이제 미검증으로 남은 것은 **라이브 캡처(`dw-capture`)와
ADB 순회뿐**이고, 둘 다 BlueStacks가 떠 있어야 한다.

설치는 Scoop이다 (`scoop bucket add supabase …` 후
`scoop install supabase/supabase main/uv main/gh main/gitleaks main/lefthook`).
pnpm은 corepack이 `package.json`의 핀(9.15.0)을 읽어 받는다. 버전은 WSL과
동일하게 떨어졌고 supabase만 2.111.0, uv만 0.12.1로 올라갔다 — 둘 다 저장소가
고정하는 값이 아니다.

두 창을 섞지 않는 것이 요점이다. 섞으면 저널 경로와 `.env`가 두 벌이 되고,
"왜 `sent=0`인가"의 답이 대체로 "다른 창에서 돌렸다"가 된다.

### 지금 상태 (2026-08-03)

- **PR #74까지 머지됐다.** 열린 PR도 이슈도 없고 작업 트리는 깨끗하다.
- 마이그레이션은 **0066**까지. `supabase db reset` 한 번이면 영웅 카탈로그 28기
  이름·병종·등급까지 전부 들어온다 — 0061이 그 일을 한다. **손으로 다시 입력할
  것이 없다.**
- 테스트: pgTAP **35파일 377건**, 대시보드 **221건**, pytest 전부 통과.
  **전부 Windows에서 확인했다** (2026-08-03).
- 0065가 기본값을 뒤집어서 **로그인하지 않으면 아무것도 안 보인다.** `anon`은
  `public` 스키마에 SELECT 권한 자체가 없고 REST 요청은 401을 받는다.

2026-08-03에 들어간 것 (#65~#74): 아레나 두 번째 리그, 플레이어 상세 페이지,
멤버 게이트(0065), 가입 코드 발급 화면, admin 설정 4그룹 재편과 Operations
그룹, 멤버 본인 로스터 이력(0066), 남아 있던 세 가지 정리, 백엔드 없이 화면만
보는 `index.dev.html`.

### Windows에서 처음 돌려서 나온 것 (2026-08-03)

`pnpm test`·`pnpm build`·`pytest`·`supabase test db`를 Windows에서 처음
돌렸다. **pytest가 두 가지로 깨졌고 둘 다 CI에는 안 보이는 것이었다.**

1. **`Path.read_text()`가 로케일 인코딩을 쓴다.** 한국어 Windows에서는 cp949라,
   베트남어 플레이어 이름이 든 fixture를 읽다가 `UnicodeDecodeError`로
   `test_resetweek.py` 수집 자체가 중단됐다. 같은 호출이 `cli.py`의 `replay`에
   있고, `extract-fixture`는 같은 방식으로 **쓰기**까지 한다 — 그쪽은 터지지
   않고 깨진 fixture를 남겼을 것이다. 이제 전부 명시적 utf-8이다.

2. **step 검증이 벽시계를 비교하고 있었다.** 이 머신에서 `datetime.now(tz=UTC)`를
   연속 6번 부르면 **전부 같은 값**이다(해상도 약 15.6ms). `created_at > ?`로
   거르던 `commands_since`는 같은 tick에 쓰인 행을 못 본다. runner 테스트 5건이
   그것만으로 실패했다. rowid watermark로 바꿨다 — 시계가 필요 없고, 원래
   테스트가 고정하던 "엄격히 이후" 의미도 그대로다. `insert or ignore`는 rowid를
   안 올리므로 **재생된 관측이 새 증거 행세를 못 한다**(테스트 추가).

   프로덕션은 대체로 무사했을 것이다 — 실제 응답은 탭과 같은 tick이 아니라
   수십 ms 뒤에 온다. 다만 "대체로"는 **탭이 확인 안 되면 멈추는 것이 존재
   이유인 장치**에 쓸 말이 아니다. 거짓 실패는 잘 열린 화면을 두고 "화면 상태를
   알 수 없다"며 순회를 중단시킨다.

**교훈은 하나다. Windows-only라고 적어 두는 것과 Windows에서 돌려 보는 것은
다르다.** 이 둘은 Linux CI가 구조적으로 못 잡는 종류였다.

**`arena_matches`는 0이다** (2026-08-03, `db reset` 직후 로컬에서 확인). 마이
그레이션에도 `seed.sql`에도 이 테이블에 넣는 INSERT가 없고 `services/`·`apps/`
어디에도 writer가 없다. 즉 클라우드에 올려도 0이다. **삭제 마이그레이션이 맞지만
그 작업의 대부분은 pgTAP 3파일(`01_conventions`·`05_notifications`·
`33_arena_member_only`)이 이 테이블을 편의상 스냅샷 테이블로 쓰는 것을 옮기는
일이다.** 별건으로 처리한다.

**아직 아무도 안 돌린 테스트가 남아 있다.** `tests/test_protocol.py`의 실캡처
테스트 4종이 `/mnt/c/...` 경로에 걸려 있다 — WSL 세션이 남긴 것이고, Windows에도
Linux CI에도 그 경로가 없어서 **어디서도 실행된 적이 없다.** 파일 자체는
`C:\DW_data\`에 있다.

### 처음 한 번

```powershell
supabase start
supabase db reset            # 0001~0061
pnpm install
pnpm --filter @dw/dashboard dev
```

`.env`에 `SUPABASE_URL` · `SUPABASE_SECRET_KEY` · `DW_COLLECTOR_ID`.
대시보드용 `VITE_*`는 없어도 된다(`lib/env.ts` 기본값이 로컬 스택).

admin 계정이 필요하면 `docs/runbooks/admin-access.md`.

### 실제 데이터를 넣는다

**저널은 관측이 도착한 그날의 파서 결과를 들고 있다.** 기존 저널은 0025·0029
이전 것이라 아레나 편성이 아예 없고 기여도가 135행뿐이다. 그래서 sync 전에
한 번 다시 정규화한다:

```powershell
uv run dw-collector renormalize --source C:\DW_data\collector.db --db .\data\fresh.db
uv run dw-collector retry-outbox --already-sent --db .\data\fresh.db
uv run dw-collector sync --db .\data\fresh.db      # sent=0 이 나올 때까지 반복
```

`renormalize`는 **원본을 읽기만 한다.** 결과는 별도 파일로 나가므로 실제 캡처
이력이 파서 버그에 상하지 않는다. 같은 관측을 다시 돌려도 idempotency_key가
원본 payload를 해시하므로(§11.2) sync는 **중복이 아니라 갱신**이다.

이 경로로 넣은 결과: 멤버 **93명**(HELLBOUND [CBFW], 실명), 아레나 편성
**3,998행**, 기여도 **1,615행**. (2026-08-02, **Windows에서 확인**)

### 합성 시드를 지운다

`supabase db reset`은 seed.sql의 합성 플레이어 20명과 연맹 하나를 같이 넣는다.
실데이터가 들어온 뒤에는 방해물이다 — 멤버 수가 113으로 부풀고, 그 연맹이
`roster_unredacted_seen`을 달고 있어서 **핀이 없으면 "우리 연맹"이 둘**이 된다.

```powershell
Get-Content supabase\drop-synthetic-seed.sql |
  docker exec -i supabase_db_darkwar-platform psql -U postgres -v ON_ERROR_STOP=1
```

`removed 20 players, 1 alliances`가 나오면 된다. 삭제 대상은 손으로 나열하지
않고 `pg_constraint`에서 뽑는다 — players를 참조하는 테이블이 16개인데 절반만
`on delete cascade`라, 손으로 적었다가 두 번 틀렸다.

### 연맹 핀을 박는다

`is_own`은 핀이 있으면 핀, 없으면 "접속정보가 안 지워진 로스터를 본 연맹"으로
정해진다([0032](../supabase/migrations/20260728000032_app_settings.sql)). 후자는
**수집 계정을 따라다니고 되돌리는 코드가 없다.** 수집 계정이 다른 연맹을 한 번
훑으면 그대로 붙는다. Admin 설정에서 HELLBOUND [CBFW]를 고정하면 끝이다.

수집 계정이 바뀌어도 **연맹만 같으면** 나머지는 그대로다. 연맹 밖 계정이면
게임이 로스터의 접속 정보를 지우고(`presence_redacted`), [0024](../supabase/migrations/20260728000024_member_presence.sql)의
접속 이력이 **에러 없이 비어버린다** — Activity Score의 48시간 오프라인 규칙이
거기 얹혀 있다. 코드로 우회할 수 있는 종류가 아니다.

### 알아둘 것 하나 — 브라우저 검증 스킬은 리눅스용이다

`.claude/skills/run-dashboard`의 **브라우저 절만** WSL 전용이다
(`apt-get download`, `dpkg -x`, `LD_LIBRARY_PATH`). Windows에서는 그 과정이
필요 없다 — `npx playwright install chromium` 하나면 되고 `executablePath`도
안 준다. 스택 기동·픽스처 적재·세션 만들기는 양쪽 같다. 스킬 첫머리에 그렇게
적어 뒀고, **Windows 경로는 아직 아무도 돌려보지 않았다.**

### 다음에 할 일 둘 (2026-08-03에 정해졌다)

> **2026-08-06 정정.** 1번은 끝났다 — 2026-08-04에 실행했고, 호스트는 Pages가
> 아니라 **Cloudflare Workers 자산**이 됐다(`darkwar-platform.hjyshane.workers.dev`,
> `apps/dashboard/wrangler.jsonc`). `*.pages.dev`는 존재하지 않는다.
> 2번은 좌표까지 잡혔고 스윕(9~100위)만 남았다 — 맨 위 「2026-08-06 상태」 참고.

**1. 클라우드에 올린다.** 절차는 `docs/runbooks/going-public.md`. 실행한 뒤에
「실제로 이랬다」 절들을 그 문서에 추가했다 — 특히 `db push`가 번호를 건너뛰면
조용히 안 올린다는 것.

**2. ADB 화면 순회.** 이것만 하면 상시 수집이 완성된다. 절차는
`docs/runbooks/continuous-collection.md`에 있고, **좌표는 저장소에 없다** —
기기마다 다르고, 지어낸 좌표가 든 스크립트는 없느니만 못하다. 실제 좌표는
`C:\DW_data\routines\*.json`에 있다(gitignore). 문서에 찾는 법이 있다.
운영 형태는 **24시간 무인**으로 정했다.

여기에 하나 걸리는 것이 있다. `idle.py`의 예의 게이트(FR-COL-009)와 가장 중요한
수집 시각이 부딪힌다 — **일 01:59 UTC는 한국시간 일요일 10:59**라 사람이 PC
앞에 있을 시간이고, 게이트에 걸리면 순회가 통째로 중단된다. 그 결과는 화면에
"캡처 없음"이 아니라 **전원 낮은 점수**로 나온다. 현재 idle 정책은 runner 단위
전역이라 routine별로 끌 수 없다. `DW_UI_MIN_IDLE_SECONDS=60`으로 시작하고,
실제로 일요일에 걸리는지 보고 나서 routine별 오버라이드가 필요한지 판단한다.

대시보드 쪽은 이미 됐다: `dw-sync`가 10초마다 하트비트를 쓰고, 1분 침묵이면
제목 옆이 `Real-time sync stopped`로 바뀐다. 양쪽 상태 모두 브라우저로 확인했다.

---

## 이어서 할 일 (우선순위)

캡처는 `C:\DW_data\re-capture.pcapng`에 있다.

### 0-a. 상시 수집 — 대시보드 쪽은 됐고, 순회는 미검증 (2026-08-02)

`dw-sync`가 10초마다 하트비트를 쓰고, 뷰 `sync_status`가 **마지막 하트비트 시각
하나만** 공개한다. 1분 침묵이면 대시보드 제목 옆이 `Real-time sync stopped`로
바뀌고, **데이터는 마지막으로 받은 것을 계속 보여준다.** 양쪽 상태 모두 브라우저로
확인했다.

**ADB 화면 순회는 확인하지 않았다** — Windows·BlueStacks가 필요하다. 좌표는
기기마다 다르므로 문서에 적지 않았다(지어낸 좌표가 든 스크립트는 없느니만 못하다).
절차는 `docs/runbooks/continuous-collection.md`.

### 0. 등급 산정 — 계산은 끝났고, 정확도가 캡처 일정에 걸려 있다 (2026-08-02)

2주마다 멤버 등급(R1~R3)을 산정하고 **직전 기간 대비 변동만** admin 리포트로
보여준다. 사용자가 그걸 보고 **게임 안에서** 직위를 조정한다.

| 무엇 | 언제 재나 | 왜 그 시각인가 |
|---|---|---|
| 공헌도 · 주간 듀얼 | 각 주 마지막날 **01:59 UTC**, 2회 합산 | **02:00에 게임이 주간 보드를 비운다.** 1분 늦으면 전원 0점 |
| 전투력 | 기간 양 끝 **02:00 UTC** | 전투력은 리셋되지 않는다 |

기간은 `rank_period_start()`(0050)가 정하고, **기존 `reset_week_start` 위에**
얹혀 있다 — 월요일 02:00이 두 군데에 적히면 언젠가 갈라진다. 에폭은
`2026-07-27T02:00Z`이고 **게임이 스스로 부른 경계**다(`user.get.arena.info`의
week_start).

**가중치는 원값이 아니라 연맹 내 백분위에 걸린다.** 연맹 평균이 기부 48,684 대
듀얼 3,502,889이라, `0.4/0.6`을 원값에 걸면 기여가 19,474 대 2,101,733이 되어
**기부는 없는 것과 같다.** 각 항목을 먼저 순위로 바꾼 뒤 가중치를 준다.

등급은 **비율**로 자른다(기본 R3 20% / R2 50%). 절대값은 기록이 쌓이기 전엔 정할
수 없고, 전원의 수치가 오르면 낡는다. **48시간 이상 오프라인은 무조건 R1**이고
행에 `tier_reason`으로 `score`/`offline`을 남긴다 — 강등된 사람이 물을 것이 그
차이다.

**스케줄러는 없다.** 경계가 고정이고 값이 그 경계로 잘려 있어 언제 열든 같은
리포트가 나온다. 없어서 아쉬운 것은 답이 아니라 **알림**이다.

**남은 위험은 하나뿐이고 코드가 아니다.** 이 리포트의 정확도는 **수집기가 일요일
01:59 근처에 실제로 돌았는지**에 달렸다. 목요일이 마지막 캡처면 3일치가 빠지고,
그건 화면에 "캡처 없음"이 아니라 **낮은 점수**로 보인다. ADB로 주 2회(일 01:59 ·
월 02:00)만 확실히 돌게 해두면 해결된다. 상시 가동 논의가 여기서 나왔다.

### 1. 기부 일간·주간 (요청 6번) — **완료 (2026-08-01)**

**주간은 별도 커맨드였다** — `get.week.alliance.donate.rank`. 같은 pcap에
일간과 37초 간격으로 들어 있고 payload는 `{uid, score, updateTime}`으로 일간과
완전히 동일하다. 화면 기록과 대조해 확정했다:

| 보드 | 상위 3명 (payload를 같은 캡처의 `al.rank`로 이름 조인) |
|---|---|
| 일간 (83명) | Vina-BảoPhan 14,500 · Baby Nur 11,980 · đắng 11,980 |
| 주간 (90명) | Bored101 86,440 · VINA ăn cướp 80,820 · R3HAB 80,640 |

이름과 순서가 화면 기록과 전부 일치한다. 기록의 `86400`·`90640`은 각각
`86440`·`80640`의 필기 오류였다.

들어간 것: 파서(두 커맨드가 한 정규화기를 공유하고 **기간은 커맨드 이름에서**
온다), 마이그레이션 0029(`weekly_donation` + `player_contributions.
weekly_donation_score`), 대시보드 `Weekly Donation` 열, fixture 3종, pgTAP 3건,
파서 테스트 8건.

**듀얼과 달리 기부는 두 보드 모두 우리 연맹만 담는다** — 90·83명 전원이 같은
캡처의 `al.rank` 94명 안에 있고 바깥 사람은 0명이다. 그래서 아래 3번(상대 연맹
제외)은 **듀얼에만** 해당한다.

로컬 Supabase에 fixture를 replay→sync해 끝까지 확인했다: 스냅샷 143행(일간 53 +
주간 90)이 들어가고 두 값이 **서로 다른 컬럼에 서로 다른 시각으로** 앉는다.

### 2. 메일 수신 → Discord 계정 연결 (§6.2) — **안 만들기로 했다 (2026-08-03)**

> 아래는 왜 막혀 있었는지의 기록이다. 기능 자체를 사용자가 빼기로 했으므로
> 이 캡처는 더 이상 필요하지 않다.

인수인계에 "같은 pcap에 `북경오리구이`가 보낸 메일 수신이 들어 있다"고 적혀
있었으나 **사실이 아니다.** `re-capture.pcapng`에 `push.mail`이 **0건**이다.
들어 있는 메일 계열은 전부 시스템 발신이거나 빈 응답이다 —
`chat.get.system.mails`(집결 결과·자원 배달), `get.del.mail.list`,
`get.bind.mail.reward`, 그리고 채널 두 개가 모두 빈 `push.share.msg`.

`push.mail`의 **shape 자체는** 예전 스윕에서 확보돼 있다(`fromUser`/`toUser`가
UID, `contentsArr`가 본문). 없는 것은 **실제 수신 사례**다. 그러니 이 항목은
"pcap을 다시 열어보면 된다"가 아니라 **다른 계정에서 메일을 보내면서 캡처를
켜야 하는** 일이다. 캡처 백로그 2번.

### 3. "우리 연맹"을 스키마가 알게 되었다 — 2026-08-01

이 항목은 오래 "판단이 필요하다"로 남아 있었는데, **설정값 없이 풀렸다**(0031).

`al.rank`가 이미 구분해 준다. 게임은 **내가 속하지 않은 연맹의 접속 정보를
가린다** — 전원 online, `offLineTime` 0, `pointId` 0으로 온다. 파서가 그걸
`presence_redacted`로 표시한다(FR-CORE-003, v0.4.1로 검증됨). 즉 **접속 정보가
진짜로 온 로스터 = 수집 계정이 속한 연맹**이다. 설정이 아니라 관측이다.

`alliances.is_own`에 기록한다(`alliance_member_snapshots`는 member 전용이라
로그아웃 방문자가 못 읽는다. `alliances`는 공개 테이블이다). 한 번 true가 되면
내려가지 않는다 — 남의 연맹 로스터를 나중에 열어도 우리 표시는 유지된다.

**남은 진짜 항목**: 듀얼 일간·주간은 상대 연맹 선수도 포함한다(165 = 우리 93 +
상대 72). 상대 72명도 `player_contributions` 행을 갖는다. 값 자체는 틀리지 않다
(그 사람의 실제 점수다). 이제 `is_own`으로 걸 수 있으므로, **연맹 합계를 내는
화면을 만들 때** 처리하면 된다. 지금 화면에는 안 나온다.

### 4. 캡처가 필요한 것 — **없다 (2026-08-03)**

- ~~**2번** — 메일 수신(§6.2 Discord 연결).~~ **사용자가 안 만들기로 했다**
  (2026-08-03). 캡처 백로그에서 내린다. 다시 하고 싶어지면 위 2번 항목에 필요한
  것(다른 계정에서 메일을 보내면서 캡처)이 적혀 있다.

**0-b번은 캡처 없이 닫혔다 (2026-08-02).** 30초짜리 화면 확인을 요청해 뒀었는데,
답은 이미 저널에 있었다 — 로그인 응답 `init`의 `userHero`가 수집 계정 영웅 27기를
평문으로 주고, `rankLv` 6(=게임 5성, 최고)인 23기는 `stage` **키가 아예 없으며**
그 아래 4기만 값을 갖는다. JSON의 부재는 진짜 부재이므로 `stage`는 **다음 성급까지의
승급 단계**이고, 최고 성급에는 그런 것이 없다. army 블롭 4,260유닛도 같은 말을
한다(최고 성급 2,196기 전부 0). 자세한 것은 백로그 0-b.

여기서 얻을 교훈은 필드 하나가 아니다. **캡처를 더 요청하기 전에 이미 가진
응답부터 다시 읽는다.** 같은 `init` 응답이 영웅 카탈로그(0037)의 id 28개도 줬고,
둘 다 새 캡처 계획을 세우던 중에 나왔다.

한편 이 확인 과정에서 표시 버그가 하나 드러났다. payload 성급은 게임보다 1 크고
그 사실은 디코더 주석에 적혀 있었지만 **화면은 변환 없이 그리고 있어서**, 만렙
영웅이 게임에 없는 6★로 나오고 있었다. `starsShown`으로 고쳤다.

---

`CLAUDE.md`(재론하지 않을 결정), `docs/bootstrap-plan.md`(원래 계획),
`docs/capture-backlog.md`(무엇을 캡처해야 하는가)가 함께 읽을 문서다.

---

## 한 문장

> **2026-08-06 기준 한 문장**: 수집·스키마·대시보드가 클라우드에서 실 데이터로
> 돌고 있고, 남은 것은 **캡처 스케줄**이다 — 등급 리포트의 정확도가 순회가
> 일요일 01:59 UTC를 지키는지에 달려 있고, 아직 지켜진 적이 없다.
>
> 아래 문단은 2026-08-01 시점 기록이다.

수집기와 스키마는 실 캡처로 검증됐다. **대시보드는 2026-08-01에 처음으로 실
데이터를 봤다** — 로컬 Supabase에 실 fixture를 적재하고 패널이 던지는 쿼리를
그대로(익명 키로) 실행하는 방식이다. 브라우저로 띄워본 것은 아직 아니므로
렌더링·Realtime은 여전히 미검증이다.

**WSL에서도 Supabase 스택은 돌아간다** (2026-08-01 확인). 돈다는 것과 거기서
해야 한다는 것은 다르다 — `CLAUDE.md`는 Windows-only이고, 2026-08-02에 문서를
전부 그쪽으로 되돌렸다(창은 PowerShell 하나). 아래 "Windows에서 가장
먼저 할 일"은 pgTAP이 Windows 전용이라는 전제로 쓰였는데 그렇지 않다 —
`supabase start` · `db reset` · `test db` · `gen types` 전부 WSL에서 돈다.
Windows여야 하는 것은 **라이브 캡처(Npcap·BlueStacks)뿐**이다. 0029는 WSL에서
`supabase db reset` 후 pgTAP 18파일 216건 전부 통과시킨 뒤 커밋했다.

---

## 사용자 요청 10건의 상태

| # | 요청 | 상태 |
|---|---|---|
| 1 | 타이틀 → Dark War dashboard | 완료 (#38) |
| 2 | 멤버 페이지 접근 제한 | 완료 (#41 RLS, #42 인증) |
| 3 | 필터·정렬·검색 | 완료 (#39) |
| 4 | 즐겨찾기 | 완료 (#43) |
| 5 | 듀얼 포인트 일간·주간·라운드 | **완료** — 세 보드 확정·분리, 열 3개 (0028) |
| 6 | 기부 일간·주간 | **완료** — 주간은 별도 커맨드 `get.week.alliance.donate.rank`. 열 2개 (0029) |
| 7 | 서버 드릴다운 + 서버 즐겨찾기 | 완료 (#44) |
| 8 | 아레나 영웅 정보 | 완료 — 편성·병종·전용무기·장비·스킬·병사수 (0025) + 승급 단계 `stage` (0038). 영웅 이름은 카탈로그(0037)에서 온다 |
| 9 | 아레나 서버·연맹 표시 | 완료 (#40) |
| 10 | R4/R5 코드 입력 | 완료 (#42, 2번과 통합) |

6자리 패스코드는 사용자와 상의해 **빼기로 했다**. 경계가 RLS로 내려간 뒤에는
인증된 세션 위의 UI 잠금이 단계만 늘리고 보장은 늘리지 않는다.

---

## Windows에서 가장 먼저 할 일 — 옛 기록

> 이 절은 2026-08-01 시점의 것이고, 여기 적힌 "실 데이터로 한 번 돌린다"는
> 2026-08-02에 끝났다(문서 맨 위 참조). 절차 자체는 아직 맞으므로 남긴다.

### 1. 실 데이터로 대시보드를 한 번 돌린다

```powershell
supabase start
supabase db reset          # 0001~0031 전부 적용
uv run dw-capture           # 별도 창, Npcap 필요
uv run dw-sync              # 별도 창
pnpm dev
```

`.env`에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DW_COLLECTOR_ID` 필요.
대시보드용 `VITE_*`는 `apps/dashboard/.env.local`(gitignore됨). 없어도 된다 —
`lib/env.ts`의 기본값이 로컬 스택을 가리킨다.

멤버 역할을 받으려면 admin으로 코드를 발급하고(`docs/runbooks/admin-access.md`)
`#/login`에서 입력한다.

**Windows에서 새로 알게 될 것은 실 캡처가 붙었을 때의 값뿐이다.** 화면은
2026-08-01에 WSL에서 헤드리스 크로미움으로 전부 확인했다 — 렌더링, 폭, sticky
열, RLS 경계, Realtime까지(아래 "브라우저 검증" 절).

**이 절차는 `.claude/skills/run-dashboard/`에 스킬로 들어 있다.** 스택 기동부터
fixture 적재, member 세션 만들기, 헤드리스 크로미움 구하기(이 머신에는
`chromium-cli`가 없고 Playwright는 프로젝트 의존성이 아니다), Realtime 확인까지
그대로 따라갈 수 있게 적혀 있다. 다시 확인할 일이 생기면 처음부터 알아내지 말고
그것을 쓴다.

**멤버 탭이 비어 보이면 `alliances.is_own`부터 본다.** 0031이 그 표시를
`al.rank` 응답에서 세우는데, 로스터를 한 번도 안 찍었거나 남의 연맹 것만 찍었으면
아무 연맹도 우리 것이 아니고 탭이 빈다. 확인:

```sql
select current_name, current_code, is_own from public.alliances where is_own;
```

---

## 브라우저 검증 — 2026-08-01에 처음으로 했다

**대시보드는 목 데이터로만 검증돼 있었다.** 2026-08-01, 실 fixture 전량(적재
2,975행 · 플레이어 557명)을 로컬 Supabase에 넣고 **헤드리스 크로미움으로 네 탭을
전부 열었다.** 아래는 그 결과다.

| 확인할 것 | 결과 |
|---|---|
| 렌더링 · 콘솔 에러 | 네 탭 전부 렌더, **에러 0건** |
| `Alliance Battle` 열 | 해결됨(0028). 아래 참조 |
| 기부 두 열 | **화면에서 확인됨.** 로그인 시 값이 찬다 |
| 크로스서버 보드 6종 | 150행 렌더 |
| 아레나 연맹 열 | 100행 + 편성 F/S/R 배지까지 렌더 |
| 100명 규모 테이블 | **본문은 가로로 안 밀린다**(1440·390 둘 다). 표만 자기 컨테이너에서 스크롤하고, 이름 열은 390px에서 끝까지 밀어도 `position: sticky`로 붙어 있다 |
| Realtime 갱신 | **확인됨.** 스냅샷을 하나 넣자 **리로드 없이** 셀이 36,370 → 999,111로 바뀌었다 |

**그리고 버그 두 개가 나왔다. 둘 다 목에서는 원리적으로 안 보이는 것이었다.**

### 멤버 탭이 멤버를 안 보여주고 있었다 (0031)

`RosterPanel`이 `players`를 전투력순 50명으로 뽑을 뿐 연맹 필터가 없었다.
`players`에는 수집기가 본 모든 사람이 쌓인다 — 실 데이터로 **557명 대 멤버
93명**이고, 우리 멤버는 전투력 **91~557위**다. 상위 50에 멤버가 **한 명도 없어서**
기여도 5열이 로그인해도 전부 `—`였다. 목은 6명 전원이 멤버라 이 구분이 없었다.

### 로스터 투영이 남의 시계로 게이트되고 있었다 (0030)

`apply_roster_summary`가 쓰는 모든 열을 **공유 `last_seen_at` 하나**로 막는데,
그 컬럼은 `apply_contribution_summary`가 올린다. 그래서 기부 관측이 로스터보다
나중이면 로스터 투영이 **통째로 거부된다** — 이름·전투력·HQ·킬·연맹이 같이.

실측: 93명 전원이 로스터 `captured_at`(2026-07-27T21:29Z) 이상의 `last_seen_at`을
이미 갖고 있었고, **93/93이 거부됐다.** `current_alliance_id`가 붙은 사람은 1명뿐.

**적재 순서에 따라 결과가 갈린다.** `al.rank`를 먼저 넣으면 붙고, 기부를 먼저
넣으면 영영 안 붙는다. 이건 0015가 이름 붙이고 0028이 기여도 *안에서* 없앤 함정
("각자 자기 타임스탬프로 게이트한다")이 소스 *사이에서는* 남아 있던 것이다.
`players.roster_observed_at`을 줘서 고쳤고, 되던 순서/깨지던 순서 둘 다
`19_roster_own_clock_test.sql`이 고정한다.

### `Alliance Battle` 열 — 해결됨 (2026-08-01)

세 보드(`type` 0 일간 / 1 주간 / 2 라운드 총합)를 라벨 캡처로 확정하고
`contribution_type`을 분리했다(0028). 대시보드도 열 3개로 나뉘었다. 아래는 그
경위 기록이다.

#### 이전 서술 — 파서는 있고, 값의 의미가 미확정이었다

**2026-08-01 정정 (2차).** 이 절은 원래 "파서가 없다"고 적혀 있었다. 틀렸다.
파서는 2026-07-30에 `feat-battle-rank`에 작성돼 있었고 **푸시되지 않아** 다른
머신에서 보이지 않았을 뿐이다. 리베이스해서 머지했다.

- 스키마 · 트리거 · 대시보드 열 — 있음
- 파서 `normalize/alliance_battle_rank.py` — **있음** (마이그레이션 0023)

남은 문제는 미구현이 아니라 **모호함**이다. `al.battle.rank.info`는 같은 162명을
두 번 준다(`type` 0과 1, 상위 1인 점수 2.6M 대 13.7M). 의미를 모르므로 `variant`
컬럼에 기록만 하고 해석하지 않는다.

그런데 요약 트리거(0020)는 `alliance_battle` 중 **가장 최근 것 하나**만 고르고,
두 variant는 같은 캡처에서 같은 `captured_at`으로 들어온다. 즉 **어느 쪽이 그 열에
표시될지 정해져 있지 않다.** 실 데이터를 붙이면 열이 채워지긴 하지만 **그 숫자는
아직 믿을 수 없다.**

`docs/capture-backlog.md` 0번 캡처로 variant를 확정한 뒤, 트리거를 variant로
좁히거나 열을 일간/주간 둘로 나눠야 한다. 그때까지는 스냅샷에 이력만 쌓는다 —
전투 리포트와 같은 "적재는 하되 해석은 미룬다" 방식이다.

---

## 막혔던 3건의 정확한 사유

### 5·6번 — 기여 일간·주간 — **둘 다 끝났다 (2026-08-01)**

한때 "게임이 점수 하나만 주므로 스냅샷 차이로 유도한다"고 판단했다. **그
판단은 틀렸다.** 사용자가 게임 화면에 일간·주간이 각각 나온다고 확인했고,
가진 fixture가 `get.daily.alliance.donate.rank` **하나뿐**이라 그렇게 보였을
뿐이다. 커맨드 이름부터 daily다.

유도하지 말고 캡처한다. 게임이 알려주는 값을 추정할 이유가 없고, 유도값은
캡처 주기에 정확도가 묶인다.

**그리고 실제로 그랬다.** 듀얼은 한 커맨드의 `type` 0/1/2였고(0028), 기부는
아예 **두 커맨드**였다(0029). 즉 두 기능이 서로 다른 모양으로 같은 것을 준다 —
어느 쪽도 다른 쪽을 보고 추측할 수 있는 게 아니었다.

**여기서 얻을 교훈**: fixture가 하나뿐인 것은 "게임이 하나만 준다"는 증거가
아니다. 두 번 다 그 착각이 원인이었다. 캡처를 한 번 더 훑는 비용이, 유도값을
스키마에 굳히는 비용보다 항상 싸다.

### 8번 — 아레나 영웅 정보

`army` 필드는 실 캡처에 **존재한다**. `sanitize.py`가 fixture에서 `""`로
지운다(`sanitize_user_get_arena_info`). 아직 아무도 디코딩하지 않았고
`terms.ts`도 "opaque lineup blob"이라 적어뒀다.

슈터/파이터/라이더 조합이 `careerType`에 있을 것으로 기대했으나 **아니다** —
al.rank 93명 전원과 아레나 엔트리 전원이 `careerType=0`, `careerPos=0`,
`careerLv=0`이다. 살균 대상이 아니므로 실제 값이 0이다. 조합 정보는 `army`
안에 있거나 다른 커맨드가 필요하다.

**2026-08-01 해결 — `army`는 열렸고, 영웅 정보가 들어 있다.**

실 저널은 `C:\DW_data\collector.db`(과 `probe.db`)다.
캡처를 새로 찍을 필요가 없었다. `army`는 **base64 protobuf**이고 `.proto` 없이
와이어 포맷만으로 완전히 파싱된다(전투 리포트의 `battleContent`와 달리 여기서
막히지 않는다).

아레나 엔트리 **800건**을 파싱한 결과:

| 필드 | 의미 | 근거 |
|---|---|---|
| 2 (repeated) | 편성 유닛 | **모든 편성이 정확히 5기**(800/800) |
| 2.1 | `heroId` | 값 공간이 `rank.get.by.range` type 49의 `heroId`와 **일치**(1004·21001·33003·40001…) |
| 2.4 | 슬롯 | 편성마다 1~5가 **정확히 한 번씩** |
| 2.12 | **병종** | 값이 {1,2,3} 세 개뿐이고 **영웅마다 완전히 고정**(21개 영웅, 모호한 것 0건) |
| 2.2 | **영웅 레벨** | `army.info`의 `heroLevel`(103)과 일치 |
| 2.7 | 레벨 **상한** | 전부 200. `army.info`의 `maxLv`와 일치 |
| 2.8 | 성급 | {3,4,5,6}. 게임 표시보다 **1 크다** — 게임은 5성이 끝이므로 payload 6이 최고다. 이 오프셋은 이제 `protocol/army.py` 주석에도 있다 |
| 2.13 (repeated) | 장비 4종 | id + 레벨(1~100) + 단계(1~36). 뒤 둘은 선택적 |
| 2.15 | **전용 무기** | 안쪽 id가 그 유닛의 heroId와 **1730/1730 일치**. 레벨 3~41 |
| 2.5 (repeated) | **스킬** | 영웅당 3~5개, 레벨 1~30. id가 영웅별로 묶임 |
| 1.3 | **병사수** | 엔트리 전투력과 상관 0.85 |
| 2.16 | 영웅 전투력 | 5기 합이 엔트리 `power`의 5~15% — 계정 총합이 아니라 **출전 5기의 값** |

**한때 2.7을 레벨로 읽어 전원 200을 저장했다.** `army.info`가 `heroLevel`과
`maxLv`를 둘 다 주는데 대조하지 않은 탓이다. 실 데이터에서 이제 1~117로 분포한다.

`careerType`이 아니라 **`army` 안 2.12가 슈터/파이터/라이더 축**이다. 보강
증거로 `40001`/`40002`/`40003`이 각각 1/2/3으로, 한 영웅 계열에 병종이 하나씩
있다.

**라벨 확정 (2026-08-01, 사용자 확인)**: `1 = 파이터`, `2 = 슈터`, `3 = 라이더`.

페이로드에는 없는 정보이므로 게임 화면을 근거로 삼았다. 교차 검증도 통과한다 —
수집 계정 본인 편성은 슈터 3기 + 파이터 2기인데, 사용자가 독립적으로 "주력 병종은
3기 이상인 쪽"이라고 말한 것과 일치한다.

관측된 영웅 24종 전체 매핑 (4,260유닛 기준, 한 heroId가 두 병종으로 보인 적 0건):

| 병종 | heroId |
|---|---|
| 파이터 (1) | 1002 · 1004 · 1006 · 1007 · 1008 · 1011 · 1017 · 12001 · 33005 · 40001 |
| 슈터 (2) | 1003 · 1018 · 1019 · 11001 · 21001 · 40002 |
| 라이더 (3) | 1012 · 1016 · 22001 · 22002 · 22003 · 33001 · 33003 · 40003 |

id 접두사로는 병종을 알 수 없다(`33001`·`33003`은 라이더인데 `33005`는 파이터).
`4000x` 계열만 1·2·3이 하나씩이다. **매핑은 관측으로만 유지한다.**

**영웅 카탈로그는 28종이다 (0037).** `init.userHero`가 수집 계정 보유 27기를 주고,
`33005`는 거기 없이 남의 편성에서만 6번 나온다 — **한 계정의 보유 목록은 전체
카탈로그가 아니다.** 위 24종에 없는 4기(`1015`·`1021`·`32001`·`33002`)는 보유
중이지만 아무도 편성에 낸 적이 없어 병종이 비어 있고, 게임 화면을 보고 admin
페이지에서 채우면 된다.

**전용무기 성급은 페이로드에 없다 — 레벨에서 유도한다.** `2.15` 서브메시지는
필드가 둘뿐이고(1 = heroId와 같은 무기 id, 2 = 레벨) 1,904건 전부 그렇다. 5레벨이
한 단계이므로 `블록 = 레벨 ÷ 5`, `단계 = 레벨 % 5`다. 근거는 사용자가 게임에서
읽은 Cyrus의 전용무기 **4성 2단계**이고 그 무기의 레벨이 **22 = 4×5+2**로 정확히
맞는다.

**무기도 5성이 끝이고, 그 위는 각이다**(사용자 확인). 한때 이 코드가 6성·7성·8성을
찍고 있었는데 게임에 없는 등급이다. 다섯 번째를 넘는 블록은 성급이 아니라 각으로
센다. 레벨 분포 2~41 중 **1,904개 가운데 77개가 5성을 넘는다.**

**각 번호도 확인됐다 (2026-08-02).** 사용자가 레벨 30짜리 전용무기를 열었고
**각 1**로 보였다 — 5레벨 리듬이 각에서도 이어진다. 이제 이 유도에 추측이 없다.

**장비 각도 페이로드에 없다 — `promote`에서 유도한다.** 장비 서브메시지는 관측
17,028건 전부 필드가 셋뿐이다(id, 레벨, promote). 장비는 레벨 100까지 오르고
그다음 **5각까지** 승급한다(사용자 확인).

레벨 100인 장비만 걸러 보면 promote가 **11 · 16 · 21 · 26 · 31 · 36**에 몰리고
그 사이 값들은 훨씬 드물다. 공차 5의 등차수열이고 **36이 전 구간 최대값**이다.
`(36 − 11) ÷ 5 = 5`로 사용자가 말한 5각 상한과 맞는다. 상위 10위권만 보면 16 이상
값이 거의 전부 그쪽에 있다 — 트랙을 끝까지 간 사람들이다. 그래서
`각 = (promote − 11) ÷ 5`, `단계 = (promote − 11) % 5`로 읽는다.

**확인됐다 (2026-08-02).** 레벨 100 · promote 11인 장비가 게임에서 **각 0**으로
보였다. 11이 이 계산이 걸려 있는 기준점이다. 레벨 100인데 promote가 11 미만인
장비는 여전히 아무도 안 봤고 지금은 그것도 각 0으로 읽는다 — 틀렸다면 "아직 각을
안 올렸다" 쪽으로 틀리는 것이라 해롭지 않다.

**`init`이 영웅에 대해 주는 것 (2026-08-02 정리)**

| 필드 | 정체 | 근거 |
|---|---|---|
| `userHero[].lev` | 영웅 레벨 | `army.info`의 heroLevel과 5기 일치 |
| `userHero[].rankLv` | 성급, **화면보다 1 큼** | 6 = 게임 5성 |
| `userHero[].stage` | 승급 단계 | 최고 성급에서는 키 자체가 없음 (0038) |
| `heroIntensifys[].lv` | **명예의 전당 레벨** | 사용자가 화면에서 확인. 5성을 채워야 들어가고, **이 필드를 가진 19기가 전부 rankLv 6이며 성급 미달 4기는 하나도 없다** |
| `heroEquips[]` | 장비 4칸, id 첫 자리가 등급 | 22002를 화면과 대조: 손 노랑 lv32 = `410100 lv32`, 머리 노랑 lv10 = `410300 lv10`, 나머지 lv0. 4=노랑, 3=보라 |
| `heroEquips[].promote` | **장비 각 (유도)** | 아래 |
| `heroEquipUniques[]` | 전용무기 | `equipId == heroId` |
| `schoolPositions[]` | 훈련소 배치 1~15 | 화면 슬롯 번호와 그대로 대응 |
| `digHeroesHistory` | **게임 전체 영웅 목록** | 28건이 카탈로그와 같은 집합. 미보유 `33005`가 들어 있으므로 계정 목록이 아니다 |

**28은 항목 수이지 캐릭터 수가 아니다.** `33005` Catherine을 유료 업그레이드하면
`1017` Catherine & Rex가 되고 원본은 사라진다(사용자가 게임에서 확인). 즉 한 계정은
둘 중 하나만 갖고, 수집 계정이 `33005`만 미보유였던 것도 로스터의 구멍이 아니라
업그레이드를 했기 때문이다. 영웅 수를 세는 곳은 **항목인지 캐릭터인지** 밝혀야 한다.

관측으로는 확인되지 않는다. `33005`는 고유 편성 156개 중 3개에만 나오고 `1017`은
38개에 나오므로 독립 가정 기대 동시등장이 0.7이고 실제 0이다 — **우연히도 절반쯤
나오는 결과**다. 둘 다 파이터라 동종 3기 보너스가 오히려 같이 나오도록 밀 텐데도 0인
점은 약하게 흥미롭지만 근거는 아니다. 이 관계의 근거는 사용자의 화면 확인이다.

`heroIntensifys`는 한때 키 이름만 보고 "강화"로 적었다가 철회한 자리다 —
`11001`이 `army.info` 레벨 103인데 이 값은 13이라 레벨도 아니었다. **payload
키 이름은 근거가 아니다**는 사례로 남겨 둔다.

`userHero[].atk`/`def`는 영웅 식별에 못 쓴다. 개체값이 아니라 등급 원형값이라
`1002`·`1008`·`12001`이 전부 8085/8085로 같다.

**이름은 프로토콜에 없고 앞으로도 없다.** 서버는 로컬라이즈 키를 보낸다 —
`push.refresh.hero.lottery`가 `"name": "483491"`을 `"protect_des": "157000"` 옆에
두고 있고, 표시 텍스트는 APK가 갖는다. `rank.get.by.range`에서 `heroId 1004`에
붙은 이름 50종이 전부 **플레이어** 이름이었던 것도 같은 이야기다. 그래서 이름은
`heroes` 테이블에 사람이 입력하고, 안 채운 id는 화면에 숫자로 나온다.

미확인 단서: `soldiers[].id`가 `107009`·`107109`·`107209` 세 종류다. 넷째 자리
0/1/2가 병종일 가능성이 있으나 대조하지 않았다.

**둘 다 끝났다.** `sanitize.py`는 `army`를 **원본 그대로 유지한다** — 806개
블롭의 모든 필드 경로를 확인했고 문자열은 병종 id 하나뿐, 이름·UID·좌표가 없어
이 모듈이 가릴 대상이 아니다. 편성은 `arena_entry_heroes`(0025)에 엔트리당 5행으로
들어가고 대시보드 아레나 탭에서 펼쳐 볼 수 있다.

**미해석 필드도, 버려지는 필드도 남아 있지 않다.** `2.14`는 훈련소 레벨(0026),
`2.9`는 승급 단계 `stage`로 확정됐고(0-b) **0038에서 컬럼으로 승격됐다.** 그전까지
디코더가 내보낸 `stage`를 `arena.py`가 읽지 않아 관측마다 버려지고 있었다 —
빈 컬럼보다 나쁜 쪽의 같은 실수다.

컬럼은 nullable이고 **최고 성급에서는 null**이다. proto3 부재가 0이라 블롭만으로는
"0단계"와 "다음 성급 없음"이 같아 보이는데, `star`가 그걸 가른다.

## 연맹 밖 플레이어에 대해 알 수 있는 것 (2026-08-01 조사)

**대전제: 수집기는 수동 스니퍼다.** 요청을 보내지 않고, 게임 클라이언트가 이미
받은 응답만 디코딩한다. 따라서 "이 UID의 정보를 가져와줘"는 성립하지 않는다.
**우리가 볼 수 있는 것 = 수집 계정이 게임에서 연 화면**뿐이다.

### 영웅 정보

| 얻는 것 | 커맨드 | 범위 |
|---|---|---|
| **편성 5기 전체** (영웅·병종·성급·장비·전투력) | `user.get.arena.info` | 아레나 Top100. **크로스서버, 연맹 무관** |
| **최강 영웅 1기** (`maxHeroId`, `maxPower`) | `get.user.info.multi` | 프로필을 열면 누구든. 실제로 서버 577·579·580, 연맹 GAR7·TWya·TIRN(전부 우리 연맹 아님)이 잡혔다 |
| 최강 영웅 보드 | `rank.get.by.range` type 49 | 크로스서버 150명 |

즉 특정 비연맹원의 **편성 전체**를 보려면 그 사람이 아레나 Top100에 있어야 하고,
**최강 영웅만**이면 캡처를 켠 채 게임에서 프로필을 열면 된다.

### 온라인 여부

| 소스 | 범위 | 값 |
|---|---|---|
| `al.rank.online` | **연맹원만** | bool |
| **`get.friend.list.online`** | **친구 — 연맹 무관** | bool. 실제로 54명이 잡혔고 서버 579 TIRN 등 타 연맹 포함 |
| `get.user.info.multi.offLineTime` | 프로필 조회 | **쓸 수 없다.** 13/13 전부 0 |

**비연맹원 온라인 확인 방법은 친구 추가다.** 프로필 조회로는 안 된다.

### 덤 — `al.rank.offLineTime`은 진짜 마지막 접속 시각이다

멤버 93명에서 `online=True` ⟺ `offLineTime=0`이 **예외 0건**으로 성립하고,
오프라인 84명은 전부 실제 타임스탬프(**밀리초** epoch)를 갖는다.

**2026-08-01 승격됨** (마이그레이션 0024). `alliance_member_snapshots.offline_since`
와 회원 전용 `player_presence` 테이블로 들어가고, 대시보드 멤버 탭에 `Last Online`
열이 생겼다. 기존 `Last Seen`은 `captured_at` 기반의 **신선도 표시**로 남는다 —
0020 주석이 밝혀둔 대로 그건 "수집기가 관측한 시각"이지 마지막 접속이 아니다.

---

## 미처리로 남겨둔 것 — 지나가다 본 것들

고치지 않고 적어만 둔다. 둘 다 지금 무언가를 깨뜨리고 있지는 않다.

**1. ~~듀얼 세 보드가 `metric_key`를 하나 공유한다.~~ 해결됨 (0036).**

`activity_facts`에서 일간(5.6M)·주간(26M)·라운드(103M)가 한 계열에 섞여 있었고,
`metric_registry`가 `percentile_rank`를 지정하므로 백분위가 **어느 보드가
마지막에 적재됐는지**에 좌우됐다. 보드마다 키를 하나씩 주고, 이미 쌓인 424건은
`source_snapshot_id` → `contribution_type`으로 되짚어 재분류했다 — 값은 그대로고
분류만 고쳤다.

같은 김에 `alliance_donation_score`를 `alliance_daily_donation_score`로 바꿨다.
"일간"이라고 말하지 않는 이름이 이 실수를 쉽게 만든 원인이었고, 그걸
`alliance_battle_daily_score` 옆에 두면 다음 사람이 "기부 전체"로 읽는다.

**2. `player_contributions`와 `player_presence`에 `service_role` 권한이 없다.**
`player_month_cards`(0016)는 `grant all ... to service_role`을 하는데 0020·0024는
`anon, authenticated`만 했다. 그래서 시크릿 키로 이 두 테이블을 읽으면 42501이
난다. 실제로 막히는 것은 없다 — 쓰기는 `security definer` 트리거가 하고 읽기는
브라우저 세션이 한다. **더 좁은 쪽이므로 필요가 생기기 전에는 넓히지 않는다.**
필요해지면 RLS 변경이니 pgTAP 음성 테스트가 따라야 한다(§20.2).

**3. `arena_matches`에 writer가 없다. — 확인됐다, 0이다 (2026-08-03)**

> `db reset` 직후 로컬에서 `select count(*)` = **0**. 마이그레이션에도
> `seed.sql`에도 이 테이블에 넣는 INSERT가 없으므로 클라우드에 올려도 0이다.
> **아래 "0이면" 갈래가 확정됐다.** 아직 지우지 않았다 — pgTAP 3파일을 옮기는
> 것이 그 작업의 대부분이고, 별건으로 다룬다.

`services/`와 `apps/` 어디에서도 이 테이블에 쓰지 않는다. 읽는 코드는
`legacy/v0.4.1/`(`activity_api.py`, `dashboard.py`)에만 있다. 0003이 만들고 0007이
알림 트리거를 달고 0064가 member-only로 좁혔지만, **아무도 행을 넣지 않는다.**

`al.battle.rank.info`와 같은 모양이다 — 자리는 있는데 채우는 것이 없다.

확인할 것: 프로덕션에서 `select count(*) from public.arena_matches`.

- **0이면** 테이블을 지우는 마이그레이션이 맞다. 다만 **지우기 전에 알 것**:
  pgTAP 세 파일이 이 테이블을 편리한 스냅샷 테이블로 쓰고 있다 —
  `01_conventions_test`(관례·유니크), `05_notifications_test`(알림 페이로드),
  `33_arena_member_only_test`. 셋 다 다른 테이블로 옮겨야 하고, 그게 삭제
  작업의 대부분이다.
- **0이 아니면** 어딘가에 writer가 있다는 뜻이고, 그걸 먼저 찾아야 한다.

**확인 전에는 지우지 않는다.** Mac에는 실 데이터가 없어서 여기서는 셀 수 없었다.

---

## Mac에서 만든 것 중 저장소에 없는 것

스크래치라 커밋하지 않았다. Windows에서는 실 Supabase를 쓰므로 대부분 불필요
하지만, 목이 다시 필요해지면 아래를 알고 있어야 한다.

- **목 PostgREST** (`mock-supabase.py`): 앱을 고치지 않고 `VITE_SUPABASE_URL`만
  돌려 붙였다. 앱 코드는 건드리지 않는 게 핵심이었다.
- 하마터면 놓칠 뻔한 것: **`204 No Content`에 본문을 실으면 브라우저가 연결을
  끊는다**(curl은 통과시킨다). 즐겨찾기 해제가 안 되는 것처럼 보인 원인이
  이것이었고, 앱은 정상이었다.

## Mac 도구 설치 메모

Windows에는 해당 없지만 기록해둔다.

- Homebrew가 `admin` 소유라 `npm -g`가 EACCES → `npm config set prefix ~/.local`
- Node 26에는 corepack이 없다(25부터 제거) → `npm i -g pnpm@9.15.0`
- `uv`는 PyPI에서 `~/Library/Python/3.14/bin`로 설치

---

## 작업 방식에서 지켜야 할 것

이번 세션에서 CI가 잡은 것들이며, 반복하지 않기 위해 적는다.

**세션 끝에 브랜치를 푸시한다. 미완성이어도.** 맥과 윈도우 사이에 충돌이
난 적은 **한 번도 없다** — 두 머신이 같은 파일을 동시에 고치지 않기 때문이다.
실제로 손해를 낸 것은 언제나 **푸시하지 않은 브랜치**였다.

- `feat-battle-rank` — 파서를 다 써놓고 푸시하지 않아 다른 머신에서 안 보였고,
  문서 두 개가 "미승격"으로 잘못 적혔다
- `docs-capture-backlog` — 운영 런북 381줄이 origin에는 있는데 `main`에 머지가
  안 돼 몇 주 동안 없는 문서였다. 2026-08-01에 머지했다
- `feat-operability` — 로컬에만 있던 브랜치. 다행히 내용이 이미 다른 경로로
  `main`에 들어가 있어 잃은 것은 없었고, 확인 후 삭제했다

그래서 규칙은 하나다. **`origin/main`이 유일한 진실이고 머신은 캐시다.**
세션 시작에 `git fetch --prune`, 세션 끝에 푸시. 이것만 지키면 머신이 몇 대든
상관없다.

**GitHub 인증이 막히면 키 문제가 아닐 가능성이 높다.** Windows에서는 ssh-agent가
서비스라 `Set-Service -StartupType Automatic` + `ssh-add` 한 번이면 끝이고, 그
뒤로는 셸을 새로 열어도 유지된다(2026-08-02 확인). 아래는 WSL에서 겪은 기록이다.
키
(`~/.ssh/id_ed25519_github`)는 계정에 `home_wsl_github`로 등록돼 있다. 새 창에
ssh-agent가 없고 키에 passphrase가 걸려 있으면 `Permission denied (publickey)`가
난다. 새 키를 만들거나 등록하지 말고 아래만 하면 된다.

```bash
eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519_github
```

**커밋 전에 로컬에서 전부 돌린다.** 이걸 시작한 뒤로 CI 왕복이 사라졌다.

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm build
uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest
```

**pgTAP은 로컬에서 돌려야 한다.** Mac에는 Supabase 스택이 없어 `db` 잡이
유일한 사각지대였고, 실제로 두 번 진짜 버그를 잡았다.

- 컬럼을 옮기고 `supabase/tests/`를 grep하지 않아 테스트 7개가 깨졌다
- **`RAISE EXCEPTION`은 그 호출에서 함수가 쓴 것을 전부 롤백한다.** 실패
  카운터를 기록하고 예외를 던지면 카운터가 사라진다. 시도 제한이 통째로
  무력화돼 있었다

Windows에는 스택이 있으므로 `supabase test db`를 커밋 전에 돌릴 것.

**스키마를 바꾸면 저장소 전체를 grep한다.** `apps/`와 `services/`만 보고
`supabase/`를 빼먹어 CI를 깨뜨렸다.

**화면 기능은 양쪽 방향을 다 눌러본다.** 즐겨찾기를 "켜기"만 확인하고 완료로
보고했다가 사용자가 "끄기가 안 된다"고 지적했다.
