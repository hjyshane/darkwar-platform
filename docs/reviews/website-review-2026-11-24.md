# 웹사이트 전면 리뷰 — 2026-11-24

대상: `apps/dashboard` (cbfw.us) + `supabase/migrations`. 기준 커밋 `ad0b38e8`.
방식: 읽기 전용 패널 5명(코드베이스 · 보안 · 성능 · UI/UX · 어드민 자유도)이 정적 분석. 핵심 주장은 종합 단계에서 다시 grep으로 확인했다.

**한계.** 빌드·번들 측정·Lighthouse·실기기·로그인 상태의 실 DB 확인은 하지 않았다(`node_modules` 없음). 수치가 없는 "예상 효과"는 추정이다. 각 줄의 **확인함 / 미확인**을 구분한다.

## 1. 결론

목적(사용성 · 단순화 · 설정 디테일 · 어드민 자유도, 코드 수정 의존 탈피)에 비춰 보면 문제는 한 가지 모양으로 반복된다: **정의가 코드 여러 곳에 흩어져 있어서, 바꾸려면 코드를 고쳐야 한다.**

- 설정: 키마다 전용 화면을 손으로 만든다(`features/admin`에 Setting 파일 약 30개, 큰 것은 700줄). 새 설정 = 새 화면 + 새 마이그레이션.
- 내비게이션: 라우트 하나를 추가하려면 `lib/route.ts`(702줄) · `lib/shellNav.ts`(793줄) · `App.tsx`(690줄)를 모두 고친다. 탭 배열 7개가 공존한다.
- 게임 상수: 서버 목록, 팩 분류, 환율, 랭크 최소치 등이 TS 상수다.

그래서 권고의 축은 두 개다: **(A) 설정 레지스트리 + 변경 이력**, **(B) 라우트/내비 단일 정의**. 나머지는 그 위에 얹는 빠른 수정들이다.

## 2. 우선순위 로드맵

### 1단계 — 바로 (2026-11-24 처리)

| # | 항목 | 결과 |
|---|---|---|
| 1 | 보안 헤더 | **함.** `apps/dashboard/public/_headers`: CSP(스크립트는 자기 출처만, 연결·이미지는 Supabase 프로젝트 하나), `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`. 프로덕션 빌드에 같은 CSP를 씌워 로그인·약관·개인정보 페이지에서 위반 0 확인. **cbfw.us에서는 머지 뒤 확인 필요**(로그인 상태로 지도·이미지·실시간). |
| 2 | 라우트 단위 지연 로딩 | **함.** 첫 진입 JS가 gzip 447 KB → 176 KB(1,567 KB → 598 KB). 홈·로그인·캐릭터 선택만 즉시, 나머지 화면은 열 때 받는다. 배포 직후 옛 탭이 사라진 파일을 찾으면 한 번 새로고침하고, 그래도 안 되면 "This page did not load" + Reload(`lib/lazyPage.tsx`). |
| 3 | 캐시 헤더 | **함.** `/assets/*`는 1년 immutable. `index.html`은 Cloudflare 기본(max-age=0, 재검증) 그대로. |
| 4 | 서버 목록을 데이터로 | **읽기만 함.** 이동 화면 둘과 Merchant tester가 `servers.is_tracked`(0264가 565–588로 설정)를 읽는다. 상수는 대체값으로 남김. 어드민이 화면에서 켜고 끄는 것은 2단계 A(설정 레지스트리) 몫 — 쓰기 RPC와 pgTAP가 필요하다. |
| 5 | 홈 온보딩 | **안 함 — 전제가 틀렸다.** 캐릭터가 없는 멤버·임원은 이미 캐릭터 선택 화면(`CharacterGate`)을 먼저 거친다. 홈의 "Link your account" 줄은 관리자에게만 보인다. |
| 6 | 백업/복구 | **런북만 씀**(`docs/runbooks/backup.md`), 한 번도 안 돌림. 2026-08 기준 무료 티어라 관리형 백업이 없을 가능성 — 주인 확인 필요. |

### 2단계 — 구조 (어드민 자유도의 본체) — 결과 (2026-11-24)

| 항목 | 결과 |
|---|---|
| A. 설정 레지스트리 | **함**(#673, #674, #680). Settings › Shared › Site values가 레지스트리를 읽어 그린다. 서버 목록, 팩 분류, 루비 환율(0348), 기본 언어, 저참여 기준·"hot" 점수·Black Gold 추세 길이·연맹 개요 기간과 항상 표시할 이벤트·Game guide 회차 수·캘린더 상시 이벤트 기준, 캘린더 카테고리(순서·이름·숨김·추가, 0351)와 숨긴 이벤트. |
| B. 변경 이력 + 되돌리기 | **함**(0347, #673). `app_settings`·`tab_visibility`·`ui_overrides`·`role_permissions`·`servers`에 이력 트리거, Settings › Change history에서 Undo. |
| C. 라우트 레지스트리 | **함**(#681). `lib/routeTable.ts`가 화면마다 주소·옛 주소·제목·아이콘·그룹·공개 여부·커뮤니티·캐릭터 선택 중 허용·탭 숨김 키를 한 줄로 선언하고, `pages.tsx`가 `Record<Route, …>`로 페이지를 그린다. 사이드바의 순서·묶음은 레이아웃 결정이라 코드에 남김. |
| 메뉴 편집 | **PR #682**(열림). 편집 모드에서 사이드바 항목과 그 아래 화면의 이름·순서·숨김, 그룹 이름. 그룹 간 이동은 주인이 뺐다. `ui_overrides` 재사용, 마이그레이션 없음. |
| D. import/export · 기본값 복원 · 검색 | **함**(#673, #674). 피처 플래그는 따로 만들지 않았다 — 탭 숨김(0295)과 메뉴 숨김이 그 몫을 한다. |

아래는 리뷰 당시의 제안 원문이다.


**A. 설정 레지스트리 + 스키마 기반 폼 (L)**
키별로 타입 · 기본값 · 라벨 · 설명 · 범위 · 스코프(전역/연맹) · 필요한 capability를 한 곳에 선언하고, 범용 폼이 그것을 읽어 그린다. 이미 있는 `app_settings`(0032)와 연맹별 설정(0195–0200, 0342)을 저장소로 그대로 쓴다. 새 설정이 "레지스트리 한 줄"이 되는 것이 목표다. 첫 이관 대상: 서버 목록, 팩 분류(`shopValue/data.ts:201-230`의 `CATEGORY_BY_TYPE` — 주석이 "add it here when it turns up"이라고 적혀 있다), `DOLLARS_PER_RUBY`(`data.ts:12`), 캘린더 카테고리/기본 노출.

**B. 변경 이력 + 되돌리기 (M)**
`app_settings` · `tab_visibility` · `ui_overrides` · `role_permissions`에 공통 이력 트리거(key, old, new, by, at). 화면에 diff와 "이 버전으로 되돌리기". 감사 로그와 undo가 한 번에 해결된다. 현재 `audit_logs`에 쓰는 마이그레이션은 0094(leaving) 하나뿐이고 이력/감사 트리거는 없다(확인함).

**C. 라우트 레지스트리 (L, 기능 변화 없음)**
`{ key, path, icon, label, component: lazy(...), nav }` 선언 테이블 하나에서 route · nav · App을 파생. `satisfies Record<Route, …>`로 누락을 컴파일에서 막는다. 2번(lazy)과 같이 하면 한 번에 끝난다. 그 뒤에야 "탭 구성 자체를 어드민이 편집"이 현실적이다.

**D. 피처 플래그 · 기본값 복원 · 설정 검색 · import/export (각 S, A 위에)**

### 3단계 — 품질 (2026-11-24 처리)

| 항목 | 결과 |
|---|---|
| 관리자 RPC × member 거절 pgTAP 매트릭스 | **스키마 전체 불변식으로 함**(`supabase/tests/990_schema_invariants_test.sql`): 모든 public 테이블 RLS 켜짐, 클라이언트가 부를 수 있는 SECURITY DEFINER 함수는 호출자를 확인하거나 검토된 예외, definer는 search_path 고정, anon 쓰기 권한 없음. 확인 결과 **구멍은 없었다**: anon이 부를 수 있는 definer 5개(claim_player 등)는 모두 역할 확인, 확인이 안 보이던 8개(하이브·BGB 쓰기)는 `internal.*_lock`이 hive.plan을 먼저 확인. |
| 공용 로딩/오류 표시 | **홈부터 함**(`components/QueryProblem.tsx`): 하이브 카드가 실패 시 사라지고, 이번 주 카드가 실패를 "오늘 Alliance Duel 테마 없음"으로 보여 주던 것을 "불러오지 못함 + 다시 시도"로. 다른 화면은 이미 각자 오류 문구가 있어 일괄 교체는 안 함. |
| dist에 fixture 유입 CI 가드 | **함**(ci.yml web 잡). |
| fetchAllPages 병렬화 | **안 함 — 이득이 없다.** 호출처 셋 모두 보통 1,000행 한 페이지로 끝난다. |
| 1초 타이머 격리 | **안 함 — 의도된 것.** HuntPins의 1초 틱은 트럭을 길 위로 움직이는 것이고, 사냥 화면이 열려 있을 때만 돈다. |
| 쿼리 팩토리 / 거대 파일 분해 / CSS 분할 / knip | **보류.** 사용자에게 보이는 변화 없이 회귀 위험만 큰 리팩터다. 해당 파일을 기능 때문에 고칠 일이 생길 때 그 자리에서 나누는 편이 낫다. |

## 3. 패널 지적 중 걸러 낸 것

- **"anon EXECUTE 부여 35건 — 높음"** → 낮춤. 한 줄짜리 grant 문 기준으로 anon에 열린 함수는 `active_alliance`, `current_app_role`, `has_permission`, `is_service_request`, `primary_own_alliance`, `tier_rank` 여섯 개로 모두 헬퍼다. 0198("anon calls none of the alliance functions")도 있다. 여러 줄에 걸친 grant는 이 확인에 안 잡히므로, 전수 `has_function_privilege` 불변식 테스트는 여전히 가치가 있다.
- **"연맹별 설정 스코프 없음"** → 틀림. 0195–0200, 0342가 연맹별 설정이다.
- **"dev fixtures가 프로덕션 번들에 샌다"** → 근거 없음. `index.html`은 `src/main.tsx`만 참조하고 fixtures는 `index.dev.html` 쪽이다. 다만 `src/dev` 밖에서 "fixtures"를 언급하는 비테스트 파일이 둘(`player/headerModel.ts`, `lib/timezone.ts`) 있어 import인지 주석인지는 미확인.
- **React Query/Realtime** → 문제 아님. 전역 `staleTime` 60초, 채널 하나로 queryKey 무효화. 구조가 좋다.
- **XSS** → `dangerouslySetInnerHTML` 0건, `RichText`가 전부 React 노드로 렌더. CSP가 없어서 이 설계 하나에 의존하는 것이 문제일 뿐이다.

## 4. 주인 결정 (2026-11-24)

1. **언어.** 영어가 기본. 한국어 · 프랑스어 · 터키어 · 이탈리아어 · 스페인어 · 독일어 · 중국어 · 베트남어를 추가한다(총 9개). 번역 계층(`t()` 사전, en 대체)이 선행 작업이다.
2. **메뉴 구조.** 정함, 구현함: Home · 연맹 · Tools · Guides · Map. Hive는 연맹 아래로, Calculator 항목은 Tools로 이름만 바뀜(주소·탭 가시성 키 그대로). 연맹 아래 이벤트는 "Events"(시즌과 무관)와 "Seasons" 두 묶음. "Event guide"는 "Game guide". Shop value는 Admin 메뉴에 그대로, Alarms 위치는 건드리지 않음. 아래 §4.1은 결정 전 비교표.
3. **홈의 Upgrades 카드.** 뺐다(`HomePage.tsx`, 테스트, `.home-kinds` CSS). 계산기는 사이드바 항목 그대로.
4. **설정 화면 그룹.** 위임받음 — 레지스트리 작업(2단계 A) 때 검색 + 자주 쓰는 항목 우선 + "Shared"(id `catalogue`) 이름 정리로 처리한다.
5. **모바일.** 뷰어 목적. 읽는 화면만 폰에서 보장하고, 편집기류는 PC 전용으로 둔다.
6. **점수 상수.** 어드민이 전부 바꿀 수 있게 한다. "점수 변경 = 새 버전, 과거 점수 덮어쓰지 않음" 규칙은 유지 — 설정 저장이 새 `scoring_version`을 만드는 형태여야 한다.

### 4.1 메뉴 — 지금 / 패널 제안 / 수정 제안

패널은 옛 탭 배열(`NAV_TABS` 등)까지 현재 메뉴로 읽었다. 실제 사이드바(`buildMemberNav`, 11-19)는 이미 여섯 항목이고, "Events가 세 군데"는 대부분 `route.ts`에 남은 옛 배열 얘기다. 사용자에게 보이는 남은 문제는 (a) 이벤트가 Guides 아래(Event guide)와 연맹 항목 아래(이벤트 보드)로 갈려 있고 (b) 연맹 항목 아래에 화면이 최대 9개 평평하게 나열된다는 것.

| | 지금 | 패널 제안 | 수정 제안(최소 변경) |
|---|---|---|---|
| 최상위 | Home · Guides · Calculator · Hive · Map · 연맹(CBFW) | Home · Alliance · Events · Tools · Guides | 지금의 여섯 유지 |
| 이벤트 보드 | 연맹 아래에 Overview와 나란히 8개 | Events로 이동, Boards/Seasons로 분리 | 연맹 아래 유지, "Events"와 "Seasons" 두 묶음으로 |
| Event guide | Guides 아래 | Events로 이동 | Guides 아래 유지 |
| Alarms | 이벤트 보드 사이(임원·관리자만) | Admin 메뉴 | Officer/Admin 메뉴 |
| Hive | 최상위 | Alliance 아래 | 최상위 유지(이동일에 모두가 읽는 화면) |
| 주소 | — | 유지 | 유지 |

## 5. 측정이 먼저인 것

- 실제 번들 크기(gzip)와 lazy 전후 차이 — `pnpm install && pnpm build` + 번들 시각화.
- 죽은 CSS 규모 — purge 도구의 rejected 목록.
- ~~`shell.css:150, 434, 1263`의 `outline: none`에 대체 focus 스타일이 있는지.~~ **확인함(11-24).** 일곱 곳(계산기 입력 포함) 중 여섯은 box-shadow 링이 대신했지만 고대비 모드(Windows)는 box-shadow를 지워 아무 표시도 없었다 → 투명 outline으로 바꿈. 명령 팔레트 검색 칸은 표시가 전혀 없었다 → 줄에 포커스 표시 추가.
- 2단 사이드바가 폰에서 동작하는지(실기기).
- 쓰기 RPC의 사용자별 한도 필요성 — 가입 코드 외에는 제한이 안 보인다는 보고(미확인).
