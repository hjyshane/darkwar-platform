# 런북: 외부 공개 (Supabase 클라우드)

> **실행됐다 — 2026-08-04.** 프로젝트 `balpuvkvpiqvclibajje`, 대시보드는
> `https://darkwar-platform.hjyshane.workers.dev`. 아래는 그 절차이고, 실제로
> 겪은 것은 각 단계의 「실제로 이랬다」에 적었다. 처음 하는 사람 기준으로 쓴
> 문장은 그대로 뒀다 — 다시 만들 때 같은 순서로 필요하다.

스펙 §21.1의 배포 파이프라인은 **여전히 미룬 항목이다.** 배포는 손으로 한다.

**이 작업은 되돌리기 어렵다.** 한 번 인터넷에 올라간 데이터는 나중에 지워도
누군가 이미 읽었을 수 있다. 그래서 0단계가 "무엇이 공개되는가"다.

---

## 0. 로그인하지 않은 사람이 보게 되는 것

**아무것도 없다.** 2026-08-03에 0065가 기본값을 뒤집었다 — `public` 스키마의
모든 테이블·뷰가 member 이상 전용이고, `anon`은 SELECT 권한 자체가 없다.
로그인하지 않은 요청은 빈 목록이 아니라 **401**을 받는다.

로그아웃 상태에서 남는 것은 로그인 화면과 가입 코드 흐름뿐이다. 둘 다 GoTrue와
security definer 함수를 지나가므로 테이블 읽기가 아니다. (실측: `/auth/v1/token`
200, `/auth/v1/signup` 200, `/rest/v1/*` 전부 401.)

가입한 계정은 `viewer`이고, 관리자가 역할을 주거나 가입 코드를 쓰기 전까지는
대시보드가 "멤버 전용" 안내만 보여준다.

### 그래서 이 문서에서 가장 위험한 항목이 바뀌었다

원래 0단계는 "무엇이 공개되는가"를 재는 일이었다. 지금은 공개되는 것이 없으므로,
남은 위험은 **그 상태를 실수로 되돌리는 것**이다. 두 가지 경로가 있다:

1. **`service_role` 키를 브라우저에 넣는 것.** 6단계의 경고가 그것이고, 이 한
   줄이면 위의 모든 정책이 무의미해진다.
2. **새 테이블.** Supabase가 만드는 테이블은 기본 권한상 `anon`에게 SELECT가
   붙는다. 0065가 그 기본값을 회수하지만 호스팅 환경에서는 회수 자체가 거부될
   수 있어서, 진짜 방어선은 `34_no_public_read_test`다 — 스키마의 모든 관계를
   훑어서 anon이 읽을 수 있는 것이 하나라도 있으면 CI가 실패한다.
   **그 테스트가 실패하면 테스트를 고치지 말고 테이블을 고친다.**

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

마이그레이션이 순서대로 적용된다(2026-08-06 기준 75개). 영웅 카탈로그 28기는
0061이 함께 넣으므로 손으로 다시 입력할 것이 없다.

**`supabase db push`는 seed.sql을 실행하지 않는다.** 합성 플레이어 20명이
안 들어간다는 뜻이고, 그게 맞다 — `supabase/drop-synthetic-seed.sql`을 클라우드에
돌릴 일이 없다.

올린 뒤 확인:

```powershell
supabase db diff --linked
```

아무것도 안 나와야 한다. 나오면 로컬과 클라우드가 갈라진 것이다.

### 실제로 이랬다 — 번호가 건너뛰어지면 조용히 안 올라간다

`db push`는 **원격 마지막 번호보다 앞선** 마이그레이션을 그냥 넣지 않는다. 0072가
빠진 상태로 0073이 올라가 있었고, 그 뒤의 push는 이것만 뱉었다:

```
Found local migration files to be inserted before the last migration on remote
database. Rerun the command with --include-all flag to apply these migrations
```

`--include-all`로 해결된다. 다만 **문제는 메시지가 아니라 그 전이다** — 0072가
없는 동안 화면은 정상이었고 `scoring_version`만 옛 값이었다. 그걸 "리빌드를 안
눌러서"라고 잘못 진단했다. 함수가 아예 없었던 것이다.

그러니 push 전후로 **번호를 직접 본다**:

```powershell
supabase migration list
```

`remote`가 빈 문자열인 줄이 있으면 그게 안 올라간 것이다. `db diff --linked`는
함수 본문 차이를 항상 잡아주지 않는다.

### push 뒤에 `db diff --linked`도 본다 — 로컬 테스트가 구조적으로 못 보는 것이 있다

```powershell
supabase db diff --linked --schema public
```

출력은 **원격에는 있는데 마이그레이션엔 없는 것**이다. 대부분은 플랫폼 잡음이라
(기본 권한, `rls_auto_enable`, `ensure_rls` 이벤트 트리거) 흘려보게 되는데,
**그 잡음이 실제로 위험한 한 가지를 숨긴다.**

호스팅 프로젝트에는 이게 걸려 있다:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
```

**새로 만드는 함수마다 `anon`·`authenticated`에 EXECUTE가 직접 붙는다.**
`revoke all on function ... from public`은 **직접 붙은 grant를 건드리지 않는다.**
revoke는 돌고, 성공을 보고하고, 함수는 그대로 열려 있다.

**로컬 스택에는 그 기본 권한이 없다.** 로컬에서 `anon`은 어떤 함수에도 실행
권한이 없다 — `approve_player_claim`도 마찬가지고, 그것도 `public`에서만
revoke했다. 그래서 **이 드리프트는 pgTAP으로 잡히지 않는다.** 로컬에서 짠
"anon은 못 부른다" 테스트는 마이그레이션이 있든 없든 통과한다.

0094가 정확히 이걸 밟았다. `record_departure()`는 자체 권한 검사가 없는 내부
헬퍼인데 (호출자 둘이 SECURITY DEFINER라 grant가 필요 없다), 프로덕션에서
`anon`이 부를 수 있었다 — `audit_logs`에 임의의 행을 넣을 수 있는 상태였다.
0095가 `from anon, authenticated`로 명시 revoke해서 닫았다.

같이 올라간 `leave_alliance()`·`remove_member()`는 안전했고, **그건 grant 때문이
아니라 각자 첫 줄에서 거부하기 때문이다** (`auth.uid()` null / `members.manage`).
그 순서가 맞다. 함수의 안전장치는 grant가 아니라 가드다.

**규칙**: 이 플랫폼에서 `revoke ... from public`은 함수를 비공개로 만들지 않는다.
**롤을 이름으로 적어야 한다.** 새 함수를 올린 뒤에는 `db diff --linked`에
`GRANT ALL ON FUNCTION public.<새 함수> TO anon`이 있는지 본다.

### 함수를 올리는 것과 실행하는 것은 다르다

`build_rank_period` 같은 계산 함수는 올라가도 **기존 행을 다시 쓰지 않는다.**
새 결과를 보려면 어드민 화면에서 다시 실행해야 하고, 그 함수는 스크립트로 못
돌린다 — `current_app_role()`을 보기 때문에 서비스 키는 `42501 officers only`로
거부된다(0111부터 member 세션도 거부). officer 이상 로그인 세션이 필요하다.

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

### 실제로 이랬다 — Cloudflare Workers 자산, Pages 아님

`apps/dashboard/wrangler.jsonc`가 정적 자산만 서빙한다. Worker 스크립트도
`main` 엔트리도 없다 — 대시보드는 브라우저에서 Supabase로 직접 말하고, 앞에
Worker를 두면 인증이 틀릴 수 있는 자리가 하나 더 생긴다. SPA fallback도 없다
(해시 라우팅).

주소는 `darkwar-platform.hjyshane.workers.dev`다. **`*.pages.dev`는 존재하지
않는다** — DNS부터 안 뜬다. 이걸 몰라서 한 번 헛짚었다.

### 배포된 것이 무엇인지 확인하는 법 — 날짜가 아니라 마커로

Cloudflare가 표시하는 시각은 **언제** 빌드했는지만 말하고 **무엇을** 빌드했는지는
말하지 않는다. 번들에서 문자열을 찾는다:

```powershell
# index.html에서 /assets/index-*.js 를 뽑아 내려받고, 최근 변경의 흔적을 찾는다.
# 예: 'pinned-rank'(#118), 'Signed in as'(#117), 'up is better'(#116)
```

> **urllib로 그냥 받으면 403이다.** User-Agent 헤더를 붙이면 200이 온다.
> PowerShell의 `Invoke-WebRequest`는 기본으로 붙여 준다.

## 7. 확인한다 — 로그인하지 않은 브라우저로

배포 주소를 **시크릿 창**에서 연다. 0단계의 표와 맞는지 눈으로 본다.

**탭이 하나도 없어야 한다.** "Alliance members only" 안내와 로그인 링크만
보인다 (0065).

화면만 보고 만족하지 말고 **데이터에 직접 물어본다.** 화면은 경계가 아니다:

```powershell
curl -i "https://<ref>.supabase.co/rest/v1/players?select=player_id&limit=1" -H "apikey: <publishable key>"
```

**401**이 나와야 한다. `[]`가 나오면 정책은 걸렸지만 GRANT가 안 회수된 것이고,
행이 나오면 둘 다 안 올라간 것이다.

그다음 로그인해서 반대쪽도 확인한다 — 전부 막혔는데 멤버도 못 보면 그건 보안이
아니라 장애다.

맞지 않으면 되돌리는 것보다 **먼저 프로젝트를 일시정지**하고 원인을 찾는다.

---

## 남은 것

- **백업.** 무료 티어에는 자동 백업이 없다. 저널이 관측의 원본이므로 다시 sync
  할 수 있지만, **사람이 입력한 것**(영웅 이름은 0061이 들고 있으니 괜찮고,
  `app_settings`·`announcements`·`player_ranks.assigned_rank`는 아니다)은
  어디에도 복제본이 없다.
- **CI에서의 자동 배포는 여전히 만들지 않았다** (§21.1). 지금은 손으로 한다.
