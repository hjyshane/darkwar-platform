# 보존 정책 — 우리 사람은 3개월, 나머지는 7일

작성 2026-08-05. 마이그레이션 0070.

**아무것도 스케줄되어 있지 않다.** 이 문서를 읽고 숫자를 확인한 뒤에 켜는 것이
의도된 순서다. 삭제는 이 스키마가 되돌릴 수 없는 유일한 연산이다.

## 왜 하는가 — 크기가 아니라 증가율

전체 데이터는 약 47,000행이고 무료 티어는 500MB다. 지금 당장 공간 문제는 없다.

문제는 기울기다. 연맹 **9개**를 훑은 결과가 `alliance_member_snapshots` 13,875행이다.
162개를 매일 돌면 하루 약 15,000행이 붙고, 그 대부분은 다른 연맹 사람들의 일주일 전
전투력이다 — 아무도 다시 묻지 않을 값이다.

## "우리 사람"의 정의

**우리 연맹 멤버 스냅샷에 한 번이라도 나온 사람.** `public.own_player_ids`.

"현재 멤버"가 아니다. 탈퇴 기록이 바로 지켜야 할 히스토리이고, 0067이 탈퇴를 이
스냅샷들에서 파생한다. 현재 멤버로 정의하면 누가 탈퇴한 지 일주일 뒤에 **탈퇴했다는
증거 자체가 사라진다.**

## 손대지 않는 것

| 대상 | 이유 |
|---|---|
| `players`, `alliances` | 작고, 히스토리가 아니라 정체성이다. 삭제하면 `player_ranks`·`player_contributions`로 cascade — **사람이 정한 등급은 어떤 캡처로도 복원할 수 없다** |
| `player_names` | 개명한 플레이어를 다시 찾는 유일한 수단. 캡처 수와 무관하게 늘지 않는다 |
| 점수 관련 전부 | `rank_periods`가 점수 근거 행을 고정한다. `CLAUDE.md`: 과거 점수는 덮어쓰지 않는다 |

스냅샷 테이블에는 점수 테이블에서 오는 외래키가 **없다**(0070 작성 전 확인). 그래서
스냅샷을 지워도 점수가 고아가 되지 않는다.

## 대상과 창

| 테이블 | 우리 | 남 |
|---|---|---|
| `player_snapshots` | 3개월 | 7일 |
| `player_component_power_snapshots` | 3개월 | 7일 |
| `player_detail_snapshots` | 3개월 | 7일 |
| `alliance_member_snapshots` | 3개월 (우리 연맹 행 전체) | 7일 |
| `alliance_snapshots` | 3개월 (전부) | — |
| `arena_snapshots` | 우리 멤버가 있는 보드는 안 지움 | 7일 |

`alliance_snapshots`는 연맹당 스윕당 한 행이라 멤버당 한 행과 비교가 안 되게 싸다.
남의 연맹 전투력의 유일한 장기 시계열이므로 길게 둔다.

아레나는 **보드 단위**다. `arena_entries`와 `arena_entry_heroes`가 보드에서
cascade되므로, 보호를 보드 수준에서 걸어야 한다 — 그러지 않으면 오래된 보드를
지우면서 우리 멤버의 라인업까지 같이 가져간다.

## 절차

먼저 센다. 아무것도 지우지 않는다.

```sql
select * from public.retention_report();
```

숫자가 납득되면 지운다.

```sql
select * from public.retention_report(p_confirm := true);
```

창을 바꿔 보려면:

```sql
select * from public.retention_report(false, interval '6 months', interval '14 days');
```

`members.manage`가 필요하다. 없으면 리포트조차 `42501`이다.

리포트와 삭제는 **같은 술어 텍스트**를 실행한다(동적 SQL 한 벌). 두 함수로 나누면
리포트가 실제로 지워질 집합과 다른 것을 설명할 수 있다.

## 스케줄로 옮길 때

pg_cron은 이 프로젝트에서 아직 쓰지 않는다(§18.4 알림과 함께 보류). 켜기로 하면
`retention_report(true)`를 하루 한 번 부르는 것으로 충분하고, **첫 몇 번은 리포트만
찍어 로그로 남긴 뒤** 삭제로 바꾸는 편이 안전하다.

## 함정

**`is_own`은 트리거가 정한다.** 0031이 `alliance_member_snapshots.presence_redacted`
로 판정한다 — 은닉되지 않은 로스터는 우리 연맹뿐이라는 관찰이다. 테스트 픽스처에
`presence_redacted`를 명시하지 않으면 기본값 `false` 때문에 **남의 연맹이 우리 것으로
표시되고**, 그러면 보존 창이 조용히 3개월로 바뀐다. 39_retention_test가 이 실수로 5개
실패했고, 그때 틀린 것은 마이그레이션이 아니라 테스트였다.
