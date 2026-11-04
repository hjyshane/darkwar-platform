# 시즌 4 (Sealed Island) 캡처 체크리스트

시작: **2026-11-09 월 02:00 UTC** (0245로 시드됨). 이 문서는 `season-map-capture.md`의
시즌 3 교훈을 시즌 4에 옮긴 것이다. **파서·테이블은 캡처가 온 뒤에 만든다** —
아래 내용은 전부 웹 2차 자료(2025-10~12월 글, 서로 어긋나는 부분 있음)에서 온 것이라
"무엇을 열어 볼지"의 목록일 뿐 필드 이름 하나도 확정이 아니다.

> 번호 대응(추정): 웹의 "Season 5: Sealed Island" = 우리 "Season 4". 우리 번호는
> 게임 stage+1이고, 시즌 3의 Coal Production이 웹의 눈(snow) 시즌과 맞는다.
> 확인: `game_season_snapshots`의 `stage` = 3, 또는 인게임 시즌 화면.

## 원칙 (시즌 3에서 배운 것)

1. **첫날 보드는 거의 비어 있다.** 첫날 없는 필드는 "서버가 안 보낸다"와 "아직 아무도
   안 했다"를 구별할 수 없다. 그래서 **명령 이름·필드 이름·ID 안정성**만 첫날에 닫고,
   값이 차야 하는 질문은 **2차 패스**(3~4주차)로 미룬다. 모든 파일에 날짜와 패스 번호를 적는다.
2. **파일 하나에 동작 하나.** 부정 결과("이 명령은 이 파일에 없다")는 그 동안 무엇을
   했는지 정확히 알 때만 의미가 있다.
3. **Wireshark 병행**(디코드 못 한 바이트가 보존된다). 캡처 필터 `tcp port 8680`,
   pcapng, **레포 밖** 저장(`C:/DW_data/season4/`). PCAP에는 수집 계정 UID·세션 서명이
   있다 — 레포·이슈에 올리지 않는다.
4. **요청도 이제 쌓인다.** `request_observations`(로컬 SQLite)와 Commands 탭,
   `uv run dw-collector command-catalog`. 새 명령이 카탈로그에서 "처음 봄"으로 뜨는지
   매일 본다. (`request-capture.md`) 이 체크리스트에 보내는 작업은 없다.
5. **옆에 평문 로그 한 줄씩**: 파일명, 한 일, 시각(UTC).

## 월요일 전 (오늘~일요일)

- [ ] 수집기 최신 `git pull` 후 재시작 (Windows `stop-iphone-task.ps1 -Restart` /
      맥 `install-iphone-agent.sh`). 로그인 응답의 시즌 달력을 받으려면 필요하다.
- [ ] `select stage, starts_at, settle_at, next_stage from game_season_snapshots order by captured_at desc limit 3`
      → stage 3, 11-09 02:00이 보이는지. **`settle_at`이 이 시즌의 실제 종료일**이다
      (웹 기준 9주 = 63일이면 2027-01-11 근처, 추정).
- [ ] Settings → Catalogue → Seasons에 Season 4 행이 있는지 (이름·시작일).
- [ ] 디스크 여유와 Wireshark 설치, 저장 폴더 `season4/` 준비.
- [ ] 주말에 **시즌 3 마지막 보드**(Coal Production·Influence)를 한 번 더 열어 둔다 —
      월요일 이후엔 새 시즌 보드로 바뀔 수 있다.

## 첫날 (11-09, 시즌 시작 직후)

| 파일 | 게임에서 할 일 | 답하는 것 |
|---|---|---|
| `01_s4_login.pcapng` | 로그인, 시즌 화면에 도착, 아무것도 안 건드림 | 시즌 핸드셰이크가 보내는 것, 새 `init` 필드 |
| `02_s4_season_tabs.pcapng` | 시즌 화면의 모든 탭을 천천히 한 번씩 | 시즌 점수·순위 보드의 출처 명령 |
| `03_s4_altar.pcapng` | **Alliance Altar** 열기 (연맹 거점) | 거점이 맵 오브젝트인지, Soulstone 저장량 필드 |
| `04_s4_soulstone_rank.pcapng` | **Soulstone 연맹 순위** 열고 맨 아래까지 스크롤 | 시즌 종료 순위 보드. `rank.get.by.range`식 페이징인지 |
| `05_s4_own_building.pcapng` | 개인 시즌 건물 하나 열기 (제단 반경 안) | 건물 상세 필드, 레벨·생산 |
| `06_s4_two_same_type.pcapng` | 같은 종류 건물 **두 개**, 그다음 첫 번째 다시 | 오브젝트 식별 필드 vs 종류 필드, ID 안정성 |
| `07_s4_miasma.pcapng` | Miasma 상태 화면, 가능하면 전투 후 감염 확인 | Miasma 중첩·감염이 응답에 오는지 (개인 상태일 가능성) |
| `08_s4_magatama_shop.pcapng` | Lan's Shadow Shop 열기 | 상점·화폐 명령 (`shop-value`와 같은 길인지) |
| `09_s4_hero_shop.pcapng` | **영웅 상점**에서 Angela·Ryan·Shadow 확인 (구매 아님) | 신규 영웅 id, 병종, 가격 |
| `10_s4_map_pan.pcapng` | 지도를 한 방향으로 팬, 같은 자리로 되돌아옴 | 새 오브젝트 종류(제단·Quartz Factory 등), 점령 영토 필드 |

멤버 소유 건물은 **우리 연맹원 것 하나, 외부인 것 하나**를 열어 `owner`가 `players`에
조인되는지 대비한다 (시즌 3의 2번 질문과 같다).

## 건너뛰지 말 것

- 영웅 상점/모집은 **열어서 보기만** 한다. 구매·소비는 하지 않는다.
- 팬은 **되돌아와야** 한다. 한 방향 팬으로는 ID 안정성을 못 본다.
- 순위는 **끝까지 스크롤**. 첫날 한 페이지뿐이면 "답 아님"이고 2차 패스 대상이다.

## 신규 영웅 (캡처가 오면)

웹 자료: Angela(Fighter), Ryan(Rider), Shadow(Shooter) — 전부 같은 병종 팀원 HP +10%.
Noah(Fighter)는 웹 기준 시즌 4(우리 3)라 이미 나왔을 수 있다. `heroes` 테이블은 28개
id뿐이고 이 영웅들의 id는 **서버가 이름이 아니라 로컬라이제이션 키만 보내서 미리 알 수 없다.**

- [ ] 아레나/영웅 캡처에서 `heroes`에 없는 id 확인:
      `select distinct hero_id from arena_entry_heroes where hero_id not in (select hero_id from heroes)`
- [ ] 영웅 상점 캡처(`09`)의 id와 인게임 이름·병종을 대조해 Settings → Catalogue →
      Heroes에 이름·병종·등급 입력 (`notes`에 "시즌 4" 기록).
- [ ] 이름 입력 후 아레나·플레이어 페이지에서 id 대신 이름이 나오는지.
- [ ] 영웅 레벨·장비 비용 표(0217, 0218)에 새 영웅이 쓰는 값이 있으면 그때 확인 —
      지금은 값을 모른다.

## 2차 패스 (시즌 3~4주차, 대략 11-30~12-07)

값이 찬 뒤에야 닫히는 질문. `04`, `05`, `07`을 다시 찍는다.

- [ ] Soulstone 순위: 값이 있고 페이징되는지, 개인별 기여가 귀속되는지.
- [ ] 건물 레벨·상태가 채워진 뒤의 모양.
- [ ] **Glory War**(웹 기준 시즌 22일째 ≈ 12-01)가 열리면 그 화면과 보고서. 규칙이 웹에
      없다 — 이벤트로 취급해 `capture-sweep.md`의 판정 절차를 따른다.
- [ ] 결승(≈ 1-05)과 정산(`settle_at`) 보드.

## 캡처가 온 다음 순서

1. 새 명령을 `capture-sweep.md` 방식으로 **판정**한다 (UID가 있다고 승격이 아니다).
2. 승격은 **한 PR에 파서 하나** + 정제된 픽스처 + 재생 테스트 (NFR-009).
3. 시즌 3 전용 문구는 그때 시즌별 라벨로 분리한다: `TERMS.season`('Season 3'),
   `seasonScore`('Coal Production'), `seasonForce`('Influence'), 그리고 보드 아래 주석
   ("Coal production and influence are the game's own season figures").
4. 건물은 `new-season.md` 3단계(Seen, not named)로 이름을 붙인다.
5. 판정만 하고 승격을 안 한 명령은 **미완으로 명시**한다 (`al.battle.rank.info` 선례).
