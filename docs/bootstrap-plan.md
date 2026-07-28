# DarkWar Platform — 저장소 부트스트랩 및 첫 수직 슬라이스

> **진행 상황** (2026-07-28 기준, WSL 검증 후 갱신)
>
> - **P0 완료** — 커밋 `8464377`. 저장소 뼈대, `.gitignore`/gitleaks/lefthook
>   시크릿 가드, pnpm 워크스페이스, Python 패키지 설정, CI 워크플로, `CLAUDE.md`.
> - **P0 검증 완료** — 실제 개발 환경은 계획과 달리 Windows 네이티브가 아니라
>   **WSL2**다(저장소가 WSL 파일시스템에 있음). 캡처(P5/S15)만 네이티브 Windows.
>   `~/.local/bin`에 설치: pnpm 9.15.0(corepack) · uv 0.12.0 · supabase CLI
>   2.110.0 · gh 2.96.0 · gitleaks 8.30.1 · lefthook 2.1.10.
>   통과: `pnpm install` · `biome check` · `uv sync`(Python 3.12) · `ruff` ·
>   gitleaks 히스토리 스캔(누출 0) · lefthook 훅 설치. 핀 버전 조정 불필요했음.
> - **GitHub 저장소 생성됨** — `git@github.com:hjyshane/darkwar-platform.git`.
> - **Supabase 로컬 검증 완료** — Docker Desktop WSL 통합 활성화, `gh` 인증 완료.
>   `supabase init`(project_id는 `darkwar-platform`으로 교정) → `supabase start` →
>   `supabase db reset` 전부 통과. 주의: CLI tarball에는 `supabase`와 `supabase-go`
>   두 바이너리가 들어있고 `db reset`은 둘 다 필요하다.
> - **남은 수동 작업** — push는 사용자 터미널에서(SSH 키가 패스프레이즈로 잠겨
>   있고 ssh-agent 미실행).
> - **P1 완료** — 마이그레이션 0001~0006(21개 테이블 + internal.raw_observations),
>   seed(합성 연맹 1·로스터 20·아레나 1주), pgTAP 75개 통과(RLS negative,
>   Realtime publication 3개 테이블 한정, reset-week 벡터 7개 —
>   `protocol-fixtures/reset-week/vectors.json`이 원본), `packages/shared-types`
>   생성 + 타입 드리프트 0. 발견: 이 Postgres 이미지는 public 테이블에
>   anon/authenticated 기본 grant가 없어 0006에서 명시적으로 grant한다.
>   D-1은 계획대로 `game_uid` 전역 유니크로 확정(레거시 SQLite로 사후 검증 예정).
> - **P2 완료** — Observation 모델·파서 레지스트리(al.rank, user.get.arena.info
>   정규화기 2개), SQLite 저널(raw+정규화+outbox 단일 트랜잭션, FR-COL-004),
>   sync 워커(엔티티 해석 → idempotency upsert, 백오프/데드레터),
>   `dw-collector init-db/replay/sync` CLI. 합성 fixture 4종
>   (`protocol-fixtures/decoded/`). pytest 27개 통과 — idempotency 키가 raw
>   payload 해시임을 고정하는 회귀 테스트, 저널 원자성(강제 롤백), 로컬
>   Supabase 대상 논리적 exactly-once(강제 재전송 흡수) 포함.
> - **다음** — P3: 대시보드 셸, Realtime 구독 → 패널 refetch, 로스터/아레나
>   화면, 장애 주입(S9~S10, S12).

## Context

`docs/DarkWar_Platform_Technical_Specification_v1.0.md`(1,634줄) 기술 명세는 완성됐지만 코드는 한 줄도 없고 git 저장소도 아니다. 목표는 GitHub private 저장소를 만들고, 폴더 구조를 확정하고, 실제 구현을 시작하는 것이다.

제약 조건 두 가지가 계획 전체를 결정한다.

1. **개발은 Windows PC 단독에서 한다.** 스펙의 수집 Edge는 Npcap/BlueStacks/ADB 기반이라 Windows 전용이다. 그리고 결정적으로 — v0.4.1 프로토타입 코드와 PCAP이 **이미 그 Windows PC에 있다**. 거기서 개발하면 덤프·격리·전송 절차 자체가 사라지고, 파서를 실제 캡처로 즉시 검증할 수 있다.
2. **그래도 파이프라인은 캡처와 분리한다.** 라이브 캡처에 의존하는 개발은 반복 주기가 느리고 CI에서 돌릴 수 없다.

핵심 설계 판단: **수집기의 상류 경계를 소켓이 아니라 `Observation` 객체로 정의한다.** 그러면 파이프라인 전체(SQLite 저널 → outbox → Supabase → Realtime → UI → activity fact)를 fixture로 구동·테스트할 수 있고, 캡처는 그 앞단에 꽂히는 한 가지 입력 소스가 될 뿐이다. Npcap 없이도 CI가 돌고, BlueStacks를 띄우지 않고도 회귀 테스트가 된다.

결과물: 재현 가능한 로컬 Supabase 스키마, fixture로 구동되는 end-to-end 데이터 경로, 실 데이터가 표시되는 웹 화면 1개, activity fact 1건, 그리고 v0.4.1 파서가 승격 규칙을 통과해 들어온 실제 데이터 경로.

---

## 확인된 환경

이 명세를 작성한 Mac에서 측정한 값이며, **실제 개발 환경은 Windows PC다.** 도구 설치는 Windows에서 처음부터 다시 한다.

```
git      2.50.1        ✅
python3  3.14.5        ⚠️ ADR-004는 3.12 요구 → uv로 고정
node/pnpm/uv/supabase/docker/gh   전부 미설치
```

**Windows에서 먼저 확인할 것**: Docker Desktop(WSL2 백엔드) 설치 가능 여부, Node 22 LTS, Python 3.12(uv가 설치), git longpaths, 그리고 v0.4.1 코드·PCAP·SQLite의 실제 경로.

## 확정한 결정 (이견 있으면 승인 시 말씀)

| 항목 | 결정 | 근거 |
|---|---|---|
| 폴더 구조 | Appendix C **축소판** | `modules/`는 런타임 의미가 없고 9개 하위 이름이 전부 다른 곳에 이미 집이 있음. 빈 디렉터리 20개는 코드 오배치의 원인 |
| Python 서비스 | 패키지 **1개** + 콘솔 엔트리포인트 4개 | §10.1이 요구하는 건 *프로세스* 분리이지 *패키지* 분리가 아님. 파서 하나 없이 의존성 그래프 4개를 만들 이유 없음 |
| 개발 머신 | **Windows PC 단독** | 캡처·BlueStacks·ADB가 Windows 전용이고, v0.4.1 코드와 PCAP이 이미 거기 있음. 머신 1개면 줄바꿈·인터프리터·경로·sync 대상 분리 문제가 전부 사라짐 |
| Supabase | **로컬 Docker만** | 수집기와 DB가 같은 머신에 있으므로 클라우드 dev 프로젝트가 불필요. 스키마가 자주 바뀌는 초기엔 `db reset`이 공짜여야 함. 클라우드는 staging/prod가 필요해질 때 |
| 첫 목표 | Gate 3 수직 슬라이스 | 데이터 경로 전체가 검증되고, 실제 파서까지 연결 가능 |
| Discord Activity | 마지막(S13) | 터널·URL 매핑·iframe CSP·OAuth 교환은 스택에서 가장 불안정한 표면. 데이터가 흐르기 전에 손대면 며칠을 태움 |

---

## 폴더 구조

```
DW_app/                                  ← GitHub: darkwar-platform (private)
├─ .gitignore  .gitattributes  .editorconfig  .env.example
├─ README.md  CLAUDE.md
├─ package.json  pnpm-workspace.yaml  tsconfig.base.json  biome.json
├─ .github/workflows/ci.yml
├─ docs/
│  ├─ DarkWar_Platform_Technical_Specification_v1.0.md   (기존)
│  └─ legacy-triage.md                   ← 덤프 도착 시 생성
├─ supabase/
│  ├─ config.toml  seed.sql
│  ├─ migrations/                        ← 0001~0006, 아래 참조
│  └─ tests/                             ← pgTAP
├─ services/collector/
│  ├─ pyproject.toml  .python-version("3.12")  uv.lock
│  ├─ src/dw_collector/
│  │  ├─ models.py      ← Observation 계약 (핵심 이음매)
│  │  ├─ protocol/      ← v0.4.1 디코더 착륙 지점
│  │  ├─ parsers/       ← v0.4.1 파서 착륙 지점
│  │  ├─ storage/       ← SQLite edge journal + outbox
│  │  ├─ sync/          ← outbox → Supabase
│  │  ├─ capture/       ← Windows 전용, optional dependency
│  │  └─ cli.py
│  └─ tests/
├─ apps/dashboard/                       ← Vite + React + TS (웹 겸 Discord)
│  └─ src/{runtime,features,lib}/
├─ packages/shared-types/                ← database.types.ts + contracts.ts(Zod)
├─ protocol-fixtures/
│  ├─ decoded/                           ← 살균된 JSON만 커밋
│  └─ manifests/                         ← 원본 pcap의 sha256 + 캡처 메모
└─ legacy/README.md                      ← 격리 규칙, 덤프 도착 전에 미리 작성
```

**만들지 않는 것** (필요해질 때 생성): `modules/` 전체(영구 제외), `supabase/functions/`(S13), `docs/adr/`(첫 실제 결정 시), `docs/runbooks/`(Gate 4), `packages/{ui,api-client,scoring-explain}`(두 번째 소비자가 생길 때), `services/analysis-worker`(Milestone E).

**TS와 Python 공존 방식.** 두 도구 루트는 겹치지 않는다. `pnpm-workspace.yaml`은 `apps/*`와 `packages/*`만 포함해 `services/`와 `legacy/`에 발을 들이지 않는다. 루트 `pyproject.toml`은 만들지 않고 Python 루트는 `services/collector/` 하나뿐이다. 둘이 만나는 지점은 import가 아니라 세 개의 검사되는 산출물이다.

1. SQL이 단일 진실 공급원 → `supabase gen types typescript` → `packages/shared-types/src/database.types.ts` 커밋. CI가 재생성 diff를 검사
2. 정규화 행 계약을 Pydantic(`models.py`)과 Zod(`contracts.ts`)로 각각 작성하고, `protocol-fixtures/decoded/`의 공유 fixture를 **양쪽 테스트가 모두 로드**해 고정 (§20.1 Contract 테스트)
3. `protocol-fixtures/`는 양쪽이 읽고 어느 쪽도 소유하지 않음

---

## v0.4.1 착륙 지점

Windows 단독 개발이므로 v0.4.1은 "덤프"가 아니라 **같은 머신 안의 로컬 복사**다. 전송 절차는 사라지지만 격리 규칙은 그대로 유지한다 — 목적이 파일 이동이 아니라 *검토되지 않은 레거시 코드가 기본값으로 토대가 되는 것을 막는 것*이기 때문이다.

오히려 위험은 커졌다. PCAP과 레거시 SQLite가 이제 개발 머신에 같이 있으므로 `git add -A` 한 번에 딸려 들어갈 수 있다. 로그인 pcap에는 수집 계정의 **UID + 세션 서명**이 들어있고(§5.2, Appendix A `darkwar_loading.pcapng`), 한 번 히스토리에 들어가면 private 저장소여도 영구히 남는다.

**따라서 어떤 파일도 복사해 넣기 전에** `.gitignore`가 다음을 포함해야 한다.

```
*.pcap  *.pcapng  *.db  *.db-wal  *.db-shm  *.sqlite*
.env  .env.*  !.env.example
legacy/**/*.db  legacy/**/data/
__pycache__/  .venv/  node_modules/  dist/  .supabase/
```

그리고 `gitleaks`를 pre-commit 훅과 CI 양쪽에 걸어 **import 브랜치를 병합하기 전에** 동작하게 한다.

**데이터 산출물은 저장소 바깥에 둔다.** Windows의 형제 디렉터리(예: `D:\DW_legacy_data\`)이지 하위 디렉터리가 아니다 — 형제는 `git add -A`에 딸려올 수 없다. `legacy/v0.4.1/`에는 **소스 코드만** 들어간다. PCAP·SQLite·`.env`는 원래 자리에 두거나 그 형제 디렉터리로 옮긴다.

**import 절차** — 수정 0건, 단일 커밋, `--no-ff`:

```bash
git switch -c import/v0.4.1
# legacy/v0.4.1/ 로 소스만 복사. 수정·포맷·이름변경 금지
git add legacy/ && git commit -m "chore(legacy): import v0.4.1 verbatim (quarantined, not built)"
git switch main && git merge --no-ff import/v0.4.1
```

수정을 섞으면 승격된 코드를 원본과 diff할 능력이 사라진다. `--no-ff`라야 통째로 되돌릴 수 있다(`git revert -m 1`). 절대 rebase/squash 하지 않는다.

**격리를 실제로 강제하는 장치**: pnpm 워크스페이스 glob에서 제외 · `src/` 레이아웃이라 `legacy/`는 `sys.path`에 없어 import 불가 · ruff/mypy `exclude` · pytest `norecursedirs` · biome/tsconfig ignore · CI에서 `legacy` import 금지 grep · `CLAUDE.md`에 "읽기 전용 참조, 승격 = 복사 + 재작성 + fixture 테스트" 명시.

**승격 규칙(타협 없음)**: 파서 1개당 PR 1개. fixture와 replay 테스트 없이는 `services/collector/src/`에 들어갈 수 없다. NFR-009가 이미 요구하는 바이고, 이걸 승격 시점에 강제하는 것이 레거시 코드가 기본값으로 토대가 되는 걸 막는 유일한 방법이다.

`docs/legacy-triage.md`에 파일별 판정(adopt / discard / reference-only), 목표 경로, fixture, 테스트를 표로 기록한다. 미결 행이 0이 되면 `git rm -r legacy/`.

---

## Windows 단독 개발 — 설정 규칙

WSL은 쓰지 않는다. 수집기가 Npcap·BlueStacks·ADB·SQLite를 한 프로세스 트리에서 다뤄야 하는데 WSL 경계를 끼면 경로와 장치 접근이 지저분해진다. Docker Desktop만 내부적으로 WSL2를 백엔드로 쓰고, 그건 투명하다.

| 항목 | 설정 |
|---|---|
| 줄바꿈 | `.gitattributes`에 `* text=auto eol=lf`. 지금은 머신이 하나라도 CI(ubuntu)와 어긋나면 diff가 오염됨 |
| 긴 경로 | `git config --global core.longpaths true`. `node_modules` 중첩에서 실제로 터짐 |
| 인터프리터 | `.python-version` = `3.12`, uv가 인터프리터 자체를 설치. 시스템 Python을 쓰지 않음 |
| Node | Node 22 LTS + `corepack enable`, `package.json`의 `packageManager`로 pnpm 고정 |
| 셸 스크립트 | `package.json` 스크립트는 크로스플랫폼만. 복잡한 로직은 Python/Node 파일로 — CI가 ubuntu에서 돌기 때문 |
| 경로 | Python은 `pathlib`만, 하드코딩된 구분자 금지 |
| 대소문자 | Windows는 무시하고 Linux CI는 구분 → import 케이싱 버그가 CI에서만 드러남. CI를 ubuntu에서 돌려 조기 검출 |
| Defender | `node_modules`, `.venv`, `.git`, SQLite 파일 디렉터리를 실시간 검사 제외에 추가. 안 하면 설치·테스트가 체감으로 느려짐 |
| 캡처 의존성 | `[project.optional-dependencies] capture = ["scapy>=2.5"]`. 기본 `uv sync`는 캡처 없이 설치되어 CI에서도 동일하게 돌고, 수집 실행 시에만 `uv sync --extra capture` |

---

## 마이그레이션 0001 범위

**포함 (21개 테이블)** — 전부 Appendix B의 *확정* 커맨드에 대응:

```
20260728000001_extensions_and_conventions.sql
   pgcrypto, set_updated_at(), reset_week_start(timestamptz),
   schema internal(원본 payload — exposed schema 밖이라 브라우저가 구조적으로 접근 불가),
   enum: role / measurement_type / collector_status / job_status
20260728000002_servers_and_identity.sql
   servers, players, player_names, alliances, alliance_names, app_users
20260728000003_snapshots.sql
   player_snapshots, player_detail_snapshots, alliance_snapshots,
   alliance_member_snapshots, arena_matches, arena_snapshots, arena_entries
20260728000004_operations.sql
   collectors, collector_heartbeats, refresh_jobs, workflow_runs,
   schema_observations, audit_logs, data_change_notifications
   + Realtime publication을 이 3개 알림 테이블로만 명시적 한정 (§10.4)
20260728000005_activity_facts.sql
   metric_registry, activity_facts  ← 이 둘만. §12.2에 완전히 명세됨
20260728000006_rls_core.sql
   역할 + 정책 + 모든 테이블 deny-all 기본값 (§17.3)
```

**연기 (약 24개)** — 이유가 서로 다르다:

- `event_*`(8), `season_*`/`map_scan_*`(8), `battle_report_*`(8): **프로토콜 미확정**. §5.3의 8개 미확정 항목과 §26.1의 14개 필수 PCAP이 전부 여기 걸려있다. 필드를 지금 정의하면 추측이다
- `scoring_profiles`/`scoring_weights`/`activity_scores`/`activity_statuses`/`activity_recompute_runs`: 프로토콜이 아니라 **설계** 미확정. 첫 실제 스코어링 실행 이후에 모양이 정해져야 한다. 당장은 Appendix D의 YAML이 더 나은 v1 저장소
- `game_identity_links`: 테이블 자체는 사소하나 연결 흐름(§6.2 3단계)이 미확정 인게임 메시지 수신 커맨드에 의존
- 월별 파티셔닝(§11.4), PGMQ 큐(§10.4): 8서버 × ≤100명 규모에서는 순수 운영 비용. `refresh_jobs` 테이블 + `FOR UPDATE SKIP LOCKED`로 충분

**`servers`와 server_id 전략**

```sql
create table servers (
  server_id             int primary key,   -- 게임 내 숫자 ID, 대리 UUID 아님
  server_group          text not null,     -- '577-584'
  merged_into_server_id int references servers(server_id),
  is_tracked            boolean not null default true,
  ...
);
-- 577~584 8행은 seed가 아니라 마이그레이션에 삽입 (테스트 데이터가 아니라 운영 사실)
```

정수 자연키를 쓰는 이유: 안정적이고, 로그·URL에서 사람이 읽을 수 있고, 모든 인덱스에서 작고, §11.4의 인덱스 선두 컬럼 그 자체다. 서버 병합(12/16/32/64)은 행 추가 + `merged_into_server_id` 설정으로 처리 — 스키마 변경 없음, NFR-007 충족.

**출처와 대상을 구분한다.** 서버 580에서 관측한 `server.rank` 응답에는 8개 서버 전체의 플레이어가 들어있다. 따라서 스냅샷 행의 `server_id`는 *대상의* 서버이고, 관측 위치는 별도 `collector_id`/`collected_from_server_id`로 기록한다. 이 둘을 뭉치면 나중에 걷어내기 어려운 모델링 버그가 된다.

**미결 D-1: `game_uid`가 서버군 전체에서 유일한가?** 증거는 "그렇다" 쪽 — §5.2에서 `server.rank`가 cross-server 랭킹을 한 응답에 담는다는 건 그룹 단위 UID 공간을 강하게 시사한다. 게다가 서버 병합은 `players.server_id`를 가변으로 만들어 `(server_id, game_uid)` 복합키를 *불안정한* 식별자로 만든다(병합된 플레이어가 두 정체성으로 갈라짐). **0002는 `game_uid bigint not null unique`(전역) + `server_id`는 가변 속성**으로 간다. 덤프 도착 시 레거시 SQLite에 5분짜리 쿼리로 확인하고, 틀렸다면 유니크 제약에 `server_id`를 더하는 마이그레이션 1개로 끝난다 — 그 방향은 싸고 반대는 비싸다.

**파서 출력을 모를 때의 방어 규칙.** 모든 스냅샷 테이블이 `observation_id`, `source_command`, `parser_version`, `idempotency_key unique`, `captured_at`, `raw jsonb`를 갖는다. 새/미인식 필드는 **마이그레이션 없이** `raw`에 떨어지고, 반복 관측된 뒤에야 타입 컬럼으로 승격한다. 디코더가 없는데도 0001을 오늘 쓸 수 있는 이유가 이것이다.

---

## 첫 수직 슬라이스 (Gate 3)

목표: `수집 계정 Arena/CBFW 스냅샷 → SQLite → Supabase sync → Realtime → 공용 화면 → activity fact 1건`

v0.4.1이 로컬에 있으므로 전 단계가 열려있다. 그래도 **순서는 지킨다** — 합성 fixture로 파이프라인을 먼저 세우고(S5~S12) 그다음 실제 파서를 승격한다(S14). 반대로 하면 파서 버그와 파이프라인 버그가 섞여 디버깅이 두 배로 든다.

| # | 작업 |
|---|---|
| S1 | 마이그레이션 0001~0006 로컬 적용, `supabase db reset` 반복 가능 확인 |
| S2 | `seed.sql`: 서버 577-584 + 합성 연맹 1개·로스터 20명·아레나 1주 |
| S3 | SQLite edge journal + outbox 스키마 (`dw-collector init-db`) |
| S4 | `Observation` 모델 + 파서 레지스트리 (등록된 파서 0개) |
| S5 | 손으로 쓴 fixture `decoded/al.rank/synthetic_roster_v1.json` (§5.2 문서화된 형태) |
| S6 | 정규화기: `al.rank`→`alliance_member_snapshots`, `user.get.arena.info`→`arena_snapshots`+`arena_entries` (필드명은 S14에서 교정, `raw` jsonb가 차이를 흡수) |
| S7 | `dw-collector replay --fixture` 가 raw+정규화+outbox를 **단일 SQLite 트랜잭션**으로 기록 (FR-COL-004) |
| S8 | sync 워커: outbox → Supabase `idempotency_key` upsert. 중복 replay 테스트로 논리적 exactly-once 증명 (FR-COL-005) |
| S9 | insert 트리거 → `data_change_notifications` 행 생성 |
| S10 | 대시보드가 알림 구독 → 해당 패널만 refetch (FR-UI-005), 로스터+아레나를 freshness 배지와 함께 렌더 (FR-UI-007/008) |
| S11 | activity fact 1호: 아레나 스냅샷에서 `arena_participation` 방출, `measurement_type='observed'`, `source_snapshot_id` 채워서 fact→원본 관측 역추적 성립 (FR-ACT-008) |
| S12 | 장애 주입: sync 중 네트워크 차단, 트랜잭션 중 프로세스 강제 종료 → 무손실·순서 복구 확인 (Gate 3 exit) |
| S13 | Discord 앱 등록, URL 매핑, https 터널, identity 교환 Edge Function, `DiscordRuntimeAdapter` (**마지막에**) |
| S14 | **실제 디코더 연결**: `legacy/`에서 `protocol/`과 `al.rank`/`arena` 파서를 승격(PR 1개당 파서 1개 + fixture + replay 테스트), 실 PCAP에서 뽑아 살균한 fixture로 합성 fixture 교체, S6~S11 무수정 재실행 |
| S15 | 라이브 캡처 연결, 본계정 무영향 확인 (Gate 3 exit) |

---

## 도구 선택

| 항목 | 선택 | 이유 |
|---|---|---|
| JS | pnpm 워크스페이스, **Turborepo 없이** | 앱 1개 + 패키지 1개는 스케줄할 태스크 그래프가 없음. 빌드가 실제로 아플 때 추가 |
| Python | **uv** (poetry 아님) | 결정적 이유: 인터프리터 자체를 설치·고정한다. ADR-004는 3.12를 요구하고 scapy는 신규 릴리스에 뒤처진다. Windows에서 특히 중요 |
| Supabase | **로컬 Docker만** | 마이그레이션은 **손으로 쓴 SQL**. `db diff`는 보조로만 쓰고 저자로는 쓰지 않는다(생성된 SQL은 리뷰 불가). 클라우드 프로젝트는 staging이 필요해질 때 |
| Python 테스트 | pytest + **syrupy** | 스냅샷 테스트가 §20.1 프로토콜 replay에 정확히 맞음 |
| TS 테스트 | vitest + @testing-library/react | |
| DB 테스트 | **pgTAP** (`supabase test db`) | §20.2가 "RLS 변경은 무권한 접근 테스트 없이 merge 금지"를 하드 게이트로 규정. RLS를 *데이터베이스가 보는 대로* 테스트하는 유일한 수단 |
| E2E | Playwright는 **Gate 4로 연기** | 화면 1개에 브라우저 매트릭스는 과함 |
| 린트/포맷 | ruff(+mypy strict) / **Biome** | 각 1개 바이너리, 플러그인 생태계 없음 |
| 시크릿 | **gitleaks** (pre-commit + CI) | pcap과 service-role 키 때문에 타협 불가 |
| 훅 | lefthook | 단일 바이너리, YAML 1개 |
| GitHub | `gh repo create darkwar-platform --private`. **LICENSE 없음** | 비공개·비배포 프로젝트에 MIT를 붙이면 문서와 모순 |

**CI** (`.github/workflows/ci.yml`) — 워크플로 1개, 잡 4개:

- `python` (paths: `services/**`, `protocol-fixtures/**`): uv sync(캡처 extra 없이) → ruff → mypy → pytest. **ubuntu에서 실행** — 개발이 Windows 단독이므로 CI를 Linux에 두는 것이 대소문자·줄바꿈·경로 가정을 잡아주는 유일한 안전망이다
- `web` (paths: `apps/**`, `packages/**`): biome ci → tsc --noEmit → vitest → build
- `db` (paths: `supabase/**`): `db reset`(마이그레이션이 맨바닥에서 적용됨을 증명) → `test db`(RLS negative 포함) → 타입 재생성 후 `git diff --exit-code`(드리프트 검사)
- `guard`: gitleaks + `legacy/` import 금지 grep

§21.1의 9단계 파이프라인(스테이징 배포, 수동 승인, 프로덕션 배포)은 Gate 6 재료다. 배포할 것이 없는데 배포 자동화를 먼저 만드는 건 고전적인 시간 낭비다.

---

## 리스크와 순서 함정

1. **파서 출력 모양을 모른 채 쓴 스키마** → 모든 스냅샷 테이블의 `raw jsonb`. 추가로 **스키마 동결 시점**을 명시: 프로덕션 수집기가 실 데이터를 처음 쓰는 날. 그 전엔 마이그레이션을 자유롭게 갈아엎고, 그 후엔 forward-only
2. **히스토리에 들어간 시크릿** → 파일을 복사해 넣기 *전에* `.gitignore` + gitleaks. PCAP·SQLite가 같은 머신에 있으므로 `git add -A` 한 번이면 끝장이다. 데이터는 저장소 형제 디렉터리에. service-role 키는 RLS를 완전히 우회하므로(NFR-001) 환경변수와 GH Actions 시크릿에만
3. **레거시 import가 히스토리를 오염** → 소스만, 단일 `--no-ff` 커밋, 도구 레벨 제외, CI 가드
3b. **파서를 너무 일찍 붙이는 것** → v0.4.1이 손에 닿는 곳에 있으면 S5~S12를 건너뛰고 바로 실제 파서를 꽂고 싶어진다. 그러면 파서 버그와 파이프라인 버그가 섞인다. 합성 fixture로 파이프라인을 먼저 녹색으로 만든다
4. **빈 스캐폴딩 부패** → "처음 필요할 때 생성" 규칙을 `CLAUDE.md`에 기록해 AI 세션이 스펙에서 다시 만들어내지 않게
5. **미확정 도메인 선구현** → FR-UI-004는 탭 10개를 나열하지만 지금은 2개(Overview, Alliance/Arena)만. **지금 만들지 않을 것**: 이벤트 프레임워크, 시즌/맵 크롤러, 전투 리포트 파이프라인, PGMQ, Storage, 파티셔닝, 알림(§18.4), CD 파이프라인
6. **Discord Activity를 너무 일찍** → 웹 우선, `DiscordRuntimeAdapter`는 S13
7. **idempotency 키 churn** → §11.2의 키는 `payload_hash`를 포함하는데, 이걸 *정규화된* 행에 대해 계산하면 파서 버전이 오를 때마다 키가 바뀌어 replay 시 과거 행이 전부 중복된다. **원본 디코드 payload에 대해 해시**하고 이를 회귀 테스트로 고정
8. **Realtime 과다 구독** → 기본 `supabase_realtime` publication이 조용히 전체를 포함할 수 있음. publication 멤버십을 3개 알림 테이블로 명시 설정하는 마이그레이션 + pgTAP 단언
9. **주간 리셋 드리프트** → 월요일 02:00 UTC가 SQL·Python·TS 세 곳에 구현된다. 공유 테스트 벡터 fixture 1개를 세 테스트 스위트가 모두 소비

---

## 검증

- `supabase db reset` → 마이그레이션이 맨바닥에서 적용되고 seed가 로드됨
- `supabase test db` → pgTAP 통과, 특히 RLS negative(Viewer가 내부 presence 읽기 실패, 비인증이 raw payload 접근 실패)
- `uv run pytest` → outbox 백오프/데드레터, idempotency 중복 replay가 행을 1개만 만듦, reset-week 벡터
- `uv run dw-collector replay --fixture protocol-fixtures/decoded/al.rank/synthetic_roster_v1.json` → SQLite에 raw+정규화+outbox 행, sync 후 Supabase에 동일 데이터, 두 번 실행해도 논리적 중복 0
- `pnpm dev` → 로스터/아레나 화면에 seed 데이터가 freshness 배지와 함께 표시. replay를 다시 돌리면 해당 패널만 refetch
- `activity_facts`에서 fact 1건을 골라 `source_snapshot_id` → 스냅샷 → `observation_id` → 원본 관측까지 역추적 (FR-ACT-008)
- 장애 주입: sync 도중 네트워크 차단 후 복구 → 손실 0, 순서 유지

---

## 실행 순서

**전제: Windows PC로 옮겨서 시작한다.** 이 Mac 세션에서는 계획까지만.

- **P0** — Windows 도구 설치(Node 22 + corepack, uv, Docker Desktop, supabase CLI, gh), git init, `.gitignore`/`.gitattributes`, gitleaks, GitHub private repo, `CLAUDE.md`, `legacy/README.md`. *어떤 파일도 복사해 넣기 전에 `.gitignore`부터*
- **P1** — 마이그레이션 0001~0006, RLS + pgTAP, seed (S1~S2)
- **P2** — Python 코어, SQLite 저널, outbox, idempotency, replay CLI (S3~S8)
- **P3** — 대시보드 셸, Realtime, 화면 1개, 장애 주입 (S9~S10, S12)
- **P4** — activity 수학 + fact 1호 (S11). Gate 3 실질 완료
- **P5** — v0.4.1 import 브랜치 → triage → 파서 승격 (S14) → 라이브 캡처 (S15)
- **P6** — S13 Discord 런타임
