# 인수인계 — Mac에서 Windows로

작성 2026-08-01. Mac에서 할 수 있는 일이 소진된 시점의 상태다. 다음 세션이
이 문서만 읽고 이어받을 수 있게 쓴다.

`CLAUDE.md`(재론하지 않을 결정), `docs/bootstrap-plan.md`(원래 계획),
`docs/capture-backlog.md`(무엇을 캡처해야 하는가)가 함께 읽을 문서다.

---

## 한 문장

수집기와 스키마는 실 캡처로 검증됐지만, **대시보드는 한 번도 실 데이터를 본
적이 없다.** 지금까지 화면 검증은 전부 스크래치 목 서버 대상이었다.

---

## 사용자 요청 10건의 상태

| # | 요청 | 상태 |
|---|---|---|
| 1 | 타이틀 → Dark War dashboard | 완료 (#38) |
| 2 | 멤버 페이지 접근 제한 | 완료 (#41 RLS, #42 인증) |
| 3 | 필터·정렬·검색 | 완료 (#39) |
| 4 | 즐겨찾기 | 완료 (#43) |
| 5 | 듀얼 포인트 일간·주간·라운드 | **막힘 — 캡처 필요** |
| 6 | 기부 일간·주간 | **막힘 — 캡처 필요** |
| 7 | 서버 드릴다운 + 서버 즐겨찾기 | 완료 (#44) |
| 8 | 아레나 영웅 정보 | **막힘 — 캡처 필요** |
| 9 | 아레나 서버·연맹 표시 | 완료 (#40) |
| 10 | R4/R5 코드 입력 | 완료 (#42, 2번과 통합) |

6자리 패스코드는 사용자와 상의해 **빼기로 했다**. 경계가 RLS로 내려간 뒤에는
인증된 세션 위의 UI 잠금이 단계만 늘리고 보장은 늘리지 않는다.

---

## Windows에서 가장 먼저 할 일

### 1. 실 데이터로 대시보드를 한 번 돌린다

이게 최우선인 이유는 아래 "미검증" 절에 있다. 절차:

```powershell
supabase start
supabase db reset          # 0001~0022 전부 적용
uv run dw-capture           # 별도 창, Npcap 필요
uv run dw-sync              # 별도 창
pnpm dev
```

`.env`에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DW_COLLECTOR_ID` 필요.
대시보드용 `VITE_*`는 `apps/dashboard/.env.local`(gitignore됨).

멤버 역할을 받으려면 admin으로 코드를 발급하고(`docs/runbooks/admin-access.md`)
`#/login`에서 입력한다.

### 2. 기여도 일간·주간 캡처

`docs/capture-backlog.md`의 **0번**이 절차와 확인 사항을 담고 있다.

---

## 미검증 — 반드시 확인할 것

**대시보드 전체가 목 데이터로만 검증됐다.** 목 서버는
`scratchpad/mock-supabase.py`에 있었고 저장소에 없다(스크래치). 실 데이터에서
처음 드러날 것들:

| 확인할 것 | 왜 |
|---|---|
| `Alliance Battle` 열 | **확실히 비어 있다.** 아래 참조 |
| 크로스서버 보드 6종 | 목은 `server.rank`와 `hero_power_total`만 흉내 냈다 |
| 아레나 연맹 열 | fixture는 `Alliance01` 같은 살균 placeholder다. 실 값 확인 필요 |
| 100명 규모 테이블 | 목은 6명이었다. 정렬·검색·sticky 열이 실제 길이에서 어떤지 |
| Realtime 갱신 | 목에 웹소켓이 없어 한 번도 동작하지 않았다 |

### `Alliance Battle` 열 — 파서는 있고, 값의 의미가 미확정이다

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

## 막힌 3건의 정확한 사유

### 5·6번 — 기여 일간·주간

한때 "게임이 점수 하나만 주므로 스냅샷 차이로 유도한다"고 판단했다. **그
판단은 틀렸다.** 사용자가 게임 화면에 일간·주간이 각각 나온다고 확인했고,
가진 fixture가 `get.daily.alliance.donate.rank` **하나뿐**이라 그렇게 보였을
뿐이다. 커맨드 이름부터 daily다.

유도하지 말고 캡처한다. 게임이 알려주는 값을 추정할 이유가 없고, 유도값은
캡처 주기에 정확도가 묶인다.

### 8번 — 아레나 영웅 정보

`army` 필드는 실 캡처에 **존재한다**. `sanitize.py`가 fixture에서 `""`로
지운다(`sanitize_user_get_arena_info`). 아직 아무도 디코딩하지 않았고
`terms.ts`도 "opaque lineup blob"이라 적어뒀다.

슈터/파이터/라이더 조합이 `careerType`에 있을 것으로 기대했으나 **아니다** —
al.rank 93명 전원과 아레나 엔트리 전원이 `careerType=0`, `careerPos=0`,
`careerLv=0`이다. 살균 대상이 아니므로 실제 값이 0이다. 조합 정보는 `army`
안에 있거나 다른 커맨드가 필요하다.

**먼저 할 일**: 실 PCAP에서 `army` 원본 바이트를 꺼내 구조를 본다. 거기 영웅
정보가 없으면 UI 설계 자체가 불가능하므로, 화면부터 그리지 말 것.

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
