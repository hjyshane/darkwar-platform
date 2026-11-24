# 백업과 복구

작성 2026-11-24. **이 문서의 절차는 아직 한 번도 돌려 보지 않았다.** 처음 돌린 사람이
날짜와 결과를 §5에 적고, 틀린 줄을 고친다.

## 1. 무엇을 잃을 수 있나

데이터는 두 종류이고, 잃었을 때의 무게가 전혀 다르다.

| 종류 | 예 | 잃으면 |
|---|---|---|
| **캡처에서 온 것** | 스냅샷 테이블 전부, `raw_observations`, 랭킹·로스터·지도 | 수집기 저널(`C:\DW_data\collector.db`)이 남아 있는 범위까지 `replay` + `sync`로 다시 채운다. 저널을 `prune-journal`로 줄인 이전 구간은 돌아오지 않는다 |
| **사람이 입력한 것** | `app_users`(역할), `role_permissions`, `tab_visibility`, `ui_overrides`, `app_settings`, `alliance_settings`, `join_codes`, `player_claims`, `player_ranks`(사람이 정한 등급), `announcements`, `guides`, `post_comments`, `event_guides`, `hive_formations`, `schedule_reminders`, `gift_codes`, `heroes`(영웅 이름), `seasons` | **어떤 캡처로도 복원되지 않는다.** 백업이 유일한 사본이다 |

`run-dashboard` 스킬이 기록한 대로, 로컬 `db reset` 한 번에 영웅 이름을 입력한 세션 하나
분량이 날아간 적이 있다. 프로덕션에서 같은 일이 나면 되돌릴 사본이 지금은 없다.

## 2. 지금 상태 (미확인)

- 2026-08-05 기준 프로젝트는 **무료 티어**였다(`retention.md`). Supabase 무료 플랜은
  관리형 일일 백업과 PITR을 주지 않는 것으로 알고 있다 — **주인 확인 필요**:
  Supabase 대시보드 › Project › Database › Backups에 백업 목록이 있는지 본다.
- 목록이 비어 있으면 §3의 수동 덤프가 유일한 백업이다.

## 3. 덤프 뜨기

`supabase db dump`는 Docker 안의 `pg_dump`를 쓴다. Docker가 없는 이 맥과 Windows에서는
PostgreSQL 17의 `pg_dump`를 직접 쓴다(맥: `mac-setup.md`의 `PGBIN`).

연결 문자열은 Supabase 대시보드 › Connect › **Session pooler**의 URI(비밀번호 포함).
이 문자열은 RLS를 우회하는 권한이다 — 셸 기록에 남기지 말고 환경 변수로 넘긴다.

```bash
read -rs DW_DB_URL   # Session pooler URI를 붙여 넣는다 (화면에 안 보임)
export DW_DB_URL
STAMP=$(date -u +%Y%m%dT%H%MZ)
"$PGBIN/pg_dump" "$DW_DB_URL" --schema=public --format=custom --no-owner --no-privileges \
  --file "$HOME/DW_data/backups/public-$STAMP.dump"
```

- **저장소 안에 두지 않는다.** `.gitignore`와 gitleaks가 막지만, 애초에 저장소 밖
  (`~/DW_data/backups/`, Windows는 `C:\DW_data\backups\`)에 둔다.
- `public`만 뜬다. `auth` 스키마(이메일·비밀번호 해시)는 넣지 않는다 — 새 프로젝트로
  옮길 때는 사람들이 다시 가입하고 `app_users`의 역할을 이메일로 다시 잇는 편이 해시를
  들고 다니는 것보다 낫다.
- 덤프 자체도 멤버 이름·게임 UID를 담는다. 공유 드라이브에 올리지 않는다.

**주기:** 사람이 입력한 표가 바뀌는 속도로 보면 주 1회로 충분하다. 시즌 시작·랭킹 정산·
큰 설정 변경 **직전**에는 따로 한 번 뜬다. 최근 8개만 남긴다.

## 4. 복구 훈련 (프로덕션에 손대지 않는다)

덤프가 실제로 복원되는지는 복원해 봐야 안다. `scripts/pgtap/run.py`와 같은 일회용
PostgreSQL 17에서 한다.

```bash
"$PGBIN/initdb" -D /tmp/dw-restore -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D /tmp/dw-restore -o "-p 55432" -l /tmp/dw-restore.log start
"$PGBIN/createdb" -p 55432 -U postgres restore_check
"$PGBIN/pg_restore" -p 55432 -U postgres -d restore_check --no-owner --no-privileges \
  "$HOME/DW_data/backups/public-<STAMP>.dump" 2> /tmp/dw-restore-errors.txt
"$PGBIN/psql" -p 55432 -U postgres -d restore_check -c \
  "select (select count(*) from public.app_users) users,
          (select count(*) from public.guides) guides,
          (select count(*) from public.hive_formations) formations,
          (select count(*) from public.heroes) heroes;"
"$PGBIN/pg_ctl" -D /tmp/dw-restore stop && rm -rf /tmp/dw-restore
```

- `auth.users`를 참조하는 외래 키, `auth.uid()`를 부르는 정책·함수는 이 빈 인스턴스에서
  오류를 낸다(`/tmp/dw-restore-errors.txt`). 훈련의 목적은 **사람이 입력한 행이 돌아오는가**
  이므로 위 숫자가 프로덕션과 맞으면 통과로 본다. 실제 복구는 새 Supabase 프로젝트에
  마이그레이션을 먼저 적용하고 `--data-only`로 행만 넣는 것이 맞다(§1의 표부터).
- 숫자는 프로덕션 SQL Editor에서 같은 쿼리로 비교한다.

## 5. 기록

| 날짜 | 누가 | 무엇을 | 결과 |
|---|---|---|---|
| — | — | 아직 없음 | — |
