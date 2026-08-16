# 런북: 수집기 운영 (따라하기)

이 문서는 **그대로 따라 치면 되도록** 썼다. 각 단계마다 *입력 → 보여야 할 것 →
다르게 나오면 무엇이 문제인지*가 있다.

- 설치가 아직이면 → `collector-setup.md`
- 발견 세션에서 어떤 화면을 여는지 → `capture-sweep.md`
- 무엇을 아직 찍어야 하는지 → `../capture-backlog.md`

---

## 0. 먼저 알아야 할 것: 창이 두 종류다

이 PC에는 **두 개의 작업 공간**이 있고, 명령마다 돌아가야 하는 곳이 정해져 있다.

**지금 내가 어디에 있는지 구분하는 법** — 프롬프트(명령을 치는 줄) 모양을 본다.

| 프롬프트 모양 | 여기는 | 예 |
|---|---|---|
| `PS C:\...>` | **Windows** (PowerShell) | `PS C:\darkwar-platform\services\collector>` |
| `사용자@컴퓨터:~$` | **WSL** — 여기서 하는 일은 이제 없다 | `hyoju_5pede6k@JunePChome:~$` |

**무엇을 어디서 하는가**

| 하는 일 | 어디서 |
|---|---|
| 게임 데이터 모으기 (`dw-capture`) | **Windows** |
| 모은 것 올리기 (`dw-collector sync`) | **Windows** |
| 데이터베이스 켜기 (`supabase start`) | **Windows** |
| 화면 보기 (`pnpm dev`) | **Windows** |
| 테스트 돌리기 | **Windows** |

> **창은 하나다 — PowerShell.** `CLAUDE.md`의 "Development is Windows-only.
> No WSL."이 원래 결정이고, 2026-08-02에 문서를 거기 맞췄다. 아래 세 줄이
> 한동안 WSL로 적혀 있었던 것은 그 시기 세션이 WSL에서 돌아간 흔적이다.
>
> 나눠 쓰면 저널 경로와 `.env`가 두 벌이 되고, "왜 `sent=0`인가"의 답이 대체로
> "다른 창에서 돌렸다"가 된다. 그 값을 치를 이유가 없다.
>
> WSL 자체는 지우지 않는다 — **Docker Desktop이 내부적으로 WSL2를 쓴다.**
> 설치돼 있되 거기서 타이핑하지 않는다는 뜻이다.
>
> 캡처만은 선택이 아니다 — 이유는 바로 아래.

### 왜 캡처는 Windows에서만 되나

두 가지 이유가 있고, **둘 다 설정으로 해결되지 않는다.**

1. **Npcap은 Windows 프로그램이다.** 네트워크를 엿보는 기능 자체가 Windows에만 설치돼 있다.
2. **WSL은 랜카드가 따로다.** WSL은 같은 PC 안의 작은 별도 컴퓨터라서 자기만의
   가상 랜카드(`172.19.160.1`)를 쓴다. 게임은 Windows의 진짜 랜카드
   (`192.168.86.30`)로 통신하므로, **WSL에서는 그 선을 아예 볼 수 없다.**

그래서 WSL에서 `dw-capture`를 돌리면 환경변수를 다 채워도 **0패킷**이다. 실제로는
그 전에 이렇게 멈춘다:

```
DW_COLLECTOR_ID is required
```

이 메시지가 나오면 "값을 채워야겠다"가 아니라 **"창을 잘못 열었다"** 로 읽으면 된다.

> **더 조심할 것**: `dw-capture`는 이렇게 바로 멈춰서 오히려 다행이다.
> `dw-collector sync`를 WSL에서 돌리면 **에러 없이** 빈 저장소를 만들고
> `sent=0`을 보고한다. "보낼 게 없음"과 똑같이 생겼다. 그래서 sync 출력의
> `journal=` 줄을 항상 확인해야 한다 (2-6단계).

---

## 1. 데이터 모으기 (가장 자주 하는 일)

### 1-1. 데이터베이스 켜기

PowerShell을 열고:

```powershell
cd C:\darkwar-platform
supabase start
```

Docker Desktop이 먼저 떠 있어야 한다. Supabase는 그 위에서 돈다.

**보여야 할 것**: 여러 줄 뒤에 `API URL`, `Studio URL` 같은 주소 목록.

**이미 켜져 있으면** `supabase start is already running.` 이 나온다. 이때
`Stopped services:` 줄에 무언가 적혀 있으면 **일부가 죽은 것**이니:

```bash
supabase stop && supabase start
```

### 1-2. PowerShell 창 열기

시작 메뉴에서 **PowerShell** 실행. 프롬프트가 `PS C:\>` 로 시작하는지 확인한다.

### 1-3. 폴더 이동하고 설정 불러오기

```powershell
cd C:\darkwar-platform\services\collector
```

```powershell
. ..\..\dw-env.ps1
```

> 맨 앞의 **점 하나와 공백**(`. `)이 중요하다. 이게 없으면 설정이 이 창에
> 적용되지 않는다.

**`dw-env.ps1`이 없다는 오류가 나면** 한 번만 만들면 된다:

```powershell
cd C:\darkwar-platform; Copy-Item dw-env.example.ps1 dw-env.ps1
```

그리고 메모장으로 `dw-env.ps1`을 열어 `SUPABASE_SECRET_KEY = ""` 의 따옴표 안에
키를 넣는다. 키는 이 명령으로 확인한다:

```bash
supabase status -o json
```

출력에서 `SECRET_KEY` 값을 복사한다.

### 1-4. 캡처 시작

```powershell
uv run dw-capture
```

**보여야 할 것**:

```
capture.start   interface='Intel(R) Ethernet Controller (3) I225-V' port=8680 server_id=580
```

여기서 창이 멈춘 것처럼 보이는 게 **정상이다.** 게임을 지켜보는 중이다.

**다르게 나오면**

| 나온 것 | 뜻과 조치 |
|---|---|
| `DW_COLLECTOR_ID is required` | `.env`를 안 읽었다. 1-3부터 |
| `live capture needs the capture extra` | `uv sync --extra capture` 를 실행한다 |
| 아무 것도 안 뜨고 오류 | Npcap이 설치돼 있는지 확인 |

### 1-5. 게임에서 화면 열기

**VPN을 끈다.** 켜져 있으면 게임 통신이 암호화된 통로로 들어가서 아무것도 못 잡는다.

이 창을 **켜둔 채로** 게임(BlueStacks)으로 전환해서 아래 화면들을 연다.

> **중요**: 이미 열려 있는 화면은 게임이 저장해둔 값을 보여줄 뿐 서버에 다시
> 묻지 않는다. **반드시 닫았다가 다시 열어야** 한다.

| 게임에서 하는 동작 | 모이는 데이터 |
|---|---|
| 연맹 → 멤버 목록 | 연맹원 전체(이름·전투력·HQ·킬·접속) |
| 연맹 → 기부 랭킹 → **일간 탭·주간 탭을 각각** | 기부 기여도 2종. **탭마다 커맨드가 달라서 둘 다 열어야 둘 다 들어온다** |
| 연맹 → 듀얼(연맹 대전) → 일간·주간·라운드 | 듀얼 기여도 3종. 일간·주간에는 상대 연맹 선수도 함께 온다 |
| 연맹 → 랭킹 (로컬·크로스서버 둘 다) | 연맹 순위 |
| 다른 연맹 정보 열기 | 그 연맹 상세 + 연맹장 |
| 아레나 → 랭킹 | 아레나 Top100 |
| 플레이어 랭킹(전투력) | 서버군 전체 플레이어 |
| 플레이어 랭킹(킬) | 킬 수 |
| 아무 플레이어 프로필 클릭 | 6종 전투력 상세 |

### 1-6. 캡처 멈추기

PowerShell 창으로 돌아와 **Ctrl + C**.

**보여야 할 것**:

```
capture.stop   discovered=106 gap_skips=0 ingested=15 rejected=0 resync_bytes=396 rows=57 segments=1214
```

**숫자 읽는 법**

| 이름 | 뜻 | 정상 범위 |
|---|---|---|
| `segments` | 게임과 주고받은 데이터 조각 수 | 0이면 VPN이 켜졌거나 랜카드를 잘못 골랐다 |
| `ingested` | 우리가 **이미 아는** 화면 데이터 | 화면을 열었다면 1 이상. 0이면 1-5를 안 했거나 화면을 다시 안 열었다 |
| `discovered` | **아직 모르는** 새 데이터 종류 | 크게 나오는 게 정상. 나중에 기능 만들 때 쓴다 |
| `rows` | 저장된 줄 수 | `discovered`보다 작아도 정상(같은 모양은 한 번만 저장) |
| `rejected` | 아는 건데 읽다 실패 | **0이 아니면 알려달라.** 프로그램 문제다 |
| `resync_bytes`, `gap_skips` | 놓친 데이터 흔적 | 0에 가까워야 한다. 크면 그 세션 결과를 믿지 말고 다시 찍는다 |

### 1-7. 서버에 올리기

**같은 PowerShell 창에서** (설정이 그 창에만 살아 있다):

```powershell
uv run dw-collector sync
```

**보여야 할 것**:

```
journal=C:\DW_data\collector.db
sent=57 failed=0 outbox={'sent': 214}
```

**반드시 확인할 것**

- `journal=` 이 **`C:\DW_data\collector.db`** 인가? 다른 경로면 창을 잘못 열었다.
- `failed=0` 인가?

**다르게 나오면**

| 나온 것 | 뜻과 조치 |
|---|---|
| `Connection refused` / `WinError 10061` | 데이터베이스가 꺼졌다. 1-1로 돌아간다. 데이터는 안 없어지고 다음 sync에 다시 올라간다 |
| `SUPABASE_URL and ... are required` | 1-3의 설정 불러오기를 안 했다 |
| `sent=0` 인데 방금 모았다 | `journal=` 경로를 본다. 십중팔구 다른 폴더에서 돌렸다 |

### 1-8. 화면에서 확인

PowerShell에서:

```powershell
cd C:\darkwar-platform; pnpm dev
```

**보여야 할 것**: `Local: http://localhost:5173/` — 브라우저로 그 주소를 연다.

로스터·연맹 순위·아레나가 보이고, 각 줄 오른쪽에 **언제 관측했는지** 배지가 붙는다.

멈추려면 Ctrl + C.

---

## 2. 무엇이 모였는지 보기

```powershell
uv run dw-collector journal-summary
```

저장소 경로, 대기 중인 항목 수, 커맨드별 개수, 테이블별 줄 수가 나온다.
1-6의 숫자가 이상할 때 여기서 확인한다.

---

## 3. 발견 세션 (새 기능 자료 모으기)

새 기능(이벤트·시즌·전투 리포트)을 만들려면 **아직 모르는 데이터**를 모아야 한다.
이때는 **Wireshark를 같이 켠다.**

### 왜 같이 켜나

`dw-capture`는 **읽는 데 성공한 것만** 저장한다. Wireshark는 **원본 그대로** 파일에
남긴다. 나중에 프로그램을 고친 뒤 그 파일을 **다시 읽을 수 있다.**

이 프로젝트에서 실제로 두 번 도움이 됐다 — 읽기 버그를 고친 뒤 같은 파일을 다시
읽어 데이터를 살렸다. 파일 하나에서 기능 세 개 분량의 자료가 나왔다.

### 순서

1. **Wireshark 실행** → 어댑터 목록에서 `Intel(R) Ethernet Controller (3) I225-V`
   선택
2. 위쪽 **capture filter**(캡처 필터) 칸에 정확히 입력: `tcp port 8680`
   - 아래쪽 display filter가 아니다. 잘못 넣으면 파일이 수십 배 커진다
3. 상어지느러미(시작) 버튼 클릭
4. **1-3, 1-4**대로 `dw-capture`도 켠다 (둘이 서로 방해하지 않는다)
5. `capture-sweep.md`의 화면 목록을 순서대로 연다
6. `dw-capture`는 Ctrl+C, Wireshark는 정지 버튼
7. Wireshark에서 **File → Save As** → `C:\DW_data\probe.pcapng`
   - 형식은 기본값(pcapng) 그대로

### 파일에서 데이터 읽기

```powershell
uv run dw-collector scan-capture --pcap C:\DW_data\probe.pcapng --db C:\DW_data\probe.db
```

```powershell
uv run dw-collector journal-summary --db C:\DW_data\probe.db
```

```powershell
uv run dw-collector sync --db C:\DW_data\probe.db
```

> **`--db`를 빼먹지 않는다.** 빼면 평소 저장소를 보게 되어 방금 읽은 것이 안 올라간다.

### 주의

- pcap 파일에는 **계정 식별자와 접속 증명**이 들어 있다. `C:\DW_data`처럼
  저장소 밖에 두고 절대 커밋하지 않는다
- 평소 수집에는 Wireshark를 켜지 않는다. 파일만 쌓이고 얻는 게 없다

---

## 4. 코드 업데이트 (PR 머지 후)

**양쪽 다** 업데이트해야 한다.

PowerShell:

```powershell
cd C:\darkwar-platform; git pull; pnpm install
```

데이터베이스 구조가 바뀌었으면(마이그레이션 포함 PR):

```bash
supabase db reset && supabase test db
```

**`db reset`은 서버 데이터를 비운다.** 대신 Windows의 저장소에 원본이 남아 있어서
5번으로 되돌릴 수 있다.

PowerShell 창:

```powershell
cd C:\darkwar-platform; git pull; cd services\collector; uv sync --extra capture
```

### 4-2. 작업 하나만 재시작하기 — `Stop-ScheduledTask`만으로는 안 된다

**2026-08-16에 실제로 겪었다.** 새 알림 이벤트를 머지하고 `dw-notify`만
재시작하려다 조용히 멈췄다.

`Stop-ScheduledTask`는 **작업의 껍데기(wscript → cmd)만 죽이고 그 아래
파이썬 워커는 살려둔다.** 확인해보니 이틀 전에 뜬 프로세스 다섯 개가 그대로
살아 있었다:

```
uv.exe 14980 / uv.exe 16068 / dw-notify.exe 16836 / python.exe 16888 / python.exe 17008
전부 2026-08-14 19:24 시작
```

그 워커가 `notify.log`를 붙잡고 있으므로, 새로 시작한 작업의 `>> notify.log`
리다이렉트가 **공유 위반으로 실패하고 cmd가 exit 1로 끝난다.** 결과는:

- 작업 상태 `Ready`
- 로그에 **아무것도 안 남음**
- "재시작했으니 새 코드가 돌겠지"라고 믿게 됨

`register-tasks.ps1`은 이 함정을 알고 있고 명령줄로 프로세스를 찾아 죽인다
(`Match` 목록). **작업 하나만 재시작하는 절차가 없었을 뿐이다.** 이 절이 그것이다.

```powershell
Stop-ScheduledTask -TaskName 'DarkWar-Notify'
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like '*dw-notify*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName 'DarkWar-Notify'
```

작업 이름과 `-like` 패턴만 바꾸면 나머지 셋도 같다. **`dw-sync`는 패턴이
`*dw-sync*`, 캡처는 `*cap.pcapng*`** — dumpcap은 이름에 작업 이름이 없다.

**반드시 확인한다.** `Running`이 아니면 안 돈 것이고, 로그에 시작 줄이 없으면
위 함정에 다시 걸린 것이다:

```powershell
(Get-ScheduledTask -TaskName 'DarkWar-Notify').State
Get-Content 'C:\DW_data\logs\notify.log' -Tail 3
```

성공하면 이렇게 보인다:

```
Running
2026-08-16 18:25:36 [info     ] notify.start                   interval=300.0
```

**venv를 다시 만들 필요는 없다.** 패키지가 editable로 설치돼 있어
(`_editable_impl_dw_collector.pth`) 재시작만으로 새 소스를 읽는다. `uv sync`가
필요한 것은 **의존성이 바뀐 PR**뿐이고, 그때는 4번처럼 네 작업을 모두 멈춘
뒤에 해야 한다 — 실행 중인 작업이 `.venv\Scripts`의 exe를 잡고 있으면
sync가 os error 32로 죽는다.

---

## 5. 데이터베이스를 비운 뒤 되살리기

`db reset`을 했다면 서버는 비었지만 **Windows 저장소는 전부 기억하고 있다.**

```powershell
uv run dw-collector retry-outbox --already-sent
```

```powershell
uv run dw-collector sync
```

여러 번 올려도 중복이 생기지 않는다(서버가 같은 데이터를 알아보고 무시한다).

---

## 5-2. 저널이 커졌을 때 (`prune-journal`)

저널은 하루 **0.92 GB**씩 자라고 **아무것도 자동으로 줄이지 않는다.** 급하진
않다 — 디스크 여유로 약 반년 — 다만 아무도 안 줄인다는 것이 저절로 고쳐지지는
않는다.

```powershell
# 무엇이 지워질지 세기만 한다 (안전, 수집 중에 돌려도 된다)
uv run --no-sync dw-collector prune-journal --db "C:/DW_data/live.db"
```

숫자가 납득되면 지운다. **VACUUM은 쓰기를 멈추고 한다** — 파일 전체를 다시
쓰고 5 GB 기준 45초 걸린다.

```powershell
schtasks /end /tn DarkWar-Ingest
schtasks /end /tn DarkWar-Sync
uv run --no-sync dw-collector prune-journal --db "C:/DW_data/live.db" --confirm --vacuum
foreach ($n in 'DarkWar-Ingest','DarkWar-Sync') { Start-ScheduledTask -TaskName $n }
```

끝나면 **로그로 진짜 도는지 본다.** 이 작업들은 죽어도 성공처럼 보인 전력이
있다.

**알아둘 것 넷**

- **`--confirm` 없이는 아무것도 안 지운다.** 0070의 `retention_report()`와 같은
  모양이고, 이유도 같다 — 숫자를 먼저 보면 계획이 바뀐 적이 있다.
- **`delete`만으로는 파일이 안 줄어든다.** 페이지가 free list로 갈 뿐이다.
  반대도 참이다: 지우기 전에 VACUUM해봐야 소용없다(첫 수동 정리 때
  `freelist_count`가 3이었다).
- **`held back: N`이 나오면 그 N은 경고다.** 기간이 지났는데도 남긴 관측 수이고,
  남긴 이유는 그 행들이 아직 클라우드에 안 갔기 때문이다. 이 숫자가 회차마다
  커지면 **outbox가 안 빠지고 있다는 뜻이다.** 먼저 `sync`를 돌린다.
- **경로에 따옴표를 씌운다.** `--db C:\DW_data\live.db`를 bash에서 그냥 쓰면
  백슬래시가 먹혀 `C:DW_datalive.db`라는 **빈 저널이 새로 생기고 전부 0으로
  보고된다.** 출력 첫 줄 `journal=`이 그걸 잡으라고 있는 것이다.

무엇이 남고 무엇이 가는가:

| | 정책 |
|---|---|
| `raw_observations` | **기간 내는 무조건 보존.** 파서를 고쳐 과거 트래픽에 다시 돌리는(`renormalize`) 유일한 원천 |
| `normalized_rows` | 관측과 함께 간다 (원천이 없으면 재생성도 불가) |
| `sync_outbox` (`sent`) | 기간 지나면 삭제. 큐이지 기록이 아니고, 클라우드가 갖고 있다 |
| `sync_outbox` (`pending`/`dead_letter`) | **절대 안 지운다.** 그 관측도 나이와 무관하게 남는다 |

기본 30일인 이유는 raw payload의 남은 용도가 "파서가 틀렸다는 걸 알아채는 데
걸리는 시간"이기 때문이다. 줄이면 소급 수정이 닿는 범위가 줄 뿐, 대시보드가
망가지지는 않는다.

**스케줄에 걸지 않았다.** 0070이 클라우드 쪽에서 같은 판단을 했다 — 켜기 전에
숫자를 먼저 본다.

---

## 6. 문제가 생겼을 때

| 증상 | 원인 | 해결 |
|---|---|---|
| `DW_COLLECTOR_ID is required` | `.env`가 안 읽혔다 | 1-3부터 |
| `packets: 0` / `segments=0` | VPN이 켜져 있다 | VPN을 끊고 다시 |
| `ingested=0` | 게임 화면을 안 열었거나 다시 안 열었다 | 1-5, 화면을 **닫았다 다시** |
| `sent=0` 인데 데이터가 있어야 함 | 저장소를 잘못 봤다 | 출력의 `journal=` 확인 |
| `Connection refused` | 데이터베이스가 꺼짐 | `supabase start`, Docker Desktop 확인 |
| `curl` 응답이 `000` | 일부 서비스만 죽음 | `supabase stop && supabase start` |
| `docker: command not found` | Docker Desktop이 안 떠 있다 | Docker Desktop을 켜고 다시 |
| `outbox={'dead_letter': N}` | 여러 번 실패해 포기한 항목 | 원인 고친 뒤 `retry-outbox --dead-letters` |
| `held back: N` (prune) | 그 관측의 행이 아직 클라우드에 안 갔다 | `sync` 먼저. N이 계속 크면 outbox가 막힌 것 |
| 저널이 계속 커짐 | 자동으로 줄이는 장치가 없다 | 5-2 `prune-journal` |
| `rejected > 0` | 프로그램이 못 읽는 데이터 | 개발자에게 알린다(수정 필요) |
| `git pull`이 `uv.lock` 때문에 멈춤 | 자동 생성 파일 충돌 | 그 파일을 지우고 다시 pull |

---

## 7. 자주 하는 실수 모음

1. **다른 폴더에서 실행** — 가장 흔하다. 저장소 안인지, `.env`가 읽혔는지 먼저 본다
2. **`. ..\..\dw-env.ps1` 의 점을 빼먹음** — 설정이 안 들어간다
3. **PowerShell 창을 새로 열고 설정을 다시 안 불러옴** — 설정은 창마다 따로다
4. **화면을 열어둔 채로 캡처 시작** — 게임이 서버에 안 묻는다. 닫았다 열어야 한다
5. **VPN을 안 끔** — 0패킷
6. **`scan-capture` 할 때 `--db` 빼먹음** — 읽은 데이터가 평소 저장소로 안 간다
7. **pcap이나 저장소 파일을 저장소 폴더에 둠** — 계정 정보가 들어 있다

---

## 명령 한눈에

| 명령 | 어디서 | 무엇을 |
|---|---|---|
| `dw-capture` | Windows | 라이브 수집 (Ctrl+C로 중지) |
| `dw-collector sync` | Windows | 모은 것 서버로 1회 전송 |
| `dw-sync` | Windows | 전송을 주기적으로 반복 + 상태 보고 |
| `dw-collector journal-summary` | 어디서나 | 저장소에 뭐가 있는지 |
| `dw-collector retry-outbox` | Windows | 실패/전송분을 다시 대기로 |
| `dw-collector scan-capture --pcap X --db Y` | 어디서나 | pcap 파일 읽기 |
| `dw-collector extract-fixture` | 어디서나 | pcap → 테스트용 살균 자료 |
| `dw-collector replay --fixture X` | 어디서나 | 자료 1개 통과시키기 |
| `dw-collector init-db` | 어디서나 | 저장소 파일 만들기 |
| `supabase start` / `stop` | PowerShell | 데이터베이스 켜기/끄기 |
| `supabase db reset` | PowerShell | 구조 새로 적용(데이터 비움) |
| `pnpm dev` | PowerShell | 화면 띄우기 |

`dw-jobs`, `dw-ui-worker`는 아직 만들지 않았다(수집 전용 계정과 ADB 자동화가
준비된 뒤).

---

## 개발자용: 새 데이터 종류를 기능으로 만들기

1. 발견 세션(3번)으로 자료를 모으고 `schema_observations`에서 모양을 본다
2. **판정** — `capture-sweep.md`의 기준. UID가 있는지, 개인별인지 집계인지.
   UID가 있다는 것만으로는 부족하다(그 UID가 *누구*를 가리키는지 확인해야 한다)
3. `sanitize.py`에 살균 함수 추가 — 없으면 `extract-fixture`가 거부한다
4. `extract-fixture`로 자료 생성. `--captured-at`은 **추측하지 말고** payload의
   서버 시각에서 취한다
5. `protocol-fixtures/manifests/`에 원본 sha256과 메모
6. 정규화기 + 테스트(정상·널·불량·provenance)
7. **PR 1개당 파서 1개**
