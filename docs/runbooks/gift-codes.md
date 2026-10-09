# 런북: 쿠폰 코드를 연맹원에게 일괄 적용 (Gift codes)

간부가 코드를 넣고, 연맹원 전원(또는 고른 사람)에게 적용 요청을 쌓으면, 수집기 PC의
작업자가 한 건씩 천천히 보낸다. Vantera의 Gift codes 화면에서 아이디어를 가져왔다
(그들의 데이터나 코드는 쓰지 않는다 — `docs/vantera-research.md`).

**상태: 대시보드, DB, 작업자, 호출기(`gift/official.py`)까지 있다. 아직 실제 연맹원에게는 보낸 적 없다.**
호출기는 `DW_GIFT_REDEEMER=official`일 때만 켜진다. 2026-10-09에 틀린 코드 한 번으로만 확인했다:
`GET https://giftcenter.darkwar-survival.com/code.php?uid=<id>&code=<code>` + 헤더 `Usertoken: <id>`
(헤더가 없으면 `{"code":10018,"message":"params error"}`). 답은 `errorCode`: ok 성공, E004 없는 코드,
E005 만료, E006 이미 받음, E007 한도, E009 `in cd`(잠시 후 재시도), E001-3/E008 시스템 오류.
성공(`ok`)과 E007의 실제 모양은 아직 못 봤다 - 첫 실제 코드로 한 사람에게 먼저 보내고 `result`를 확인한다.

## 어떻게 되는 건가

- 이 게임에는 **게임 안 코드 입력창이 없다.** 공식 웹 Gift Center
  (`darkwar-survival.com/giftCenter/`)에서 **플레이어 ID로 로그인**하고 코드를 넣으면,
  보상이 그 플레이어의 게임 우편으로 온다. 그래서 "연맹 전원에게 적용"은 게임 프로토콜이
  아니라 **이 웹 페이지를 UID 목록으로 반복해서 부르는 일**이다. 새 게임 계정은 필요 없고,
  UID는 연맹 명단에 이미 있다.
- 로그인 페이지에 슬라이더 같은 보안 확인은 **뜨지 않는다**(2026-10-09 사용자 확인). 그런 확인이
  생기면 이 기능은 자동으로 못 한다 — 우회하지 않는다.

## 만든 것

| 조각 | 위치 | 하는 일 |
|---|---|---|
| DB (0251) | `supabase/migrations/…000251_gift_codes.sql` | `gift_codes`(전역), `gift_code_claims`(코드 x 플레이어 작업 큐 겸 기록), `gift_claim_exclusions`(제외). 권한 `giftcodes.manage`(간부·관리자 기본) |
| RPC | 같은 파일 | `add_gift_code`, `enqueue_gift_claims`, `cancel_gift_claims`, `set_gift_exclusion`, `set_gift_code_status`; 화면용 읽기 `gift_code_progress`(코드당 한 줄), `gift_member_status`(사람당 한 줄) |
| 작업자 | `services/collector/src/dw_collector/gift/` | `dw-gift`. 큐에서 한 건씩 집어(`status=eq.queued` 조건부 PATCH) 호출기로 보내고 결과를 기록 |
| 화면 | `apps/dashboard/src/features/giftCodes/` | `#/gift-codes`(Alliance 아래, 간부만) |

- **기본 대상은 연맹 전원, 제외 가능.** 제외한 사람은 간부가 손으로 골라도 적용되지 않는다.
- **자동 적용(새 코드가 생기면 자동으로)은 일부러 안 넣었다.** 버튼을 눌러야 큐에 쌓인다.
- 읽기는 코드당 한 줄, 사람당 한 줄이라 PostgREST의 1,000행 한계가 사람을 떨어뜨리지 못한다.

## 작업자의 안전장치 (`gift/worker.py`)

다른 사이트에 연맹원의 ID로 요청을 보내는 일이라 느리고, 멈출 수 있게 만들었다.

- **속도**: 요청마다 쉰다(`DW_GIFT_MIN_INTERVAL_SECONDS`, 기본 6초). 한꺼번에 보내지 않는다.
- **회로 차단**: 답이 아닌 결과(`retry`, 예외)가 5번 이어지면 15분 쉰다.
- **정지**: 호출기가 `stop`(보안 확인이 떴다, 거절당했다 등)을 돌려주면 **그 건을 시도 횟수에
  넣지 않고 되돌린 채** 멈춘다. 사람이 보고 다시 켜야 한다.
- **정지 스위치 파일**: `DW_GIFT_KILL_SWITCH_FILE`이 가리키는 파일이 있으면 매 요청 전에 멈춘다.
- 죽은 코드(만료/무효)는 코드를 은퇴시키고 기다리던 모든 건을 취소한다.
- 작업 중 죽어서 `running`으로 남은 건은 10분 뒤 큐로 돌아온다. 최악은 같은 건이 두 번
  나가는 것이고, 페이지는 "이미 받음"으로 답한다.

## 켜기 전에 남은 일 (순서대로)

1. **DB 적용**: `supabase db push --linked --workdir C:\darkwar-platform`은 운영 DB 쓰기라
   **직접 실행해야 한다**(분류기가 막는다). 적용 전에는 새 탭이 보이지 않는다(권한이 없으니).
   적용 후 `Hosted default grants` 함정이 있으므로 새 표들이 `select`만 열려 있는지 확인한다.
2. ~~Gift Center의 요청 모양 확인~~ (끝: 위 참고)
   원래 절차:: 사용자가 자기 브라우저에서 **틀린 코드로** 한 번 시도하고,
   개발자 도구 Network의 요청 두 개(로그인, 코드 사용)를 `Copy as cURL`로 복사한다. UID와
   토큰은 가린다. 틀린 코드는 아무것도 소모하지 않고 오류 응답의 모양까지 한 번에 보여 준다.
3. ~~호출기 작성~~ (끝: `gift/official.py`)
   원래 절차: (`gift/redeemer.py`의 `Redeemer`): 응답을 `done / already / expired /
   invalid / retry / stop` 중 하나로 옮기고, 원문은 `result`에 그대로 남긴다. 이름을
   `DW_GIFT_REDEEMER`로 연결한다.
4. **한 사람에게 먼저**: 본인 UID와 쓰지 않은 코드 하나로 한 건만 보내서 우편이 오는지 본다.
   그다음 한 연맹원, 그다음 전원.
5. 코드 찾기(스캔): 공개 사이트에서 새 코드를 주기적으로 읽어 `gift_codes`에 `source='scan'`으로
   넣는 별도 작업. 아직 없다.

## 확인 못 한 것

- 공식 페이지의 약관이 자동 호출을 허용하는지. **본문은 읽지 못했다**(사용자가 읽고 "괜찮다"고
  했다). 위반이면 계정이 아니라 **IP 차단이나 UID 제재** 위험이다.
- 응답 모양, 속도 제한, 하루 사용 한도.
- 대시보드 화면은 개발용 미리보기(가짜 데이터)로만 봤다. **진짜 DB에 붙여 본 적 없다.**
- pgTAP 26개는 통과했지만 CI의 `db` 잡이 생성 타입(손으로 맞춘 `database.types.ts`)을 비교한다.
  틀리면 그 잡이 출력하는 diff를 그대로 옮긴다.

## PC 없이 보내기: 데이터베이스가 직접 (0252)

`dw-gift`는 PC가 꺼지면 멈춘다. 0252는 같은 일을 Postgres가 한다 (`pg_cron` 5초마다 +
`pg_net`로 `code.php` GET). 대시보드에서 적용을 누르면 PC와 상관없이 큐가 처리된다.
Edge Function도, 저장할 키도 필요 없다 - 0130(Discord 알림)과 같은 방식이다.

- **기본은 꺼짐.** 아무것도 예약되지 않고 아무것도 보내지 않는다. 켜는 것은 사람이 한다. 대시보드 Gift codes 화면 위쪽의 **Sender 패널 "Turn on" 버튼**(간부), 또는 SQL:
  `supabase db query --linked "select internal.set_gift_runner(true)"`
  끄기: `select internal.set_gift_runner(false)` (cron 작업도 같이 사라진다).
- **규칙은 `dw-gift`와 같다**: 요청 사이 5초, 답이 아닌 결과(`retry`)가 5번 이어지면 15분 쉼,
  차단/보안 확인/비 JSON 답(`stop`)이면 **스스로 꺼지고** 이유를 `internal.gift_runner.halted_reason`에
  남긴다. 죽은 코드는 은퇴시키고 기다리던 건을 취소한다. 답 원문은 `result`에 그대로.
- **상태 보기**: `select * from internal.gift_runner;` / 최근 결과는 `gift_code_claims.result`.
- **`dw-gift`와 같이 돌리지 않는다.** 한 건이 두 번 나가지는 않지만 속도가 두 배가 된다. 이쪽을
  켜면 PC의 `dw-gift`는 끈다.
- 시험하지 못한 것: pgTAP은 `pg_net` 없이 돌아서 **분류와 정산은 시험했지만 실제 HTTP 호출은
  못 했다.** Gift Center가 Supabase(클라우드) IP의 요청을 받아 주는지도 모른다. 그래서 **본인 UID +
  쓰지 않은 코드 한 건**으로 먼저 켜 보고, `gift_code_claims.result`에 `errorCode: "ok"`가 오는지,
  `halted_reason`이 비어 있는지 본다. 막히면(`stop`) 스스로 꺼진다.

## 0253: 켜기/끄기 오류와 코드 삭제

- 0252의 Sender 켜기/끄기가 호스팅 DB에서 `UPDATE requires a WHERE clause`로 실패했다. Supabase는 API 세션에
  `pg_safeupdate`를 올려 WHERE 없는 UPDATE/DELETE를 거부한다. pgTAP 하니스와 CI에는 이 확장이 없어서 통과했다.
  0253이 모든 러너 UPDATE에 `where singleton`을 붙이고, 테스트 254가 소스에서 이를 검사한다.
  **교훈: 한 행짜리 상태 표를 갱신하는 함수도 `where`를 쓴다.**
- 코드 삭제: 코드 행의 `Delete`(확인 창). 이 연맹의 요청 기록을 지우고, 다른 연맹에 요청이 남아 있지 않을 때만
  코드 자체를 지운다(코드는 전역이라 한 연맹이 다른 연맹의 기록을 지우면 안 된다).

## 0254: 연맹원이 아닌 사람 (저장한 플레이어 ID)

간부가 플레이어 ID를 직접 저장해 두면 연맹원처럼 코드를 적용할 수 있다 (친구, 부캐, 다른 연맹).

- 화면: Members 위 "Add players by ID". 여러 개를 붙여 넣을 수 있다(공백/쉼표/줄바꿈). 하나만 넣으면 이름(라벨)도
  붙일 수 있다. ID는 10~18자리 숫자만 받고, 아닌 것은 그대로 되돌려 보여 준다.
- 저장한 ID는 멤버 표 맨 아래에 "saved ID"로 나오고 `Remove` 버튼이 있다. 고르기 단추에는 "Saved IDs" 묶음이 생긴다.
- "Claim for everyone"과 "Claim … selected"가 연맹원과 저장 ID를 함께 다룬다. "Leave out"도 똑같이 적용된다.
- 이미 연맹 명단에 있거나 이미 저장된 ID는 건너뛴다. 연맹(화면에 보이는 연맹)마다 따로 저장된다.
- **ID가 틀리면** Gift Center가 `10018`을 답한다. 지금은 재시도로 처리해서 4번(5분, 10분, 20분 간격) 시도한 뒤
  `failed`가 된다. 오타가 많으면 이 부분을 바꿀 가치가 있다.
