# 런북: 맵 스윕 — 좌표 이동 방식 (`dw-ui-worker goto-sweep`)

클러스터 서버들의 월드맵을 주기적으로 훑는다. 게임의 **"World" 창**(지도 하단 돋보기 → State·X·Y → Go)에
좌표를 입력해 카메라를 옮기고, 그때 클라이언트가 보내는 `world.get.new` 응답을 캡처가 저널에 쌓는다.
**요청과 서명은 게임 클라이언트가 직접 만든다** — 이 도구는 화면만 조작한다(ADR-0002·0003 범위, 읽기 전용,
게임 상태를 바꾸는 버튼은 누르지 않는다). 코드: `services/collector/src/dw_collector/ui_worker/goto.py`(계획·판정),
`goto_screen.py`(화면), `__main__.py`의 `goto-sweep`.

## 계획

- 커버리지 규칙은 `world_sweep_coverage`와 같다(`gaps.py`): 50타일 셀의 중심이 어떤 viewLvl 1 뷰포트 중심에서
  가로 35·세로 70 안에 있으면 읽힌 것.
- 셀 중심을 그 범위로 묶으면 **X 10열 × Y 7행 = 서버당 70번**(스와이프 방식은 같은 줌에서 162번).
  566–588 23개 서버면 **1,610번**.
- 도착 판정: 같은 서버, 목표에서 **X ±10·Y ±20 이내**, **viewLvl 1**, 타일이 1개 이상. 이 허용 오차 안이면
  그 점이 맡은 셀이 전부 읽힌다(테스트가 확인). 판정 못 받은 점은 한 번 더 간다.

## 화면 흐름 (1080×1920 BlueStacks, 게임 1.250.672에서 측정)

1. 줌을 viewLvl 1까지 빼면 지도 아래에 `🔍 #580 (492,929) ☆` 바가 생긴다. 처음 열리는 줌에는 없다.
2. 돋보기(390,1735) → "World" 창. State(634,887)·X(634,956)·Y(634,1025)는 현재 위치로 채워져 있다.
3. 칸을 누르면 화면 아래 Android 입력 줄이 뜨고 기존 값이 선택돼 있다 → 숫자 입력이 덮어쓴다 → OK(998,1868).
4. Go(540,1185) → 카메라 이동(다른 서버도 됨). **이동하면 줌이 viewLvl 0으로 돌아간다.**
5. 가상 마우스 휠 12칸(아래)으로 viewLvl 1 복귀. 7칸이면 충분했고 19칸도 viewLvl 1이었다(2로 넘어가지 않음).

☆(북마크 추가)는 누르지 않는다. State는 서버가 바뀔 때만 입력한다.

## 안전 장치

- **누르기 전에 본다.** 바·창 제목·Go 버튼·입력 줄 OK를 템플릿(`ui_worker/templates/goto_*.png`)으로 확인한 뒤에만
  누른다. 맞는 화면 0.99–1.00, 다른 화면 최대 0.50, 기준 0.85.
- **팝업은 아는 것으로만 닫는다**(`cloud/popups.py`와 같은 원칙). 바가 안 보이면 한 단계씩, 매번 다시 보고:
  X 버튼(World 창이 쓰는 공용 팝업 틀의 X, 화면 어디든) → 전체 화면 창의 왼쪽 아래 뒤로가기 화살표 →
  Android 입력 줄(이것만 뒤로 가기 키) → 휠로 줌 빼기 → 잠깐 뜨는 화면이면 3초씩 두 번 기다리기.
- **게임 안에서 뒤로 가기 키는 쓰지 않는다** — 창이 닫히지 않는다(주인 확인). **빈 곳 누르기**도 모르는 화면에는
  안 쓴다 — 스윕 줌의 지도는 도시·몬스터·트럭으로 덮여 있어 "빈 곳"이 보장되지 않고, 잘못 누르면
  Build/Teleport/March, Rally, Loot이 뜬다(측정 중 셋 다 실제로 열렸다). 빈 곳으로 닫는 팝업은 템플릿과
  누를 자리를 정해 하나씩 추가한다.
- 그래도 모르는 화면이면 **3분 쉬고 다시 보기를 3번**(`--unknown-screen-wait`, `--unknown-screen-retries`) —
  재접속·로딩 같은 화면은 스스로 사라진다. 그다음 멈춘다. 스크린샷은 저널 옆 `ui-shots\goto-*.png`이고,
  새 팝업은 이걸로 템플릿을 만든다.
- 사람이 에뮬레이터를 쓰면(`IdlePolicy.contends`) 최대 `--wait-for-idle-seconds`(기본 900초) 기다렸다가 이어 간다.
- 매시 :55–:00은 매크로 시간이라 멈췄다가 이어 간다. 킬 스위치 파일이 있으면 즉시 멈춘다.
- **터치 장치(event4)에는 쓰지 않는다** — 사람의 클릭이 죽는다(`traps.md`). 탭·숫자는 `adb shell input`,
  줌은 `/dev/input/event5` 휠.

## 실행

```powershell
cd C:\darkwar-platform\services\collector
uv run --no-sync dw-ui-worker goto-sweep --servers 582 --max-jumps 3      # 시험
uv run --no-sync dw-ui-worker goto-sweep                                   # 566-588 전체
```

예약(8시간마다, 관리자 PowerShell에서 한 번):

```powershell
.\scripts\windows\register-map-sweep.ps1                       # 566-588, 8h, 01:05 시작
.\scripts\windows\register-map-sweep.ps1 -Servers '566-588' -Hours 8 -Start '01:05'
```

로그는 `C:\DW_data\logs\map-sweep.log`. 끝에 서버별 `583: 70/70 landed`가 나오고, 못 간 서버는
`refused by the client`, 멈춘 이유는 `STOPPED: ...`(종료 코드 1).

## 게임 업데이트로 화면이 바뀌면

`STOPPED: ... did not open` 같은 줄과 스크린샷이 남는다. 새 스크린샷(`dw-ui-worker screenshot`)에서
템플릿 6개를 다시 자르고(`goto_bar_magnifier`·`goto_window_title`·`goto_window_go`·`goto_entry_ok`·`goto_close_x`·`goto_back_arrow`),
좌표가 바뀌었으면 `goto_screen.py` 상단 상수를 고친다. 자른 뒤 모든 스크린샷에 점수를 매겨
맞는 화면 ≥0.95, 아닌 화면 ≤0.6인지 본다.

## 걸리는 시간

이동 한 번 **11.2초**(2026-11-18, 585 서버 15번). 화면을 네 번 본다 — 지도(바), 창, 입력 줄 두 번.
고정 대기 대신 기대한 화면이 보일 때까지 다시 보고(최대 3번), 캡처는 PNG가 아닌 원본(0.7–0.95초, PNG는 1.0–1.8초).
서버당 약 13분, 566–588 전체 **약 5시간**, :55 대기까지 5.5시간. 예약 작업의 실행 제한은 7시간이다.

## 알려진 한계

- 1080×1920 화면 전제. 크기가 다르면 첫 화면에서 멈춘다.
- `contends`는 앞 창 제목에 `darkwar`가 들어간 창(예: 저장소 폴더 창)도 게임으로 본다 — 그동안 기다린다.
- 기존 스와이프 스윕(`dw-ui-worker sweep`)의 줌(`zoom.py` 핀치)은 지금 BlueStacks에서 동작하지 않는다.
