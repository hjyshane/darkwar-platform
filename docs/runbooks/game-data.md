# 런북: 게임 클라이언트 데이터로 이름 채우기

서버는 이벤트·아이템·영웅을 **번호로만** 보낸다. 이름은 클라이언트가 자기 데이터
테이블과 현지화 파일에서 찾는다. 그 파일을 읽으면 사람이 이름을 하나씩 입력할
필요가 없다. 지금은 이벤트 이름(`event_names`, 0208)을 채운다. 같은 파일에 아이템
(`goods`)·패키지(`gift`)·연구·영웅 테이블도 있어서 계산기와 가성비 리포트도 여기서
출발한다.

사용자 결정(2026-10-02): 본인 기기의 클라이언트 파일을 읽기 전용으로 쓴다.
파일은 **레포 밖**(`C:\DW_data\gamedata\`)에만 두고 커밋하지 않는다.

## 파일이 어디 있고 어떻게 생겼나

- 위치: BlueStacks 안 `/sdcard/Android/data/com.readygo.dark.gp/files/AssetBundles/`
- `datatable_config_luatxt_*.bundle` — 설정 테이블. 안에 든 건 **Lua 5.4 바이트코드**
  (`*.bytes`)이고 실행하면 `{data = {[id] = {값...}}, index = {컬럼 = {위치, 타입}}}`를
  돌려준다.
- `datatable_langslice_localization_dialog_0..5.bundle` — 16개 언어의 `키=문자열`
  텍스트. 한 언어가 여섯 조각으로 나뉘어 있다. English·Korean 둘 다 있다.
- 클라이언트가 걸어둔 장치 두 개(`dw_collector/gamedata/`가 처리):
  - 번들 맨 앞에 `UnityRaw` 8바이트가 붙어 있다. 떼면 평범한 UnityFS 번들이다.
  - 바이트코드 시그니처 `\x1bLua` 뒤에 `\x03` 한 바이트가 끼어 있다. 빼면 표준 Lua 5.4다.
- `files/config.db`(146MB)는 설정이 아니라 채팅·유저 캐시다. 쓸모없다.
- `AssetBundles`에 있는 건 **패치로 내려받은** 번들뿐이다(테이블 이름 a~g 일부).
  **전체 테이블(463개)은 APK의 `split_install_time_pack.apk`(약 2GB) 안**
  `assets/AssetBundles/datatable_*.bundle` 34개(약 36MB)에 있다. 건물·연구·개조차·
  펫 업그레이드 비용과 아이템 사전은 여기서 나온다. 순서는 **기본 → 패치**(패치가 덮어씀).

## 절차

1. 번들을 복사한다(약 21MB, 읽기만 한다).

   ```powershell
   $adb = "C:\Program Files\BlueStacks_nxt\HD-Adb.exe"
   & $adb devices
   & $adb -s emulator-5554 pull /sdcard/Android/data/com.readygo.dark.gp/files/AssetBundles/. C:\DW_data\gamedata\bundles
   ```

   기기 이름이 다르면 `devices`에 나온 것을 쓴다.

2. 확인만(쓰지 않음):

   ```powershell
   cd C:\darkwar-platform\services\collector
   uv sync --extra gamedata
   uv run dw-collector game-names --bundles C:/DW_data/gamedata/bundles --dry-run
   ```

   `1443 named events in the client's tables (English)` 같은 줄과 목록이 나온다.

3. 올리기(`.env`의 `SUPABASE_URL`·`SUPABASE_SECRET_KEY` 사용):

   ```powershell
   uv run dw-collector game-names --bundles C:/DW_data/gamedata/bundles
   ```

   `written=N unchanged=M kept-officer-names=K`. 임원이 직접 입력한 이름
   (`updated_by`가 있는 행)은 **절대 덮어쓰지 않는다.** 이 도구가 쓴 행(`updated_by`
   null, `note`에 출처 표기)은 게임이 이름을 바꾸면 다음 실행에서 갱신된다.

4. 기본 팩에서 전체 테이블 꺼내기(2GB를 통째로 받지 않는다). 기기의 `unzip -p`는
   파일 끝에 `unzip: invalid zip magic 00000000\n`(34바이트)을 붙여 내보내므로 잘라낸다.

   ```bash
   A="C:/Program Files/BlueStacks_nxt/HD-Adb.exe"
   P=$("$A" -s emulator-5554 shell pm path com.readygo.dark.gp | grep install_time_pack | cut -d: -f2 | tr -d '\r')
   mkdir -p C:/DW_data/gamedata/base && cd C:/DW_data/gamedata/base
   for e in $("$A" -s emulator-5554 shell "unzip -l '$P'" | awk '{print $4}' | grep -E '^assets/AssetBundles/datatable_.*\.bundle$' | tr -d '\r'); do
     "$A" -s emulator-5554 exec-out "unzip -p '$P' '$e'" > "$(basename $e)"
   done
   python -c "import glob;t=b'unzip: invalid zip magic 00000000\n';[open(f,'wb').write(d[:-len(t)]) for f in glob.glob('*.bundle') for d in [open(f,'rb').read()] if d.endswith(t)]"
   ```

   크기가 `unzip -l` 목록과 정확히 같아야 한다.

5. 아이템·자원 이름과 업그레이드 비용 올리기(0209):

   ```powershell
   uv run dw-collector game-catalog --bundles C:/DW_data/gamedata/base --bundles C:/DW_data/gamedata/bundles
   ```

   `items=1869 resources=24 steps=16106 {building, research, vehicle_part, pet}`.
   게임 데이터라 덮어쓴다(사람이 고칠 칸이 없다). 영웅 이름도 채운다(`aps_new_heroes`) —
   관리자가 입력한 이름은 그대로 두고 빈 칸과 처음 보는 영웅만 채운다(2026-10-03 대조:
   입력된 31명 전원 게임 이름과 일치). 영웅 장비 비용은 아직 없다 — 승급은 Power Core
   (`ds_equip_promote`)로 확인됐지만 레벨업 재료(`ds_equip_upgrade.stone_upgrade_cost`)가
   어떤 아이템인지 테이블에 없다.

6. 아이템 가치(루비)와 팩 이름 올리기(0215). **팩이 먼저 동기화돼 있어야 한다** —
   `exchange.info`가 잡힌 뒤(상점·팩 화면을 한 번 열면 온다), 수집기가 `shop_pack_snapshots`로 올린 다음:

   ```powershell
   uv run --no-sync --with "UnityPy>=1.25" --with "lupa>=2.8" dw-collector game-values --bundles C:/DW_data/gamedata/base --bundles C:/DW_data/gamedata/bundles
   ```

   세 출처, 위가 이긴다:
   - **officer** — 대시보드에서 임원·관리자가 고친 값. 이 명령은 절대 덮어쓰지 않는다.
   - **game** — `goods.price`. 루비 상점(상점 타입 1) 정가와 모든 품목에서 같다(2026-10-03 대조).
     **VIP 포인트는 0**(사용자 결정 2026-10-03: 보너스지 가치가 아니다).
   - **estimated** — 루비 상점에 없는 품목(Power Core, Precision Part, Design Blueprint …)은
     팩들의 게임 주장 가치(`percent`)에서 역산한다. game 가격 품목은 고정하고, 남은 품목만
     비음수 최소제곱으로 푼다(VIP 포인트는 여기선 게임 가격으로 — 게임 주장에 포함돼 있으니까).
     오차 중앙값 4%, 팩 2개 미만에 나온 품목은 추정하지 않는다. 그래서 '추정'으로 표시하고 임원이 고친다.

   1 루비 = $0.0099 (루비만 든 팩이 전부 $0.99당 100).

## 아이콘 (영웅·무기·장비·아이템 그림)

그림은 패치 번들이 아니라 Play 스토어가 APK 옆에 까는 에셋 팩
`split_install_time_pack.apk`(약 2 GB, 번들 4,288개 중 그림 번들 약 1,169개)에 있다.

1. 경로 확인 — 설치마다 디렉터리 이름이 바뀐다:
   `HD-Adb.exe -s <endpoint> shell pm path com.readygo.dark.gp`
2. 복사 — **PowerShell에서** 한다. Git Bash는 `/data/app/...`를 Windows 경로로 바꿔 버려서
   "성공"하고도 파일이 없다(2026-10-05).
   `HD-Adb.exe -s <endpoint> pull "<pm path가 준 경로>/split_install_time_pack.apk" C:/DW_data/gamedata/apk/install_time_pack.apk`
3. 올리기:
   `uv run --no-sync --with "UnityPy>=1.25" --with "lupa>=2.8" dw-collector game-icons --bundles <base> --bundles <patch> --pack C:/DW_data/gamedata/apk/install_time_pack.apk`
   (`--extra gamedata`는 쓰지 않는다: 수집기 환경을 다시 설치하려다 실행 중인 `dw-collector.exe`에
   막혀 os error 32로 실패한다. Pillow는 UnityPy에 딸려 온다.)
   먼저 `--dry-run`으로 개수를 본다(첫 배치: 102개, 259 KB — 무기 18/18, 장비 60/60, 영웅 40/47,
   업그레이드에 드는 아이템 28/32).

그림은 게임 회사 것이라 **공개 URL로 내보내지 않는다**. `game_icons`(base64 WebP, 긴 변 96px)와
`game_icon_refs`(무엇이 어느 그림인지)는 멤버만 읽고(0232), 대시보드는 로그인한 세션으로 받아 간다.
dev 픽스처에는 진짜 그림 대신 색 원을 쓴다.

### 아이콘이 없는 상점 아이템 25개 (2026-10-08)

Shop value에서 그림이 빈 25개는 `goods.icon`이 가리키는 그림이 **설치된 asset pack에 없다**.
번들 3,440개(mesh/music/animation/spine/zombie/scenes/dub 제외)를 Sprite·Texture2D 이름으로 전부
훑었고, 로컬 `base`·`bundles`(패치)에도 그림이 없다. 같은 이름의 변형(대소문자·밑줄)도 없다.

| 아이템 id | `goods.icon` |
|---|---|
| 200001, 200004, 200006, 200008 | `item000`, `item005`, `item014`, `item004` |
| 200016, 200017, 200020 | `item200016`, `item200017`, `item200020` |
| 200018 | `item_jail_2` |
| 200100, 200101 | `item201` |
| 200300, 200302, 200304-200306 | `item400` |
| 200414, 200415 / 200416, 200417 | `item501` / `item502` |
| 200424, 200425 / 200426 | `item506` / `item514` |
| 222010 | `item401` |
| 222101, 222102 | `icon_microradar=png`, `icon_transmissionrod=png` |

이름을 추측해 다른 그림을 붙이지 않는다. 남은 후보는 기기의 `base.apk`·`split_config.*.apk`와
on-demand 팩이다(`pm path com.readygo.dark.gp`가 주는 나머지 파일). 에뮬레이터를 켠 뒤
`pm path`로 목록을 보고, 새 APK를 `C:/DW_data/gamedata/apk/`에 복사해 같은 이름으로 훑는다.
`icon_*=png`는 값에 `=png`가 붙은 표 오타일 수 있으니 `icon_microradar`로도 찾는다.

## 이벤트 가이드: 무엇이 점수를 주는가 (0248)

Survival Preparedness와 Alliance Duel의 테마별 점수 항목은 서버가 주는 테마 목록
(`hero.event.info.get`, `get.hero.event.calendar`)과 클라이언트의 `score` 테이블(항목 이름과 기본 점수)을
합쳐 만든다. 멤버 개인의 점수는 읽지 않는다 — 버프 때문에 사람마다 다르다.

`uv run --no-sync --with "UnityPy>=1.25" --with "lupa>=2.8" dw-collector game-event-guide --bundles C:/DW_data/gamedata/base --bundles C:/DW_data/gamedata/bundles --journal C:/DW_data/live.db --dry-run`

먼저 `--dry-run`으로 개수를 본다(2026-10-08: 테마 10, 점수 항목 125, 달력 42칸). 게임 업데이트 뒤나 테마가
이상해 보일 때 다시 돌린다. Duel은 그 주의 차례가 와야 요일 테마가 오므로, 아직 안 온 요일은 가이드에
"Not seen yet"으로 나온다. 화면은 `#/event-guide`(Events 탭). 시각은 전부 서버 시간(UTC-2)이고, 슬롯 1은
서버 00:00에 시작하는 4시간 칸이다.

## 연구 선행 조건 (0243)

`game-catalog`는 연구 단계마다 선행 조건도 `game_upgrade_steps.requires`에 쓴다.
`aps_science.building_condition`(연구소 같은 건물 레벨, 건물 id = 종류+레벨)과
`science_condition`(먼저 끝내야 하는 연구, `aps_science`의 행 id). 연구 쪽 조건에는
`"kind": "research"`가 붙고, kind가 없으면 건물이다. **0243 마이그레이션을 푸시한 뒤 이 명령을 한 번 다시
돌려야** 플래너가 선행 연구를 계산에 넣는다(돌리기 전에는 연구 단계에 조건이 없어 예전과 같다).
확인: `select count(*) from game_upgrade_steps where kind='research' and jsonb_array_length(requires) > 0`
가 4,000 대(2026-10 기준 4,349)면 된다.

## 언제 다시 돌리나

게임 업데이트 뒤. `AssetBundles/*.version` 파일이 바뀌었으면 1~3을 다시 한다.
새 이벤트는 캘린더에 번호로 먼저 나타나고, 이걸 돌리면 이름이 붙는다.

## 하지 말 것

- 번들·추출물을 레포에 넣기. 게임 회사의 자산이다.
- `--extra gamedata`를 수집기 상시 실행 환경의 필수 의존성으로 만들기. 이 명령만 쓴다.
