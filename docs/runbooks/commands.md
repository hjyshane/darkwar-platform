# 명령 모음

작성 2026-10-02. 이 레포에서 사람이 직접 치는 명령을 한곳에 모았다. 근거는
`package.json` 스크립트, `services/collector/pyproject.toml`의 진입점,
`dw-collector` CLI(`cli.py`), 그리고 각 런북이다. 자세한 절차와 이유는 각 줄에
적어 둔 런북에 있다 — 이 문서는 색인이지 절차서가 아니다.

**[W]** = Windows에서만 된다(캡처, Docker, 작업 스케줄러). 맥은 2026-10-02부터
Docker 없이 나머지를 다 한다 — pgTAP, 수집기 점검, `supabase db push`, `sync`.
설치와 맥에서 안 되는 것은 [`mac-setup.md`](mac-setup.md).

명령이나 옵션이 바뀌면 이 문서도 같이 고친다. 옵션 전체는 `--help`가 정답이다:
`uv run dw-collector <명령> --help`.

---

## 1. pnpm — 대시보드와 JS 쪽 (레포 루트에서)

| 명령 | 하는 일 |
|---|---|
| `pnpm install` | 의존성 설치. `git pull` 뒤에 |
| `pnpm dev` | 대시보드 개발 서버(실제 진입점). 로컬 Supabase가 켜져 있어야 의미 있다. 없으면 로그인 벽만 보이는데, 그게 정상이다 |
| `pnpm --filter @dw/dashboard dev:local` | 백엔드 없이 픽스처로 화면만 보는 빌드(`index.dev.html`). Mac용. 쿼리·RLS는 검증하지 못한다 |
| `pnpm check` / `pnpm check:fix` | biome 린트·포맷 검사 / 자동 수정 |
| `pnpm typecheck` | 모든 패키지 TypeScript 검사 |
| `pnpm test` | 모든 패키지 vitest. 레포는 Node 22를 쓴다(`.nvmrc`) — Node 26에서는 `localStorage` 테스트 2개가 깨진다 |
| `pnpm build` | 빌드. **로컬 `dist/`는 `127.0.0.1:54321`을 가리키므로 손으로 배포하면 안 된다** |
| `pnpm db:types` | 로컬 스택에서 `packages/shared-types/src/database.types.ts` 재생성. 로컬 전용, `--linked` 금지(`scripts/db-types.mjs` 머리말) |
| `pnpm db:reset` / `pnpm db:test` | `supabase db reset` / `supabase test db` 단축 **[W]** |
| `pnpm db:test:local` | Docker 없이 pgTAP 전체(`scripts/pgtap/run.py`). Windows는 scoop의 `postgresql17`(약 45초), 맥은 `PGBIN`의 `~/.local/opt/postgresql-17`(약 8초) |

커밋 전 점검 (CLAUDE.md):

```bash
pnpm check && pnpm typecheck && pnpm test && pnpm build
```

---

## 2. uv — 수집기 Python (`services/collector`에서)

| 명령 | 하는 일 |
|---|---|
| `uv sync --extra capture` | 의존성 설치(캡처용 scapy 포함). `git pull` 뒤에 **[W]** — 맥은 그냥 `uv sync` |
| `uv run ruff check .` / `uv run ruff format --check .` | 린트 / 포맷 검사 |
| `uv run mypy src` | 타입 검사(strict) |
| `uv run pytest` | 테스트 |
| `uv run dw-capture` | 실시간 캡처. Ctrl+C로 중지 **[W]** — `collector-operations.md` §1-4 |
| `uv run dw-sync` | 서버 전송을 주기적으로 반복 + 상태 보고 |
| `uv run dw-console` | 운영 콘솔(저널 정리 버튼 포함) **[W]** |
| `uv run dw-notify` | Discord 알림 워커 |

`uv run --no-sync ...` 는 의존성 동기화를 건너뛴다. 예약 작업이 돌고 있을 때는
이 형태로 실행한다.

커밋 전 점검 (CLAUDE.md):

```bash
uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest
```

---

## 3. `dw-collector` 서브명령 (`uv run dw-collector <명령>`)

저널을 받는 명령은 `--db`를 쓴다. 기본값은 `$DW_SQLITE_PATH`. **경로는 따옴표 +
슬래시로 쓴다** — `"C:/DW_data/live.db"`. 따옴표 없는 백슬래시는 빈 저널을 새로
만들고 전부 0으로 보고한다(`collector-operations.md` §5-2).

### 일상

| 명령 | 주요 옵션 | 하는 일 |
|---|---|---|
| `journal-summary` | `--db` | 저널에 무엇이 있는지: 명령별, 테이블별, outbox 상태 |
| `sync` | `--until-empty`, `--batch-size` | outbox를 Supabase로 한 번 전송 |
| `retry-outbox` | `--dead-letters`, `--already-sent` | 실패분·전송분을 다시 대기열로. 지우지도 고치지도 않는다 |
| `clock-skew` | `--db` | 게임 서버 시계와 우리 시계 차이 |
| `init-db` | `--db` | 저널 파일 생성·마이그레이션 |

### 캡처 파일 읽기

| 명령 | 주요 옵션 | 하는 일 |
|---|---|---|
| `scan-capture` | `--pcap`, `--discover-only` | pcap 하나를 수집 |
| `ingest-dir` | `--dir`, `--interval-seconds`, `--delete-ingested` | 폴더의 pcap을 수집. 간격 0이면 한 번, 아니면 계속 |
| `survey` | `--journal`, `--pcap`, `--out`, `--samples-dir`, `--alliance-id` | **읽기만.** 파서 없는 명령·메일 타입 중 우리 멤버 uid가 든 것을 찾는다(PR #329). `collector-operations.md` §5-3 |

### 과거 데이터 다시 처리

| 명령 | 주요 옵션 | 하는 일 |
|---|---|---|
| `backfill` | `--command`, `--table`, `--limit` | 명령 **하나**의 과거 원본을 지금 파서로 다시 처리. 파서가 있는 명령만 |
| `renormalize` | `--source` | 저널 전체를 지금 파서로 **새 파일에** 다시 만든다 |
| `prune-journal` | `--keep-days`, `--confirm`, `--vacuum` | 오래된 기록 정리. `--confirm` 없이는 세기만 한다. **`survey`를 먼저** — 지운 기간은 다시 못 본다. §5-2 |

### 개발용

| 명령 | 주요 옵션 | 하는 일 |
|---|---|---|
| `extract-fixture` | `--pcap`, `--command`, `--out` | pcap의 응답 하나를 정제한 테스트 픽스처로 |
| `replay` | `--fixture` | 픽스처 하나를 파이프라인에 통과 |
| `unnamed-heroes` | `--url`, `--secret-key` | 카탈로그에 이름이 없는 영웅 id |

---

## 4. supabase CLI

### 로컬 **[W]**

| 명령 | 하는 일 |
|---|---|
| `supabase start` / `supabase stop` | 로컬 스택 켜기/끄기 (Docker 필요) |
| `supabase status -o json` | 로컬 URL·키. `SECRET_KEY`를 `dw-env.ps1`에 넣을 때 |
| `supabase db reset` | 로컬 DB를 비우고 마이그레이션 + seed 전체 재적용 |
| `supabase test db` | pgTAP 전체 |
| `supabase gen types typescript --local` | 타입 생성 — 직접 쓰지 말고 `pnpm db:types` |

### 운영 — `going-public.md`

| 명령 | 하는 일 |
|---|---|
| `supabase login` / `supabase link --project-ref <ref>` | 운영 프로젝트 연결 (처음 한 번) |
| `supabase migration list --linked` | 운영에 무엇이 올라갔나. `remote` 칸이 빈 줄이 안 올라간 것 |
| `supabase db push` | **운영 DB에 마이그레이션 적용.** seed는 실행하지 않는다 |
| `supabase db diff --linked` | push 뒤 운영과 로컬 차이. 로컬 테스트가 구조적으로 못 보는 권한(anon 기본 권한 등)을 잡는다 |

---

## 5. 배포와 Git

| 명령 | 하는 일 |
|---|---|
| `main`에 머지 | **cbfw.us 대시보드 자동 배포**(Cloudflare Git 연동, 약 1분). 머지가 곧 운영 릴리스다 (CLAUDE.md) |
| `gh pr create`, `gh pr checks` | PR 생성 / CI 확인. **머지 전에 db 잡을 읽는다** |
| `wrangler deploy` | 대시보드 손 배포. 자동 빌드가 고장 났을 때만, `VITE_SUPABASE_URL`·`VITE_SUPABASE_PUBLISHABLE_KEY`를 붙여 빌드한 뒤에(`going-public.md` §6) |
| `pnpm --filter @dw/discord-bot register` / `pnpm --filter @dw/discord-bot deploy` | Discord 봇 슬래시 명령 등록 / Worker 배포 (`apps/discord-bot`) |

---

## 6. Windows 일상 흐름

| 상황 | 명령 |
|---|---|
| 창 열고 설정 불러오기 | `cd C:\darkwar-platform\services\collector` → `. ..\..\dw-env.ps1` (맨 앞 **점 + 공백** 필수) |
| PR 머지 후 업데이트 | `cd C:\darkwar-platform; git pull; pnpm install` → `cd services\collector; uv sync --extra capture` |
| 마이그레이션이 들어왔을 때 | `supabase db reset && supabase test db` 또는 `pnpm db:test:local` |
| 작업 하나 재시작 | `schtasks /end /tn DarkWar-Ingest` → `Start-ScheduledTask -TaskName DarkWar-Ingest` (`collector-operations.md` §4-2) |
| 예약 작업 등록 | `scripts/windows/register-tasks.ps1`, `scripts/windows/register-cold-start.ps1` |
| 저널 정리 | `survey` 먼저 → `prune-journal`(세기) → 작업 멈추고 `prune-journal --confirm --vacuum` (§5-2, §5-3) |
