# 런북: 클라우드에서 부계정을 24시간 무인으로 돌리기

규칙은 `docs/adr/0002-direct-requests-from-the-collector-account.md`(main 머지 전에는
브랜치 `packet-data-collection-automation-9b66b5`)에 있다. 이 문서는 그 허용 범위
안에서 **패킷 수집만** 클라우드로 옮기는 설계와 절차다. 직접 요청 송신은 다른
작업이고 여기에 없다. 본계정은 건드리지 않는다(FR-COL-010).

## 현재 상태 — 먼저 읽을 것

| 부분 | 상태 |
|---|---|
| 재시작 상태기계 `watchdog/machine.py` | **구현, 단위 테스트만.** 시간·장치·알림을 주입해 시험했다. 실제 장치와 붙여 본 적 없다. |
| 업데이트 신호 관찰기 `watchdog/update_signal.py` | **구현, 단위 테스트만.** 필드 이름은 **추측**이다(아래). |
| 어댑터 `cloud/`(`dw-cloud`): tcpdump 백엔드, adb `GameClient`, 저널 피드, 진입점 | **구현, 단위 테스트만.** 가짜 adb·가짜 시계로 시험했고 VM에서 `dw-cloud`를 돌려 본 적은 없다. 아래 §9 |
| 클라우드 VM, 에뮬레이터, 로그인 | **아무것도 만들지 않았다.** 아래 「사용자가 할 일」. |

## 1. 환경 비교

선택: **Linux VM(KVM) + 안드로이드 에뮬레이터.** 근거와 대안:

| | Linux VM + 안드로이드 에뮬 | Windows VM + BlueStacks | 맥 + 아이폰(`dw-iphone`) |
|---|---|---|---|
| 캡처 | VM의 `tcpdump`(루트) → pcap 청크. `ingest-dir`가 이미 읽는다 | 현재 경로(Npcap/scapy). 코드 변경 최소 | `pymobiledevice3 pcap`, 이미 동작 |
| 구동 | `adb`(에뮬레이터는 네트워크 ADB) — `ui_worker/adb.py`가 그대로 쓰는 `monkey` 실행 | 같음 | `dvt launch`(`iphone/device.py`) |
| 비용 | 가장 낮다. 단 **중첩 가상화(KVM)가 되는 VM**이어야 한다 | Windows 라이선스 + 중첩 가상화 필요, 가장 비싸다 | 클라우드가 아님 |
| 에뮬레이터 탐지 | **가장 위험.** 에뮬 흔적(빌드 속성, 센서 없음, 데이터센터 IP)이 그대로다 | 탐지 위험은 비슷하나 BlueStacks는 일반 유저가 흔하다 | 실기기라 위험 최저 |
| ARM/x86 | 게임이 ARM 전용 네이티브 라이브러리면 x86 에뮬이 실행을 못 하거나 변환 계층을 쓴다. **확인 안 됨** | BlueStacks가 이미 이 게임을 돌리고 있으므로 해결됨 | 해당 없음 |
| 로그인 유지 | 디스크 스냅샷으로 앱 데이터 보존 가능 | 같음 | 폰이 로그인 상태 유지 |

판단: 비용·무인성은 Linux가 낫지만 **이 게임이 해당 에뮬에서 실행되는지, 탐지로
막히는지는 해 보기 전에는 모른다.** 그래서 설치 절차의 첫 단계가 5분짜리 가능성
확인이고, 막히면 Windows VM(코드 변경이 가장 적은 경로)이 후퇴선이다.
Genymotion·redroid 등 구체 제품의 가격과 라이선스는 이 세션에서 **조회하지 않았다.**
고르기 전에 직접 확인한다.

### 이 환경에서 다시 해야 하는 코드 (환경 무관 부분은 이미 끝)

- `capture/live.py`는 Windows+Npcap 전용이다. Linux는 `tcpdump -w`로 청크를 쓰고
  `ingest-dir --delete-ingested`가 읽는 **`dw-iphone`과 같은 모양**(청크 교대,
  `.part` 이름, 오래된 청크 승격)을 따른다. `iphone/supervisor.py`의 `Backend`
  프로토콜에 `tcpdump` 구현을 꽂는 것이 가장 작은 변경이다.
- 에뮬레이터는 NAT 뒤에 있다. VM의 `tcpdump -i any`로 **게임 TCP 포트(8680)** 를
  잡는다. 이 가정은 에뮬이 브리지/NAT 어느 쪽이든 VM 커널을 지나므로 성립하지만
  Linux에서 실제로 해 본 적은 없다.
- TLS가 아닌 평문 프레임이라는 현재 전제는 그대로다.

## 2. 재시작 감독자 (구현됨)

`watchdog/machine.py`의 `Watchdog`. 한 번의 `tick()`이 한 판단이다.

```
running ──패킷 침묵 ≥ 10분──▶ stalled ──┐
   │                                   ├─▶ relaunch → relogin ─▶ 5분 안에 패킷? ─예▶ running
   └─업데이트 신호(옵션 켠 때만)─▶ update_detected ┘                              └아니오▶ 백오프 후 재시도
                                                        실패 3회 연속 또는 6시간 6회 초과 ▶ halted
```

- **백오프:** 실패마다 2분, 4분, 8분… 최대 30분.
- **상한:** 6시간 창에서 6회(성공한 재시작도 센다), 연속 실패 3회. 넘으면 `halted`.
  `halted`는 사람이 `resume()` 할 때까지 아무것도 하지 않는다.
- **알림:** `stalled` · `update_signal` · `restarted`(몇 번째인지) · `recovered` ·
  `relogin_failed` · `halted`를 `alert` 콜백으로 낸다.
- **업데이트 신호만으로는 재시작하지 않는다.** `auto_restart_on_signal` 기본값이
  거짓이다. 신호가 실제로 관측되고 규칙에 맞춰진 뒤에 켠다.
- 침묵 판정(10분)은 클라우드의 `data_stalled`(2시간)보다 일부러 훨씬 짧다.
  감독자가 먼저 움직이고, 멈춘 뒤에는 `data_stalled`가 마지막 안전망이다.

기존 `iphone/supervisor.py`는 **연결과 청크**를 감독하고(USB 끊김, 6시간 재실행)
이 상태기계는 **게임 클라이언트**를 감독한다. 둘은 겹치지 않는다. 연결이 살아
있는 상태에서 게임만 죽거나 로그아웃된 경우를 잡는 것이 새 부분이다.

### 사람 없이 재로그인이 되는가

**확인하지 못했다.** `routines/example-cold-start.json`은 좌표가 전부 0인 예시이고,
자기 설명대로 팝업 닫기 단계는 `expect`가 없어 **성공을 검증하지 못한다**(응답이
없는 동작이므로). 검증되는 것은 실행 단계의 `init`(로그인 응답) 도착뿐이다.
그래서 `GameClient.relogin()`의 성공 기준은 **`init`이 다시 도착했는가**로 잡는다.
팝업 모양이 바뀌면 로그인은 되고 이후 화면만 틀어질 수 있다.

## 3. 업데이트 감지 (관찰만)

`watchdog/update_signal.py`의 `UpdateObserver`. 저널과 픽스처(`protocol-fixtures/decoded/init`
세 종류)를 확인했고 **클라이언트 버전·점검·킥을 나타내는 필드는 하나도 없다.**
(`account.login.new` 픽스처는 이 저장소에 없다.) 그래서 규칙은 추측이다.

| 신호 | 규칙 | 신뢰도 |
|---|---|---|
| `version_changed` | 키 이름이 `version`/`ver`/`resVersion` 꼴인 값이 바뀜. 첫 관측은 기준선 | 낮음 — 그런 키가 있는지부터 모름 |
| `push_signal` | 명령 이름에 kick·maintenance·shutdown·force update 포함 | 낮음 — 이름 추측 |
| `login_repeated` | 우리가 재시작하지 않았는데 `init`이 또 도착 | 중간 — 재접속은 킥의 흔한 증상 |

**다음에 할 일:** `dw-collector discovery`(모르는 명령 받은편지함)를 24시간 돌려
보며 실제 푸시 이름을 모은 뒤 `PUSH_NAME`·`VERSION_KEY`를 실제 값으로 바꾸고
픽스처를 추가한다. 1단계(요청 캡처) 세션의 결과가 나오면 거기에 클라이언트가 보내는
버전 필드가 있는지 본다.

## 4. 알림 연결

- **새 알림 이벤트는 만들지 않았다.** `data_stalled`/`sync_stalled` 같은 이벤트는
  마이그레이션과 대시보드 설정 화면(`NotificationsSetting.tsx`)을 함께 건드린다.
  이번 범위가 아니다.
- 대신 지금 연결되는 방식: 감독자가 `halted`가 되면 재시작을 멈추므로 패킷이 없다.
  `last_packet_at`이 2시간 정체되면 기존 **`data_stalled`가 울린다.** 최대 2시간
  늦지만 기존 채널과 해제 메시지를 그대로 쓴다.
- `data_stalled`는 `dw-notify`가 계산한다(`alerting.md`). **클라우드 VM 또는 항상
  켜진 다른 머신에서 `dw-notify`가 돌아야 한다.** PC가 꺼지면 안 간다고 이미
  적혀 있고, 무인 운영에서는 같은 이유가 그대로 적용된다.
- 더 빠르게 알려야 하면 후속 작업: `alert` 콜백을 `collectors`에 쓰는 새
  이벤트(`restart_budget_exceeded`)로 연결한다. 마이그레이션 번호는 push 시점의
  `origin/main` 기준으로 잡는다.

## 5. 설치 절차 (사용자가 할 일)

코드가 하지 않는 외부 조작이다. 이 세션은 아무것도 만들지 않았다.

1. **가능성 확인(가장 먼저, 5분):** 중첩 가상화가 되는 VM을 잠시 띄워 에뮬레이터에
   게임을 설치하고 **로그인이 되는지만** 본다. 설치 거부·즉시 종료·로그인 차단이면
   Windows VM으로 간다.
2. VM 생성: KVM 지원(`/dev/kvm` 존재 확인), x86_64, 디스크는 에뮬 이미지 + 청크용.
   비용은 사업자 요금표로 직접 계산한다.
3. 에뮬레이터와 `adb` 설치, 게임 설치, **부계정으로만** 로그인. 본계정의 인증정보를
   이 VM에 두지 않는다.
4. 앱 데이터가 든 디스크 스냅샷을 만든다(복구 지점).
5. `uv` 설치 후 이 저장소의 `services/collector`를 동기화, `.env`에 Supabase 값을
   넣는다(`.env`는 커밋 금지). `DW_DATA_DIR`는 저장소 밖.
6. `dw-sync`, `dw-notify`, `ingest-dir`를 systemd 서비스로 등록한다(`Restart=always`).
7. 좌표를 읽어 `routines/example-cold-start.json`을 자기 에뮬 값으로 복제한다.
   `dw-ui-worker screenshot`으로 확인하고 **드라이런 먼저**(`collector-setup.md`).

## 6. 운영과 복구

| 증상 | 의미 | 조치 |
|---|---|---|
| `restarted` 알림 1~2회 뒤 `recovered` | 정상 복구 | 없음. 하루에 반복되면 원인을 본다 |
| `relogin_failed` | 로그인 응답이 안 옴: 점검, 업데이트 대기, 계정 제재일 수 있다 | 에뮬 화면 스크린샷을 보고 게임을 직접 연다 |
| `halted` | 상한 도달 | **재시작을 반복하지 않는다.** 화면을 보고 원인을 찾은 뒤 `resume()` |
| 2시간 뒤 `data_stalled` | 감독자가 멈췄거나 죽음 | 서비스 상태와 `halted` 여부 확인 |
| 로그인은 되는데 화면이 틀림 | 팝업 모양 변경 | 콜드 스타트 루틴 좌표를 다시 읽는다 |

게임 업데이트로 앱이 구버전이 되면 재시작만으로는 풀리지 않는다. 스토어 업데이트는
사람이 한다. 이 경우 `halted`가 정상 결과다.

## 7. 위험

- **계정 제재가 가장 큰 위험이다.** 데이터센터 IP, 에뮬레이터 흔적, 24시간 접속은
  봇으로 보이기 쉽다. 부계정은 잃을 수 있는 계정으로 취급한다(ADR-0002). 재시작
  횟수 상한과 백오프는 이것을 줄이려는 장치이지 막는 장치가 아니다.
- **약관·유휴 로그아웃**(`continuous-collection.md` 「남은 위험」)은 해결되지 않았다.
  유휴 로그아웃이 있다면 `login_repeated`와 침묵으로 나타날 것이다. 첫 일주일의 재시작
  횟수가 이 질문의 답이다.
- 에뮬레이터 탐지, x86 호환성, 클라우드 사업자의 IP 대역 차단은 **전부 미확인**이다.
- PCAP에는 부계정의 UID와 세션 서명이 있다. VM 디스크가 보안 경계이므로 청크는
  `--delete-ingested`로 지우고 VM 이미지를 공유하지 않는다.
- 직접 요청 송신은 이 문서의 범위 밖이다. `dw-capture` 류는 계속 수동 스니퍼다.

## 8. 시험 기록 (2026-11-04, GCE `dw-emu-test`)

사용자가 직접 만든 시험 VM에서 확인한 것. 이 절만 **실제로 해 본 결과**다.

- VM: `asia-northeast3-a`, `n2-standard-4`, `--enable-nested-virtualization`, Ubuntu 22.04,
  디스크 50GB. `n2`의 기본 CPU가 Cascade Lake라서 `--min-cpu-platform="Intel Haswell"`을
  주면 생성이 거부된다(빼야 한다). `vmx` 플래그 있음, `kvm-ok` 통과.
- 에뮬레이터 37.2.13 + `system-images;android-34;google_apis_playstore;x86_64`,
  AVD `dw`(RAM 4096MB, 데이터 파티션 10G). 헤드리스에는 `libx11-xcb1` 등 X11 라이브러리가
  필요하다(없으면 `Could not open libX11-xcb.so.1`로 죽는다).
- **GPU 모드가 안정성을 가른다.** `swiftshader_indirect`와 `guest`에서는 Play 스토어를
  열거나 scrcpy를 붙이면 에뮬레이터가 `SEGV`로 죽었다(`Failed to find ColorBuffer`).
  `-gpu swangle_indirect`에서는 Play 스토어가 열렸다. 게임 실행 중에도 버티는지는 미확인.
- 에뮬레이터는 SSH 세션에 딸려 죽는다. systemd 서비스(`Restart=on-failure`)로 올리면
  살아 있고 죽은 이유가 `journalctl -u dw-emulator`에 남는다.
- scrcpy는 원격 adb 서버(`ADB_SERVER_SOCKET`) + `--force-adb-forward --port=27183`와
  포트 터널(5038, 27183)이 필요했다. 맥에 로컬 기기가 있으면 터널이 닫힌 상태의
  `adb devices`가 로컬 서버를 5038에 띄워 맥의 기기를 VM으로 착각하게 되므로, 항상
  `ro.product.model`이 `sdk_gphone64_x86_64`인지 확인하고 `-s emulator-5554`를 붙인다.
- 게임은 Play 스토어에서 설치됐다: `com.readygo.dark.gp`, 버전 1.250.670, 다운로드 약
  2.06GB. x86_64 에뮬레이터에 설치가 허용됐다.
- 첫 실행은 약관 동의 뒤 **게스트 계정을 자동 생성**해 튜토리얼로 들어갔다. 기존 부계정은
  사용자가 이메일로 직접 로그인했다(자격 증명은 사람이 입력한다). 로그인 직후 한 번
  Play Games 프로필 선택 팝업이 떴고 Cancel로 닫았다. 이후에는 뜨지 않았다.
- **캡처가 파서까지 통한다.** VM에서 `sudo tcpdump -i ens4 -U -s 0 -w ... 'tcp and not port 22'`
  (Ethernet, 포트 필터 없이 SSH만 제외)로 뜬 pcap을 `scan-capture`가 그대로 읽었다.
  게임을 `force-stop` 후 `monkey -p com.readygo.dark.gp ... LAUNCHER 1`로 다시 켜자
  **사람 손 없이 기지 화면까지 올라왔고**(저장된 로그인 유지), 150초 캡처에 `init`과
  `account.login.new`를 포함해 118종 명령, 수집 16건, 거부 0건이 잡혔다. 캡처를 먼저 켜고
  게임을 켜야 로그인 응답이 읽힌다(이미 접속한 세션만 잡으면 `init`이 없다).
- 즉 `GameClient.relogin()`의 최소 구현은 `force-stop` → `monkey` 실행 → `init` 도착 대기다.
  팝업 닫기 좌표는 이 시험에서는 필요하지 않았다. 팝업이 다시 뜰 수 있는지는 며칠
  운영해 봐야 안다.
- **업데이트 신호는 로그인 응답에서 찾지 못했다.** `account.login.new`와 `init`에서 키
  이름에 version이 들어간 것은 `picVer`(프로필 사진 버전)뿐이고, 점검·킥 필드도 없다.
  화면 우상단에 `App Ver 1.250.670(1631)`, `Res Ver 1333.1632.1761.911`이 보이지만
  어느 패킷으로 오는지는 모른다. 클라이언트가 **보내는** 로그인 요청(1단계 세션의 요청 캡처)
  에 있을 가능성이 크다. 그때까지 `VERSION_KEY`는 실제 일치가 없다.
- 시험 중 `scan-capture`는 임시 저널(`--db`)에만 썼고 Supabase에는 올리지 않았다.

## 9. `dw-cloud` 설치와 운영

`dw-cloud`는 한 프로세스에 캡처(tcpdump 청크 교대, `dw-iphone`과 같은 감독자), 읽기와
올리기(`ingest-dir`, `dw-sync` 자식), 감시 루프를 담는다. 에뮬레이터(`dw-emulator`)는
별도 서비스이고 여기서 시작하지 않는다. **VM에서 실행해 본 적이 없다.** 첫 실행은
`DW_CLOUD_NO_RESTART=1`(캡처만)로 시작해 `journal-summary`가 늘어나는 것부터 본다.

### 안전장치
- 재시작은 `DW_CLOUD_SERIAL`(기본 `emulator-5554`) **한 대**에만, `AdbClient`의 가드를
  거쳐 간다. 그 serial이 VM의 adb에 보이는 **유일한 기기**가 아니면 `AdbGuardError`로
  멈추고 재시도하지 않는다. 이 VM에는 부계정 에뮬레이터만 둔다.
- 킬 스위치: `DW_UI_KILL_SWITCH_FILE`이 가리키는 파일이 있으면 재시작이 거부된다.
- `halted`는 `~/dw-data/cloud-halted.json`로 남아 서비스가 재시작돼도 유지된다. 원인을
  보고 `touch ~/dw-data/cloud-resume`로 풀면 다음 틱에 마커가 지워진다.
- 알림은 `~/dw-data/cloud-alerts.jsonl`과 로그에 남는다. 외부로 나가는 알림은 §4의
  `data_stalled` 뿐이다.

### 한 번만 하는 설정
```bash
# tcpdump를 sudo 비밀번호 없이 (GCE 기본 계정은 이미 NOPASSWD)
sudo apt-get install -y tcpdump
# 저장소와 uv, 비밀은 ~/dw-data/.env (커밋 금지)
cd services/collector && uv sync
```

### systemd (`/etc/systemd/system/dw-cloud.service`)
```ini
[Unit]
Description=Dark War cloud collector
After=network-online.target dw-emulator.service
Wants=dw-emulator.service

[Service]
User=hxy008
WorkingDirectory=/home/hxy008/DW_app/services/collector
Environment=DW_DATA_DIR=/home/hxy008/dw-data
Environment=DW_CLOUD_ADB=/home/hxy008/android/platform-tools/adb
ExecStart=/home/hxy008/.local/bin/uv run dw-cloud
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```
`dw-emulator.service`의 GPU 모드는 `-gpu swangle_indirect`여야 한다(§8).

### 환경 변수
| 변수 | 기본값 | 뜻 |
|---|---|---|
| `DW_CLOUD_NO_RESTART` | 끔 | 켜면 캡처와 올리기만 한다 |
| `DW_CLOUD_SERIAL` | `emulator-5554` | 재시작 대상 adb serial |
| `DW_CLOUD_PACKAGE` | `com.readygo.dark.gp` | 게임 패키지 |
| `DW_CLOUD_INTERFACE` | 기본 경로의 인터페이스 | tcpdump 인터페이스 |
| `DW_CLOUD_CHUNK_SECONDS` | 60 | 저널은 청크가 끝나야 로그인을 안다 |
| `DW_CLOUD_STALL_MINUTES` | 10 | 패킷 침묵으로 보는 기준 |
| `DW_CLOUD_LOGIN_TIMEOUT` | 300 | 재시작 뒤 `init`을 기다리는 시간(초) |
| `DW_CLOUD_AUTO_RESTART_ON_SIGNAL` | 끔 | §3의 신호로 재시작. 신호가 확인되기 전에는 켜지 않는다 |

### 아직 모르는 것
- 청크가 60초라 저널이 현실보다 1~2분 늦다. 재시작 판정(10분)에는 문제없지만 짧게
  줄이지 않는다.
- 로그인 응답이 청크 경계에 걸려도 `overlap`(10초)이 받아 주는지는 실기기(폰)에서만
  봤고 이 VM에서는 못 봤다.
- 에뮬레이터가 SEGV로 죽어 다시 뜨는 동안 감시가 어떻게 보이는지 시험하지 않았다.
  `emulator_missing`이 로그에 남고 시도는 실패로 계산된다. 실패가 3번 쌓이면 `halted`다.
