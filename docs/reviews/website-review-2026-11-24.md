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

### 1단계 — 바로 (각 반나절 이하)

| # | 항목 | 근거 | 상태 |
|---|---|---|---|
| 1 | 보안 헤더 추가: `public/_headers`에 CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'` | `public/`에 `map.webp`·`privacy.html`·`terms.html`뿐, `wrangler.jsonc`는 assets만 선언 | 확인함 |
| 2 | 라우트 단위 `React.lazy` + `Suspense` (hive, map, shopValue, planner, calculator, admin, eventGuide/editor 순) | `src`에 `lazy(` 0건, `App.tsx`가 feature 약 40개 정적 import | 확인함 (효과 수치는 미측정) |
| 3 | 캐시 헤더: `/assets/*` immutable, `index.html` no-cache | `_headers` 없음 | 확인함 |
| 4 | 서버 목록을 데이터로: `SERVERS = 565..588` 상수 제거 | `features/migration/boards.ts:48`. 그 외 577–584 숫자가 든 파일 약 20개 | 확인함 |
| 5 | 홈 온보딩: "캐릭터 연결" 체크리스트를 홈 최상단에 | `HomePage.tsx`가 `playerId === null`에 안내 한 줄, 카드 대부분 빈 화면 | 미확인(패널 보고) |
| 6 | 백업/복구 런북 + PITR 여부 확인 | `docs/runbooks`에 backup/restore 없음 | 미확인(패널 보고) |

### 2단계 — 구조 (어드민 자유도의 본체)

**A. 설정 레지스트리 + 스키마 기반 폼 (L)**
키별로 타입 · 기본값 · 라벨 · 설명 · 범위 · 스코프(전역/연맹) · 필요한 capability를 한 곳에 선언하고, 범용 폼이 그것을 읽어 그린다. 이미 있는 `app_settings`(0032)와 연맹별 설정(0195–0200, 0342)을 저장소로 그대로 쓴다. 새 설정이 "레지스트리 한 줄"이 되는 것이 목표다. 첫 이관 대상: 서버 목록, 팩 분류(`shopValue/data.ts:201-230`의 `CATEGORY_BY_TYPE` — 주석이 "add it here when it turns up"이라고 적혀 있다), `DOLLARS_PER_RUBY`(`data.ts:12`), 캘린더 카테고리/기본 노출.

**B. 변경 이력 + 되돌리기 (M)**
`app_settings` · `tab_visibility` · `ui_overrides` · `role_permissions`에 공통 이력 트리거(key, old, new, by, at). 화면에 diff와 "이 버전으로 되돌리기". 감사 로그와 undo가 한 번에 해결된다. 현재 `audit_logs`에 쓰는 마이그레이션은 0094(leaving) 하나뿐이고 이력/감사 트리거는 없다(확인함).

**C. 라우트 레지스트리 (L, 기능 변화 없음)**
`{ key, path, icon, label, component: lazy(...), nav }` 선언 테이블 하나에서 route · nav · App을 파생. `satisfies Record<Route, …>`로 누락을 컴파일에서 막는다. 2번(lazy)과 같이 하면 한 번에 끝난다. 그 뒤에야 "탭 구성 자체를 어드민이 편집"이 현실적이다.

**D. 피처 플래그 · 기본값 복원 · 설정 검색 · import/export (각 S, A 위에)**

### 3단계 — 품질

- 쿼리 계층: `supabase.from(` 직접 호출 68곳, 인라인 `queryKey` 354곳 → 도메인별 `queryOptions` 팩토리 (M).
- 거대 파일 분해: `FormationEditor.tsx` 2,552줄, `TileGrid.tsx` 1,426줄, `ShopValuePage.tsx` 1,008줄. 분해 전에 렌더 테스트부터 (L).
- 공용 `<QueryState>`(로딩/빈 상태/오류+재시도) — 실패와 "데이터 없음"이 지금은 구분되지 않는다 (M).
- 대형 표 행 `React.memo`, 1초 타이머를 말단 컴포넌트로 격리 (S–M).
- `fetchAllPages` 직렬 페이지네이션(`lib/fetchAllPages.ts:13-30`) 병렬화 또는 서버 집계 (S).
- `index.css` 8,794줄 → feature별 분할 (M, lazy와 함께).
- 관리자 RPC × "member로 호출하면 실패" pgTAP 매트릭스 (M).
- `knip`으로 미사용 export 측정, `dist`에 fixture 문자열이 없는지 CI 가드 (S).

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
- `shell.css:150, 434, 1263`의 `outline: none`에 대체 focus 스타일이 있는지.
- 2단 사이드바가 폰에서 동작하는지(실기기).
- 쓰기 RPC의 사용자별 한도 필요성 — 가입 코드 외에는 제한이 안 보인다는 보고(미확인).
