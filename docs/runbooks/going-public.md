# 런북: 외부 공개 (Supabase 클라우드)

지금까지 이 프로젝트에는 **클라우드 프로젝트가 연결된 적이 없다.** 스펙 §21.1의
배포 파이프라인도 의도적으로 미룬 항목이다. 이 문서는 그것을 처음 하는 절차다.

**이 작업은 되돌리기 어렵다.** 한 번 인터넷에 올라간 데이터는 나중에 지워도
누군가 이미 읽었을 수 있다. 그래서 0단계가 "무엇이 공개되는가"다.

---

## 0. 로그인하지 않은 사람이 보게 되는 것

로컬에서는 이 질문이 실제로 문제가 된 적이 없다. 주소를 아는 사람이 곧 나뿐이기
때문이다. 공개하면 달라진다 — **RLS가 유일한 경계가 된다.**

익명 세션으로 직접 세어 본 결과 (2026-08-03, 실데이터 기준):

| 보인다 | 행 수 | 무엇인가 |
|---|---|---|
| `players` | 792 | **이름·전투력·킬·본부 레벨** — 우리 멤버 93명 포함 |
| `player_names` | 467 | 과거에 쓰던 이름들 |
| `alliances` | 101 | 연맹 이름·태그 |
| `player_snapshots` | 463 | 서버 랭킹 원본 |

> **아레나는 2026-08-03에 member 전용으로 옮겼다** (0064). 위 표에서 빠진 이유다.
> 옮기기 전에는 `arena_entries` 800행과 `arena_entry_heroes` **3,998행**이
> 익명으로 읽혔다.

| 안 보인다 | 왜 |
|---|---|
| `player_contributions` | 0020, member 전용 |
| `player_presence` | 0024, member 전용 |
| `player_ranks` | 0059, member 전용 |
| `alliance_member_snapshots` | 0006, member 전용 |
| `player_month_cards` | 0016, admin 전용 |
| `arena_snapshots` · `arena_entries` · `arena_entry_heroes` · `arena_matches` | **0064**, member 전용 |
| `app_users` · `collectors` · `join_codes` | 전부 차단 |

### 결정해야 할 것

**아레나는 이미 정해서 닫았다** (0064, 2026-08-03). 어떤 영웅을 몇 성으로 어떤
장비로 세워 뒀는지가 주소만 알면 읽히는 상태였고, 게임 안에서도 순위표를 열면
보이는 정보이긴 하지만 **한 번에 3,998행을 긁어갈 수 있는 형태로 놓는 것은 다른
이야기**라서다. 네 테이블 전부 옮겼다 — 편성만 닫고 `arena_entries`를 열어 두면
누가 몇 위에 방어 전투력 얼마로 있는지가 그대로 남아, 대시보드에서는 닫힌 것처럼
보이면서 실제로는 안 닫힌다.

**남아 있는 판단은 `players`다.** 792행 — 이름·전투력·킬·본부 레벨, 우리 멤버 93명
포함 — 이 여전히 공개다. 닫으면 크로스서버 랭킹·서버 페이지·아레나 이름 표시가
로그아웃 상태에서 전부 빈다. 사실상 "공개 대시보드"를 포기하는 선택이라 기본값을
공개로 두었다. 바꾸려면 0064와 같은 모양의 마이그레이션 하나다.

**정하기 전에는 다음 단계로 가지 않는다.** 올린 다음에 좁히는 것은 늦다.

---

## 1. 클라우드 프로젝트를 만든다

브라우저에서 https://supabase.com/dashboard → New project.

- **Region**: 한국에서 쓰면 `Northeast Asia (Seoul)` 또는 `(Tokyo)`.
- **Database password**: 생성해서 비밀번호 관리자에 넣는다. 이건 `.env`에 두지
  않는다 — 마이그레이션 푸시할 때만 쓴다.
- **무료 티어**: 데이터베이스 500MB. 현재 로컬은 **35MB**이므로 여유가 있다.
  다만 상시 수집을 붙이면 계속 자란다. 가장 큰 테이블은
  `arena_entry_heroes`(6.5MB)이고 매주 늘어난다.
- **무료 티어는 1주일 동안 요청이 없으면 프로젝트를 일시정지한다.** 상시 수집이
  돌면 해당 없다.

## 2. 저장소를 프로젝트에 연결한다

```powershell
cd C:\darkwar-platform
supabase login
supabase link --project-ref <프로젝트 ref>
```

`ref`는 프로젝트 URL `https://<ref>.supabase.co`의 그 부분이다.

## 3. 스키마를 올린다

```powershell
supabase db push
```

64개 마이그레이션이 순서대로 적용된다. 영웅 카탈로그 28기는 0061이 함께
넣으므로 손으로 다시 입력할 것이 없다.

**`supabase db push`는 seed.sql을 실행하지 않는다.** 합성 플레이어 20명이
안 들어간다는 뜻이고, 그게 맞다 — `supabase/drop-synthetic-seed.sql`을 클라우드에
돌릴 일이 없다.

올린 뒤 확인:

```powershell
supabase db diff --linked
```

아무것도 안 나와야 한다. 나오면 로컬과 클라우드가 갈라진 것이다.

## 4. admin 계정을 만든다

`app_users`를 쓸 수 있는 것은 admin뿐이라(순환), 첫 admin은 대시보드에서 직접
만든다 — `docs/runbooks/admin-access.md`의 "최초 admin 시드"와 같은 절차이고,
장소만 로컬 Studio에서 Supabase 대시보드로 바뀐다.

**이메일 도메인을 다시 생각해야 한다.** 로컬에서 쓰는 `admin@hellbound.cbfw`는
실재하지 않는 도메인이다. 로컬은 메일을 보내지 않으니 문제가 없었지만,
클라우드에서는:

- 관리자가 직접 만들면서 "Auto Confirm"을 켜면 **로그인은 된다.**
- 하지만 **비밀번호 재설정 메일이 영원히 도착하지 않는다.** 비밀번호를 잊으면
  복구 경로가 없다.

실제로 받을 수 있는 주소를 쓰는 편이 낫다.

## 5. 데이터를 옮긴다

로컬 데이터베이스는 클라우드로 자동으로 따라가지 않는다. 저널이 원본이므로
**덤프를 옮기는 것보다 다시 sync 하는 쪽이 안전하다** — idempotency_key가 원본
payload를 해시하므로(§11.2) 같은 관측을 다시 보내면 중복이 아니라 갱신이다.

```powershell
cd C:\darkwar-platform\services\collector
# 클라우드 자격증명으로. .env를 덮어쓰지 말고 별도 파일을 쓴다.
$env:SUPABASE_URL = "https://<ref>.supabase.co"
$env:SUPABASE_SECRET_KEY = "<Project Settings > API > service_role key>"
uv run dw-collector retry-outbox --already-sent --db .\data\fresh.db
uv run dw-collector sync --db .\data\fresh.db     # sent=0 까지 반복
```

수집기 행(`collectors`)을 먼저 넣어야 FK가 통과한다 — 3단계와 같은 UUID로.

그다음 연맹 핀을 다시 박는다. `app_settings`는 관측이 아니라 사람이 입력한
값이라 sync로 따라가지 않는다.

## 6. 대시보드를 띄운다

**Supabase는 정적 사이트를 호스팅하지 않는다.** 별도 호스트가 필요하다 —
Cloudflare Pages, Vercel, Netlify 중 아무거나. 빌드 결과는
`apps/dashboard/dist`이고 순수 정적이다(해시 라우팅이라 서버 rewrite 설정도
필요 없다 — `lib/route.ts`가 그렇게 만든 이유다).

빌드 환경변수 **두 개만** 넣는다:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<Project Settings > API > publishable/anon key>
```

> **service_role 키를 `VITE_`로 넣지 않는다.** `VITE_` 변수는 빌드 결과 자바스크립트
> 안에 그대로 박히고, 브라우저 개발자도구에서 누구나 읽는다. 그리고 그 키는
> **RLS를 통째로 우회한다.** 이 한 줄의 실수가 위 0단계의 모든 판단을 무의미하게
> 만든다. `gitleaks`가 커밋은 막아 주지만 호스트의 환경변수 화면은 막아 주지 못한다.

배포한 뒤 Supabase 대시보드에서:

- **Authentication → URL Configuration → Site URL**을 배포 주소로 바꾼다.
  지금 `config.toml`은 `http://127.0.0.1:3000`이고, 그대로 두면 로그인 후
  리디렉션이 로컬로 간다.

## 7. 확인한다 — 로그인하지 않은 브라우저로

배포 주소를 **시크릿 창**에서 연다. 0단계의 표와 맞는지 눈으로 본다.

- **멤버 탭과 아레나 탭이 둘 다 안 보여야 한다** (0063, 0064).
- 기여도·접속·등급이 안 보여야 한다.
- 크로스서버 랭킹과 서버 페이지는 보여야 한다 — `players`는 공개로 뒀다.

탭이 없는 것만으로 만족하지 말고 **데이터에 직접 물어본다.** 탭은 경계가
아니다:

```powershell
curl "https://<ref>.supabase.co/rest/v1/arena_entry_heroes?select=hero_id&limit=1" -H "apikey: <publishable key>"
```

`[]`가 나와야 한다. 행이 나오면 정책이 안 올라간 것이다.

맞지 않으면 되돌리는 것보다 **먼저 프로젝트를 일시정지**하고 원인을 찾는다.

---

## 남은 것

- **백업.** 무료 티어에는 자동 백업이 없다. 저널이 관측의 원본이므로 다시 sync
  할 수 있지만, **사람이 입력한 것**(영웅 이름은 0061이 들고 있으니 괜찮고,
  `app_settings`·`announcements`·`player_ranks.assigned_rank`는 아니다)은
  어디에도 복제본이 없다.
- **CI에서의 자동 배포는 여전히 만들지 않았다** (§21.1). 지금은 손으로 한다.
