# 런북: 주간 다이제스트 초안 (LLM)

설계: `docs/superpowers/specs/2026-11-12-llm-features-design.md`. 결정(2026-11-12, 사용자): 첫 슬라이스 = 다이제스트,
실행 위치 = Supabase Edge Function, 연맹원 이름·수치의 외부 모델 API 전송 허용.

**상태: DB와 함수 코드까지. 배포 안 함, UI 없음, 실제 모델 호출은 한 번도 안 해 봤다.**

## 구성

| 조각 | 위치 | 검증 |
|---|---|---|
| `llm_drafts`, `llm_digest_facts()`, 꺼진 상태의 `app_settings.llm_digest` | 마이그레이션 0322 | pgTAP `322_llm_drafts_test.sql` (19개, 음성 테스트 포함) — 전체 214파일 로컬 통과 |
| 근거 검사, 프롬프트, 재시도 흐름 | `supabase/functions/llm-digest/{grounding,prompt,digest}.ts` | `node --test` 10개, 모델은 가짜로 주입. CI web 잡이 돌린다 |
| HTTP 핸들러 | `supabase/functions/llm-digest/index.ts` | **미검증** — Deno 런타임·Anthropic API·실제 JWT로 돌려 본 적 없음 |

## 지키는 것

- 모델은 `llm_digest_facts()`가 준 JSON만 본다. 호출자의 JWT와 `x-alliance-id`로 실행되어 RLS가 범위를 정한다.
- 숫자는 facts에 있는 것만, 선수 이름은 `[[이름]]`으로 감싸 facts와 대조한다. 한 번 재시도하고 또 실패하면 **아무것도 저장하지 않는다**(422).
- 초안은 `draft`로만 저장된다. `output`·`facts`·`model`·`prompt_version`은 고칠 수 없고, officer가 `status`/`final_text`를 **한 번** 정한다.
- 검사가 못 잡는 것: 괄호 없이 쓴 이름, 사실을 그럴듯하게 잘못 서술한 문장. 그래서 초안은 officer가 읽고 고친다.

## 켜는 순서 (소유자 몫)

1. `supabase secrets set ANTHROPIC_API_KEY=...` — 저장소·`VITE_` 변수·브라우저에 넣지 않는다.
2. `supabase db push` (0322) → `supabase functions deploy llm-digest`.
3. 관리자가 `app_settings`의 `llm_digest`를 `{"enabled": true, "daily_cap": 5}`로 바꾼다. 기본은 꺼짐.
4. officer 세션으로 `POST /functions/v1/llm-digest` 한 번 — 첫 실제 호출이다. 422(근거 검사 실패)가 자주 나면 `prompt.ts`를 고치고 `PROMPT_VERSION`을 올린다.

## 아직 없는 것

- Admin → Digest 화면(생성·편집·승인·복사). 지금은 함수 호출과 `llm_drafts` 조회뿐이다.
- 비-primary 동맹의 켜기/끄기: `app_settings`는 primary의 행이다(0200).
