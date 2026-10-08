# 런북: 아이폰을 USB로 맥에 꽂고 다크워 패킷 뜨기 (`rvictl`)

아이폰의 다크워 앱이 주고받는 패킷을, 아이폰을 USB로 맥에 연결해서 **맥에서**
뜬다. BlueStacks도 Npcap도 필요 없다. 뜬 파일은 `mac-capture.md`와 같은
`ingest-dir` → `sync`로 올라간다.

**상태: Windows에서 `pymobiledevice3`로 실제 아이폰 캡처를 돌려 읽히는 것까지 확인했다(2026-10-08, 맨 아래 표). 맥 `rvictl` 경로는 아직 한 번도 못 돌렸다.** 이 문서의 1~3단계는
"되는지 확인하는 테스트"고, 확인된 뒤에야 4단계(본 수집)로 간다. 확인 결과는 맨
아래 표에 적는다.

Windows에는 `rvictl`이 없다(macOS 전용). Windows는 아래 "Windows에서" 절을 본다.

## 왜 코드 변경이 필요 없어 보이나

`rvi0`은 Apple이 만든 가상 인터페이스고, `tcpdump`/`dumpcap`이 이걸 열면 파일의
링크 타입은 raw IP(101)이거나 `-i any`로 뜨면 PKTAP(258) 안의 raw IP(DLT 12)다.
둘 다 `protocol/linklayer.py`가 이미 읽고, `tests/test_capture_formats.py`가
raw 링크 타입(IPv4, IPv6 확장 헤더, 길이 0 포함)을 고정해 둔다. 그래서 이 경로에
새로 필요한 것은 문서뿐이라고 본다 — **실제 `rvi0` 파일로 확인되기 전까지는
"본다"일 뿐이다.** 2단계에서 `UNREADABLE unsupported link type N`이 나오면 그때
`linklayer.py`에 N을 추가한다(고정 테스트와 함께).

## 사전 준비 (1회)

1. **Xcode** (또는 Xcode Command Line Tools) — `rvictl`이 들어 있다.

   ```bash
   which rvictl
   ```

   없으면 `xcode-select --install`. 그래도 없으면 App Store의 Xcode.
2. **Wireshark** + "Install ChmodBPF" — `mac-capture.md`의 사전 준비 2번과 같다.
3. `~/dw-data/.env`, `DW_ENV_FILE`, `~/dw-captures` — `mac-capture.md`의 3번과 같다.
4. 아이폰을 USB로 꽂고, 아이폰 화면에서 **"이 컴퓨터를 신뢰"** 를 누른다.

## 1단계: 가상 인터페이스 만들기

1. 아이폰의 UDID를 구한다.

   ```bash
   pymobiledevice3 usbmux list
   ```

   `UniqueDeviceID`가 UDID다. 25자리(`00008110-001234567890401E`)이고 하이픈이
   들어간다. **`system_profiler SPUSBDataType`으로 찾지 않는다** — 폰이 USB로 연결돼
   있는데도 아무것도 내지 않는 맥이 있었다(2026-10-08, 같은 폰이 `usbmux list`에는 잡힘).
   `pymobiledevice3`가 없으면 Finder에서 아이폰을 고르고 기기 이름 아래 줄을 클릭하면
   UDID로 바뀐다.
2. 인터페이스를 만든다.

   ```bash
   rvictl -s <UDID>
   ```

   `Starting device <UDID> [SUCCEEDED] with interface rvi0` 이 나와야 한다.
3. 확인:

   ```bash
   ifconfig rvi0
   ```

`[FAILED]`면 케이블/신뢰/잠금 해제를 먼저 본다. 아이폰 화면이 잠겨 있으면 안 된다.

## 2단계: 1분 떠서 무엇이 오가는지 본다

**포트 필터를 걸지 않는다.** 아이폰 앱이 BlueStacks와 같은 8680을 쓰는지가 모르는
것이기 때문이다. 필터를 걸고 떴는데 0이면, 포트가 달라서인지 인터페이스가
틀려서인지 구분이 안 된다.

```bash
mkdir -p ~/dw-captures/iphone-test
/Applications/Wireshark.app/Contents/MacOS/dumpcap \
  -i rvi0 -a duration:60 \
  -w ~/dw-captures/iphone-test/rvi_$(date +%Y%m%d-%H%M%S).pcapng
```

60초 안에 아이폰에서 다크워를 **켜고 로그인한 다음**(앱을 이미 켜둔 상태면 한 번
껐다 켠다 — 로그인 응답이 가장 많은 정보를 담는다) 연맹 랭킹 화면 하나를 연다.

**캡처는 앱을 켜기 전에 시작한다.** 이미 맺어진 TCP 연결은 중간부터 보여서 읽을 수
없다.

## 3단계: 읽히는지 판정한다

```bash
F=$(ls -t ~/dw-captures/iphone-test/*.pcapng | head -1)

# (a) 어떤 대화가 있었나 — 게임 서버 포트가 무엇인지
/Applications/Wireshark.app/Contents/MacOS/tshark -r "$F" -q -z conv,tcp | head -20

# (b) 우리 파서가 읽는가
cd ~/darkwar-platform/services/collector
uv run dw-collector ingest-dir --dir ~/dw-captures/iphone-test \
  --min-age-seconds 0 --collected-from-server <계정 서버>
```

판정:

| (a) 결과 | (b) 결과 | 의미 / 다음 |
|---|---|---|
| 8680 대화가 있다 | `ingested=N` (N>0) | **된다.** 4단계로 |
| 8680 대화가 있다 | `ingested=0 discovered=0` | 포트는 같은데 페이로드가 다르다(iOS 클라이언트의 프레이밍 차이). 파일을 보관하고 중단 — 프로토콜 분석이 필요하다 |
| 8680이 없고 다른 포트에 큰 대화가 있다 | — | 포트가 다르다. `ingest-dir --port <포트>`로 다시 돌려 본다. 읽히면 4단계의 `-f` 필터도 그 포트로 바꾼다 |
| 대화가 아예 없다 | — | `rvi0`으로 안 흐른다. `ifconfig rvi0`이 `UP`인지, 아이폰이 Wi-Fi가 아닌 셀룰러로 나가는 건 아닌지(rvi는 둘 다 잡는다고 알려져 있으나 미확인) 본다 |
| — | `UNREADABLE unsupported link type N` | `linklayer.py`에 N 추가 필요 |
| 대화가 TLS(443)뿐 | — | 이 경로로는 못 읽는다 |

**`ingested=N`만 보고 끝내지 않는다.** 저널에 들어간 커맨드 이름을 본다. 로그인과
랭킹 응답이 나와야 진짜다.

```bash
uv run dw-collector journal-summary
```

## 4단계: 본 수집

2~3단계가 통과했을 때만. 포트가 8680으로 확인됐으면 필터를 건다.

```bash
/Applications/Wireshark.app/Contents/MacOS/dumpcap \
  -i rvi0 -f "tcp port 8680" -b duration:300 \
  -w ~/dw-captures/iphone.pcapng
```

아이폰에서 필요한 화면을 직접 연다(자동화 없음 — Windows도 BlueStacks 매크로나
손으로 연다). `Ctrl-C` 후:

```bash
cd ~/darkwar-platform/services/collector
uv run dw-collector ingest-dir --dir ~/dw-captures --min-age-seconds 0 \
  --collected-from-server <계정 서버>
uv run dw-collector sync
```

끝나면 가상 인터페이스를 지운다.

```bash
rvictl -x <UDID>
```

## Windows에서

`rvictl`은 없지만 같은 일을 하는 길이 둘 있다. **USB로 직접 뜨는 B가 주 경로**다
— 파일이 곧 백업이 되고, 게임 서버로 나가는 트래픽만 따로 골라 담을 수 있다.
A는 B가 막힐 때의 대안이다. 둘 다 Windows 기계에서 한 번도 돌려본 적 없다.

### B. `pymobiledevice3 pcap` (USB 직접)

아이폰이 내주는 `com.apple.pcapd` 서비스에 USB로 붙어서 pcap으로 저장한다
(`rvictl`이 쓰는 것과 같은 서비스). 맥에서도 똑같이 쓸 수 있다.

**준비 (1회)**

1. 아이폰 USB 드라이버 — **iTunes** 또는 **Apple Devices**(Microsoft Store)를
   설치한다. 이게 없으면 PC가 아이폰을 USB 장치로 못 본다.
2. 도구:

   ```powershell
   uv tool install pymobiledevice3
   ```

3. 아이폰을 꽂고 "이 컴퓨터를 신뢰"를 누른다. 화면은 잠금 해제 상태로 둔다.

**옵션** (`pymobiledevice3 pcap --help`로 확인한 것)

| 옵션 | 뜻 |
|---|---|
| `--out <파일>` | 저장할 pcap |
| `-c <N>` | N개 패킷만 뜨고 끝낸다. 생략하면 Ctrl-C까지 무한 |
| `--process <이름>` | 그 프로세스의 패킷만 — 다크워 앱 이름으로 걸면 다른 앱 트래픽이 안 섞인다 |
| `-i <이름>` | 인터페이스 이름으로 거른다 |
| `--userspace` | iOS 17+에서 터널이 필요할 때, 관리자 권한 없이 쓰는 방식 |
| `--udid <UDID>` | 아이폰이 여럿일 때 |

**1단계: 1분 테스트** — 맥의 2~3단계와 같다. 필터 없이 뜬다.

```powershell
mkdir C:\DW_data\iphone-test
pymobiledevice3 pcap --out C:\DW_data\iphone-test\test.pcap
```

실행한 **다음에** 아이폰에서 다크워를 껐다 켜고 로그인한 뒤 연맹 랭킹을 하나
연다. 1분 후 `Ctrl-C`. 그리고:

```powershell
uv run dw-collector ingest-dir --dir C:\DW_data\iphone-test --min-age-seconds 0
uv run dw-collector journal-summary
```

판정은 맥의 3단계 표와 같다(포트가 8680인지, `ingested=N`, 커맨드 이름).
에러가 나면:

| 증상 | 조치 |
|---|---|
| 기기를 못 찾는다 | iTunes/Apple Devices 드라이버, 신뢰, 잠금 해제, 케이블 |
| iOS 17+라는 이유로 접속이 거부된다 | `--userspace`를 붙인다 |
| `UNREADABLE unsupported link type N` | `linklayer.py`에 N 추가 (고정 테스트와 함께) |

게임 패킷이 어느 `--process` 이름으로 오는지 모르면, 이 테스트는 `--process` 없이
뜨고 결과 pcap에서 확인한다. 이름을 알게 되면 4단계부터 건다.

**본 수집** — `pcap`에는 파일 순환(링)이 없다. 한 파일이 계속 커지고, `ingest-dir`는
**파일 이름으로 "읽었음"을 기록**하므로(맥의 `-b duration` 설명과 같은 이유) 쓰는
중인 파일은 읽히지 않고 끝난 파일만 읽힌다. 그래서 `-c`로 조각을 내서 이름을
바꿔가며 돈다.

```powershell
$dir = "C:\DW_data\iphone"
mkdir $dir -ErrorAction SilentlyContinue
while ($true) {
  $f = Join-Path $dir ("iphone_{0:yyyyMMdd-HHmmss}.pcap" -f (Get-Date))
  pymobiledevice3 pcap --out $f -c 100000
}
```

그리고 다른 창에서, 읽고 지우지 않고(백업으로 남긴다) 올린다:

```powershell
uv run dw-collector ingest-dir --dir C:\DW_data\iphone --interval-seconds 30
uv run dw-collector sync
```

- 조각 경계에서 TCP 스트림이 끊기므로 그 순간의 응답 하나는 잃을 수 있다. 맥/Windows
  링 캡처도 같은 성질이다.
- `--delete-ingested`는 **쓰지 않는다.** 이 파일들이 그대로 백업이다. 다만 캡처에는
  UID와 세션 서명이 들어 있으니 저장소 밖에 두고, 쌓이는 용량은 가끔 직접 정리한다.
- 쓰는 중인 파일을 `ingest-dir`가 건드리지 않는 것은 `--min-age-seconds` 기본값
  30초가 막아준다. 줄이지 않는다.

### A. PC 모바일 핫스팟 (B가 막힐 때)

1. 설정 → 모바일 핫스팟을 켠다(PC가 인터넷에 이미 연결돼 있어야 한다. 유선 LAN이
   가장 안정적이다).
2. 아이폰을 그 Wi-Fi에 붙인다.
3. 핫스팟 어댑터(`Local Area Connection* N`)에서 Npcap/dumpcap으로 뜬다 —
   `collector-setup.md`의 어댑터 선택 부분을 따른다. `dw-capture`는 인터페이스
   전체를 듣기 때문에 BlueStacks 트래픽도 섞인다.
4. 이후는 기존 Windows 흐름(`ingest-dir` → `sync`)과 같다.

## 집에 두는 폰: 꽂으면 자동으로 수집 (`dw-iphone`)

폰을 USB로 꽂아 두면 게임 재시작, 캡처, 읽기, 업로드가 이어지는 경로다. **폰이 꽂혀
있는 동안만 수집된다** — 뽑으면 멈추고, 다시 꽂으면 이어진다.

**상태 (2026-10-08).** 폰으로 한 번 끝에서 끝까지 돌려 확인했다: 원격 재시작 → 45초
조각 캡처 → `ingest-dir --delete-ingested` → `account.login.new`, `init`, `al.rank`
(연맹원 68행)가 정규화까지 들어왔다. 이어서 `run-iphone.ps1`로 세 프로세스를 함께 돌려, 가짜 REST 수신서(`/rest/v1`)에 올리는
데까지 확인했다: 연맹원 60행, 아레나 100행, 상점, 계정 상태 등이 중복 없이 올라갔다.
**진짜 Supabase(DB, RLS, 대시보드 표시)에는 아직 올려 본 적 없다** — 로컬 스택은 이 PC에
Docker가 없어 못 썼다.

**알려진 거동:** 폰을 막 꽂은 직후 USB 세션이 몇 초 흔들려 첫 캡처가 죽고 게임 실행이
실패할 수 있다(`Device is not connected`). 정상이다 — 10~60초 안에 다시 붙고 그때 게임이
켜진다.

**1회 준비** (한 번만, 전부 이 폰에서 이미 끝냈다):

1. Apple Devices(Microsoft Store) 설치. 드라이버가 같이 깔린다.
2. `uv tool install pymobiledevice3`
3. 폰을 꽂고 "이 컴퓨터를 신뢰". 설정에 **개발자 모드** 항목이 없으면 정상이다 —
   폰이 개발자 요청을 한 번 받아야 나타난다: `pymobiledevice3 amfi reveal-developer-mode`
   → 설정 → 개인정보 보호 및 보안 → 개발자 모드 켜기 → 재시작 → 암호 → "켜기".
   확인: `pymobiledevice3 amfi developer-mode-status`가 `true`.
4. 개발자 이미지: `pymobiledevice3 mounter auto-mount`.
5. 게임 번들 ID: `com.readygo.dark.nbios` (Dark War 1.250.666). 다르면
   `DW_IPHONE_BUNDLE_ID`.

**실행:**

```powershell
.\scripts\windows\run-iphone.ps1
```

세 프로세스를 띄우고 Ctrl+C로 함께 끈다. 로그는 `C:\DW_data\logs\iphone-*.out/.err`.
자동 잠금을 꺼 두지 않아도 돌지만, **잠금이 걸리면 USB 세션이 끊길 수 있다**
(오늘 세 번 끊겼고 원인은 확정 못 했다). 끊기면 `dw-iphone`이 5~60초 간격으로
기다리다 붙는다.

환경 변수 (`dw-iphone`):

| 변수 | 기본 | 뜻 |
|---|---|---|
| `DW_IPHONE_DIR` | `./data/iphone` | 조각 파일 위치 |
| `DW_IPHONE_CHUNK_SECONDS` | 300 | 조각 길이 |
| `DW_IPHONE_RELAUNCH_HOURS` | 6 | 꽂아 둔 채로 게임을 다시 켜는 간격. 0이면 끈다 |
| `DW_IPHONE_BUNDLE_ID` | `com.readygo.dark.nbios` | 게임 |
| `DW_IPHONE_NO_LAUNCH` | | `1`이면 게임을 건드리지 않는다(수동 실행) |
| `DW_IPHONE_UDID` | | 폰이 여럿일 때 |

**알아 둘 것**

- 데이터는 **로그인 직후 응답**이 중심이다. 연맹 랭킹, 계정 상태, 아레나 등은 접속할 때
  한꺼번에 오고, 화면을 연다고 새로 오지 않는다(`continuous-collection.md`). 그래서
  재시작 간격이 곧 갱신 주기다. iOS는 화면 조작을 자동화하지 않는다.
- 캡처는 게임보다 **먼저** 시작해야 한다. `dw-iphone`은 캡처를 띄운 뒤 5초 있다가
  게임을 켠다.
- 같은 계정으로 BlueStacks와 폰을 동시에 로그인하지 않는다 — 한쪽이 끊긴다. 재시작이
  주기적으로 로그인을 일으키므로 BlueStacks 수집 계정과 같은 계정을 쓰면 서로 밀어낸다.
- 조각은 읽은 뒤 지운다(UID와 세션 서명이 들어 있다). 읽기 전에 죽은 조각만 남는다.

## 맥에서도 B를 쓸 수 있다

`rvictl`이 막히면 위 B를 맥에서 그대로 쓴다(`uv tool install pymobiledevice3`).
맥에서는 `--native`로 관리자 권한 없이 iOS 17+ 터널에 붙는 방법도 있다.

## 주의

- **같은 계정으로 BlueStacks와 아이폰을 동시에 로그인하지 않는다.** 한쪽이 끊긴다.
- **`DW_COLLECTOR_ID`는 Windows와 같은 값**(`mac-capture.md`). 중복은
  `idempotency_key`로 걸러지므로 같은 화면을 두 기계가 떠도 행이 늘지 않는다.
- 캡처 파일에는 계정 UID와 세션 서명이 들어 있다. 저장소 안에 두지 않는다.
- 캡처 시작을 앱 실행보다 먼저. 중간부터 뜬 TCP는 읽히지 않는다.

## 확인 기록

실제로 돌려 본 뒤 여기에 채운다.

| 날짜 | 맥 / iOS | rvi0 링크 타입 | 게임 포트 | ingest 결과 | 비고 |
|---|---|---|---|---|---|
| 2026-10-08 | Windows / iOS 26.6.2 (iPhone18,2) | pcap (`pymobiledevice3 pcap`) | 8680 (파서가 읽음) | `ingested=19 commands=123`, 로그인·`al.rank` 포함 | USB 세션이 세 번 끊김 |
| 2026-10-08 | 맥 / iOS 26.6.2 (iPhone14,3, **다른 폰**) | pcap (`pymobiledevice3 pcap`) | 미기록 | 캡처, 게임 원격 실행, `ingest-dir` 모두 됐다고 사용자가 보고. **건수는 못 받았다** | `system_profiler`에는 폰이 안 보이는데 `usbmux list`에는 `USB`로 잡힘. `rvictl`은 안 씀 |
