# 런북: 수집기 설치와 실행

Appendix E의 "Collector 설치 및 수집 계정 연결", "ADB serial 확인과 본계정
denylist 검증"에 해당한다. 2026-07-29 첫 라이브 캡처에서 실제로 확인·수정한
값과 함정만 적었다.

## 역할 분담 — 어느 쪽에서 무엇을 돌리는가

| 어디서 | 무엇을 | 왜 |
|---|---|---|
| **Windows** `C:\darkwar-platform` | `dw-capture`, `dw-collector sync` | Npcap이 Windows 전용이고, SQLite 저널이 로컬 디스크에 있어야 한다 |
| **WSL** `~/Projects/DW_app` | `supabase` 마이그레이션·pgTAP, `pnpm dev`, pytest | 툴체인이 여기 있고 CI와 같은 환경이다 |

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

그다음 WSL에서 대시보드로 확인한다.

```bash
cd ~/Projects/DW_app && pnpm dev
```

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
| WSL에서 `docker: command not found` | Docker Desktop → Settings → Resources → WSL integration이 꺼졌다. 켜고 Docker Desktop 재시작 |
| `curl http://127.0.0.1:54321` 이 `000` | Kong(API 게이트웨이)이 죽었다. `supabase start`가 "already running"이라며 `Stopped services`에 kong을 나열하면, `supabase stop && supabase start`로 완전히 재시작한다 |
| `git pull`이 untracked `uv.lock` 때문에 중단 | Windows uv가 만들어 둔 사본이다. 커밋된 것과 동일하면 지우고 다시 pull |
| `git clone`이 `no such identity: /c/Users/.../id_ed25519_github` | WSL 안에만 있는 키를 Windows ssh가 찾고 있다. HTTPS로 클론한다 |

## 절대 하지 말 것

- 본계정 시리얼을 `DW_ADB_COLLECTOR_SERIAL`에 넣기
- 저널을 WSL 공유 드라이브에 두기
- PCAP·SQLite·`.env`를 커밋하기 (`.gitignore`와 gitleaks가 막지만, 애초에 하지 않는다)
- 캡처에서 뽑은 payload를 손으로 fixture로 만들기 — 본계정 UID와 세션 서명이
  들어 있다. 반드시 `dw-collector extract-fixture`(살균기 없는 커맨드는 거부한다)를 쓴다
