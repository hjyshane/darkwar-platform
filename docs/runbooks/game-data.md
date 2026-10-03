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
- 이건 **패치로 내려받은** 번들뿐이다. APK 안 기본 테이블에만 있는 항목은 여기서
  안 나올 수 있다(이벤트는 캘린더 70개 중 67개가 여기서 나왔다).

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

## 언제 다시 돌리나

게임 업데이트 뒤. `AssetBundles/*.version` 파일이 바뀌었으면 1~3을 다시 한다.
새 이벤트는 캘린더에 번호로 먼저 나타나고, 이걸 돌리면 이름이 붙는다.

## 하지 말 것

- 번들·추출물을 레포에 넣기. 게임 회사의 자산이다.
- `--extra gamedata`를 수집기 상시 실행 환경의 필수 의존성으로 만들기. 이 명령만 쓴다.
