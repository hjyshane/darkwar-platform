# 런북: 발견 스윕 캡처

> 무엇을 아직 찍어야 하는지는 `docs/capture-backlog.md`에 우선순위와 시점
> 제약까지 정리돼 있다. 이 문서는 *어떻게* 찍는지를 다룬다.

목적은 데이터 수집이 아니라 **프로토콜 발견**이다. 화면을 한 번에 넓게 열어
미확인 커맨드의 shape을 `schema_observations`에 쌓아두면, 이벤트·시즌·전투
리포트 프레임워크(§13/§14/§15)를 만들 때 새로 캡처하러 돌아가지 않아도 된다.
스펙 §26.1이 "새로 찍어야 한다"고 나열한 14개 캡처의 상당 부분이 이 방식으로
대체된다.

## Wireshark를 함께 켤 것인가

**발견 세션에서는 켠다.** Npcap은 같은 어댑터에 여러 캡처 핸들을 허용하므로
`dw-capture`와 동시에 돌려도 서로 패킷을 뺏지 않는다.

이유는 하나가 결정적이다 — **pcap은 디코드에 실패한 바이트까지 보존하지만,
저널은 디코드에 성공한 것만 남긴다.** 이 프로젝트에서 디코더 버그를 두 번
찾았는데(블로킹 `sniff()`를 순회한 것, 프레임 경계 오탐), 그때마다 pcap이 있었기
때문에 고친 뒤 **다시 스캔**할 수 있었다. 라이브 캡처만 돌렸다면 그 프레임들은
복구할 수 없었다. 실제로 pcap 하나에서 파서 3개분의 fixture가 나왔다.

부수적으로 통제 실험도 된다: 같은 시간·같은 조작에서 Wireshark에는 있는데
라이브에는 없는 커맨드가 있다면 라이브 캡처가 유실하고 있다는 증거다.

**정기 수집에서는 켜지 않는다.** 파서가 안정된 뒤에는 pcap을 쌓을 이유가 없고,
§11.5는 PCAP 보존을 로컬 14일로 잡는다.

설정: 캡처 필터(디스플레이 필터가 아니라)에 `tcp port 8680`, 저장은 pcapng
(우리 리더는 pcapng만 읽는다). 파일은 `C:\DW_data`처럼 저장소 밖에 둔다 —
계정 UID와 세션 서명이 들어 있다(§5.2).

## 규칙

- **한 번의 캡처를 계속 켜둔다.** 화면마다 끊지 않는다. 10~20분 한 세션.
- **각 화면은 닫고 다시 연다.** 이미 열려 있으면 캐시돼 요청이 안 나간다.
- **VPN은 끊는다.** 켜져 있으면 물리 어댑터에 암호화된 UDP만 보인다.
- 순서대로 진행하면 `_id`가 증가하므로 나중에 시간순 상관이 가능하다.
- 이름만 있고 UID가 없는 화면은 **개인 귀속에 쓸 수 없다**(이름은 바뀌므로).
  그래도 캡처해 둘 가치는 있다 — shape을 알면 판단할 수 있다.

## 목록

시작: `uv run dw-capture` (그대로 두고 게임으로 전환)

### 1. 로그인 흐름 (§26.1 `01_announcement_login`)
게임을 **완전히 종료하고 재시작**한다. 로그인 직후 공지·이벤트 초기 payload가
한꺼번에 흐른다. 여기서만 보이는 커맨드가 많다.

### 2. 연맹
- 멤버 목록 ← `al.rank` (확정, 로스터)
- 멤버 목록에서 **개인 프로필** 몇 명 ← `get.new.user.info`, `get.user.info.multi`
- **기여 / 지원 탭** ← `al.show.help`(UID 있음) 그리고 기여 탭에 별도 커맨드가
  있는지 확인하는 것이 이 세션의 핵심 목표
- 연맹 랭킹 — 로컬과 크로스서버 둘 다 ← `alliance.rank`
- 다른 연맹 정보 열기 ← `get.al.info`
- 연맹 공지 / 가입 신청 목록 / 투표
- 연맹 보스, 연맹 결투(duel), 선전포고 화면
- 연맹 창고 / 복지 / 레드패킷 / 기술(science)

### 3. 랭킹
- 플레이어 전투력 순위 ← `server.rank` (확정, 크로스서버)
- 킬 순위, 그 외 순위 탭 전부 (각 탭이 다른 커맨드일 가능성이 높다)

### 4. 아레나
- 아레나 랭킹 ← `user.get.arena.info` (확정, Top100)
- 주간 매치업, 방어 편성 화면

### 5. 이벤트 (§26.1 이벤트 5종)
- 이벤트 탭 목록
- 진행 중인 이벤트의 **랭킹**
- 이벤트 보상 tier / 목표 달성률
- 메일함 — 이벤트 정산 메일이 있으면 열기

### 6. 시즌 (활성일 때만, §26.1 시즌 6종)
- 시즌 개요 탭
- 지도를 **팬(pan)** 해서 몇 화면 이동
- 시즌 건물 하나 열기
- 수령/기여 동작

### 7. 전투 리포트 (§26.1 전투 3종)
- 전투 리포트 목록에서 **리포트 하나 열기**
- 가능하면 수집 계정에 **리포트 공유**해보기 (§5.3의 미확정 항목)

종료: PowerShell로 돌아와 Ctrl+C → `uv run dw-collector sync`

## 세션 후 확인

무엇이 새로 발견됐는지 (Windows, 저널 기준):

```powershell
uv run python -c "import sqlite3,sys,json; c=sqlite3.connect(sys.argv[1]); [print(f'{n:4d}  {k}') for k,n in c.execute('select source_command, count(*) from raw_observations group by 1 order by 2 desc').fetchall()]" C:\DW_data\collector.db
```

sync 후 shape까지 보려면 (WSL, 로컬 스택):

```bash
curl -s "http://127.0.0.1:54321/rest/v1/schema_observations?select=source_command,fingerprint,sample&order=source_command" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" | python3 -m json.tool | head -80
```

`sample`에는 **값이 아니라 타입 스켈레톤만** 들어간다. 그래서 이 테이블을
브라우저로 열어도 UID·세션 자료가 새지 않는다. 파서를 만들 때 필요한 정보는
그 shape이다.

## 판정 기준

발견된 커맨드를 파서로 승격할지 결정할 때:

- **UID가 있는가?** 이름만 있으면 개인 귀속 불가(개명 때문). 연맹 집계로만 쓴다.
- **집계인가 개인별인가?** 연맹 총량을 개인에게 나누는 것은 FR-SEA-008 위반이다.
- **`measurement_type`은 무엇인가?** 직접 관측이면 `observed`, 다른 소스와
  결합해 추론했으면 `calculated`, 추정이면 `estimated`.

승격은 `docs/legacy-triage.md`의 큐와 같은 규칙을 따른다 — 파서 1개당 PR 1개,
살균 fixture와 replay 테스트 필수.

## 이미 판정한 커맨드

UID가 있다는 것만으로 승격하면 안 된다. 아래는 payload를 열어보고 내린 판정이며,
둘은 **필드 존재를 확인한 뒤에 의미가 다름을 발견해 되돌린 사례**다.

| 커맨드 | 판정 | 근거 |
|---|---|---|
| `get.daily.alliance.donate.rank` | **승격** | `{uid, score, updateTime}`. 개인 귀속이 명확 |
| `get.week.alliance.donate.rank` | **승격** (2026-08-01) | 주간 기부는 **별도 커맨드**다 — 일간의 `type`이 아니다. payload는 일간과 완전히 동일한 `{uid, score, updateTime}`이고, 같은 캡처에 37초 간격으로 들어온다. 라벨 대조: 화면 상위 3명이 Bored101 86,440 · VINA ăn cướp 80,820 · R3HAB 80,640이고 payload와 이름·순서가 일치. 듀얼과 달리 **양쪽 보드 모두 우리 연맹만** 담는다(90·83명 전원이 같은 캡처 `al.rank` 94명 안, 바깥 0명) — 그래서 `alliance_name` 필터가 필요 없다. 파서는 일간과 공유하고 **기간은 커맨드 이름에서** 온다. 마이그레이션 0029 |
| `al.battle.rank.info` | **승격** | `{uid, name, score}`. `type` 0=일간, 1=주간, 2=라운드 총합(4라운드) — 2026-08-01 라벨 캡처로 전부 확정. 0·1은 **상대 연맹 선수도 포함**(165 = 우리 93 + 상대 72), 2는 우리 연맹만(94). `alName`으로 구분. 파서는 2026-07-30에 작성됐으나 푸시되지 않아 다른 머신에서 보이지 않았고, 그 사이 두 문서가 "미승격"으로 잘못 적었다. 2026-08-01 리베이스 후 머지. `variant`는 라벨 캡처로 확정돼 `contribution_type` 세 개로 나뉘었다(0028) — 백로그 0번은 이것으로 닫혔다 |
| `kill.rank` | **승격** | `{uid, armyKill, rank}`. `server.rank`가 주지 않는 킬 |
| `al.show.help` | **거절** | UID는 있지만 **지원을 요청한 사람**이다. `senderId`가 1~2개뿐이고 대부분 `senderId == recvId`, `nowcount/maxcount`는 몇 명이 도왔는지만 알려주고 **누가** 도왔는지는 없다. `todayHelpPoint`는 수집 계정 자신의 값. "지원 기여도"로 만들면 실제로는 요청 횟수를 보여주게 된다 |
| `rank.get.by.range` | **거절** | 엔트리 필드가 `power`인데 **`type`마다 값이 다르다**. 같은 플레이어가 66.5M / 7.09M / 4.73M / 1.93M이고 실제 총 전투력(314M)과는 어느 것도 일치하지 않으며 4개 합(약 8천만)도 총합이 아니다. 즉 `power`는 그 랭킹 종류의 지표다. `player_snapshots.power`에 넣으면 전투력을 4분의 1로 오염시킨다. 크기 순서는 `45 ≥ 49 ≥ 79 ≥ 80`으로 일관(79명 중 72명)해 계층 구조는 있으나, 각 type이 무엇인지는 미확정 |
| `al.battle.week.result.info` | **거절** | 점수는 있으나 **이름만** 있고 UID가 없다 |
| `get.alliance.boss.activity.info.new` | **재캡처 필요** | `dmgRecordArr`가 `{diff, dmg}`뿐이고 `memberDamageArr`는 이 캡처에서 비어 있었다. 보스전 진행 중에 다시 캡처하면 개인 귀속 여부를 판정할 수 있다 |
| `push.share.msg` | **재캡처 필요** | 채팅 채널이며 이 캡처에서 `msg`가 비어 있었다. 리포트를 **수집 계정으로** 공유받는 순간을 캡처해야 §26.1 `01_report_share_receive`가 채워진다 |
| `push.mail` | **유망 — 아직 미확인** | `fromUser`/`toUser`가 UID이고 `contentsArr`가 본문. §6.2 계정 연결이 기다리던 인게임 메시지 경로일 가능성이 높다. 수집 계정으로 메일을 받으면서 캡처해 확인한다. **2026-08-01: `re-capture.pcapng`에 `push.mail`이 0건이다** — 인수인계가 이 캡처에 메일 수신이 있다고 적은 것은 사실이 아니었다. 여전히 "메일이 도착하는 순간"을 찍어야 한다 |
| `get.new.user.info` | **승격 완료 (판정 2026-08-11 · 파서 1.1.0, 2026-08-12)** | **전투력 6분할이 여기 있다.** `buildingPower`(건물)·`sciencePower`(테크)·`armyPower`(부대)·`heroPower`(영웅)·`modCarPower`(개조차)·`petPower`(펫), 그리고 `power`(총합)·`playerMaxPower`. 로컬 저널 최근 400행에서 **서로 다른 플레이어 97명, 여섯 필드가 97/97 전원 존재**, 타입 전부 `int`. **20명 표본에서 여섯 합 == `power`가 20/20 정확히 일치**(오차 0) — 즉 총 전투력의 완전한 분해다. `get.user.info.multi`(프로필 열기)에는 이 숫자가 **없다**: 그쪽은 `power`·`maxPower`·`maxHeroId`·`migratePower`·`mainBuildingLevel`뿐이다. 저널엔 최근 2,176건이 디코드돼 있으나 판정 시점엔 컴포넌트를 차트가 읽는 테이블에 쓰는 파서가 없어 Supabase에 한 건도 없었다 — 재캡처 불필요. **1.1.0이 여섯 행을 `player_component_power_snapshots`로 승격했다**: `heroPower`/`petPower`는 기존 `hero_power_total`/`pet_power_total`(0018이 보드 45/79와의 등치를 고정), 나머지 넷은 0109의 신규 등록 행. 백필은 머지 후 수집기에서 `renormalize → retry-outbox --already-sent → sync` |

`rank.get.by.range`를 확정하는 방법은 **라벨 붙인 캡처**다: 랭킹 탭을 하나씩,
어떤 탭인지 적으면서 열고 화면의 숫자를 payload 값과 대조하면 type↔지표 대응이
확정된다.
