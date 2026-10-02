# 런북: 맥 개발 도구 (Docker 없이, 관리자 권한 없이)

작성 2026-10-02. 맥에서 Windows와 같은 수준으로 작업하기 위한 도구 구성이다:
마이그레이션 작성과 pgTAP 테스트, 수집기 점검, 운영 DB push, 클라우드 sync.
실제로 이 순서대로 설치했고, 최신 `main`에서 아래 "확인"이 전부 통과했다.

**왜 이렇게 설치하나.** 이 맥의 계정은 `admin` 그룹이 아니다. `/opt/homebrew`가
admin 소유라 `brew install`이 막히고, Docker Desktop·OrbStack은 설치에 관리자
암호가 필요하다. 그래서 전부 **홈 폴더 안**에 둔다. `~/.local/bin`이 PATH에서
Homebrew보다 앞에 있으므로, 거기 둔 것이 먼저 잡힌다.

**Docker는 필요 없다.** Docker가 주는 것은 로컬 Supabase 스택(`supabase start`)
하나뿐이고, 테스트는 PostgreSQL 17 + pgTAP만으로 CI와 같은 결과를 낸다
(`scripts/pgtap/run.py`). 빠지는 것은 끝의 "맥에서 안 되는 것"에 있다.

---

## 설치

받는 파일은 전부 공식 출처이고, 체크섬이나 코드 서명을 확인한 뒤 설치한다.

### 1. Node 22 — 레포 기준 버전(`.nvmrc`)

Homebrew의 Node 26에서는 대시보드 `localStorage` 테스트 2개가 깨진다(Node 26의
내장 `localStorage`가 jsdom 것을 가린다). Homebrew 것은 그대로 두고 앞에 22를 둔다.

한 셸에서 이어서 돈다(`F`를 다음 줄이 쓴다). 체크섬이 안 맞으면 `-c`가 실패하고
거기서 멈춘다.

```bash
cd /tmp && curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt && F=$(grep -o 'node-v22[0-9.]*-darwin-arm64.tar.gz' SHASUMS256.txt | head -1) && curl -fsSLO https://nodejs.org/dist/latest-v22.x/$F && grep " $F\$" SHASUMS256.txt | shasum -a 256 -c - && mkdir -p ~/.local/opt && tar -xzf $F -C ~/.local/opt && for b in node npm npx; do ln -sfn ~/.local/opt/${F%.tar.gz}/bin/$b ~/.local/bin/$b; done
```

`node -v`가 `v22.x`이면 된다. pnpm(`~/.local/bin/pnpm`)은 이 Node로 돈다.

### 2. uv와 Python 3.12

```bash
curl -LsSf https://astral.sh/uv/install.sh | UV_NO_MODIFY_PATH=1 sh
```
```bash
uv python install 3.12 --default
```

`--default`가 `~/.local/bin`에 `python`·`python3`을 만든다. `pnpm db:test:local`이
`python`을 부르기 때문에 필요하다(맥에는 원래 `python3`만 있다).

### 3. PostgreSQL 17 — Postgres.app에서 꺼내 쓴다

[Postgres.app](https://github.com/PostgresApp/PostgresApp/releases) 안정 릴리스의
**PG17 단일 dmg**(`Postgres-<버전>-17.dmg`)를 받아 마운트하고, 서명을 확인한 뒤
**버전 폴더만** 꺼낸다.

```bash
codesign --verify --deep --strict "/Volumes/<마운트>/Postgres.app" && echo OK
```
```bash
ditto "/Volumes/<마운트>/Postgres.app/Contents/Versions/17" ~/.local/opt/postgresql-17
```

**앱 번들 안에 설치하지 않는다.** macOS가 서명된 `.app` 내부 쓰기를 막아서
pgTAP 설치가 `Operation not permitted`로 실패하고, 억지로 쓰면 앱 서명이 깨진다.
꺼낸 폴더는 라이브러리를 `@loader_path`로 찾으므로 어디로 옮겨도 돈다
(`otool -L ~/.local/opt/postgresql-17/bin/postgres`). 앱을 실행하거나 서버를 띄울
필요는 없다 — 테스트 실행기가 매번 임시 클러스터를 만든다.

### 4. pgTAP

[theory/pgtap](https://github.com/theory/pgtap/releases) 최신 릴리스 소스를 받아,
꺼낸 PostgreSQL에 대고 빌드한다. Xcode 명령줄 도구(`make`)가 필요하다.

```bash
make PG_CONFIG=~/.local/opt/postgresql-17/bin/pg_config && make install PG_CONFIG=~/.local/opt/postgresql-17/bin/pg_config
```

그리고 테스트 실행기가 찾도록 `~/.zshrc`에 한 줄:

```bash
export PGBIN="$HOME/.local/opt/postgresql-17/bin"
```

### 5. Supabase CLI

[supabase/cli](https://github.com/supabase/cli/releases) 릴리스의
`supabase_darwin_arm64.tar.gz`. `checksums.txt`에는 버전이 붙은 이름
(`supabase_<버전>_darwin_arm64.tar.gz`)으로 적혀 있지만 해시는 같다 —
`shasum -a 256`으로 비교한다.

```bash
tar -xzf supabase_darwin_arm64.tar.gz && install -m 755 supabase ~/.local/bin/supabase
```

### 6. 연결 — 계정과 키가 필요해서 직접 한다

| 무엇 | 명령 / 위치 | 주의 |
|---|---|---|
| 운영 프로젝트 | `supabase login` → 레포 폴더에서 `supabase link --project-ref <ref>` | `db push` 권한이 생긴다 |
| 클라우드 sync | `~/dw-data/.env` — `mac-capture.md`의 "사전 준비" | **secret key는 RLS를 우회한다.** 레포 밖에 두고, 맥을 잃으면 바로 교체 |
| (선택) 운영 데이터로 화면 개발 | `apps/dashboard/.env.local`에 `VITE_SUPABASE_URL`·`VITE_SUPABASE_PUBLISHABLE_KEY` | `.gitignore`가 막는다. 운영 인증에 `localhost` 리다이렉트가 없으면 로그인이 안 될 수 있다 |

---

## 확인

새 터미널에서(또는 `source ~/.zshrc` 뒤) 레포 루트에서:

```bash
pnpm install && pnpm check && pnpm typecheck && pnpm test && pnpm build
```
```bash
pnpm db:test:local
```
```bash
cd services/collector && uv sync && uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run pytest
```
```bash
supabase migration list --linked
```

2026-10-02 결과: JS 테스트 전부 통과(Node 26에서 깨지던 2개 포함), pgTAP은
마이그레이션 200개 적용 후 **113개 파일 전부 통과, 약 8초**(Windows는 약 45초),
수집기는 Python 3.12에서 ruff·mypy strict·pytest 통과.

---

## 맥에서 안 되는 것

| 무엇 | 대신 |
|---|---|
| 실시간 캡처(`dw-capture`), BlueStacks·ADB | Windows. 손으로 뜬 pcap은 맥에서도 올린다 — `mac-capture.md` |
| 로컬 스택(`supabase start`, `db reset`) | 화면은 `pnpm --filter @dw/dashboard dev:local`(픽스처) 또는 6절의 운영 데이터 |
| 타입 재생성(`pnpm db:types`) | `database.types.ts`를 손으로 고치고 CI의 타입 비교로 확인한다 |
| `supabase db diff --linked`(push 뒤 권한 점검) | Windows (임시 DB를 Docker로 띄운다) |

## 되돌리기

전부 홈 폴더 안이라 지우면 끝이다: `~/.local/opt/node-v22*`,
`~/.local/opt/postgresql-17`, `~/.local/bin`의 `node`·`npm`·`npx`·`python`·
`python3`·`uv`·`uvx`·`supabase`, `~/.local/share/uv`, `~/.zshrc`의 `PGBIN` 줄.
`~/Applications/Postgres.app`을 받아 뒀다면 그것도 지워도 된다(쓰지 않는다).
