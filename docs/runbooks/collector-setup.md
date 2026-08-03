# 런북: 수집기 설치와 실행

Appendix E의 "Collector 설치 및 수집 계정 연결", "ADB serial 확인과 본계정
denylist 검증"에 해당한다. 2026-07-29 첫 라이브 캡처에서 실제로 확인·수정한
값과 함정만 적었다.

## 역할 분담 — 어느 쪽에서 무엇을 돌리는가

창은 **PowerShell 하나**다 (`PS C:\...>`). WSL은 지우지 않지만 — Docker
Desktop이 내부적으로 WSL2를 쓴다 — 거기서 타이핑하지 않는다.

| 어디서 | 무엇을 | 왜 |
|---|---|---|
| **Windows** `C:\darkwar-platform` | `dw-capture`, `dw-collector sync` | Npcap이 Windows 전용이고, SQLite 저널이 로컬 디스크에 있어야 한다 |
| **Windows** `C:\darkwar-platform` | `supabase` 마이그레이션·pgTAP, `pnpm dev`, pytest | 창을 나누면 저널과 `.env`가 두 벌이 된다 |

**캡처는 WSL에서 원리적으로 불가능하다.** Npcap이 Windows 전용인 것에 더해,
WSL2는 자기만의 가상 랜카드(`172.19.160.1`)를 쓰는 별도 네트워크다. 게임은
Windows의 실제 랜카드(`192.168.86.30`)로 통신하므로 WSL에서는 그 트래픽이 보이지
않는다 — 환경변수를 다 채워도 0패킷이다. WSL에서 `dw-capture`를 돌리면
`DW_COLLECTOR_ID is required`로 멈추는데, 이건 "값을 채워라"가 아니라 **"창을
잘못 열었다"**는 뜻으로 읽는다.

두 체크아웃은 같은 Supabase(`127.0.0.1:54321`)를 보고, 코드는 git으로만
오간다. **WSL에서 수집기 명령을 돌리면 별개의 빈 저널이 생긴다** —
`DW_SQLITE_PATH`가 없으면 `./data/collector.db`로 떨어지므로, 캡처한 데이터를
못 보고 조용히 0건을 sync한다.

저널을 WSL 공유 드라이브(`U:\`, `\\wsl$\...`)에 두지 않는다. SQLite WAL을
9p/SMB 위에서 쓰는 것은 손상 위험이 실재한다.

## 사전 준비 (1회)

1. **Npcap** 설치 — <https://npcap.com>, WinPcap 호환 모드 체크
2. **Windows 네이티브 클론**

   ```powershell
   git clone https://github.com/hjyshane/darkwar-platform.git C:\darkwar-platform
   ```

   SSH가 아니라 HTTPS를 쓴다. WSL의 SSH 키는 Windows에 없고, Git for Windows에
   들어 있는 Git Credential Manager가 브라우저 로그인으로 처리한다.
   `git config --global --get-regexp "url\."`에 `insteadOf` 재작성 규칙이 보이면
   `git config --global --unset-all "url.git@github.com:.insteadOf"`로 지운다.

3. **의존성** — 캡처 extra 포함

   ```powershell
   cd C:\darkwar-platform\services\collector; uv sync --extra capture
   ```

4. **환경 스크립트** — `dw-env.example.ps1`을 `dw-env.ps1`로 복사해 값을 채운다
   (`dw-env.ps1`은 gitignore 대상)

   `SUPABASE_SECRET_KEY`는 템플릿에 없다. 이 키는 RLS를 완전히 우회하므로
   (NFR-001) 로컬 값이라도 파일에 박아두지 않는다. 실행 중인 스택에서 가져온다:

   ```bash
   supabase status -o json
   ```

   `.env`를 써도 된다 — 수집기가 `$DW_ENV_FILE`, 없으면 작업 디렉터리와 그 상위의
   가장 가까운 `.env`를 자동으로 읽는다. **셸에 이미 설정된 변수가 항상 이긴다**,
   그래서 `dw-env.ps1`이 `.env`를 덮어쓴다. PowerShell에서는 경로에 백슬래시가
   들어가므로 `dw-env.ps1` 쪽이 덜 헷갈린다.

## 캡처 인터페이스 결정

```powershell
uv run python -c "from scapy.all import IFACES; IFACES.show()"
```

- **확인된 값(이 PC)**: `Intel(R) Ethernet Controller (3) I225-V` / 192.168.86.30.
  BlueStacks Nxt는 호스트 네트워크 스택을 통해 NAT되므로 실제 LAN 어댑터에서
  게임 트래픽이 보인다. scapy는 GUID 대신 이 이름 문자열을 그대로 받는다.
- **VPN을 끊는다.** NordVPN이 올라와 있으면 게임 트래픽이 터널로 들어가고 물리
  어댑터에는 암호화된 UDP만 보인다. NordLynx 같은 WireGuard 터널 어댑터는 Npcap이
  캡처하지 못하는 경우가 많다. VPN을 유지해야 하면 split tunneling에서 BlueStacks를
  우회 대상으로 지정한다.
- `Hyper-V Virtual Ethernet Adapter`(172.19.160.1)는 WSL2 vNIC이다. WSL2는 별도
  네트워크 namespace라 **WSL에서는 BlueStacks 트래픽이 보이지 않는다.**

20초 검증 — 게임에서 연맹 멤버 목록을 여는 동안:

```powershell
uv run python -c "from scapy.all import sniff; p=sniff(filter='tcp port 8680', iface='Intel(R) Ethernet Controller (3) I225-V', timeout=20); print('packets:', len(p))"
```

## BlueStacks 인스턴스 ↔ ADB 시리얼

`C:\ProgramData\BlueStacks_nxt\bluestacks.conf`의 `bst.instance.*.adb_port`가
정답이다. 추측하지 않는다.

| 인스턴스 | 표시 이름 | 시리얼 | 비고 |
|---|---|---|---|
| Pie64 | wonderedoffduck | `127.0.0.1:5555` | |
| Pie64_1 | wonderingduck | `127.0.0.1:5565` | **본계정** |
| Pie64_2 | lostidas | `127.0.0.1:5575` | |

같은 인스턴스가 `127.0.0.1:5565`와 `emulator-5564` 두 이름으로 보일 수 있다.

**수집 계정이 준비되기 전까지 `DW_ADB_COLLECTOR_SERIAL`은 비워 둔다.** 가드는
미설정 상태에서 모든 UI 자동화를 거부하므로, 그게 지금 맞는 상태다. 라이브
캡처는 패시브 스니핑이라 ADB가 전혀 필요 없다.

수집 계정이 생기면 그 시리얼만 `DW_ADB_COLLECTOR_SERIAL`에 넣고 **나머지 전부를**
`DW_ADB_DENYLIST_SERIALS`에 넣는다. 본계정 시리얼을 collector 쪽에 넣는 것은
FR-COL-010 가드를 스스로 해제하는 것이다 — 레거시 설정의
`force_restart_game = true`는 게임을 강제 종료한다.

실제 보호는 denylist가 아니라 **"수집기 시리얼과 정확히 일치하지 않으면 거부"**
규칙이다. 적어두지 않은 별칭도 통과하지 못한다. denylist는 의도를 명시하고
collector 시리얼 오기입을 잡는 2차 방어다.

긴급 정지(FR-OPS-006): `DW_UI_KILL_SWITCH_FILE`이 가리키는 파일을 만들면 모든
UI 자동화가 즉시 거부된다.

## 캡처 실행

```powershell
cd C:\darkwar-platform\services\collector; ..\..\dw-env.ps1; uv run dw-capture
```

확정 커맨드는 **요청-응답**이라 게임에서 실제로 화면을 열어야 나온다. 이미 열려
있는 패널은 캐시되므로 **닫고 다시 열어야** 요청이 나간다.

| 게임 동작 | 커맨드 | 들어가는 테이블 |
|---|---|---|
| 연맹 → 멤버 목록 | `al.rank` | `alliance_member_snapshots` |
| 연맹 → 랭킹(로컬/크로스) | `alliance.rank` | `alliance_snapshots` |
| 다른 연맹 정보 | `get.al.info` | `alliance_snapshots` (+`leader_game_uid`) |
| 아레나 → 랭킹 | `user.get.arena.info` | `arena_snapshots` + `arena_entries` + fact |
| 플레이어 랭킹 | `server.rank` | `player_snapshots` |
| 플레이어 프로필 | `get.new.user.info` | `player_detail_snapshots` (6종 파워) |
| 프로필 요약 | `get.user.info.multi` | `player_snapshots` |

Ctrl+C로 멈추면 카운터가 찍힌다:

- `segments` — 포트 8680에서 본 페이로드 있는 TCP 세그먼트. 0이면 인터페이스나
  VPN 문제다.
- `ingested` — 확정 커맨드 7종. 게임이 대기 중이면 0이 정상이다.
- `discovered` — 미확인 커맨드 관측 건수. 크게 나오는 게 정상이다.
- `rows` — 저널에 새로 들어간 정규화 행. `discovered`보다 작으면 같은 모양이
  반복된 것이고, `(source_command, fingerprint)` 중복 제거가 동작한 결과다.
- `rejected` — 아는 커맨드인데 파싱 실패. 0이 아니면 파서를 봐야 한다.
- `clock_skew_seconds` — **게임 서버 시계 − 이 PC 시계**(초). 게임에 로그인할
  때 서버가 자기 시각을 보내주므로, 그 세션에 로그인이 없었으면 `None`이다.

`clock_skew_seconds`가 커지면 그 세션의 `captured_at`이 통째로 그만큼 어긋난
것이다. 조용히 망가지는 곳이 세 군데다:

| 어긋나면 | 무슨 일이 생기나 |
|---|---|
| idempotency 키의 날짜 버킷 | 같은 데이터가 다른 키로 들어가 역사가 두 벌이 된다 |
| 게임 주 경계 (월요일 02:00 UTC) | 지난주 기록이 이번 주로 들어간다 |
| 대시보드 신선도 | "20분 전 관측"이 거짓말이 된다 |

몇 초는 정상이다(네트워크 지연 + 서버가 초 단위로만 보냄). **60초를 넘으면
경고가 찍힌다** — 그때는 수집을 멈추고 Windows 시계부터 맞춘다.

수집기는 시계를 **고치지 않고 확인만 한다.** 시스템 시계를 건드리는 것은 이
프로세스가 할 일이 아니고, 잘못된 시계로 돌아간 세션은 나중에 **알아볼 수 있어야**
하기 때문이다 — 몰래 보정해버리면 그 세션의 데이터가 왜 이상한지 알 방법이 없다.

쌓인 표본은 이렇게 본다:

```powershell
uv run dw-collector clock-skew
```

무엇이 잡혔는지 확인:

```powershell
uv run python -c "import sqlite3,os; c=sqlite3.connect(os.environ['DW_SQLITE_PATH']); print(c.execute('select source_command, count(*) from raw_observations group by 1 order by 2 desc').fetchall())"
```

## Supabase로 올리기

같은 PowerShell 창에서(환경변수가 살아 있어야 한다):

```powershell
uv run dw-collector sync
```

`sent=N failed=0`이 정상이다. 네트워크나 스택 문제로 실패하면 행은 outbox에
`pending`으로 남고, 스택을 복구한 뒤 같은 명령을 다시 돌리면 손실 없이 올라간다.

그다음 대시보드로 확인한다.

```powershell
cd C:\darkwar-platform; pnpm dev
```

## 운영 절차

설치가 끝난 뒤의 일상 작업은 **`collector-operations.md`**에 단계별로 있다 —
어느 창에서 무엇을 치고, 무엇이 보여야 하고, 다르게 나오면 무엇이 문제인지까지.
처음이라면 그 문서를 순서대로 따라가면 된다.

아래 자동화는 그 일상 작업의 손을 덜어주는 것이므로, 먼저 한 번은 손으로
돌려보고 오는 편이 낫다.

## 화면 열기를 자동화하기 (dw-ui-worker)

위의 "캡처 실행"까지 하면 데이터는 들어오지만, **화면은 사람이 눌러야** 한다.
`dw-ui-worker`가 그 손을 대신한다. **읽기 전용 화면만** 연다 — 자원 수급, 출정,
채팅 전송 같은 **게임 상태를 바꾸는 동작은 하지 않는다.**

### 왜 눈감고 누르지 않는가

좌표는 해상도와 UI 버전에 따라 밀린다. 밀린 좌표로 계속 누르면 엉뚱한 버튼이
눌린다. 그래서 이 워커는 **각 단계마다 "어떤 커맨드가 와야 하는지"를 미리
적어두고, 그게 저널에 들어올 때까지 기다린다.** 안 오면 **거기서 멈춘다.**
다음 단계를 누르지 않는다 — 지금 어느 화면에 있는지 모르는 상태에서 누르는 것이
정확히 사고가 나는 방식이기 때문이다.

그래서 **`dw-capture`가 먼저 돌고 있어야 한다.** 안 돌면 아무것도 저널에 안
들어오고, 1단계에서 멈추면서 그 이유를 말해준다.

### 1단계 — 어느 인스턴스를 건드릴지 확인

```powershell
uv run dw-ui-worker devices
```

adb가 보는 시리얼과 **가드의 판정**이 같이 나온다. 수집 인스턴스 하나만
`ALLOWED (collector)`여야 한다. 본계정이 ALLOWED로 나오면 **거기서 멈추고**
`DW_ADB_COLLECTOR_SERIAL`과 `DW_ADB_DENYLIST_SERIALS`를 다시 본다.

### 2단계 — 좌표 읽기

```powershell
uv run dw-ui-worker screenshot --out C:\DW_data\screen.png
```

그림판이나 이미지 뷰어로 열어서, 누르고 싶은 버튼의 **픽셀 좌표**를 읽는다.
(그림판은 커서 위치를 왼쪽 아래에 보여준다.)

### 3단계 — 루틴 파일 만들기

`services/collector/routines/example-alliance-daily.json`을 복사해서 좌표를
채운다. 예제의 `x`/`y`는 전부 **0**이다 — 그대로 돌리면 1단계에서 실패하고
멈춘다. 그게 의도된 동작이다.

한 단계는 이렇게 생겼다:

```json
{
  "name": "member list",
  "action": "tap",
  "x": 450, "y": 700,
  "expect": ["al.rank"],
  "settle_seconds": 2.0,
  "timeout_seconds": 20
}
```

- `expect` — 이 탭이 성공하면 서버가 보내야 하는 커맨드. **이게 검증의 전부다.**
  위 "캡처 실행" 표에서 화면 ↔ 커맨드 대응을 보고 채운다.
- `settle_seconds` — 누른 뒤 기다리는 시간. 메뉴 애니메이션이 있다.
- `action`은 `tap` / `swipe` / `back` / `wait` 네 가지. `back`과 `wait`은
  응답이 없으므로 `expect`를 쓸 수 없다(파일 읽을 때 거부된다).

### 4단계 — 눌러보지 않고 먼저 확인

```powershell
uv run dw-ui-worker run --routine C:\DW_data\daily.json --dry-run
```

무엇을 누를지만 출력하고 **아무것도 건드리지 않는다.** 좌표를 잘못 적었는지
여기서 본다.

### 5단계 — 실제 실행

**창 두 개**가 필요하다. `dw-capture`가 도는 창은 그대로 두고, **새 창**에서:

```powershell
cd C:\darkwar-platform\services\collector; ..\..\dw-env.ps1; uv run dw-ui-worker run --routine C:\DW_data\daily.json
```

정상이면 이렇게 나온다:

```
routine=alliance_daily serial=127.0.0.1:5575
  ok          roster saw=['al.rank']
  ok          contribution saw=['get.daily.alliance.donate.rank']
  ok          contribution saw=['get.week.alliance.donate.rank']
  skipped     close contribution

all steps verified
```

`skipped`는 실패가 아니다 — `back`/`wait`처럼 **검증할 응답이 없는 단계**다.

실패하면:

```
  unverified  ranking MISSING=['alliance.rank']

ABORTED at 'ranking': expected ['alliance.rank'] after 20.0s but saw none
 — screen state is unknown, so no further taps
```

이때 할 일은 **좌표를 다시 읽는 것**이다(2단계). 게임 UI가 업데이트되면 좌표가
밀린다.

### 급할 때 멈추기

`DW_UI_KILL_SWITCH_FILE`이 가리키는 파일을 만들면 된다. 실행 중이어도 **다음
단계로 넘어가기 전에 확인**하므로 즉시 멈춘다.

```powershell
New-Item -ItemType File $env:DW_UI_KILL_SWITCH_FILE
```

다시 돌리려면 그 파일을 지운다.

### 하지 않는 것

게임 플레이 자동화(자원 수급, 전투, 채팅)는 **만들지 않는다.** 약관상 밴 사유이고,
무엇보다 검증 고리가 없다 — 화면이 밀렸을 때 "응답이 안 왔으니 멈춘다"가 성립하는
것은 **읽기 전용 화면**뿐이다.

## 예약해두고 잊기 (dw-jobs)

`dw-ui-worker run`은 **내가 직접 시킬 때** 도는 것이다. `dw-jobs`는 대시보드나
관리자가 큐에 넣어둔 작업을 **알아서 가져다 돌린다.**

방향이 중요하다. 클라우드가 이 PC로 들어오는 게 아니라, 이 PC가 밖으로 나가서
가져온다. 열어둘 포트가 없다.

```powershell
cd C:\darkwar-platform\services\collector; ..\..\dw-env.ps1; uv run dw-jobs
```

`dw-capture`가 도는 창은 그대로 두고 **새 창**에서 띄운다. 캡처가 안 돌면
루틴 1단계에서 검증에 실패하고 멈춘다 — 아무도 안 보고 있는 화면을 두드리는
것보다 낫다.

### 작업이 루틴을 고르는 방식

큐의 행은 루틴 **이름**만 담는다. 좌표도 경로도 담지 않는다.

```json
{ "job_type": "run_routine", "payload": { "routine": "daily" } }
```

`dw-jobs`는 그 이름을 `DW_ROUTINES_DIR` 안에서만 찾는다. `../`나 절대경로처럼
디렉터리를 벗어나려는 이름은 **영구 실패**로 처리한다. DB의 한 행이 이 PC의
아무 파일이나 열게 만들 수는 없어야 한다.

### 실패하면 어떻게 되나

| 상황 | 처리 |
|---|---|
| 에뮬레이터가 자고 있음, adb 재시작 | 30초 → 1분 → 2분… 으로 물러나며 재시도 |
| 루틴 이름이 없음, 모르는 `job_type` | **즉시** dead_letter — 기다린다고 생길 리 없다 |
| 가드 거부 (시리얼 미설정, denylist 비어 있음) | **즉시** dead_letter — 설정을 고쳐야 한다 |
| 킬스위치 | 재시도 대상. 스위치를 내리면 다시 집어간다 |
| 조작자가 자리에 앉음 | 재시도 대상 (`DW_UI_MIN_IDLE_SECONDS`) |

킬스위치가 걸려 있으면 **애초에 작업을 집지 않는다.** 집었다가 중단하면 시도
횟수만 까먹고 결국 dead_letter로 가는데, 잠깐 멈춘 것뿐인 작업을 손으로 다시
넣어야 하는 건 말이 안 된다.

시도 이력은 매번 `workflow_runs`에 남는다. 두 번 실패한 작업은 두 줄로 보인다.

## 넓게 쓸어담기

프로토콜 발견이 목적인 세션은 `capture-sweep.md`를 따른다 — 어떤 화면을 어떤
순서로 열면 미확인 커맨드가 가장 많이 잡히는지, 그리고 잡힌 것을 승격할지
판정하는 기준이 정리돼 있다.

## 문제 해결

| 증상 | 원인과 조치 |
|---|---|
| `packets: 0` | VPN이 켜져 있다 / 그 20초 안에 게임이 서버와 통신하지 않았다 / 어댑터를 잘못 골랐다 |
| `ModuleNotFoundError: No module named 'dw_collector'` | 그 체크아웃에 `src/`가 없다. `git pull`이 안 된 오래된 체크아웃이거나 잘못된 디렉터리다 |
| `SUPABASE_URL and SUPABASE_SECRET_KEY are required` | 환경변수를 다른 셸(PowerShell↔WSL)에 설정했거나, `.env`가 작업 디렉터리·상위 4단계 안에 없다 |
| sync가 `WinError 10061` / `Connection refused` | 로컬 스택이 내려갔다. 아래 참조 |
| `docker: command not found` | Docker Desktop이 안 떠 있다. 켜고 다시 (Supabase 로컬 스택이 그 위에서 돈다) |
| `curl http://127.0.0.1:54321` 이 `000` | Kong(API 게이트웨이)이 죽었다. `supabase start`가 "already running"이라며 `Stopped services`에 kong을 나열하면, `supabase stop && supabase start`로 완전히 재시작한다 |
| `git pull`이 untracked `uv.lock` 때문에 중단 | Windows uv가 만들어 둔 사본이다. 커밋된 것과 동일하면 지우고 다시 pull |
| `git clone`이 `no such identity: /c/Users/.../id_ed25519_github` | WSL 안에만 있는 키를 Windows ssh가 찾고 있다. HTTPS로 클론한다 |

## 절대 하지 말 것

- 본계정 시리얼을 `DW_ADB_COLLECTOR_SERIAL`에 넣기
- 저널을 WSL 공유 드라이브에 두기
- PCAP·SQLite·`.env`를 커밋하기 (`.gitignore`와 gitleaks가 막지만, 애초에 하지 않는다)
- 캡처에서 뽑은 payload를 손으로 fixture로 만들기 — 본계정 UID와 세션 서명이
  들어 있다. 반드시 `dw-collector extract-fixture`(살균기 없는 커맨드는 거부한다)를 쓴다
