# Vantera 조사와 맵 크롤러 계획

2026-10-06~08 세션의 인수인계 문서. 이 문서가 끝나는 곳: **크롤러 코드는 한 줄도
없다.** 있는 것은 조사 결과, 읽기 전용 분석 스크립트 둘, 그리고 다음에 할 일이다.

> 판정 표기: **확인** = 코드·데이터·사이트 문구로 직접 확인. **추정** = 근거는
> 있으나 검증 못 함. **미확인** = 모른다.

## 왜 하는가

vantera.app(독립 팬 사이트)이 우리가 원하는 기능을 이미 갖고 있다: 전 서버 쉴드
보드, 노출 타깃, 라이브 맵(기지와 이동 중인 행군), 로스터 동기화, 입퇴 로그,
킬 증가(War Room). 목표는 그들이 어떻게 데이터를 받는지 파악하고, 같은 것을 우리
파이프라인에 만드는 것.

(처음엔 vantera.com으로 알았으나 실제 도메인은 **vantera.app**. Reddit 글
r/darkwarsurvival `1uokudu`에서 제작자가 링크를 남겼다.)

## Vantera가 하는 일 (사이트 공개 문구)

출처: `/features/*`, `/changelog`, `/compare/vantera-vs-modded-clients`, `/privacy`.

- **확인(문구)** "reads the world; it never plays it" — 읽기만 한다. 데이터는
  "what the game shows publicly to every player". 사용자의 게임 로그인은 받지 않는다.
  서버는 EU. **그들 자신이 쓰는 계정은 어디에도 언급이 없다.**
- **확인(문구)** 규모: 624 State, 연맹 1.13만, 플레이어 9.36만 (랭킹 보드 기준),
  라이브 맵이 본 계정은 100만 이상.
- **확인(문구)** 수집 방식의 흔적 (changelog):
  - State 단위 **전수 스윕**, "served before the next state rather than after the
    whole sweep".
  - 신규 State는 30분마다, 기프트 코드는 3시간마다, 라이브 맵은 10분 넘은 State를
    열면 새로 읽고 화면 영역은 몇 초마다 읽는다.
  - 사용자가 모르는 플레이어를 열면 **스캔 요청**이 큐에 들어가고, 3번 시도 후
    실패 처리, 성공하면 기지 수와 함께 done.
  - **"Map scans are back after the game's update"** — 게임 업데이트에 깨졌다 고쳐짐.
- **추정** 위로부터: 게임 프로토콜을 직접 말하는 서버 측 클라이언트(계정은 자체
  보유). 공개 HTTP API라는 Reddit 익명 댓글(Agile-Reception7158)은 **검증 못 함**.
- **추정** "텔레포트, 쉴드 변화, 개명, 연맹 이동" 로그는 연속된 스캔의 비교.
- **미확인** 계정 수, 로그인 처리, 요청 간격, TCP인지 HTTP인지.

브라우저에서는 **보이지 않는다.** Next.js 서버 렌더링(RSC)이라 클라이언트가 부르는
데이터 API가 없다(홈, `/search`, 상태 페이지 모두 `_rsc`와 정적 파일뿐).
`robots.txt`가 `/api`, `/dashboard`, `/login`을 막아 두었고 **건드리지 않았다.**
계속 그렇게 할 것 — 그들의 구현을 알 필요는 없다. 우리 프로토콜의 요청 형식만
알면 된다.

## 기능별 필요 데이터와 우리 repo

| Vantera 기능 | 우리에게 있는 것 | 없는 것 |
|---|---|---|
| 상태·플레이어 순위, 킬/HQ | `server.rank`, `kill.rank`, `get.new.user.info` | — |
| 로스터, 입퇴 로그, 킬 증가 | `al.rank`, `alliance_roster_latest` | 시간차 쿼리 |
| 쉴드 보드, 노출 타깃, 라이브 맵 | `world.get.new` 타일 | **쉴드 필드 확정**, 능동 스윕 |
| 행군 (보낸 사람, 목적지, 병력, 영웅, 도착) | `push.world.march.world.get.new` | 디코더 |
| 플레이어 행군 3개와 영웅 레벨 | `army.py` (라인업) | 남을 능동 조회 |
| 텔레포트/개명/연맹 이동 로그 | 스냅샷 테이블 | 비교 이벤트를 만드는 쿼리 |
| 기프트 코드 자동 수령 | 없음 | 공식 Gift Center 웹 호출(게임 서버와 별개) |

## 프로토콜 사실 (코드에서 확인)

- SmartFoxServer 2X, TCP **8680**, 평문. 프레임 봉투 `{a, c, p}`, `c`=명령,
  `p`=파라미터 (`protocol/frames.py`).
- 디코더는 **요청 방향도 이미 읽는다.** `iter_extension_events`
  (`protocol/pcapng.py`)가 `direction="outbound"` 이벤트를 낸다.
- 그런데 라이브 수집기가 **요청을 버린다**: `capture/session.py`의
  `if not inbound: continue`, 주석 "our own requests are not data". 그래서 어떤 DB나
  fixture에도 요청 내용이 없다. **요청 프레임이 무엇을 싣는지 아무도 적어 둔 적이 없다.**
- `world.get.new` 응답이 `x`, `y`, `viewLvl`, `serverId`, `maxAreaSize`(1000)를
  돌려준다 — 요청 파라미터의 에코일 가능성(**추정**). 한 응답에 최대 657개 타일.
- **확인(사용자)** 한 계정으로 여러 서버의 맵을 볼 수 있다. 즉 `serverId`만 바꿔
  훑을 수 있을 가능성이 크다. 요청에 `serverId`가 실제로 들어가는지는 **미확인**.

## 쉴드 필드 후보: 도시 타일 `f3.8` / `f3.9`

`services/collector/scripts/tile_timestamps.py`로 재현된다 (fixture
`season3_viewport_v1.json`, `season3_buildings_v1.json`, 도시 135개).

- `f3.8`과 `f3.9`는 **같은 33개 도시에만** 있다(24%). 한쪽만 있는 도시는 0.
- 캡처 시각 기준 `f3.8`은 **전부 미래**(4.1시간~680시간 뒤), `f3.9`는 **전부 과거**.
  현재는 항상 `[f3.9, f3.8]` 안.
- 그래서 `f3.8`=끝, `f3.9`=시작처럼 보인다 — **추정**.
- **쉴드라고 확정 못 하는 이유**: `f3.8 - f3.9`가 88~124시간과 288~694시간 두
  덩어리이고 **둥근 값이 없다**. 고정 길이 쉴드의 시작과 끝이라면 이렇게 안 나온다.
  다른 기간 효과이거나, 연장된 쉴드의 마지막 갱신 시각일 수 있다.
- 쉴드 표지가 아닌 것: `f3.5`(=1)와 `f3.6`(=65536)은 쉴드 없는 도시 15개에도 있다.
  `f3.10`, `f3.24`는 135개 전부 최근 며칠 안의 과거 시각 — 접속 시각 같은 것(추정).
- **정답지가 없다.** `world.get.detail.new`는 평문 JSON이라 필드 이름을 말해 주는데,
  지금까지 열어 본 것은 연맹 건물과 시즌 건물뿐이고 **플레이어 도시는 연 적이
  없다** (`docs/runbooks/season-map-capture.md`의 "opened" 24개는 타입 6 건물).
- `worldmap.py`는 아직 수정하지 않았다. 이름 붙이기는 확정 뒤. (`al.battle.rank.info`
  의 "판정만 하고 승격 안 한" 선례를 피하려는 것.)

## 결정과 전제

- 능동 호출은 **별도 계정**으로만 한다. 본 계정과 collector 계정으로는 하지 않는다.
  패시브 캡처(읽기만)는 어느 계정이든 같은 위험.
- 이 작업은 `CLAUDE.md`의 "맵 크롤러(§14)는 아직 만들지 않는다"와 충돌한다.
  **실제로 만드는 PR에서 그 문장과 §14 상태를 함께 고친다.** 지금은 고치지 않았다.
- 크롤러는 `Observation` 생산자 하나로 추가한다 (아래층 파이프라인은 그대로).
  속도 제한과 정지 스위치를 처음부터 넣는다.
- Windows에서 개발한다는 결정은 그대로. Mac에서 찍은 PCAP은 분석용 입력일 뿐.

## 다음 할 일 (순서)

1. **요청 형식 확인** — Windows에서:

   ```
   uv run python services/collector/scripts/request_shapes.py C:/DW_data/pcaps/<파일>.pcapng --command "get.user.info.multi|get.new.user.info|get.al.info|server.rank|al.rank|world.get.new|world.get.detail.new"
   ```

   보려는 것: (a) UID 하나씩인가 리스트인가 (b) 서명이 모든 요청에 있는가, 로그인 때만인가
   (c) `_id`는 클라이언트가 고르는 카운터인가 (d) `world.get.new` 요청이 좌표와
   `serverId`를 어떻게 싣는가. 출력은 16자 넘는 문자열을 가려서 채팅에 붙여도 된다.
2. **쉴드 확정 캡처** (게임 + 캡처): 본인 도시의 쉴드 남은 시간을 화면에서 읽어
   적어 두고(없으면 아이템으로 켠다), 그 주변 맵을 팬하고, **다른 플레이어 도시를
   몇 개 탭**해서 상세 창을 연다. 그다음 본인 UID 타일의 `f3.8`이 읽어 둔 종료
   시각과 맞는지, 상세 JSON에 쉴드 필드명이 있는지 대조.
3. 로그인 프레임 분석(별도 계정으로 접속하려면 서명 생성 방식을 알아야 한다).
4. 스윕 설계: 한 번에 657타일, State 하나가 몇 번의 팬인지 계산해 8개 서버(577~584)에
   필요한 주기를 정한다. 그다음 큐, 재시도, 스냅샷 비교 이벤트.

## Mac에서 iPhone 트래픽 캡처 (Windows 없이 1번을 얻는 길)

Mac은 iPhone을 USB로 물리면 가상 인터페이스 `rvi0`로 패킷을 캡처할 수 있다.
탈옥도 앱 설치도 필요 없고 읽기만 한다. iOS 앱이 같은 프로토콜·포트(8680)인지는
**미확인**.

상태(2026-10-08 기준): Xcode 27.1 설치 및 활성화 완료. `rvictl`은 PATH에 없고
`/Library/Apple/usr/bin/rvictl`에 있다. **iPhone이 USB로 인식되지 않았다**
(`system_profiler SPUSBDataType`에 없음, 신뢰 팝업 안 뜸, `xctrace`는 Offline,
`devicectl`은 "available (paired)" = 네트워크 쪽으로만 보임). 케이블(데이터용),
포트, 잠금 해제, 재시작, 위치 및 개인정보 보호 재설정을 시도해야 한다.

```bash
xcrun xctrace list devices                      # 하드웨어 UDID는 00008...로 시작하는 쪽
sudo /Library/Apple/usr/bin/rvictl -s <UDID>
mkdir -p ~/DW_data
sudo tcpdump -i rvi0 -w ~/DW_data/iphone.pcap 'tcp port 8680'
# 게임 완전 종료 후 재시작, 맵 팬, 도시 탭, 프로필 열기. Ctrl+C
sudo /Library/Apple/usr/bin/rvictl -x <UDID>
```

`tcpdump -w`는 classic pcap을 쓴다. `pcapng.py`에 `_read_classic`이 있어 읽힐 것으로
보이나 **실행해 본 적 없다**. 안 읽히면 Wireshark의 `editcap -F pcapng`로 변환.
VPN은 끈다. 개인 계정이라면 능동 호출 계정으로 쓰지 않는다.

## 지켜야 할 것

- PCAP에는 계정 UID와 세션 서명이 있다. 저장소 밖(`C:\DW_data`, `~/DW_data`)에 두고,
  `.pcap`/`.pcapng`는 커밋하지 않는다. 쓰고 나면 지운다.
- `legacy/`는 건드리지 않는다.
- Vantera의 `/api`, `/dashboard`, `/login`은 요청하지 않는다. 약관상 데이터는
  공개 페이지에서만 읽었다.
