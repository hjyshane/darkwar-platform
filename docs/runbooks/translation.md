# 글 번역 (공지·가이드·댓글)

작성 2026-11-24. **아직 배포 전이다.** 처음 켠 사람이 아래 §4에 날짜와 결과를 적는다.

## 1. 무엇을 하나

읽는 사람이 공지·가이드·댓글 아래의 **"Translate into …"** 를 누르면 Edge Function
`translate`가 Claude로 그 글을 읽는 사람의 언어로 번역한다. 같은 글·같은 언어의 번역은
`content_translations`(0349)에 남아, 다음 사람은 비용 없이 바로 본다. 글을 고치면
원문 해시가 바뀌어 옛 번역은 저절로 쓰이지 않는다.

- 글은 **읽는 사람의 권한으로** 읽는다(RLS 그대로). 못 보는 글은 번역도 못 받는다.
- 하루 한도: Settings › Shared › Site values › **Translations per reader per day**(기본 20,
  **0이면 버튼이 꺼진다**). 이미 있는 번역은 한도에 안 센다.
- 모델: 기본 `claude-opus-5-5`, 낮은 effort. 함수 비밀 `TRANSLATE_MODEL`로 바꿀 수 있다.
  거절(refusal) 시 서버 쪽 fallback이 같은 호출 안에서 다른 모델로 다시 시도한다.
- 글 내용은 Anthropic API로 나간다(2026-11-24 주인 결정: 2번 방식, 요청 시 번역).

## 2. 켜는 순서 (주인 몫)

```bash
supabase db push                                   # 0349 (앞의 0347·0348이 먼저)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  # 저장소·VITE_ 변수에 절대 넣지 않는다
supabase functions deploy translate
```

Windows에서는 `npx.cmd supabase …`, CLI 버전에 따라 `--remote`/`--linked`가 필요하다
(handover §2 "이 PC에서 db push 하는 법").

## 3. 확인

1. 아무 공지에서 "Translate into 한국어"(또는 자기 언어) → 번역이 보이고 "Show original"로 돌아온다.
2. 같은 공지를 다른 계정으로 다시 번역 → 즉시 나온다(캐시). SQL Editor:
   `select kind, field, language, model, created_at from content_translations order by created_at desc limit 5;`
3. 공지를 한 글자 고친 뒤 다시 번역 → 새 행(`created_at` 갱신).
4. 한도를 0으로 → 버튼을 누르면 "Translation is switched off."

키가 없으면 "Translation is not set up on this site yet."(503), 함수가 배포 전이면
"did not come back"이 나온다.

## 4. 기록

| 날짜 | 누가 | 무엇을 | 결과 |
|---|---|---|---|
| — | — | 아직 없음 | — |
