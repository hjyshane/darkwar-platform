# 런북: 관리자 접근

대시보드는 로그인 없이도 공개 패널(로스터·랭킹·아레나)을 보여준다. 로그인은
**링크 없는 주소** 두 개로만 닿는다:

| 주소 | 용도 |
|---|---|
| `#/login` | 로그인 / 현재 세션 확인 / 로그아웃 |
| `#/month-cards` | 월정액 현황 — admin 세션일 때만 데이터가 보인다 |

주소는 보안 경계가 아니다. 로그인이 바꾸는 것은 쿼리에 실리는 JWT뿐이고, 그
JWT가 무엇을 읽을 수 있는지는 전부 RLS가 결정한다. 대시보드 어디에도 로그인
상태 표시가 없다 — 로그인돼 있는지 보려면 `#/login`을 다시 연다.

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

이후의 역할 부여는 admin 세션으로 app_users에 쓰면 된다(admin_write 정책).

## 로컬 스택 테스트 계정

`admin@test.local` / `local-admin-pw-1` — 2026-07-30 검증 때 시드했다.
`supabase db reset`이 지우므로 리셋 후에는 다시 만든다. **로컬 전용이다** —
클라우드에는 본인 이메일로 별도 생성.

## 검증된 사슬 (2026-07-30)

publishable 키로 비밀번호 로그인 → 받은 JWT로 `player_month_cards` 조회 →
admin은 이름 조인된 실데이터, anon은 `[]`. pgTAP 12번 파일이 같은 것을
페르소나별로 고정한다.
