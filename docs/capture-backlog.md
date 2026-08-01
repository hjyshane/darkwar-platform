# 캡처 백로그

스펙 §26.1은 새로 찍어야 할 캡처 14개를 나열한다. 2026-07-30 발견 스윕 이후
그 목록은 갱신이 필요하다 — **상당수는 커맨드 이름과 shape을 이미 확보했고**,
남은 것은 대부분 "그 기능이 실제로 돌아갈 때" 다시 찍어야 하는 것들이다.

원본 pcap은 저장소 밖(`C:\DW_data`, `C:\darkwar-adb`)에 두고, sha256과 메모만
`protocol-fixtures/manifests/`에 커밋한다.

## 이미 확보 — 추가 캡처 불필요

| 대상 | 상태 |
|---|---|
| 확정 커맨드 7종 (Appendix B) | 파서·살균 fixture·replay 테스트 완료: `al.rank` · `alliance.rank` · `get.al.info` · `server.rank` · `get.new.user.info` · `get.user.info.multi` · `user.get.arena.info` |
| 로그인 시퀀스 (§26.1 이벤트 01) | `init` · `account.login.new` · `check.device.change` · `push.setting` · `push.utc.time` shape 확보 |
| 이벤트 탭 (§26.1 이벤트 02) | `get.battlepass.info` · `dragon.activity.info` · `monster.siege.activity.info` · `get.fortress.activity.info` · `get.dig.activity.info` · `hero.event.info.get` · `apex.info` 등 shape 확보 |
| 메일 (§26.1 이벤트 03) | `push.mail`(`fromUser`/`toUser`가 UID, `contentsArr`가 본문) · `chat.get.system.mails` · `get.del.mail.list` |
| 기여도(일간 기부) | `get.daily.alliance.donate.rank` 승격 완료 — `contribution_type='daily_donation'` |

`schema_observations`에 미확인 커맨드 **164종**의 타입 스켈레톤이 있다. 새 파서를
쓸 때는 새로 찍기 전에 먼저 여기를 본다.

## 필요한 캡처 — 우선순위 순

### 0. 기여도 일간·주간 — 아무 때나 가능 · **최우선**

게임 화면에는 기부와 듀얼이 **일간과 주간으로 각각** 나온다. 우리가 가진 것은
일간 기부 하나뿐이다.

`al.battle.rank.info`는 스윕에서 "승격" 판정을 받았지만 **실제로 승격되지
않았다** — 파서도 fixture도 없다. 그 결과:

- `contribution_type='alliance_battle'` 행을 만드는 코드가 **없다**
- 스키마·트리거·대시보드 열(`Alliance Battle`)은 전부 존재하는데 **영원히 비어
  있다**. 목 데이터로만 확인해서 여태 드러나지 않았다

스윕 노트가 남긴 단서: `al.battle.rank.info`의 **`type`이 두 랭킹을 구분한다.**
그것이 일간/주간일 가능성이 높다.

**캡처 방법** — `rank.get.by.range`와 같은 라벨 붙인 캡처다. 탭을 하나씩 열되
어떤 탭인지 적고, 화면의 숫자를 payload 값과 대조한다.

| 열 화면 | 적어둘 것 |
|---|---|
| 연맹 → 기부 랭킹 → **일간** | 상위 3명의 이름과 점수 |
| 연맹 → 기부 랭킹 → **주간** | 같은 3명의 점수 (일간과 다른지) |
| 연맹 → 듀얼(연맹 대전) → **일간** | 상위 3명의 이름과 점수 |
| 연맹 → 듀얼 → **주간** | 같은 3명의 점수 |
| 듀얼에 **라운드** 구분이 있으면 그것도 | 라운드 번호와 점수 |

확인할 것:

1. 주간 기부가 **별도 커맨드**인가(`get.week...` 같은), 아니면 같은 커맨드의
   다른 `type`인가
2. `al.battle.rank.info`의 `type` 값과 화면 탭의 대응
3. 화면 숫자와 payload `score`가 일치하는가 — 일치해야 개인 귀속이 성립한다

판정이 끝나면 `contribution_type` check 제약을 확장하고
(`daily_donation`, `weekly_donation`, `alliance_battle_daily`, … 실제로 관측된
것만) 파서를 승격한다. **관측 전에 컬럼을 추측해서 만들지 않는다.**

### 1. 라벨 붙인 랭킹 탭 — 아무 때나 가능

**막고 있는 것**: `rank.get.by.range`의 `type`(45/49/79/80)이 무슨 지표인지 모른다.
같은 플레이어가 type마다 다른 값(66.5M / 7.09M / 4.73M / 1.93M)을 갖고, 실제 총
전투력(314M)과는 어느 것도 일치하지 않으며 4개 합도 총합이 아니다. 해석 없이
`player_snapshots.power`에 넣으면 전투력을 4분의 1로 오염시킨다.

**2026-07-30 해결 — 그리고 정정**: 처음에는 탭을 연 순서로 추론해
`45=영웅 총합, 79=최강 영웅, 49=펫 총합, 80=최강 펫`이라고 적었는데 **49와 79가
뒤바뀐 것이었다.** 파서를 만들며 `probe.pcapng`의 페이로드로 다시 검증한 결과:

| type | 지표 | 근거 |
|---|---|---|
| 45 | 영웅 총 전투력 | `selfPower` 70,857,050 = 수집 계정 프로필의 `heroPower`와 **정확히 일치** |
| 79 | 펫 총 전투력 | `selfPower` 7,977,471 = 같은 프로필의 `petPower`와 **정확히 일치** |
| 49 | 최강 영웅 | 항목마다 `heroId`가 있다 — 영웅 하나를 지목하는 보드 |
| 80 | 최강 펫 | 항목마다 `petId`가 있다 |

**교훈**: 캡처 순서는 정황이고 페이로드는 증거다. 순서 기반 추론을 그대로 칼럼
이름으로 굳혔다면 두 지표가 영구히 뒤바뀐 채 쌓였을 것이다.

**파서 완료**(마이그레이션 0018, `player_component_power_snapshots`). 재캡처는
필요 없었다 — `probe.pcapng`에 네 보드가 모두 들어 있었다.

### 2. 수집 계정으로 메일 받기 — 아무 때나 가능

**막고 있는 것**: `game_identity_links`(§6.2 Discord 계정 연결). 연기 사유가
"인게임 메시지 수신 커맨드 미확정"이었는데 `push.mail`이 그 조건을 충족할
가능성이 높다.

**방법**: 캡처를 켠 채로 **다른 계정에서 수집 중인 계정으로** 메일을 보낸다.
`fromUser`가 보낸 사람 UID로 채워지고 `contentsArr`에 본문이 들어오면 확정이며,
"일회용 코드를 게임 메일로 받아 UID와 매칭"하는 흐름을 구현할 수 있다.

### 3. 전투 리포트 — 수신은 확보, 해석이 남음

**2026-07-30 갱신**: `all_walkethrough.pcapng`에서 리포트 메일을 잡았고
`mail.read.share`를 승격해 **원본을 저장하기 시작**했다
(`battle_report_ingests`, 마이그레이션 0013).

| 파일 | 상태 |
|---|---|
| `01_report_share_receive` | **확보** — `mail.read.share`. 마커는 `custom.c.battleReportSimple`, 본문은 `contentsLocal.obj.battleContent` |
| `02_report_open_detail` | **확보** — `get.fight.report.detail` 승격, `report_kind='detail'`로 적재. 메일 본문과 **다른 바이트**다(12,340 vs 5,642 decoded — 요약본과 전체본) |
| `03_report_reply_send` | 미확보. 회신은 우리가 **보내는** 쪽이라 캡처 엔진이 버린다 (FR-BR-006) |

**남은 진짜 장애물은 캡처가 아니라 스키마다.** `battleContent`는 base64 protobuf인데
`.proto`가 APK에 없고 descriptor 문자열도 없다. 그래서 **해석은 미루고 적재만 한다** —
스키마를 알아내는 날, 분석할 히스토리가 이미 쌓여 있게 하려는 것이다. `battle_reports`
계열 분석 테이블은 여전히 만들지 않는다(칼럼이 전부 추측이 된다).

관측된 리포트 메일은 **시스템 발신**이라 `fromUser`/`fromName`이 비어 있다. `toUser`는
원 수신자이고 이번 건은 수집 계정이 아닌 **다른 플레이어**(공유된 리포트를 읽은 것)였다.
어느 쪽이 공격자인지는 확인되지 않았으므로 UID만 저장하고 플레이어로 연결하지 않는다.

`push.share.msg`가 채팅 채널인 것은 확인했으나 이번 캡처에서도 `msg`가 비어 있었다.

### 4. 연맹 보스전 진행 중 — 시점 제약

**막고 있는 것**: 개인별 보스 기여도. `get.alliance.boss.activity.info.new`의
`dmgRecordArr`는 `{diff, dmg}`뿐이었고 `memberDamageArr`는 비어 있었다.
`alliance.boss.damage.rank.new`도 `rankList: []`였다.

**방법**: 보스전이 열려 있고 멤버들이 딜을 넣은 뒤 해당 화면을 연다. 개인 UID가
붙어 나오면 승격 가능하고, 안 나오면 연맹 총량만 남으므로 개인 배분은 하지
않는다(FR-SEA-008).

### 5. 이벤트 진행 중·정산 — 시점 제약

§26.1 이벤트 04·05. 탭 shape은 확보했지만 **진행 중인 랭킹**과 **최종 보상
정산**은 그 시점에만 데이터가 찬다.

- 이벤트 랭킹 화면 (개인 / 연맹 / 팀 scope별로)
- 정산 직후의 메일과 보상 tier

`push.act.score.obtain`은 **수집 계정 자신의** 점수만 준다. 남의 이벤트 점수는
랭킹 화면을 열어야 한다.

### 6. 시즌 — 시즌 활성 시에만

§26.1 시즌 6종. `get.season.group.server.info` 등 커맨드는 보이지만 시즌이
비활성이라 내용이 비어 있다.

- 시즌 개요 탭 / 지도 팬 스캔 / 건물 상세 / 수령·기여 / 연맹 기여 화면

**§14 시즌 프레임워크 전체가 여기에 걸려 있다.** 다음 시즌이 열리면 우선순위가
가장 높아진다.

## 시점 제약 요약

아무 때나 가능한 것은 **1·2뿐**이다. 3은 사람이 필요하고, 4·5·6은 **그 기능이
돌아가는 동안에만** 찍을 수 있다. 이벤트나 시즌이 시작되면 그때 캡처를 켜두는
편이 낫다 — 놓치면 다음 사이클까지 기다려야 하고 그동안 해당 마일스톤은 움직이지
못한다.

## 절차

`docs/runbooks/capture-sweep.md`를 따른다. 요약: 한 세션을 끊지 말고 켜둘 것, 각
화면은 닫고 다시 열 것(캐시), VPN 끊을 것. 세션 후 `dw-collector journal-summary`로
무엇이 잡혔는지 확인하고 sync한다.

승격 판정 기준과 이미 판정한 커맨드 목록도 같은 문서에 있다 — **UID가 있다는 것만으로
승격하면 안 된다**는 것이 이번 스윕에서 두 번 확인됐다(`al.show.help`는 요청자,
`rank.get.by.range`의 `power`는 지표별 값).
