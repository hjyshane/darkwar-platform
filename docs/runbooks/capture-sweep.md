# 런북: 발견 스윕 캡처

> 무엇을 아직 찍어야 하는지는 `docs/capture-backlog.md`에 우선순위와 시점
> 제약까지 정리돼 있다. 이 문서는 *어떻게* 찍는지를 다룬다.

목적은 데이터 수집이 아니라 **프로토콜 발견**이다. 화면을 한 번에 넓게 열어
미확인 커맨드의 shape을 `schema_observations`에 쌓아두면, 이벤트·시즌·전투
리포트 프레임워크(§13/§14/§15)를 만들 때 새로 캡처하러 돌아가지 않아도 된다.
스펙 §26.1이 "새로 찍어야 한다"고 나열한 14개 캡처의 상당 부분이 이 방식으로
대체된다.

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
| `al.battle.rank.info` | **승격** | `{uid, name, score}`. `type` 0=일간, 1=주간, 2=라운드 총합(4라운드) — 2026-08-01 라벨 캡처로 전부 확정. 0·1은 **상대 연맹 선수도 포함**(165 = 우리 93 + 상대 72), 2는 우리 연맹만(94). `alName`으로 구분. 파서는 2026-07-30에 작성됐으나 푸시되지 않아 다른 머신에서 보이지 않았고, 그 사이 두 문서가 "미승격"으로 잘못 적었다. 2026-08-01 리베이스 후 머지. `variant` 해석은 캡처 백로그 0번이 계속 막고 있다 |
| `kill.rank` | **승격** | `{uid, armyKill, rank}`. `server.rank`가 주지 않는 킬 |
| `al.show.help` | **거절** | UID는 있지만 **지원을 요청한 사람**이다. `senderId`가 1~2개뿐이고 대부분 `senderId == recvId`, `nowcount/maxcount`는 몇 명이 도왔는지만 알려주고 **누가** 도왔는지는 없다. `todayHelpPoint`는 수집 계정 자신의 값. "지원 기여도"로 만들면 실제로는 요청 횟수를 보여주게 된다 |
| `rank.get.by.range` | **거절** | 엔트리 필드가 `power`인데 **`type`마다 값이 다르다**. 같은 플레이어가 66.5M / 7.09M / 4.73M / 1.93M이고 실제 총 전투력(314M)과는 어느 것도 일치하지 않으며 4개 합(약 8천만)도 총합이 아니다. 즉 `power`는 그 랭킹 종류의 지표다. `player_snapshots.power`에 넣으면 전투력을 4분의 1로 오염시킨다. 크기 순서는 `45 ≥ 49 ≥ 79 ≥ 80`으로 일관(79명 중 72명)해 계층 구조는 있으나, 각 type이 무엇인지는 미확정 |
| `al.battle.week.result.info` | **거절** | 점수는 있으나 **이름만** 있고 UID가 없다 |
| `get.alliance.boss.activity.info.new` | **재캡처 필요** | `dmgRecordArr`가 `{diff, dmg}`뿐이고 `memberDamageArr`는 이 캡처에서 비어 있었다. 보스전 진행 중에 다시 캡처하면 개인 귀속 여부를 판정할 수 있다 |
| `push.share.msg` | **재캡처 필요** | 채팅 채널이며 이 캡처에서 `msg`가 비어 있었다. 리포트를 **수집 계정으로** 공유받는 순간을 캡처해야 §26.1 `01_report_share_receive`가 채워진다 |
| `push.mail` | **유망** | `fromUser`/`toUser`가 UID이고 `contentsArr`가 본문. §6.2 계정 연결이 기다리던 인게임 메시지 경로일 가능성이 높다. 수집 계정으로 메일을 받으면서 캡처해 확인한다 |

`rank.get.by.range`를 확정하는 방법은 **라벨 붙인 캡처**다: 랭킹 탭을 하나씩,
어떤 탭인지 적으면서 열고 화면의 숫자를 payload 값과 대조하면 type↔지표 대응이
확정된다.
