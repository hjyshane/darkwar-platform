# DarkWar 577–584 Collector + Dashboard

Windows에서 BlueStacks의 기존 인증 세션을 **수동으로 관찰**하여
Dark War 연맹·플레이어 데이터를 SQLite에 저장하는 초기 구현입니다.

Wireshark GUI는 사용하지 않습니다. 패킷 캡처는 Npcap과 Scapy가 담당합니다.

## 현재 지원하는 응답

| Command | 저장 내용 |
|---|---|
| `alliance.rank` | 577–584 연맹 순위와 서버별 Top 3 |
| `get.al.info` | 연맹 코드명, 전체 이름, 리더, 전투력, 가입 조건 |
| `al.rank` | 연맹원 UID, 이름, 전투력, HQ, R1–R5, 킬, 직업 정보 |

타 연맹의 `online`, `offLineTime`, `pointId`는 서버가 기본값으로 가리는
것으로 확인되어 대시보드에서 redacted 상태로 표시합니다.

## 설계 범위

이 버전은 다음을 하지 않습니다.

- 게임 계정 로그인 재현
- 세션 토큰 추출 또는 복제
- 패킷 변조·주입
- 서버에 독립 요청 전송
- 라이브 SmartFox 연결에 패킷 주입
- 게임 계정의 동시 로그인 또는 세션 복제

기본 수집은 계속 passive입니다. v0.3.0의 선택적 ADB 자동화는 Windows가
유휴 상태일 때만 읽기 전용 화면을 순회하며, 사용자 입력이 감지되면 다음
클릭 전에 중단합니다.

## 1. 준비

### Python

Python 3.11 이상을 설치합니다.

### Npcap

Npcap을 설치합니다. Scapy 공식 Windows 설치 안내에 따라
**WinPcap compatibility mode는 끄는 것**을 권장합니다.

Wi-Fi monitor mode 옵션은 이 프로그램에 필요하지 않습니다.


## Python 런타임을 찾지 못하는 경우

다음 오류가 나오면 Windows에 지원되는 Python 런타임이 없는 상태입니다.

```text
No suitable Python runtime found
Could not create the Python virtual environment.
```

수정된 `setup.bat`은 Python 3.11/3.12를 탐색하고, 없으면 WinGet을 통한
Python 3.12 설치를 제안합니다.

직접 설치하려면 PowerShell에서:

```powershell
winget install --id Python.Python.3.12 -e --source winget
```

설치 후 열려 있던 Command Prompt와 PowerShell을 모두 닫고 다시 연 뒤:

```text
setup.bat
```

을 실행합니다.


## 2. 설치

압축을 푼 폴더에서:

```text
setup.bat
```

가상환경과 Python 패키지를 자동 설치하고 seeded database를 검증합니다.

## 3. Collector 실행

```text
start_collector.ps1
```

PowerShell이 관리자 권한을 요청합니다.

정상 시작 메시지:

```text
capture filter: tcp port 8680
Open alliance rankings or member lists in BlueStacks.
```

이후 BlueStacks에서:

1. 크로스 서버 연맹 랭킹을 엽니다.
2. 대상 연맹 프로필을 엽니다.
3. 해당 연맹의 멤버 목록을 엽니다.

응답이 들어오면 다음처럼 저장 메시지가 표시됩니다.

```text
saved alliance ranking: 100 alliances
saved alliance info: [LovE]
saved members: [LovE] 98
```

## 4. Dashboard 실행

별도 창에서:

```text
start_dashboard.bat
```

브라우저에서 다음 화면을 볼 수 있습니다.

- 577–584 서버별 Top 3
- Top-3 멤버 데이터 수집 완료율
- `[코드명]` 기준 연맹 상세
- 멤버 전투력·HQ·R등급
- 플레이어 이름/UID 검색
- 반복 snapshot 간 가입·탈퇴·전투력 변화
- 최근 캡처 이벤트

초기 데이터로 `[CBFW]`, `[LovE]`, 크로스 서버 Top 100이 들어 있습니다.

## 5. 인터페이스가 잘못 잡힐 때

```text
list_interfaces.bat
```

사용 중인 Wi-Fi/Ethernet의 `name`을 확인하고 `config.toml`을 수정합니다.

```toml
[capture]
interface = "Wi-Fi"
port = 8680
server_ip = ""
```

`server_ip`는 비워두는 것이 안전합니다. 게임 서버 IP가 변경될 수 있습니다.

## 6. 기존 PCAPNG 가져오기

```text
import_capture.bat
```

위 파일로 `.pcapng`를 드래그하면 현재 SQLite에 snapshot을 추가합니다.

또는:

```powershell
.venv\Scripts\python.exe -m darkwar_tracker.offline capture.pcapng
```

## 데이터베이스

기본 위치:

```text
data/darkwar.sqlite3
```

주요 테이블:

- `alliances`
- `players`
- `ranking_snapshots`
- `ranking_entries`
- `member_snapshots`
- `member_entries`
- `tracked_alliances`
- `capture_events`

SQLite WAL 모드를 사용하므로 collector와 dashboard를 동시에 실행할 수 있습니다.

## 다음 개발 단계

1. ADB 기반 랭킹 화면 순회 보조
2. 24개 Top-3 연맹 수집 체크리스트
3. snapshot 스케줄과 변화 알림
4. FastAPI API 계층
5. 사용자 인증이 있는 웹 배포
6. 실행 파일 패키징

초기 버전에서는 안정성을 위해 passive capture만 사용합니다.


## `bytes is not JSON serializable` 오류

v0.1.0–v0.1.1에서는 게임의 일부 비대상 SmartFox 메시지에 binary byte array가
포함되면 다음 경고와 함께 캡처가 종료될 수 있었습니다.

```text
Object of type bytes is not JSON serializable
```

v0.1.2에서는 byte array를 길이와 hexadecimal 문자열로 안전하게 저장합니다.
또한 개별 패킷 처리 오류가 발생해도 collector 캡처는 계속됩니다.

기존 `data/darkwar.sqlite3`는 그대로 사용할 수 있습니다.



## `rankName`이 `null`인 `al.rank` 응답

일부 연맹 또는 일부 UI 경로의 `al.rank` 응답은 `rankName`을 object가 아니라
`null`로 반환합니다. v0.1.2 이하에서는 이 경우 다음 오류가 발생했습니다.

```text
AttributeError: 'NoneType' object has no attribute 'get'
```

v0.1.3에서는 `rankName = null`을 빈 매핑으로 처리합니다. 멤버의 숫자 R등급은
정상 저장되며, 등급 별칭만 비어 있을 수 있습니다. 기존 SQLite 데이터는 유지됩니다.


# v0.2.0 — Activity, Growth, and Monthly Pass

## Added dashboard sections

### Activity & Growth

This tab is available for an alliance whose latest `al.rank` snapshot is not
redacted, normally your own alliance.

It shows:

- members currently observed online
- members seen within 24 hours
- members inactive for 3 or 7 days
- average and median member power
- total member-power change
- individual power change
- HQ-level changes
- kill-count changes
- joins and departures
- alliance power history across snapshots

The comparison can use the previous snapshot, approximately 24 hours, 7 days,
or 30 days.

### Monthly Pass

The game response field used is:

```text
monthCardEndTime
```

The dashboard derives:

- active
- inactive or expired
- expiration within 3 days
- expiration within the configured warning period
- unknown when the server does not expose the field
- activation detected between snapshots
- renewal detected from an increased expiration timestamp
- expiration detected between snapshots

Monthly-pass status is kept separate from the activity score. It is account
status information, not evidence of event participation.

### Change events

The new `member_change_events` table stores detected changes between consecutive
member snapshots:

```text
joined
left
power_changed
hq_changed
kills_changed
monthly_pass_activated
monthly_pass_renewed
monthly_pass_expired
```

This table is intended to become the source for later Discord notifications and
Supabase synchronization.

## Automatic dashboard refresh

The dashboard sidebar supports:

```text
Off
10 seconds
30 seconds
60 seconds
5 minutes
```

Only the dashboard reruns automatically. The collector remains passive in this
release: the game still needs to produce `al.rank` by opening or refreshing the
member list. Unattended BlueStacks UI navigation is a separate development step.

## Configuration

`config.toml` now includes:

```toml
[activity]
own_alliance_code = "CBFW"
auto_refresh_seconds = 30
inactive_warning_days = 3
inactive_critical_days = 7
pass_expiry_warning_days = 7
```

Change `own_alliance_code` if the alliance code changes.

## Upgrade from v0.1.x

1. Stop the collector and dashboard.
2. Back up:

```text
data\darkwar.sqlite3
```

3. Apply the v0.2.0 patch and replace existing files.
4. Run:

```powershell
.\.venv\Scripts\python.exe -m darkwar_tracker.migrate --config config.toml
```

5. Run regression tests:

```powershell
.\.venv\Scripts\python.exe .\scripts\test_bytes_payload.py
.\.venv\Scripts\python.exe .\scripts\test_null_rank_names.py
.\.venv\Scripts\python.exe .\scripts\test_activity_growth.py
```

6. Restart:

```powershell
.\start_collector.ps1
.\start_dashboard.bat
```

`start_dashboard.bat` also runs the migration automatically. Existing SQLite
data is retained. If multiple historical snapshots already exist, migration
backfills missing change events without duplicating them.

## Recommended collection for activity tracking

For useful trends, collect your own alliance member list repeatedly. Initial
recommendation:

```text
every 30–60 minutes while testing
every 2–6 hours for normal long-term tracking
```

The dashboard can remain open during collection and refresh automatically.


## v0.2.1 플레이어 상세 전투력

다음 응답을 자동 저장합니다.

| Command | 저장 내용 |
|---|---|
| `server.rank` | 크로스 서버 플레이어 순위와 UID |
| `get.new.user.info` | 건물·과학·영웅·병사·차량·펫 전투력 |
| `get.user.info.multi` | VIP, 대표 영웅 ID, 공개 프로필 보조 정보 |

멀티 서버 플레이어 랭킹과 연맹 멤버 목록에서 프로필을 열 때 모두
`get.new.user.info`가 사용됩니다.

기존 collector에서 이미 프로필을 열었다면 다음 명령으로 과거
`capture_events`를 새 테이블에 역산할 수 있습니다.

```powershell
.\.venv\Scripts\python.exe -m darkwar_tracker.migrate --config config.toml
```


## v0.2.2 아레나 주간 매치

다음 응답을 자동 저장합니다.

| Command | 저장 내용 |
|---|---|
| `user.get.arena.info` | 주간 상대 서버, 기간, Top 100, 점수, 방어 전투력 |
| `user.arena.save.defend.army` | 내 방어 편성 요청과 서버 확인 응답 |

주간 매치는 `fightServers`, `startTime`, `endTime`, `userArenaType` 조합으로
식별합니다. 580이 `fightServers`에 포함되면 기준 서버를 580으로 지정하고,
나머지 서버를 해당 주의 상대 서버로 저장합니다. 새 주간 조합이 들어오면
이전 active match는 closed로 전환됩니다.

랭킹 응답의 `army` 문자열은 보존하지만 아직 내부 protobuf 편성을 해독하지
않습니다. 현재 버전에서는 순위, 점수, 전투력, 서버, 연맹, 플레이어 UID를
안정적으로 추적합니다.

# v0.2.3 — Daily Arena Screen Automation

아레나 수집 기준은 **주간 리셋이 아니라 매일 서버 리셋 + 2분**입니다.
현재 확인된 서버 리셋은 `02:00 UTC`이므로 Scheduler 실행 시각은 매일
`02:02 UTC`입니다. 미국 동부시간으로는 서머타임 중 전날 오후 10:02,
표준시간 중 전날 오후 9:02에 해당하지만, Scheduler는 로컬시간이 아니라
UTC를 사용하므로 DST 설정을 직접 변경할 필요가 없습니다.

주간 매치업은 계속 다음 응답으로 판별합니다.

```text
fightServers + startTime + endTime + userArenaType
```

따라서 매일 랭킹 snapshot을 추가하되, 상대 서버 조합이 바뀌는 날에만
새 `arena_matches` 행이 생성되고 기존 주차는 `closed` 처리됩니다.

## 자동화 동작

```text
매일 02:02 UTC
→ BlueStacks ADB 연결
→ Dark War 전면 실행 또는 재시작
→ 1회 보정한 화면 클릭 순서 실행
→ user.get.arena.info 수신
→ Collector가 SQLite에 저장
→ 새 arena snapshot 저장 여부 검증
→ 실패 시 1분, 3분, 10분 후 재시도
```

Collector가 함께 실행 중이어야 저장 검증이 성공합니다.

## 1회 보정

BlueStacks에서 다음을 먼저 설정합니다.

```text
Settings → Advanced → Android Debug Bridge 활성화
```

그다음 프로젝트 폴더에서 실행합니다.

```text
calibrate_arena.bat
```

보정 창이 Dark War를 새로 실행합니다. 화면에서 아레나 랭킹까지 이동하는
버튼을 하나씩 클릭한 뒤 `좌표 저장 후 실행`을 누릅니다. 아레나 랭킹이
열려 갱신된 상태가 되면 `완료 및 저장`을 누릅니다.

보정 결과:

```text
data/arena_taps.json
```

보정이 완료되면 `config.toml`의 `arena_automation.enabled`가 자동으로
`true`로 변경됩니다.

## 실행

Collector와 Arena Scheduler를 함께 시작:

```powershell
.\start_darkwar_services.ps1
```

Arena Scheduler만 실행:

```powershell
.\start_arena_scheduler.ps1
```

지금 즉시 테스트:

```text
refresh_arena_now.bat
```

상태 확인:

```text
arena_scheduler_status.bat
```

로그:

```text
logs/arena_automation.log
logs/collector.log
```

## Windows 로그인 시 자동 시작

관리자 PowerShell에서 한 번 실행합니다.

```powershell
.\install_darkwar_autostart.ps1
```

이 작업은 Windows 로그인 시 Collector와 Arena Scheduler를 관리자 권한으로
백그라운드 실행합니다. 해제:

```powershell
.\uninstall_darkwar_autostart.ps1
```

## 게임 재시작 옵션

기본값:

```toml
force_restart_game = true
```

매일 같은 시작 화면에서 이동하기 때문에 가장 안정적입니다. 다만 02:02 UTC에
직접 플레이 중이면 게임이 재시작될 수 있습니다. 이를 피하려면:

```toml
force_restart_game = false
```

로 변경할 수 있지만, 게임이 임의의 화면에 있을 때 기록된 클릭 순서가 맞지 않아
자동 수집이 실패할 가능성이 높습니다.

## 기존 v0.2.2 설정 파일에 섹션 추가

패치 적용 후 다음 명령을 한 번 실행합니다.

```powershell
.\.venv\Scripts\python.exe .\scripts\add_arena_config.py --config config.toml
```

## 회귀 테스트

```powershell
.\.venv\Scripts\python.exe .\scripts\test_arena_daily_scheduler.py
```

정상 결과:

```text
arena daily scheduler regression test passed
```


# v0.3.0 — Refresh Center and Idle-Aware Weekly Policy

v0.2.3의 매일 Arena 전용 Scheduler는 기본 운영 정책에서 제외되었습니다.
새 기본 정책은 다음과 같습니다.

```text
평상시
└─ passive capture only

필요할 때
└─ Dashboard에서 수동 갱신 요청
   └─ Windows 유휴 상태에서만 실행

매주 월요일 02:05 UTC
└─ 주간 전체 갱신 작업 생성
   ├─ Arena startup snapshot
   ├─ player + alliance rankings
   ├─ own-alliance member snapshot
   └─ tracked-alliance member snapshots
```

월요일 기준 시각은 게임 서버 리셋 `02:00 UTC`의 5분 후입니다. 미국
동부시간으로는 DST 중 일요일 오후 10:05, 표준시간 중 일요일 오후 9:05지만,
프로그램은 UTC를 사용합니다.

## Refresh Center

Dashboard 첫 탭에서 다음을 관리합니다.

- 현재 주간 reset window
- 다음 weekly refresh 시각
- Arena, Rankings, My Alliance, Tracked Alliances 최신성
- `Current · Passive`, `Current · Automated`, `Pending`, `Waiting for idle`,
  `Setup required`, `Stale`, `Missing` 상태
- 수동 갱신 버튼
- weekly/manual job queue
- 현재 단계, 시도 횟수, 오류
- pending job 취소
- 각 UI workflow의 calibration 준비 상태

수동 버튼은 즉시 화면을 누르지 않습니다. 요청을 SQLite queue에 추가하고,
사용자가 자연스럽게 같은 데이터를 열어 패킷이 들어오면 해당 단계는
`Passive` 완료로 처리됩니다. 그렇지 않은 경우 유휴 상태에서만 실행됩니다.

## Weekly full refresh calibration

Arena는 게임을 유휴 상태에서 재시작하면 로그인 직후
`user.get.arena.info`가 자동 발생하는 동작을 이용하므로 별도 좌표 보정이
필요하지 않습니다.

나머지 주간 화면은 한 번의 통합 경로로 보정할 수 있습니다.

```text
calibrate_refresh.bat
→ 1. Full Weekly
```

권장 Full Weekly 경로:

```text
게임 홈
→ 멀티 서버 플레이어 랭킹
→ 연맹 랭킹
→ 우리 연맹원 목록
→ 추적 연맹 멤버 목록 순회
→ 완료
```

저장 파일:

```text
data\refresh_sequences\full_weekly_ui.json
```

Rankings, My Alliance, Tracked Alliances를 개별 수동 버튼으로 자동화하려는
경우에만 각각의 별도 경로를 추가 보정합니다.

## Idle-aware safety behavior

기본 설정:

```toml
[refresh_automation]
enabled = true
weekly_enabled = true
weekly_weekday_utc = 0
reset_hour_utc = 2
reset_minute_utc = 0
weekly_delay_seconds = 300
idle_seconds_required = 300
```

동작:

1. 최근 키보드·마우스 입력이 5분 이내이면 작업을 시작하지 않습니다.
2. BlueStacks 또는 Dark War가 전면에서 사용 중이면 대기합니다.
3. 자동 경로 중 입력이 감지되면 다음 tap 전에 중단합니다.
4. 완료된 단계는 유지하고, 남은 단계는 다음 유휴 시간에 재개합니다.
5. UI 경로 파일이 없으면 `Setup required`로 남으며 기존 데이터는 삭제하지
   않습니다.

## 실행

```powershell
.\start_darkwar_services.ps1
```

위 스크립트는 다음을 시작합니다.

```text
Passive Collector
+ Idle-Aware Refresh Worker
```

Dashboard:

```text
start_dashboard.bat
```

상태 확인:

```text
refresh_worker_status.bat
```

대기 작업 하나를 즉시 평가:

```text
run_refresh_once.bat
```

`run_refresh_once.bat`도 idle 조건을 우회하지 않습니다.

## Upgrade from v0.2.3

1. Collector, Arena Scheduler, Dashboard를 종료합니다.
2. `data\darkwar.sqlite3`를 백업합니다.
3. v0.3.0 patch를 기존 폴더에 덮어씁니다.
4. 기존 `config.toml`을 보존한 상태에서 실행합니다.

```powershell
.\.venv\Scripts\python.exe .\scripts\add_refresh_config.py --config config.toml
.\.venv\Scripts\python.exe -m darkwar_tracker.migrate --config config.toml
.\.venv\Scripts\python.exe .\scripts\test_refresh_policy.py
.\.venv\Scripts\python.exe .\scripts\test_idle_detection.py
```

5. `calibrate_refresh.bat`에서 Full Weekly 경로를 한 번 기록합니다.
6. 다음으로 실행합니다.

```powershell
.\start_darkwar_services.ps1
.\start_dashboard.bat
```

기존 SQLite, Arena, player profile, alliance activity, monthly-pass, and change
history are retained.

## Scope of “Full Weekly”

Weekly full refresh includes core ranking and roster snapshots. It does not open
and refresh every individual `get.new.user.info` profile because that requires
one UI request per player. Detailed profiles continue to update passively when
profiles are opened, or through a future selected-player workflow.

# v0.4.0 — Discord Activity Dashboard

v0.4.0 adds a native Discord Activity that runs the DarkWar dashboard inside
Discord rather than sending only bot messages.

## Activity components

```text
activity/client/                 Vite single-page frontend
activity/dist/                   built Activity frontend
 darkwar_tracker/activity_api.py FastAPI + Discord OAuth + SQLite API
```

Tabs:

- Overview
- Arena
- Rankings
- Alliances
- Players
- Refresh Center

The Activity uses the official Discord Embedded App SDK OAuth flow with the
`identify` scope. Dashboard reads require an authenticated Discord identity.
Refresh queue and cancel actions additionally require a Discord user ID listed
in `discord_activity.admin_user_ids`.

## Build and start

```powershell
.\setup_discord_activity.bat
# edit .env.activity and config.toml
.\start_discord_activity.ps1
.\start_activity_tunnel.ps1
```

Full setup: `DISCORD_ACTIVITY_SETUP.md`.

## Security boundaries

- `DISCORD_CLIENT_SECRET` is read only from `.env.activity` on the server.
- OAuth access tokens remain in Activity memory and a short-lived server cache.
- Raw PCAP, Dark War login tokens, and SmartFox session payloads are not exposed.
- Dashboard endpoints are OAuth-protected.
- Refresh actions are admin-allowlisted and still obey idle-aware scheduling.
