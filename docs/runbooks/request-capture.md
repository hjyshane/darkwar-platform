# 런북: 요청 캡처와 명령 카탈로그

수집기는 서버→클라이언트 응답만 저널에 쌓았고, 클라이언트→서버 요청은 디코드한 뒤
버렸다. 이제 요청은 마스킹해서 `request_observations`에 쌓는다. 응답 경로와는 섞이지
않는다 — 정규화기도, 동기화 아웃박스도 요청을 보지 못한다. **보내는 코드는 없다.**
읽고, 기록하고, 보여 줄 뿐이다.

## 무엇이 어디에 쌓이는가

| 무엇 | 어디 | 비고 |
|---|---|---|
| 요청 `{c, p}` | 로컬 SQLite `request_observations` | 마스킹 후 저장. 클라우드로 가지 않는다 |
| 마스킹 규칙 | `request_log.py` | 키 이름 기준: `uid`·`sign`·`token`·`session`·`device`·`pass` 등을 `<masked:타입>`으로 |
| 짝짓기 | `catalog.pair_requests` | 같은 명령, 같은 `_id`, 요청 뒤 120초 이내 응답 |
| 판정표 | `services/collector/src/dw_collector/command_catalog.json` | `capture-sweep.md`의 표에서 옮김. `test_command_catalog.py`가 문서·`known_commands()`와 맞는지 확인 |

`_id`는 연결마다 0부터 다시 세는 카운터라 재접속하면 같은 번호가 다시 나온다. 그래서
짝짓기는 시간 창을 같이 쓰고, 응답 하나는 요청 하나에만 붙는다.

**마스킹은 로그인 명령에서 더 엄격하다.** `account.login.new`·`init`·`login`은 버전류
키(`ver`·`build`·`channel`·`platform`·`lang`·`pkg`)를 제외한 모든 값을 지운다.
로그인 요청은 한 번도 본 적이 없어서 어느 필드가 서명인지 모르기 때문이다. 키
이름에 `ver`가 들어간 `serverId`도 그대로 남는다.

## 보는 법

- 데스크톱 앱의 **Commands** 탭 (사이드카 `GET /catalog`).
- 콘솔: `uv run dw-collector command-catalog [--json] [--routines <dir>]`.
- 화면 열은 UI 루틴의 `Step.expect`에서 온다. 루틴 디렉터리는 `--routines` 또는
  `DW_ROUTINES_DIR`(사이드카도 이 환경 변수를 읽는다). 지정하지 않으면 그 열은 비어 있다.

기존 저널은 첫 시작 때 `request_observations`가 자동으로 만들어진다. 요청이 쌓이는 것은
그 뒤의 캡처부터다. 이미 있는 pcap은 `ingest-dir`/`scan-capture`로 다시 읽으면 요청도
들어간다 (재읽기는 같은 id라 중복되지 않는다).

## 5번 질문: 지금 알고 있는 것, 모르는 것

**요청은 아직 한 번도 저장된 적이 없으므로 아래는 응답에서 읽은 것이다. 요청 쪽
확인은 이 기능으로 새로 캡처한 뒤에야 가능하다.**

### `world.get.new`가 대상 서버를 어떻게 지정하는가 — 미확인

- 응답은 `serverId`, `x`, `y`, `viewLvl`, `maxAreaSize`(1000), `timeStamp`, `_id`, `points`를
  돌려준다 (`protocol-fixtures/decoded/world.get.new/*.json`). 두 픽스처 모두
  `serverId` 580이다.
- `season-map-capture.md`는 계정이 580을 떠나지 않았는데 577~588의 뷰포트가 왔다고
  적는다. 그러므로 서버 지정은 **세션이 아니라 요청 필드**일 가능성이 높고, 응답의
  `serverId`/`x`/`y`/`viewLvl`은 요청의 값을 되돌려 준 것으로 보인다. 이것은 추정이다.
- 확인 방법: 다른 서버(예: 581)의 지도를 보면서 캡처한 뒤
  `select payload_json from request_observations where source_command = 'world.get.new'`로
  `serverId` 필드가 요청에 있는지, 응답의 값과 같은지 본다. `serverId`는 마스킹되지 않는다.

### 로그인 요청과 `init`/`account.login.new`의 버전 필드 — 미확인

- 커밋된 `init` 픽스처(`login_v1.json` 등)의 `user`는 `name`·`serverId`·`uid`뿐이고,
  키 이름에 version/build/channel/platform/client/update/maint/region/lang이 들어간 필드는
  `serverId`와 `dataConfig.migration_quota.client_visible` 외에 없다. **`init` 응답에는
  버전 필드가 보이지 않는다.**
- `account.login.new`는 저장소의 어떤 픽스처·문서에도 없다. SFS 시스템 로그인 프레임은
  `p.c`(문자열)와 `p.p`(객체)를 가진 확장 이벤트일 때만 요청으로 저장된다
  (`extract_extension_event`). 그 모양이 아니면 이 기능으로도 보이지 않는다 — 검증하지
  못했다.
- 확인 방법: 게임을 완전히 종료하고 다시 시작하면서 캡처한 뒤 카탈로그에서
  `account.login.new`(있다면)의 요청 shape을 본다. 버전류 값은 남고 나머지는
  `<masked:...>`로 보인다.

### 마스킹이 틀렸을 때

키 이름 규칙이라 값이 서명인데 키 이름이 평범하면 그대로 저장된다. 새 명령의 요청을
처음 볼 때 `request_observations.payload_json`을 열어 눈으로 확인하고, 새어 나간 키가
있으면 `request_log._SENSITIVE_KEY`에 추가한 뒤 해당 행을 지운다.

## 클라우드에 올라가는 것

요청 값은 올라가지 않는다. `(명령, 요청 shape)`가 로컬 저널에서 처음 보일 때 한 번만
아웃박스에 `command_request_shapes` 행(키→타입 뼈대)이 들어가고, 관리자 화면의
Discovery Inbox 아래 "Client requests"에 보인다. 읽기는 admin만 가능하다 (0307, pgTAP
`307_command_request_shapes_test`). 건수는 올리지 않는다 — shape당 한 번만 보내기 때문이다.
건수는 로컬 Commands 탭에서 본다.

## 하지 않은 것

- `survey.py`는 여전히 응답만 훑는다.
- `database.types.ts`의 새 테이블 항목은 손으로 썼다. CI의 `db:types` 비교가 다르다고 하면 생성본으로 바꾼다.
