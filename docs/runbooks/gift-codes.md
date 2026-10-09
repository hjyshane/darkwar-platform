# 런북: 쿠폰 코드를 연맹원에게 일괄 적용 (Gift codes)

간부가 코드를 넣고, 연맹원 전원(또는 고른 사람)에게 적용 요청을 쌓으면, 수집기 PC의
작업자가 한 건씩 천천히 보낸다. Vantera의 Gift codes 화면에서 아이디어를 가져왔다
(그들의 데이터나 코드는 쓰지 않는다 — `docs/vantera-research.md`).

**상태: 대시보드, DB, 작업자 골격까지 만들었다. 실제로 코드를 보내는 부분은 없다.**
공식 Gift Center의 요청과 응답을 한 번도 보지 못했고, 짐작으로 쓴 요청을 연맹원의 플레이어
ID로 보내는 것은 하지 않기로 했다. 그래서 `dw-gift`는 호출기가 없으면 **시작하지 않는다.**

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
2. **Gift Center의 요청 모양 확인**: 사용자가 자기 브라우저에서 **틀린 코드로** 한 번 시도하고,
   개발자 도구 Network의 요청 두 개(로그인, 코드 사용)를 `Copy as cURL`로 복사한다. UID와
   토큰은 가린다. 틀린 코드는 아무것도 소모하지 않고 오류 응답의 모양까지 한 번에 보여 준다.
3. **호출기 작성** (`gift/redeemer.py`의 `Redeemer`): 응답을 `done / already / expired /
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
