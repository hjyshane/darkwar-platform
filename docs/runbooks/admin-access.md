# 런북: 관리자 접근

대시보드는 로그인 없이도 공개 패널(랭킹·아레나·크로스서버)을 보여준다. 다만
**연맹 기여(기부·듀얼)는 member 이상만** 보인다(0020).

| 주소 | 용도 | 링크 |
|---|---|---|
| `#/login` | 로그인 / 역할 확인 / 가입 코드 입력 / 로그아웃 | 탭 바 오른쪽 끝 |
| `#/month-cards` | 월정액 현황 — admin 세션일 때만 데이터가 보인다 | 없음 (의도적) |

`#/login`은 더 이상 숨기지 않는다. admin 전용 심부름이던 시절엔 맞았지만,
0020 이후로는 일반 멤버가 자기 연맹 수치를 보려고 로그인하기 때문이다. 탭 바
오른쪽 끝에 현재 역할이 표시된다.

주소는 여전히 보안 경계가 아니다. 로그인이 바꾸는 것은 쿼리에 실리는 JWT뿐이고,
그 JWT가 무엇을 읽을 수 있는지는 전부 RLS가 결정한다.

## 권한 구조

```
auth.users (Supabase 로그인 계정)
   └─ public.app_users.role : viewer | member | officer | admin
        └─ 없으면 viewer
```

## 최초 admin 시드 (1회)

app_users를 쓸 수 있는 것은 admin뿐이라(순환), **첫 admin은 DB에서 직접
만든다.** 로컬은 Studio(http://127.0.0.1:54323), 클라우드는 Supabase 대시보드.

1. Authentication → Add user → 이메일·비밀번호 생성 ("Auto Confirm" 체크)
2. SQL Editor:

```sql
insert into public.app_users (user_id, role, display_name)
select id, 'admin', '이름'
from auth.users
where email = '만든 이메일';
```

## 연맹원에게 역할 주기 (가입 코드)

가입해도 `app_users` 행은 생기지 않는다 — 새 계정은 전부 `viewer`이고 기여
수치가 안 보인다. 100명에게 손으로 역할을 주는 건 무리라, 코드를 발급한다.

`join_codes`는 **클라이언트가 읽을 수 없다.** 코드 사용은 security definer
함수 `redeem_join_code()`를 통해서만 일어난다. 발급은 admin 세션이나 서비스 키로:

```sql
insert into public.join_codes (code, grants_role, max_uses, expires_at, note)
values ('CBFW-2026-A7', 'member', 100, now() + interval '30 days', '연맹 채팅 공지');
```

연맹원은 로그인 → `#/login` → 코드 입력. 함수가 보장하는 것:

- `admin`이나 서비스 역할은 **절대** 부여하지 않는다 (함수 + check 제약 이중).
- 이미 member 이상인 계정은 **강등되지 않는다**. enum 순서가 권한 순서가 아니라서
  (`collector_service`가 `admin`보다 뒤) 비교 대신 "viewer이거나 행이 없을 때만"으로
  명시했다.
- 틀린 코드·만료·폐기·소진이 **전부 같은 메시지**로 실패한다. 어떤 코드가 존재하는지
  알려주지 않기 위해서다.
- 실패 5회/시간이면 잠긴다. 타이핑할 만큼 짧은 코드는 무한 시도 앞에서 짧다.

폐기: `update public.join_codes set revoked_at = now() where code = '...';`

officer 역할도 코드로 줄 수 있다(`grants_role = 'officer'`). admin은 아래처럼
직접 쓴다.

### 직접 역할 쓰기 (admin)

admin 세션으로 `app_users`에 쓰면 된다(admin_write 정책).

## 로컬 스택 테스트 계정

`admin@test.local` / `local-admin-pw-1` — 2026-07-30 검증 때 시드했다.
`supabase db reset`이 지우므로 리셋 후에는 다시 만든다. **로컬 전용이다** —
클라우드에는 본인 이메일로 별도 생성.

## 검증된 사슬 (2026-07-30)

publishable 키로 비밀번호 로그인 → 받은 JWT로 `player_month_cards` 조회 →
admin은 이름 조인된 실데이터, anon은 `[]`. pgTAP 12번 파일이 같은 것을
페르소나별로 고정한다.

## 우리 연맹 지정하기

대시보드는 `alliances.is_own`이 참인 연맹을 "우리"로 본다. 그 값은 두 곳에서
온다:

| 출처 | 언제 |
|---|---|
| `roster_unredacted_seen` (관측) | 기본값. `al.rank` 응답이 접속 정보를 **가리지 않았으면** 우리가 그 연맹에 속해 있다는 증거다 — 게임은 비연맹 로스터의 접속 정보를 가린다 |
| `app_settings.own_alliance` (지정) | admin이 지정하면 **관측을 이긴다** |

대개 관측이 맞으므로 아무것도 안 해도 된다. 지정이 필요한 경우는 수집 계정이
연맹을 옮겼거나, 다른 연맹을 돕느라 그쪽 로스터를 찍어서 증거가 두 곳을
가리킬 때다.

**보통은 SQL이 필요 없다.** admin으로 로그인하면 상단에 `Settings` 탭이 생기고,
거기서 연맹을 고르면 된다(`#/admin`). 관측 여부와 현재 적용 상태가 같이 보인다.

SQL로 해야 한다면:

```sql
insert into public.app_settings (key, value)
select 'own_alliance', jsonb_build_object('alliance_id', alliance_id, 'name', current_name)
from public.alliances where current_code = 'CBFW'
on conflict (key) do update set value = excluded.value;
```

`current_code`는 실제 값으로 바꾼다. 확인:

```sql
select current_name, current_code, roster_unredacted_seen as observed, is_own
from public.alliances where roster_unredacted_seen or is_own;
```

지정을 지우면 관측으로 되돌아간다:

```sql
delete from public.app_settings where key = 'own_alliance';
```

**지정은 관측을 덮어쓰지 않는다.** `roster_unredacted_seen`은 그대로 남으므로,
"admin은 CBFW라는데 우리가 가진 로스터는 전부 다른 연맹 것"인 상태를 나중에
알아볼 수 있다. 그게 이 둘을 한 컬럼으로 합치지 않은 이유다.

`alliance_id`는 설치마다 생성되는 값이라 마이그레이션에 박을 수 없다. 그래서
이 지정은 런타임 설정이고, 다음 단계에서 admin 화면으로 올라간다.
