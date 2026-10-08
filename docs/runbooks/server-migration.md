# 서버 이민 보드 운영 (0186)

대시보드 `#/migration`. 이민 전후를 **한 시점(baseline) 기준으로** 비교한다.
새 캡처는 없다 — 평소 쌓이는 스냅샷을 baseline 앞뒤로 나눠 읽을 뿐이다.

## 무엇을 세나

- **서버 총인원이 아니다.** 우리가 관찰한 사람만: 크로스서버 전투력 보드
  (`server.rank`, top 150) + 우리가 연 연맹 로스터(`al.rank`).
- 서버 간 비교에서 믿을 만한 건 **Top 150 열**이다. 양쪽 모두 보드 한 장을 통째로
  캡처하기 때문이다. "Tracked" 열은 우리가 얼마나 자주 봤는지에 좌우된다.
- 상태: `moved`(전후 서버가 다름) · `stayed` · `unseen_after`(이후 아직 못 봄 —
  떠난 게 아님) · `appeared`(이전 14일 안에 기록 없음).
- 연맹은 게임 연맹 id(`external_id`)로 묶는다. 서버를 옮긴 연맹도 한 줄이다.

## 이민 전 (baseline 직전, 창 열리기 하루 이내)

1. 크로스서버 **전투력 보드** 열기 (`server.rank`).
2. 크로스서버 **연맹 보드** 열기 (`alliance.rank`).
3. 추적하고 싶은 **연맹 로스터 전부** 열기 (`al.rank`). 연 연맹만 이탈/가입이 계산된다.
4. 대시보드 Migration → **Add migration**: 이름, baseline(서버 시간, UTC−2)은
   위 스윕 **직후** 시각. settled는 비워둔다 → 보드가 라이브로 갱신된다.

baseline 이전 14일보다 오래된 기록은 "이전 상태"로 쓰지 않는다.

## 이민 창 동안

- settled가 비어 있으면 baseline 이후 캡처가 전부 "이후"다. 평소처럼 보드를 열면
  갱신된다.
- **첫 이후 캡처에서 반드시 확인:** 이동한 걸 아는 플레이어 한 명의 raw
  `serverId`가 **새 서버**를 가리키는지. 2026-09-27 저널 확인 시점엔 아무도 이동 전이라
  `serverId == UID 끝 6자리`였다. 만약 이동 후에도 옛 서버(=UID 끝자리)를 보고한다면
  이 보드는 이동자를 전부 `stayed`로 센다 — 그 경우 `al.rank`의 `curServerId`를
  대안으로 검토.

## 이민 후

1. 1–4와 같은 스윕을 다시.
2. **Edit times** → settled에 그 스윕 **직전** 시각. 이후 보드는 이 시각 이후 캡처만 읽는다.

## 하지 말 것

- 이민이 settled 되기 전에 `retention_report(p_confirm=true)` 실행 금지.
  남의 서버 스냅샷을 7일 뒤 지워서 "이전" 쪽이 사라진다. 보드는 동결 사본이 아니라
  스냅샷에서 계산된다.

## 등급·할당량: 게임 안에 이미 있는 것 (2026-10-08 조사, 0250)

탭("Seats & rules")은 아직 게임에 없다. 그런데 **화면의 코드와 규칙 설정은 이미 클라이언트에
들어 있다.** 스위치만 꺼져 있다.

### 스위치

`init`의 `function_on_config.immigration_new` = **0**. 이게 1이 되는 날 화면이 열린다
(`IsNewImigrateOn`). `IsNewImigrateRuleEntryOn`은 규칙 화면 입구용 별도 스위치.

### 이미 캡처되는 규칙 (`init` → `dataConfig`)

| 키 | 값(2026-10-08) | 읽는 법 |
|---|---|---|
| `aps_migrate_server.k6` | `10000000;15000000;25000000;35000000` | **네 등급의 migrate power 경계**: 1천만 / 1천5백만 / 2천5백만 / 3천5백만 |
| `aps_migrate_server.k2` | 그룹 4개(`\|`), 각 `…;9999999999` | 등급별 power 구간(2M–10M, 3M–15M, 10M–25M, 15M–35M). 비용 구간으로 추정, **미확인** |
| `aps_migrate_server.k1/k3/k4/k5/k7` | `10000000` / `5` / `2880` / `2880` / `1` | power 한도 하나, 개수 하나, 48시간 두 개, 스위치. 용도 **미확정** |
| `migration_quota.k1` | `1-88;0.6,1.5,12\|89-324;0.4,1.5,12\|325-3000;0.4,1.5,7.5` | 서버 순위 구간별 매개변수. 쿼터 공식의 입력으로 추정 |
| `migration_quota.k2/k3` | `1-324;1,1,7,40\|325-3000;…` | 같은 꼴 |
| `migration_quota.k6` | 아이콘 4세트 | 등급별 아이콘 |

등급 이름은 클라이언트에서 **Normal / Mid / High / Special** (배경 그림
`yimin_bg_weizhi01–04`). 별도로 `General`이 하나 더 있는데 그림이 다르고(`chair05`) 일반 홍봉투
아이템(`GENERAL_RED_ENVELOP_ITEM_ID`)과 엮여 있다 — 네 등급과 같은 줄이 아니다.
**등급 ↔ 위 경계의 순서 대응은 코드에서 확인하지 못했다.** 표는 경계를 작은 것부터 Normal,
Mid, High, Special로 부르지만 그건 이름 순서일 뿐 증명이 아니다.

개인의 `migratePower`는 `get.user.info.multi`와 `dragon.assign.player.info`에 이미 있다
(admin 전용 지표). 등급은 이 값을 위 경계에 대 보면 나온다 — `levelOf()`
(`apps/dashboard/src/features/migration/quota.ts`).

### 서버별 할당은 서버가 준다

서버별 좌석은 설정이 아니라 **`get.migrate.servers` 응답**으로 온다 (화면을 열 때). 클라이언트의
`MigrateServerData.ParseServerData`가 읽는 필드:

| 필드 | 뜻 |
|---|---|
| `serverId`, `season`, `season_group`, `server_rank_type` | 어느 서버(받는 쪽), 시즌, 서버 종류(Strong/Weak) |
| `migrateLeft` | 등급별 남은 좌석 (`{type, num}` 쌍) |
| `specialLeft`, `inviteLeft` | 특별 / 초대 남은 좌석 |
| `powerLowLimit` | 등급별 power 하한 |
| `powerLimit`, `specialPowerLimit` | 대통령이 정한 상한 |
| `totalCount`, `useCount` | 받을 수 있는 수 / 이미 받은 수 |
| `targetPowerLimit`, `maxPower`, `needItemId`(기본 252000), `needItemNum`, `targetOpenTime`, `king*` | 그 외 |

다른 이민 명령(수집·파싱은 **아직 안 함**): `migrate.user.info`, `get.migrate.item`,
`migrate.apply`, `migrate.apply.list`, `migrate.self.apply.list`, `migrate.approve`,
`migrate.invite`, `migrate.invite.refuse`, `migrate.set.power.limit`, `migrate.server`,
`push.migrate.new.apply`, `push.migrate.new.invite`. 저널에는 `move.cross.server`만 있고 거기엔
등급도 좌석도 없다(받는 서버의 접속 정보뿐).

### 풀지 못한 것

- `migration_quota`의 매개변수가 **좌석 수로 바뀌는 공식**. `MigrateDataManager`의
  `GetMigrateQuotaData` / `GetMigrateLevelData` 안에 있는데 Lua 5.4 **바이트코드**라 문자열과
  상수만 읽힌다(디컴파일러 없음). 어차피 서버가 `migrateLeft`로 최종 숫자를 주므로 공식은
  없어도 된다 — 단, 발표 전에 좌석을 미리 계산해 보고 싶다면 필요하다.
- 등급 ↔ 경계 순서, `k1~k7`의 용도 (위 표).

### 이 코드가 어디 있나 (다시 찾을 때)

- 이민 화면 UI 스크립트 67개: 패치 번들(`C:\DW_data\gamedata\bundles`, `lua_scripts_ui_*`).
- `MigrateDataManager`와 네트워크 메시지: **APK의** `install_time_pack.apk` →
  `assets/AssetBundles/lua_scripts_datacenter_m_*.bundle`, `lua_scripts_net_*`. 로컬 `base/`에는
  datatable만 풀려 있어서 처음엔 안 보였다. 명령 이름 표는 `lua_scripts_net`의 `MsgDefines`.
- 풀기: `dw_collector.gamedata.bundles.read_dir()`로 해당 번들 폴더를 읽는다
  (`docs/runbooks/game-data.md`의 APK 추출과 같은 방식).

## 수집기·DB·탭이 하는 일 (0250)

| 들어오는 것 | 파서 | 테이블 | 화면 |
|---|---|---|---|
| `init`의 `dataConfig`(위 두 블록) + 스위치 | `normalize/migration_config.py` (`account_state.py`가 호출) | `migration_config_snapshots` — 같은 설정이면 UTC 하루 1행 | Seats & rules → 등급 표 |
| `get.migrate.servers` | `normalize/migration_servers.py` | `migration_server_snapshots` — 서버·상태·시간당 1행 | Seats & rules → 서버별 좌석 표 |

- 보는 사람은 **officer·admin** (이민 보드와 같다). `migration_server_quotas()`가 서버마다
  최신 1행을 준다.
- `server_id`는 **받는 서버**다. 캡처한 서버는 `collected_from_server_id`.
- 이민 이벤트(위의 baseline/settled)와 무관하다. 이벤트가 하나도 없어도 탭이 보인다.

### `get.migrate.servers` 파서는 아직 추측이다

화면이 열린 적이 없어서 **응답 한 번도 본 적 없다.** 봉투(`list` 같은 키)와 각 필드의 모양은
위 Lua에서 추론했다. 그래서 파서는 (1) 봉투 어디에 있든 `serverId`가 있는 항목을 찾고,
(2) 모르는 모양은 null로 두고, (3) 항목 전체를 `raw`에 그대로 남긴다. 픽스처
`protocol-fixtures/decoded/get.migrate.servers/servers_synthetic_v1.json`은 **손으로 쓴 것**이고,
테스트는 "관대하다"를 증명하지 "추측이 맞다"를 증명하지 않는다.

## 화면이 열리는 날 할 일

1. **열렸는지 본다.** `init` 캡처의 `function_on_config.immigration_new`가 1이 되면 열린 것.
   (탭의 빈 상태 문구가 이 값을 보고 바뀐다 — `migration_config_snapshots.new_migrate_on`.)
2. **수집기를 켠 채로** 에뮬레이터에서 이민 화면을 연다: 이민 가능 서버 목록, 규칙, 서버 하나하나의
   상세. 열 때마다 `get.migrate.servers`가 나간다.
3. **저널이 조용해진 뒤** 읽는다(캡처는 늦다). 새 명령이 보이는지:

   ```bash
   sqlite3 C:/DW_data/live.db "select source_command, count(*) from raw_observations where source_command like '%migrat%' group by 1"
   ```

4. **첫 실제 응답으로 추측을 바로잡는다.** 응답 payload를 열어 봉투와 필드 모양을 확인하고,
   - `normalize/migration_servers.py`의 `entries()` / `seats()` / `int_list()`를 고치고,
   - 실제 응답을 정리(uid·이름 제거)해 `servers_real_v1.json`으로 추가하고, 합성 픽스처는 지운다,
   - `migration_server_snapshots`에서 **null로 남은 열**이 있으면 그 필드가 예상과 다른 것이다.
5. 탭 "Seats & rules"에서 서버별 좌석이 맞게 보이는지, 게임 화면과 한 서버씩 대조한다.
6. 그 다음 단계(아직 안 함): 개인이 어느 등급인지(`levelOf`) 보드에 붙이기, 이민 후 실제 이동과
   남은 좌석 비교, `migrate.user.info` / `get.migrate.item` 파싱.
