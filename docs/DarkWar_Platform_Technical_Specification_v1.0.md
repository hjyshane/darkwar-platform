---
title: "DarkWar Intelligence Platform"
subtitle: "제품 요구사항 및 기술 명세서 (Product & Technical Specification)"
date: "2026-07-28"
lang: ko-KR
---

<!-- pagebreak -->

# 목차

- 문서 관리
- 1. Executive Summary
- 2. 제품 비전과 성공 기준
- 3. 범위와 비범위
- 4. 설계 원칙
- 5. 현재 기준선과 증거 상태
- 6. 사용자와 권한 모델
- 7. 기능 요구사항
- 8. 비기능 요구사항
- 9. Target Architecture
- 10. 컴포넌트 명세
- 11. Data Architecture
- 12. Activity Engine 상세 설계
- 13. Event Framework
- 14. Season Framework와 Map Crawler
- 15. Battle Report Pipeline
- 16. API와 Event Contract
- 17. Security, Privacy, Threat Model
- 18. Reliability, Operations, Observability
- 19. 개발 프로세스와 Stage Gates
- 20. Test Strategy
- 21. Deployment Environments
- 22. v0.4.1 Migration Plan
- 23. Delivery Roadmap
- 24. Definition of Ready와 Definition of Done
- 25. 주요 리스크와 완화
- 26. 미해결 결정과 Capture Backlog
- Appendix A-E
- References

<!-- pagebreak -->

# 문서 관리

| 항목 | 값 |
|---|---|
| 문서 ID | DWIP-SPEC-001 |
| 버전 | 1.0 Draft |
| 기준일 | 2026-07-28 |
| 대상 서버 | Dark War Survival 서버군 577-584 (현재 8개 서버, 시즌 서버 병합에 따라 12/16/32/64개로 확장 가능) |
| 기준 프로토타입 | DarkWar Tracker v0.4.1 |
| 문서 목적 | 실제 제품 개발, 검증, 배포, 운영을 위한 단일 기준 문서 |
| 사용 범위 | 개인 프로젝트, 완전 비공개(non-commercial). 저자 본인이 속한 서버군(577-584, 향후 확장) 연맹 운영 목적으로만 사용하며 외부 배포·판매 없음 |
| 주요 독자 | 1인 개발자(기획/개발/운영 겸임), AI 코딩 어시스턴트와 협업하여 구현 |
| 상태 | 설계 승인 전 초안 |

## 변경 이력

| 버전 | 일자 | 변경 내용 |
|---|---|---|
| 1.0 Draft | 2026-07-28 | 제품 비전, 수집 플랫폼, Supabase, Discord Activity/Web, Activity Engine, 이벤트·시즌·전투 리포트 확장 구조를 통합 |

## 규범 용어

- **MUST**: 구현 또는 운영에서 반드시 지켜야 하는 요구사항
- **SHOULD**: 특별한 사유가 없다면 지켜야 하는 요구사항
- **MAY**: 선택적으로 구현할 수 있는 요구사항
- **확정(Confirmed)**: 캡처, 현재 코드 또는 실제 데이터로 검증된 사실
- **가설(Hypothesis)**: 기술적으로 가능하지만 아직 캡처로 검증하지 않은 사항
- **제안(Proposed)**: 제품 설계를 위한 권장 정책 또는 기본값

# 1. Executive Summary

본 제품의 목적은 Dark War Survival 서버군 577-584(향후 시즌 병합에 따라 확장 가능)의 플레이어, 연맹, 아레나, 이벤트, 시즌 건물, 전투 리포트 정보를 수집하고, 이를 **활동 측정(Activity Measurement)**이라는 하나의 분석 체계로 통합하는 것이다.

제품은 다음 세 층으로 구성한다.

1. **수집 Edge**: 서버 580 소속 별도 수집 계정과 BlueStacks 인스턴스를 사용하여 공식 게임 클라이언트가 주고받는 SmartFox 트래픽을 passive하게 관찰하고, 필요한 경우 공식 UI를 ADB로 순회한다. 서버 580은 577-584 서버군에 속해 있어 cross-server 랭킹/이벤트를 통해 서버군 전체 데이터가 함께 관찰된다.
2. **Cloud Control Plane**: 로컬 SQLite를 내구성 있는 edge buffer로 유지하면서 Supabase PostgreSQL을 중앙 System of Record로 사용한다. Auth, RLS, Realtime, Storage, Queues, Edge Functions를 동일 프로젝트 안에서 사용한다.
3. **공통 제품 UI**: Discord Activity와 일반 웹 페이지가 동일한 프런트엔드 컴포넌트, 동일한 데이터 모델, 동일한 권한 체계를 사용한다.

최종 제품의 핵심은 단순 랭킹 뷰어가 아니다. 접속, 성장, 연맹 기여, 이벤트 참여, 전투 활동, 경쟁 활동, 시즌 생산을 원자적 활동 사실(`activity_facts`)로 저장하고, 버전이 관리되는 규칙으로 분야별 점수, 데이터 커버리지, 신뢰도, 주간·월간·시즌 활동 프로필을 생성한다.

본 제품은 상업적 서비스가 아니라 저자 본인이 서버군(577-584, 향후 확장)에서 속한 연맹을 운영하기 위한 개인용 도구다. 완전히 비공개로 사용하며 외부에 공개하거나 판매하지 않는다.

본 문서는 제품을 실제로 만들기 위한 요구사항, 데이터 계약, 아키텍처, 개발 단계, 테스트 게이트, 보안 정책, 운영 절차 및 출시 승인 기준을 정의한다.

# 2. 제품 비전과 성공 기준

## 2.1 제품 비전

> 서버군(577-584, 향후 확장)과 연맹의 활동을 객관적이고 설명 가능한 데이터로 관찰하고, Discord와 웹에서 동일하게 사용할 수 있는 확장형 운영·분석 플랫폼을 제공한다.

## 2.2 핵심 사용자 가치

- 연맹 운영자는 누가 접속하고, 성장하고, 이벤트와 시즌에 기여하는지 근거와 함께 확인한다.
- 일반 유저는 자신의 성장, 아레나, 이벤트, 전투 리포트 분석을 확인한다.
- 관리자는 새로운 이벤트와 시즌을 전체 코드 수정 없이 adapter/config로 추가한다.
- 수집용 계정이 별도로 작동하므로 본계정 플레이를 방해하지 않는다.
- Discord Activity와 웹이 같은 데이터를 사용하므로 한 화면의 변경이 다른 화면에 즉시 반영된다.

## 2.3 제품 성공 지표

| 지표 | 목표 |
|---|---|
| 본계정 방해 | 0건: 자동화는 수집용 인스턴스만 제어 |
| CBFW 멤버 주간 데이터 커버리지 | 90% 이상 |
| 로컬 commit 후 Supabase 반영 지연 | p95 30초 이하 |
| Supabase commit 후 UI 반영 지연 | p95 10초 이하 |
| 중복 snapshot | 논리적 중복 0건: idempotent upsert |
| 주간 baseline 생성 | 월요일 02:05 UTC 이후 자동 완료 또는 명확한 실패 상태 |
| 신규 유사 이벤트 추가 | 설정/매핑 중심, core 코드 변경 최소화 |
| 활동 점수 설명 가능성 | 모든 점수에서 원본 metric과 scoring version 추적 가능 |
| 누락 데이터 오판 | 미관측을 비활동 0점으로 처리하지 않음 |

# 3. 범위와 비범위

## 3.1 In Scope

- 수집용 580 계정 기반 near-real-time 수집
- 플레이어, 연맹, 아레나, 랭킹, 성장 이력
- Discord Activity 및 일반 웹 대시보드
- Supabase 중앙 데이터 저장·인증·권한·Realtime
- Activity Engine 및 버전 관리 점수 규칙
- 이벤트 자동 발견, 기간, 보상, 랭킹, 대결 구도
- 시즌 자동 발견, 시즌 건물, 지도 스캔, 생산·연맹 기여
- 전투 리포트 수신, 분석, 데이터 축적, 게임 내 회신
- 수동 및 예약 refresh jobs
- 운영 상태, audit log, 오류 복구, 데이터 export

## 3.2 Out of Scope

- 게임 로그인 세션 토큰 추출·복제 또는 재사용
- 라이브 SmartFox 연결에 임의 패킷 주입
- 인증 우회, anti-cheat 회피, 클라이언트 무결성 우회
- 게임 계정 비밀번호를 Supabase 또는 앱 DB에 저장
- 관측되지 않은 개인 활동을 임의 추정하여 확정값으로 표시
- 활동 점수를 단독 징계 기준으로 사용하는 자동 의사결정
- 공개되지 않은 타 연맹의 실제 접속 상태를 사실처럼 표시

# 4. 설계 원칙

1. **Official-client-first**: 공식 게임 클라이언트와 공식 UI를 사용한다.
2. **Passive capture first**: 데이터는 가능한 한 클라이언트 응답을 수동으로 관찰하여 저장한다.
3. **Dedicated account isolation**: 본계정과 수집 계정의 BlueStacks 인스턴스, ADB serial, 프로세스 제어를 분리한다.
4. **Raw / normalized / derived separation**: 원본, 정규화 snapshot, 파생 활동 점수를 분리한다.
5. **Idempotent ingestion**: 같은 데이터가 반복 수신되어도 논리적 결과는 한 번만 반영한다.
6. **Version everything**: parser, adapter, analyzer, scoring profile, schema migration을 버전 관리한다.
7. **Missing is not zero**: 미관측은 비활동이나 0점이 아니다.
8. **Explainability**: 종합점수는 분야별 점수, metric, 원본 snapshot까지 역추적 가능해야 한다.
9. **Configuration over hard-coding**: 새 이벤트·시즌은 가능한 한 설정과 관리자 매핑으로 추가한다.
10. **Cloud does not inbound-control the PC**: 로컬 Worker가 Supabase로 outbound 연결하여 작업을 pull한다.
11. **Least privilege**: 웹 클라이언트에 privileged secret을 노출하지 않는다.
12. **Fail locally, recover safely**: 네트워크 장애가 발생해도 SQLite에 수집 결과가 남아야 한다.

# 5. 현재 기준선과 증거 상태

## 5.1 현재 프로토타입 v0.4.1

현재 구현에는 다음이 포함되어 있다.

- Npcap/Scapy 기반 TCP 8680 passive capture
- SmartFox frame reassembly 및 SFSObject decode
- SQLite WAL 저장
- `alliance.rank`, `get.al.info`, `al.rank`, `server.rank`, `get.new.user.info`, `user.get.arena.info` 계열 parsing
- 플레이어 성장, 아레나 주간 snapshot, 연맹 변화 이력
- 수동/주간 refresh queue와 idle-aware ADB workflow
- 로컬 FastAPI 기반 Discord Activity API
- Discord Activity SPA 및 Player Growth 화면

현재 구현은 향후 제품의 검증된 프로토콜 parser와 migration source로 활용하되, 장기 프런트엔드와 cloud data layer는 본 문서의 target architecture로 재구성한다.

## 5.2 확정된 프로토콜 사실

| 항목 | 상태 | 근거 |
|---|---|---|
| SmartFox TCP port 8680 사용 | 확정 | 다수 PCAP |
| 압축/비압축 SmartFox frame | 확정 | decoder 및 offline replay |
| 공식 로그인은 UID + session/signature 기반 | 확정 | `darkwar_loading.pcapng` |
| 로그인 전 `login-sign.omnilojo.app` HTTPS 통신 | 확정 | 로딩 캡처 |
| 로그인 직후 `user.get.arena.info` 자동 요청 | 확정 | 로딩 캡처 |
| `server.rank` cross-server player ranking | 확정 | player rank 캡처 |
| `alliance.rank` local/cross-server alliance ranking | 확정 | alliance captures |
| `al.rank` 연맹 멤버 전체 응답 | 확정 | CBFW/LovE captures |
| 자기 연맹 presence는 의미 있고 타 연맹은 redacted 가능 | 확정 | 응답 비교 |
| 플레이어 상세 power 6종 합계가 total power와 일치 | 확정 | 2개 상세 프로필 사례 |

## 5.3 아직 캡처가 필요한 항목

| 항목 | 상태 | 필요한 증거 |
|---|---|---|
| 전투 리포트 공유 수신 command | 미확정 | 공유 → 수신 PCAP |
| 리포트 상세 payload 또는 report ID fetch | 미확정 | 리포트 열기 PCAP |
| 게임 내 개인 메시지 전송 command/확인 응답 | 미확정 | 답장 전송 PCAP |
| 이벤트 공지/탭/메일 command | 미확정 | 공지 전후·탭·메일 PCAP |
| A/B team/camp matchup authoritative source | 미확정 | 이벤트 탭과 메일 비교 |
| 시즌 지도 viewport object payload | 미확정 | map pan scan PCAP |
| 시즌 건물 production fields | 미확정 | 상세·수령·기여 PCAP |
| 개인별 시즌 기여 귀속 가능 여부 | 미확정 | player contribution 화면/응답 |

미확정 항목은 parser가 준비되기 전까지 raw observation으로 저장하며, 제품 UI에서 확정값으로 표시하지 않는다.

# 6. 사용자와 권한 모델

## 6.1 사용자 역할

| 역할 | 주요 기능 |
|---|---|
| Viewer | 공개 랭킹, 아레나, 공개 플레이어 성장 조회 |
| Member | 본인 연결 계정, 본인이 제출한 전투 리포트, 연맹 내부 허용 데이터 조회 |
| Officer | 연맹 활동, 이벤트 참여, 위험 멤버, 시즌 기여 분석 |
| Admin | refresh, tracked entities, adapter 매핑, scoring rules, 사용자 권한 |
| Collector Service | 수집 데이터 sync, job pull, 결과 업데이트 |
| Analyst Service | 전투 리포트 분석, activity aggregation, 재계산 |

## 6.2 게임 UID와 Discord identity 연결

게임 비밀번호를 받지 않고 일회용 코드로 연결한다.

1. 웹/Discord에서 연결 코드 생성
2. 유저가 게임 내에서 수집 계정에 코드를 전송
3. Collector가 발신자 `game_uid`와 코드를 매칭
4. `game_identity_links`에 verified relation 저장
5. 코드 만료 및 1회 사용 처리

# 7. 기능 요구사항

## 7.1 수집 및 동기화

| ID | 요구사항 |
|---|---|
| FR-COL-001 | 시스템은 수집용 BlueStacks instance만 식별하고 제어해야 한다. |
| FR-COL-002 | TCP 8680 stream을 재조립하고 SmartFox compressed/uncompressed frame을 decode해야 한다. |
| FR-COL-003 | 대상 command가 아니거나 unknown payload여도 collector가 중단되지 않아야 한다. |
| FR-COL-004 | 모든 수집 결과는 Supabase 전송 전에 SQLite transaction으로 commit되어야 한다. |
| FR-COL-005 | sync outbox는 재시도 가능하며 idempotency key를 가져야 한다. |
| FR-COL-006 | 로컬 네트워크 단절 시 수집을 계속하고, 복구 후 순서대로 sync해야 한다. |
| FR-COL-007 | collector heartbeat, last packet, last sync, queue depth를 cloud에 보고해야 한다. |
| FR-COL-008 | unknown command와 schema fingerprint를 discovery inbox에 저장해야 한다. |
| FR-COL-009 | UI automation은 rate limit, timeout, retry, kill switch를 지원해야 한다. |
| FR-COL-010 | 본계정 process/ADB serial에 대한 종료·재시작 명령을 금지해야 한다. |

## 7.2 플레이어, 연맹, 아레나

| ID | 요구사항 |
|---|---|
| FR-CORE-001 | 플레이어 UID를 안정적 식별자로 사용하고 이름 변경 이력을 보존해야 한다. |
| FR-CORE-002 | 연맹 기본정보, 멤버 snapshot, 가입/탈퇴, R등급, HQ, power, kills를 저장해야 한다. |
| FR-CORE-003 | 타 연맹 redacted presence를 실제 접속 상태와 구분해야 한다. |
| FR-CORE-004 | 플레이어 상세 power 6종과 총합 검증 결과를 저장해야 한다. |
| FR-CORE-005 | Arena weekly match와 daily ranking snapshot을 분리해야 한다. |
| FR-CORE-006 | 월요일 02:00 UTC 리셋을 주간 기준으로 사용하고 02:05 baseline job을 지원해야 한다. |
| FR-CORE-007 | 성장 이력은 7일, 30일, 이번 reset week, 전체 기간으로 조회 가능해야 한다. |
| FR-CORE-008 | 동일 시간대 다중 source snapshot은 session window로 병합할 수 있어야 한다. |

## 7.3 Activity Engine

| ID | 요구사항 |
|---|---|
| FR-ACT-001 | 접속, 성장, 연맹 기여, 이벤트, 전투, 경쟁 활동을 공통 `activity_facts`로 저장해야 한다. |
| FR-ACT-002 | 원점수와 정규화 점수, 계산 버전, 데이터 source를 분리해야 한다. |
| FR-ACT-003 | 분야별 점수와 overall score를 함께 제공해야 한다. |
| FR-ACT-004 | metric 미관측 시 0점으로 대체하지 않아야 한다. |
| FR-ACT-005 | coverage와 confidence를 score와 별도로 계산해야 한다. |
| FR-ACT-006 | scoring profile은 versioned, effective-dated, 재계산 가능해야 한다. |
| FR-ACT-007 | 주간·월간·시즌 집계를 동일 facts에서 생성해야 한다. |
| FR-ACT-008 | score의 모든 구성 metric과 원본 snapshot을 drill-down할 수 있어야 한다. |
| FR-ACT-009 | 활동 상태(Active, Returning, Declining, At risk 등)는 규칙과 근거를 표시해야 한다. |
| FR-ACT-010 | overall score는 coverage threshold 미달 시 표시하지 않거나 Low confidence로 명확히 표시해야 한다. |

## 7.4 이벤트 프레임워크

| ID | 요구사항 |
|---|---|
| FR-EVT-001 | 이벤트 공지, 준비, 진행, 종료, 정산 lifecycle을 모델링해야 한다. |
| FR-EVT-002 | 개인, 연맹 내부, 서버 플레이어, 서버 연맹, cross-server, team/camp, matchup scope를 지원해야 한다. |
| FR-EVT-003 | 이벤트 정보가 탭, 초기 login payload, 메일 중 어느 source에서 왔는지 기록해야 한다. |
| FR-EVT-004 | rank snapshot을 시간대별로 보존하고 최종 ranking을 별도 표시해야 한다. |
| FR-EVT-005 | 보상 tier와 목표 달성률을 저장해야 한다. |
| FR-EVT-006 | unknown event는 관리자 Discovery UI에 표시해야 한다. |
| FR-EVT-007 | 구조가 유사한 신규 이벤트는 config mapping만으로 추가 가능해야 한다. |
| FR-EVT-008 | 활성 phase에 따라 수집 주기를 동적으로 변경해야 한다. |

## 7.5 시즌 및 지도 스캔

| ID | 요구사항 |
|---|---|
| FR-SEA-001 | 신규 season/event ID와 신규 map object type을 자동 발견해야 한다. |
| FR-SEA-002 | Season Core와 season-specific adapter를 분리해야 한다. |
| FR-SEA-003 | map scan은 월드 좌표와 object ID를 기준으로 중복 제거해야 한다. |
| FR-SEA-004 | scan coverage, 실패 tile, 마지막 확인 시각을 저장해야 한다. |
| FR-SEA-005 | discovery scan과 detail scan을 분리해야 한다. |
| FR-SEA-006 | 건물 소유권, level, state, production rate, stored amount, contribution을 가능한 범위에서 추적해야 한다. |
| FR-SEA-007 | observed, calculated, estimated measurement type을 구분해야 한다. |
| FR-SEA-008 | 개인 귀속 정보가 없으면 연맹 생산량을 개인에게 임의 배분하지 않아야 한다. |
| FR-SEA-009 | 전쟁·점령 시간대에는 adaptive scan frequency를 지원해야 한다. |
| FR-SEA-010 | 새 시즌은 template clone + field mapping + adapter version으로 활성화해야 한다. |

## 7.6 전투 리포트

| ID | 요구사항 |
|---|---|
| FR-BR-001 | 수집 계정으로 공유된 리포트를 발신자 UID와 함께 감지해야 한다. |
| FR-BR-002 | report ID만 제공될 경우 공식 UI를 통해 상세를 열고 payload를 수집해야 한다. |
| FR-BR-003 | raw report, normalized report, analysis를 분리 저장해야 한다. |
| FR-BR-004 | analyzer version과 confidence를 저장해야 한다. |
| FR-BR-005 | 결과는 게임 내 발신자, Discord, 웹 중 허용된 채널로 전달할 수 있어야 한다. |
| FR-BR-006 | 게임 내 회신은 공식 UI automation을 사용하고 전송 성공을 확인해야 한다. |
| FR-BR-007 | 긴 분석은 짧은 게임 메시지 + 인증된 상세 링크 형식으로 전달해야 한다. |
| FR-BR-008 | 리포트의 공개·연맹 집계·익명 모델 학습 사용 범위를 유저가 선택할 수 있어야 한다. |
| FR-BR-009 | 중복 공유된 동일 report는 한 번만 분석해야 한다. |

## 7.7 Discord Activity와 Web

| ID | 요구사항 |
|---|---|
| FR-UI-001 | Discord Activity와 웹은 동일한 shared UI package와 API contract를 사용해야 한다. |
| FR-UI-002 | 실행 context에 따라 Discord SDK 인증 또는 Supabase Discord Auth를 사용해야 한다. |
| FR-UI-003 | Discord client에서 전달한 identity를 privileged 권한 판단의 유일한 근거로 신뢰하지 않아야 한다. |
| FR-UI-004 | Overview, Arena, Rankings, Alliances, Players, Activity, Events, Season, Battle Reports, Admin 탭을 제공해야 한다. |
| FR-UI-005 | 새 snapshot이 저장되면 관련 panel만 refetch해야 한다. |
| FR-UI-006 | desktop, Discord mobile iframe, 일반 mobile browser에서 사용할 수 있어야 한다. |
| FR-UI-007 | 모든 중요 수치에 source timestamp와 freshness를 표시해야 한다. |
| FR-UI-008 | stale, partial, redacted, estimated, insufficient data를 시각적으로 구분해야 한다. |

## 7.8 운영 및 관리자

| ID | 요구사항 |
|---|---|
| FR-OPS-001 | Collector health, sync backlog, last packet, last successful workflow를 표시해야 한다. |
| FR-OPS-002 | refresh job을 생성·취소·재시도할 수 있어야 한다. |
| FR-OPS-003 | parser/adapter/scoring configuration 변경은 audit log를 남겨야 한다. |
| FR-OPS-004 | unknown schema와 unmapped field를 관리자 inbox로 관리해야 한다. |
| FR-OPS-005 | 데이터 재계산, replay, backfill을 production write와 분리하여 실행해야 한다. |
| FR-OPS-006 | 긴급 kill switch로 모든 UI automation을 즉시 중단할 수 있어야 한다. |

# 8. 비기능 요구사항

| ID | 영역 | 요구사항 |
|---|---|---|
| NFR-001 | 보안 | Service/secret key는 browser bundle에 포함되어서는 안 된다. |
| NFR-002 | 권한 | exposed schema의 모든 사용자 데이터 테이블에 RLS를 적용한다. |
| NFR-003 | 신뢰성 | 로컬 commit된 snapshot의 RPO는 0을 목표로 한다. |
| NFR-004 | 복구 | cloud 또는 인터넷 장애 후 자동 재동기화가 가능해야 한다. |
| NFR-005 | 성능 | 일반 dashboard summary p95 응답 2초 이하를 목표로 한다. |
| NFR-006 | 지연 | 수집 후 UI 반영 end-to-end p95 40초 이하를 목표로 한다. |
| NFR-007 | 확장성 | 현재 서버군 577-584(8개 서버) 규모를 기준으로 하되, 시즌 서버 병합으로 12/16/32/64개 서버군까지 늘어나는 상황을 `server_id` 기반 식별자·파티셔닝으로 schema 변경 없이 수용한다. 상업적 멀티테넌시(여러 독립 고객) 확장은 고려하지 않는다. Realtime 동시 접속과 Activity Engine 표시 대상은 본인 연맹(≤100명) 중심으로 설계한다. |
| NFR-008 | 유지보수 | 신규 event/season adapter가 core collector를 수정하지 않고 추가 가능해야 한다. |
| NFR-009 | 테스트 | 모든 parser는 PCAP replay fixture와 contract test를 가져야 한다. |
| NFR-010 | 감사 | 데이터·권한·scoring rule 변경에 actor, time, before/after를 기록한다. |
| NFR-011 | 접근성 | 키보드 조작, 명확한 label, 표의 header, 색상 외 상태 표현을 제공한다. |
| NFR-012 | 국제화 | 저장 시간은 UTC, 표시 timezone은 사용자 설정을 사용한다. |
| NFR-013 | 개인정보 | 유저 제출 리포트의 visibility와 사용 동의를 보존한다. |
| NFR-014 | 배포 | dev, staging, production 환경을 분리한다. |
| NFR-015 | 관측성 | structured log, metric, trace correlation ID를 제공한다. |

# 9. Target Architecture

Discord Activities는 Discord desktop, mobile, web에서 iframe으로 실행되는 웹 앱이며 Embedded App SDK가 Discord client와의 통신을 담당한다.[^D1] Activity는 SDK의 `ready`, `authorize`, `authenticate` lifecycle을 따라야 한다.[^D2] Discord client가 전달한 user/channel 정보는 변조 가능성을 가정하고 서버에서 OAuth token을 사용해 검증해야 한다.[^D3]

Supabase는 PostgreSQL을 중심으로 Auth, RLS, Realtime, Storage, Queues, Edge Functions를 제공한다. Browser에서 직접 접근하는 exposed schema에는 RLS가 필수다.[^S2] 동시 접속자는 본인 연맹 규모(최대 100명 수준)로 제한되므로 Postgres Changes만으로 충분하며, Broadcast 전환은 고려하지 않는다.[^S1]

![시스템 목표 아키텍처](/mnt/data/darkwar_spec_assets/architecture.png)

## 9.1 Architecture Decision Records

| ADR | 결정 | 이유 |
|---|---|---|
| ADR-001 | Supabase PostgreSQL을 중앙 System of Record로 사용 | Discord와 웹의 동일 데이터, Auth/RLS/Realtime 통합 |
| ADR-002 | SQLite를 edge buffer/outbox로 유지 | 인터넷 장애와 cloud 장애 중 데이터 유실 방지 |
| ADR-003 | Discord와 웹은 하나의 TypeScript shared SPA 사용 | 기능 중복 및 UI drift 방지 |
| ADR-004 | Collector는 Python 3.12 service로 유지 | 기존 protocol decoder와 Windows/ADB 자산 재사용 |
| ADR-005 | 직접 packet injection 금지 | 본계정/수집계정 안정성 및 보안 경계 유지 |
| ADR-006 | Activity scoring은 versioned derived layer | 원본 보존, 공정성, 재계산 가능성 |
| ADR-007 | Adapter registry + schema discovery | 신규 이벤트·시즌 추가 비용 최소화 |
| ADR-008 | Privileged mutation은 Edge Function 또는 service worker만 수행 | browser secret 노출 방지 및 중앙 권한 검증 |
| ADR-009 | Queue 기반 비동기 작업 | refresh, analysis, delivery의 재시도와 상태 추적 |

# 10. 컴포넌트 명세

## 10.1 Collector Agent

**책임**

- interface capture, TCP stream reassembly, SmartFox decode
- command routing, parser 실행, raw observation 저장
- ADB workflow 실행 및 응답 verification
- local SQLite transaction 및 outbox 생성
- collector heartbeat와 오류 상태 보고

**프로세스 분리**

```text
collector-capture     패킷 캡처와 decode
collector-router      command → parser dispatch
collector-ui-worker   수집용 BlueStacks ADB workflow
collector-sync        SQLite outbox → Supabase
collector-job-worker  Supabase queue → local action
```

capture process가 UI workflow 또는 cloud sync 실패로 중단되지 않도록 별도 process 또는 supervisor를 사용한다.

## 10.2 Local SQLite

SQLite는 cloud의 축소판이 아니라 **edge journal**이다.

필수 local tables:

- `raw_observations`
- `normalized_snapshots`
- `sync_outbox`
- `local_jobs`
- `workflow_runs`
- `collector_state`
- 기존 v0.4.1 compatibility tables

`sync_outbox`는 다음 필드를 가져야 한다.

```text
id, event_type, entity_key, payload_json, idempotency_key,
created_at, attempt_count, next_attempt_at, status, last_error
```

## 10.3 Sync Worker

- at-least-once delivery를 사용한다.
- Supabase 측 unique constraint와 upsert로 logical exactly-once effect를 보장한다.
- retry는 exponential backoff + maximum interval을 사용한다.
- 영구 실패는 dead-letter 상태로 이동하고 관리자에게 표시한다.
- payload schema version을 포함한다.

## 10.4 Supabase Control Plane

### PostgreSQL

- authoritative normalized data
- activity facts 및 집계
- RLS와 views/RPC
- configuration 및 audit

### Auth

일반 웹은 Supabase Discord provider를 사용한다. Supabase는 Discord OAuth provider와 callback 구성을 공식 지원한다.[^S3]

Discord Activity는 Embedded App SDK OAuth code를 server-side exchange한 뒤, 검증된 Discord user ID를 application identity와 연결한다. Activity용 identity exchange는 Edge Function 또는 dedicated API에서 수행한다.

### Realtime

초기에는 다음 작은 event tables 또는 notification table만 publication에 포함한다.

- `data_change_notifications`
- `refresh_jobs`
- `collector_heartbeats`
- `battle_report_delivery_jobs`

대용량 snapshot table 전체를 무차별 구독하지 않는다.

### Queues

Supabase Queues/PGMQ는 durable background task와 visibility timeout을 지원한다.[^S6]

권장 queues:

- `refresh_jobs`
- `report_analysis`
- `in_game_delivery`
- `event_discovery`
- `season_scan`
- `recompute_activity`

### Edge Functions

Edge Functions는 사용자 인증이 필요한 command API, Discord identity exchange, link code 생성, refresh 요청 생성, privileged export를 처리한다. 긴 실행이나 BlueStacks 작업은 Edge Function 안에서 수행하지 않고 local worker queue로 넘긴다. Supabase는 Edge Functions를 짧고 idempotent하게 설계하고 long-running work를 background worker로 이동하도록 권장한다.[^S4]

### Secrets

publishable key만 browser에 포함한다. secret/service-role key는 Edge Function과 collector 환경변수에만 둔다. Supabase secret key는 RLS를 우회하므로 browser에 노출해서는 안 된다.[^S5]

## 10.5 Shared Frontend

장기 target은 TypeScript + React + Vite 기반 shared SPA다.

```text
apps/dashboard
  src/app-shell
  src/features/overview
  src/features/players
  src/features/activity
  src/features/events
  src/features/seasons
  src/features/battle-reports
  src/features/admin
packages/ui
packages/api-client
packages/shared-types
packages/scoring-explain
```

Runtime adapter:

- `DiscordRuntimeAdapter`: Discord SDK initialization, OAuth, locale, external link
- `WebRuntimeAdapter`: Supabase Auth session, browser navigation

feature component는 runtime을 직접 참조하지 않고 공통 interface만 사용한다.

# 11. Data Architecture

## 11.1 데이터 계층

1. **Raw**: 원본 decoded payload, PCAP reference, screenshot/report attachment
2. **Normalized**: player, alliance, arena, event, season, battle domain snapshot
3. **Facts**: activity measurement에 사용되는 원자적 사실
4. **Derived**: score, trend, status, recommendation
5. **Read Models**: UI용 materialized view 또는 RPC response

Derived data는 raw/normalized data를 대체하지 않는다.

## 11.2 시간과 식별자

- 모든 timestamp는 `timestamptz` UTC 저장
- 게임 reset 기준은 02:00 UTC
- 주간 baseline은 월요일 02:05 UTC 이후 첫 정상 snapshot
- internal PK는 UUID
- game entity는 `(server_id, external_id)` unique
- 동일 command의 snapshot idempotency key는 다음 조합을 기본으로 한다.

```text
collector_id + command + entity_scope + server_time_bucket + payload_hash
```

## 11.3 핵심 테이블 그룹

### Identity 및 core

| 테이블 | 목적 |
|---|---|
| `app_users` | Supabase user와 application role |
| `game_identity_links` | Discord/Supabase user와 game UID 연결 |
| `players` | 안정적 player identity와 current summary |
| `player_names` | 닉네임 이력 |
| `alliances` | alliance identity와 current summary |
| `alliance_names` | 이름/code 변경 이력 |

### Snapshots

| 테이블 | 목적 |
|---|---|
| `player_snapshots` | power, HQ, kills, alliance 등 일반 이력 |
| `player_detail_snapshots` | 6종 power, battle stats |
| `alliance_snapshots` | alliance power, member count, leader |
| `alliance_member_snapshots` | 특정 시점 roster |
| `arena_matches` | 주간 matchup |
| `arena_snapshots` | 일별/수집 시점 ranking header |
| `arena_entries` | player rank, score, defense power |

### Activity

| 테이블 | 목적 |
|---|---|
| `activity_facts` | 원자적 측정 사실 |
| `metric_registry` | metric 정의, unit, domain, source |
| `scoring_profiles` | 유효기간과 버전을 가진 점수 profile |
| `scoring_weights` | metric/domain weight 및 normalization |
| `activity_scores` | 기간별 계산 결과 |
| `activity_statuses` | 상태 분류 및 근거 |
| `activity_recompute_runs` | 재계산 trace |

### Event

| 테이블 | 목적 |
|---|---|
| `event_definitions` | 반복되는 event type |
| `event_instances` | 실제 개최 회차 |
| `event_rank_snapshots` | scope별 랭킹 header |
| `event_rank_entries` | player/alliance/team 점수 |
| `event_reward_tiers` | 보상 기준 |
| `event_teams` | team/camp |
| `event_matchups` | A/B 또는 server/alliance 대결 |
| `event_announcements` | tab/mail/init source |

### Season

| 테이블 | 목적 |
|---|---|
| `season_definitions` | season type/template |
| `season_instances` | 실제 시즌 |
| `season_buildings` | building identity와 좌표 |
| `season_building_snapshots` | owner, level, state, production |
| `season_production_intervals` | interval production/contribution |
| `season_alliance_contributions` | alliance total snapshot |
| `map_scan_runs` | coverage와 실행 상태 |
| `map_scan_tiles` | tile별 성공/실패 및 object count |

### Battle Reports

| 테이블 | 목적 |
|---|---|
| `battle_report_ingests` | 수신 message와 raw reference |
| `battle_reports` | normalized battle header |
| `battle_report_sides` | attacker/defender |
| `battle_report_heroes` | hero 구성·position·stats |
| `battle_report_troops` | troop 및 losses |
| `battle_report_analyses` | versioned analysis |
| `battle_report_delivery_jobs` | 게임/Discord/Web 전달 상태 |
| `report_data_consents` | visibility와 분석 사용 동의 |

### Operations

| 테이블 | 목적 |
|---|---|
| `collectors` | collector instance registry |
| `collector_heartbeats` | health/time/version |
| `refresh_jobs` | cloud command job |
| `workflow_runs` | local execution result |
| `adapter_registry` | event/season/report adapter version |
| `schema_observations` | unknown command/field fingerprint |
| `audit_logs` | privileged 변경 trace |
| `data_change_notifications` | lightweight realtime signal |

## 11.4 Index와 partition 정책

- snapshot/facts tables는 `captured_at` 또는 `occurred_at` 기준 월별 partition을 검토한다.
- 서버군이 577-584(8개)에서 12/16/32/64개로 늘어날 수 있으므로, player/alliance 관련 조회 index에는 `server_id`를 선두 컬럼으로 포함한다.
- 주요 index:
  - `(player_id, captured_at desc)`
  - `(alliance_id, captured_at desc)`
  - `(event_instance_id, scope_type, captured_at desc)`
  - `(season_instance_id, building_id, captured_at desc)`
  - `(player_id, period_type, period_start, scoring_profile_id)`
- JSONB raw metadata에는 필요한 key에만 expression index를 추가한다.

## 11.5 Retention 기본 정책

| 데이터 | 기본 보존 |
|---|---|
| PCAP 원본 | 로컬 14일, 문제 조사 시 수동 보존 |
| decoded raw payload | 90일, 이후 압축 archive 또는 삭제 |
| normalized snapshots | 장기 보존 |
| activity facts/scores | 장기 보존, scoring version 유지 |
| battle report raw | 사용자 동의와 정책에 따라 90일 이상 |
| audit logs | 최소 1년 |
| dead-letter jobs | 해결 후 90일 |

# 12. Activity Engine 상세 설계

![Activity Engine 데이터 흐름](/mnt/data/darkwar_spec_assets/activity_engine.png)

## 12.1 Activity Domains

| Domain | 예시 metric |
|---|---|
| Presence | observed online, recent seen, active days, inactivity days |
| Growth | power delta, HQ delta, kills delta, component power delta |
| Alliance Contribution | alliance event score, season production, building contribution |
| Event Participation | participation, target completion, rank percentile |
| Combat | submitted battle count, win/loss, loss efficiency, damage ratio |
| Competition | Arena participation, score change, rank percentile |

## 12.2 Activity Fact Contract

```json
{
  "fact_id": "uuid",
  "player_id": "uuid-or-null",
  "alliance_id": "uuid-or-null",
  "occurred_at": "2026-08-04T03:15:00Z",
  "activity_type": "event_contribution",
  "metric_key": "alliance_event_score",
  "value_numeric": 1845000,
  "unit": "points",
  "event_instance_id": "uuid-or-null",
  "season_instance_id": "uuid-or-null",
  "source_type": "event_rank_response",
  "source_snapshot_id": "uuid",
  "measurement_type": "observed",
  "confidence": 1.0,
  "schema_version": 1
}
```

## 12.3 Metric Registry

각 metric은 다음을 정의한다.

- key와 display name
- domain
- unit
- entity scope: player/alliance/team/building
- aggregation: sum, max, last, delta, count, distinct days
- normalization method
- recommended period
- source priority
- missing data policy
- outlier/cap policy
- minimum observation count

## 12.4 Normalization Methods

### Target Ratio

```text
score = clamp(value / target, 0, cap) × 100
```

이벤트 보상 최대 기준 또는 운영 목표에 적합하다.

### Percentile Rank

동일 이벤트 또는 동일 연맹 cohort에서 백분위를 계산한다. 절대 점수 단위가 다른 이벤트 비교에 적합하다.

### Personal Delta Percentile

개인의 이전 기준 대비 성장량을 cohort 내에서 비교한다. 절대 power가 큰 유저만 유리해지는 문제를 줄인다.

### Binary/Threshold Participation

참여 여부 또는 최소 목표 달성 여부를 반영한다.

### Recency Decay

접속 활동 등 최근성이 중요한 metric은 decay function을 적용할 수 있다. 단, decay parameter는 scoring profile에 명시한다.

## 12.5 Domain Score와 Overall Score

초기 제안 가중치:

| Domain | 초기 weight |
|---|---:|
| Presence | 15% |
| Growth | 15% |
| Alliance Contribution | 25% |
| Event Participation | 25% |
| Combat | 10% |
| Competition | 10% |

가중치는 코드에 고정하지 않는다.

관측 metric만으로 점수를 계산할 때는 다음 두 값을 동시에 계산한다.

```text
observed_score = Σ(metric_score × weight) / Σ(observed_weight)
coverage = Σ(observed_weight) / Σ(total_weight)
```

정책:

- coverage < 0.40: overall score 숨김, `Insufficient data`
- 0.40 ≤ coverage < 0.65: Low confidence
- 0.65 ≤ coverage < 0.85: Medium confidence
- coverage ≥ 0.85: High confidence

이 threshold는 configuration으로 관리한다.

## 12.6 공정성 규칙

- power 자체보다 power delta와 개인 baseline을 우선한다.
- 이벤트 원점수를 서로 직접 합산하지 않는다.
- 연맹 총생산만 보일 때 개인에게 나누어 부여하지 않는다.
- 제출하지 않은 전투 리포트는 전투 활동 0점이 아니라 미관측이다.
- 공개 타 연맹 redacted presence는 presence metric에 사용하지 않는다.
- 신규 가입자는 가입 전 기간을 분모에 포함하지 않는다.
- 휴가/면제 기간은 운영자가 기록할 수 있으며 별도 표시한다.

## 12.7 활동 상태 분류

상태는 score와 별개로 근거 기반 rule engine에서 생성한다.

- Highly active
- Active
- Consistent
- Returning
- Rapid grower
- Event specialist
- Season contributor
- Declining
- At risk
- Inactive
- Insufficient data

예: `At risk`는 3일 이상 미접속, 최근 핵심 이벤트 2회 미참여, 최근 주간 기여가 개인 4주 평균 대비 70% 감소 등의 복합 조건으로 정의할 수 있다. 모든 상태는 triggered rules를 표시한다.

## 12.8 Score Governance

- scoring change는 새 version을 생성한다.
- 과거 score를 overwrite하지 않는다.
- 변경 사유는 기록하되, 본인 연맹 운영 목적이므로 별도 승인자 프로세스는 두지 않는다.
- 필요 시 sample roster로 결과를 확인한 뒤 반영한다.
- 단일 score를 자동 제재에 사용하지 않는다.

# 13. Event Framework

## 13.1 Lifecycle

```text
announced → registration/preparation → active → ended → settled → archived
```

각 phase는 event instance에 저장하고 scheduler frequency를 결정한다.

## 13.2 Scope

- personal
- alliance_member
- server_player
- server_alliance
- cross_server_player
- cross_server_alliance
- team_player
- team_alliance
- matchup

하나의 event instance가 여러 scope를 동시에 가질 수 있다.

## 13.3 Discovery

새 command 또는 payload에서 다음 key가 발견되면 event candidate로 분류한다.

```text
activityId, eventId, rank, reward, camp, team, round,
match, score, signUp, startTime, endTime
```

schema fingerprint는 값이 아니라 key path와 type을 저장한다.

## 13.4 Adapter Interface

```text
can_handle(observation) -> confidence
parse_metadata(observation) -> EventInstancePatch
parse_ranking(observation) -> RankSnapshot
parse_rewards(observation) -> RewardTiers
parse_matchup(observation) -> MatchupPatch
emit_activity_facts(parsed) -> list[ActivityFact]
```

## 13.5 Dynamic Collection Policy

| Phase | 기본 주기(제안) |
|---|---:|
| 공지/오픈 전 | 6-24시간 |
| 시작 24시간 이내 | 1시간 |
| active | 5-10분 |
| 종료 1시간 전 | 2-5분 |
| 종료 직후 | 즉시 1회 + 안정화 후 1회 |
| settled | 최종 1회 후 중단 |

# 14. Season Framework와 Map Crawler

![확장형 Adapter 구조](/mnt/data/darkwar_spec_assets/extensibility.png)

## 14.1 Season Adapter

공통 Core:

- season discovery
- scheduler
- map scan coordinator
- object deduplication
- production interval calculation
- activity fact emitter

season별 설정:

- active event IDs
- building type IDs
- resource types
- map bounds와 zoom
- payload field mapping
- production rules
- special ranking rules

## 14.2 Map Scan Modes

### Discovery Scan

전체 맵을 지그재그 또는 tile grid로 이동하여 object ID, type, 좌표, owner, level, state를 수집한다.

### Detail Scan

다음 대상만 연다.

- 우리 연맹 건물
- 신규 object
- owner/level/state 변경 object
- production snapshot 시간이 된 object
- 명시적 tracked building

## 14.3 Network-first Policy

우선순위:

1. viewport object batch payload
2. building detail payload
3. alliance season aggregate payload
4. 마지막 수단으로 제한적 이미지 판독

맵을 렌더링하려면 클라이언트가 object data를 받아야 한다는 기술적 추론은 가능하지만, 실제 field는 PCAP으로 검증해야 한다.

## 14.4 Production Measurement

- `observed`: 서버가 누적량/생산속도/기여량 직접 제공
- `calculated`: 두 관측값의 차이 또는 rate×time 계산
- `estimated`: 건물 template와 ownership로 추정

UI와 score는 세 유형을 명확히 구분한다.

## 14.5 Scan Coverage

```text
coverage = 성공적으로 확인한 tile / 계획된 tile
```

건물 수와 별도로 coverage를 표시한다. 안개, 권한, loading failure로 미확인인 영역을 0건으로 간주하지 않는다.

# 15. Battle Report Pipeline

## 15.1 State Machine

```text
received → fetching → parsed → analyzing → ready → delivering → delivered
                                           ↘ failed/retry
```

## 15.2 Ingestion

- message sender UID
- conversation/message ID
- report external ID 또는 attachment
- received timestamp
- duplicate hash

## 15.3 Analysis

초기에는 deterministic rule-based analysis를 우선한다.

- 결과와 power 차이
- hero composition/position
- troop type와 상성
- damage, loss, survival
- 공격/방어 효율
- 유사 과거 리포트

LLM을 사용할 경우 수치 계산이 아니라 설명 생성과 summary 보조에 사용하고, 입력 데이터와 analyzer version을 기록한다.

## 15.4 Delivery

- in-game official UI reply
- Discord Activity notification
- 웹 report detail
- 선택적 Discord DM

게임 채팅 길이가 제한되면 짧은 summary와 authenticated deep link를 전송한다.

## 15.5 Consent

리포트별 사용 범위:

- private
- alliance aggregate
- anonymous analytics/model
- public

기본값은 private다.

# 16. API와 Event Contract

## 16.1 Read API

읽기 요청은 RLS가 적용된 view/RPC를 기본으로 한다.

| Endpoint/RPC | 목적 |
|---|---|
| `get_overview` | freshness, health, active event, alliance summary |
| `get_player_detail` | current profile + growth + activity |
| `get_alliance_detail` | roster, changes, activity distribution |
| `get_arena_dashboard` | current match, ranking, trends |
| `get_activity_members` | period별 domain score와 coverage |
| `get_event_detail` | metadata, ranks, rewards, matchup |
| `get_season_dashboard` | buildings, production, contribution, coverage |
| `get_battle_report` | authorized report와 analysis |

## 16.2 Privileged Commands

Edge Functions:

- `queue-refresh-job`
- `create-game-link-code`
- `verify-discord-activity-session`
- `update-tracked-entities`
- `update-scoring-profile`
- `approve-adapter-mapping`
- `request-battle-analysis`
- `request-report-delivery`

## 16.3 Domain Events

```text
data.player_snapshot.created.v1
data.alliance_roster.changed.v1
data.arena_snapshot.created.v1
activity.fact.created.v1
activity.score.updated.v1
event.instance.discovered.v1
event.rank.updated.v1
season.building.changed.v1
season.production.updated.v1
battle_report.received.v1
battle_report.analysis.completed.v1
refresh.job.updated.v1
collector.health.changed.v1
```

event payload는 최소 식별자와 변경 type만 포함하고 UI가 필요한 read model을 다시 조회한다.

# 17. Security, Privacy, Threat Model

## 17.1 주요 자산

- 게임 수집 계정
- Discord/Supabase user identity
- 연맹 내부 presence와 activity
- 전투 리포트 원본
- Supabase privileged key
- collector command queue

## 17.2 위협과 통제

| 위협 | 통제 |
|---|---|
| Browser secret 유출 | publishable key만 사용, RLS 적용 |
| Discord client identity 위조 | server-side OAuth token verification |
| refresh command 남용 | admin role, rate limit, audit log |
| Collector PC 탈취 | OS account 분리, disk encryption, 최소 secret scope |
| Supabase 장애 | SQLite durable outbox, retry |
| 중복/재전송 | idempotency unique key |
| 리포트 무단 공개 | default private, RLS, consent |
| 본계정 오조작 | dedicated serial allowlist, main instance denylist |
| 잘못된 activity 판정 | coverage/confidence와 drill-down |
| parser 오류로 잘못된 수치 | schema validation, quarantine, replay tests |

## 17.3 RLS 정책 개요

| 데이터 | Viewer | Member | Officer | Admin | Collector |
|---|---:|---:|---:|---:|---:|
| 공개 rankings | R | R | R | R | W |
| CBFW 내부 presence | - | 제한 R | R | R | W |
| 본인 battle reports | - | Own R | 정책 R | R | W |
| activity scoring rules | - | R | R | RW | - |
| refresh jobs | - | - | 제한 생성 | RW | consume/update |
| raw payload | - | - | - | 제한 R | W |
| audit log | - | - | R | R | W |

## 17.4 Discord Activity 보안

Discord Activity는 iframe context에서 동작하므로 URL mapping, OAuth lifecycle, cookie 정책을 고려한다. Discord는 client에서 받은 user/channel 데이터를 신뢰하지 말고 server에서 token으로 검증할 것을 명시한다.[^D3]

# 18. Reliability, Operations, Observability

## 18.1 Health Model

Collector 상태:

- healthy
- degraded
- offline
- sync_backlog
- ui_blocked
- login_required
- parser_error

## 18.2 Structured Logging

모든 로그에 다음을 포함한다.

```text
timestamp, level, service, collector_id, correlation_id,
workflow_run_id, command, entity_key, error_code
```

raw token, game credential, secret key는 log하지 않는다.

## 18.3 Metrics

- packets decoded/min
- parser success/failure by command
- outbox pending/age
- sync latency
- refresh job duration/success
- map scan coverage
- activity facts generated
- Realtime subscriber/error
- battle analysis/delivery success

## 18.4 Alerts

- last packet > threshold
- collector heartbeat missing
- outbox oldest age > threshold
- repeated ADB failure
- login screen detected
- parser quarantine count 증가
- weekly baseline 미완료
- season map coverage 급감
- delivery dead-letter 발생

## 18.5 Scheduled Operations

Supabase Cron은 database function 또는 Edge Function을 cron syntax로 실행하고 run history를 기록할 수 있다.[^S7] Cloud cron은 local PC를 직접 제어하지 않고 queue message 생성, stale check, aggregation trigger에 사용한다.

# 19. 개발 프로세스와 Stage Gates

본 프로젝트는 기능을 바로 구현하기보다 아래 게이트를 순서대로 통과한다.

## Gate 0 - Product Charter

**산출물**

- 목표/비범위 승인
- 사용자 역할과 데이터 visibility 승인
- 활동 점수 사용 정책 승인
- 수집용 계정 운영 정책 승인

**Exit criteria**

- 본인(1인 운영자)이 본 문서 1-7장 내용을 검토·확정
- 데이터 공개 범위와 리포트 consent 기본값 결정

## Gate 1 - Protocol Evidence

**절차**

1. 기능별 capture plan 작성
2. 시작/종료 시각과 UI 행동 기록
3. PCAP raw 보존
4. command/payload schema extraction
5. replay fixture 생성
6. confirmed/hypothesis evidence matrix 갱신

**Exit criteria**

- parser가 fixture를 deterministic하게 재생
- 필수 식별자와 timestamp가 검증
- 미확정 field가 제품 확정값에 사용되지 않음

## Gate 2 - Data Contract

**산출물**

- schema migration
- JSON schema/Pydantic/Zod contract
- idempotency rule
- retention 및 RLS policy

**Exit criteria**

- migration up/down 또는 forward-only 복구 계획
- duplicate replay test 통과
- RLS negative tests 통과

## Gate 3 - Vertical Slice

첫 vertical slice:

```text
수집용 계정 Arena/CBFW snapshot
→ SQLite
→ Supabase sync
→ Realtime
→ Discord/Web 공통 화면
→ activity fact 1개 생성
```

**Exit criteria**

- end-to-end 데이터 provenance 확인
- PC/network 중단 후 복구 확인
- 본계정 무영향 확인

## Gate 4 - MVP

MVP 범위:

- player/alliance/arena live core
- Supabase Auth/RLS
- Discord/Web shared dashboard
- Activity Engine presence/growth/event-ready skeleton
- refresh/admin/health

**Exit criteria**

- 주간 baseline 자동 생성
- CBFW coverage 90% 목표 검증
- 운영 Runbook 완성

## Gate 5 - Beta Modules

- battle report
- event framework
- season/map framework

각 모듈은 별도 feature flag로 출시한다.

## Gate 6 - Production Readiness Review

검토 항목:

- 보안/RLS
- backup/restore
- disaster recovery
- load/performance
- monitoring/alerting
- user consent
- scoring fairness
- 운영 위험 검토 (ToS 리스크는 개인/비공개 사용으로 수용 완료)

# 20. Test Strategy

## 20.1 Test Pyramid

### Unit

- frame decode
- SFS data type
- parser field mapping
- normalization/scoring functions
- idempotency key
- season tile generation

### Protocol Replay

각 command별 sanitized PCAP 또는 decoded fixture를 사용한다.

- expected normalized rows
- malformed/null/bytes cases
- unknown field tolerance
- duplicate replay

### Contract

- Python Pydantic ↔ Supabase schema ↔ TypeScript Zod/type
- event version compatibility
- Edge Function request/response

### Database

- migration
- unique constraint
- RLS positive/negative
- materialized view correctness
- partition/index plan

### Integration

- SQLite outbox → Supabase
- queue → local worker → result
- Auth identity link
- Realtime refetch

### E2E

- 일반 Web Discord login
- Discord Activity authorize/authenticate
- player drill-down
- refresh request
- battle report consent/display
- admin adapter mapping

### Failure Injection

- network disconnect
- Supabase timeout
- BlueStacks crash
- ADB serial change
- partial PCAP
- duplicate queue delivery
- parser exception

## 20.2 Quality Gates

- parser line/branch coverage보다 fixture coverage를 우선한다.
- 신규 command parser에는 최소 정상, null/optional, malformed, duplicate test가 필요하다.
- RLS 변경은 unauthorized access test 없이는 merge하지 않는다.
- scoring 변경은 sample roster before/after report를 생성한다.
- UI release는 desktop, Discord iframe, mobile viewport를 검증한다.

# 21. Deployment Environments

| 환경 | 목적 | 데이터 |
|---|---|---|
| Local Dev | parser/UI 개발 | fixture/seed only |
| Staging | end-to-end, RLS, Discord test guild | sanitized/test collector |
| Production | 실제 서버군 577-584(향후 확장) | production collector |

환경별 Supabase project와 Discord application을 분리한다. secret과 callback URL도 분리한다.

## 21.1 CI/CD

권장 pipeline:

1. lint/type check
2. unit/protocol replay
3. database/RLS tests
4. frontend build
5. Playwright smoke
6. migration dry run
7. staging deploy
8. manual approval
9. production deploy

## 21.2 Release Strategy

- semantic versioning
- feature flags
- backward-compatible event contracts
- database migration before app rollout
- collector rolling update와 version heartbeat
- rollback 가능한 frontend/Edge Function

# 22. v0.4.1 Migration Plan

## 22.1 재사용

- SmartFox decoder/reassembly
- command parsers
- existing SQLite data
- Arena/player/alliance business rules
- refresh workflow concepts
- current Discord UI information architecture

## 22.2 교체 또는 재구성

| 현재 | Target |
|---|---|
| local FastAPI read API | Supabase views/RPC + Edge Functions |
| vanilla JS Activity | TypeScript shared SPA |
| SQLite primary DB | SQLite edge buffer + Supabase primary |
| local user ID allowlist | Supabase Auth + RLS roles |
| fixed workflow types | extensible job/adapter registry |
| activity/growth view | formal Activity Engine |

## 22.3 Data Migration Steps

1. 기존 DB read-only backup과 checksum
2. v0.4.1 schema inventory
3. player/alliance identity deduplication
4. historical snapshot export
5. Supabase staging import
6. reconciliation count 및 sample comparison
7. activity facts backfill
8. production sync dual-write 기간
9. cloud read cutover
10. rollback window 후 legacy read-only archive

# 23. Delivery Roadmap

## Milestone A - Foundation

- monorepo 및 CI
- Supabase schema/Auth/RLS
- local outbox/sync
- shared UI shell
- collector identity isolation

## Milestone B - Live Core

- player/alliance/arena sync
- health/refresh
- Discord/Web production auth
- Realtime freshness

## Milestone C - Activity MVP

- activity facts
- presence/growth/competition domains
- scoring profiles/coverage
- member activity dashboard

## Milestone D - Event Platform

- discovery inbox
- generic event adapter
- ranking/reward/matchup
- event activity facts

## Milestone E - Battle Reports

- game UID link
- report ingestion/fetch
- rule-based analysis
- in-game delivery
- consent/RLS

## Milestone F - Season Platform

- season discovery
- map crawler
- building/production tracking
- season contribution/activity

## Milestone G - Production Hardening

- backup/restore
- alerting/runbook
- fairness review
- performance and retention
- release governance

# 24. Definition of Ready와 Definition of Done

## 24.1 Feature Definition of Ready

- 사용자 문제와 scope 정의
- confirmed evidence 또는 capture plan
- 데이터 contract 초안
- permission/visibility 결정
- acceptance criteria
- failure modes
- observability 요구사항

## 24.2 Feature Definition of Done

- 코드와 migration reviewed
- unit/replay/contract/integration test 통과
- RLS tests 통과
- audit/metrics/log 추가
- documentation/runbook 갱신
- staging E2E 통과
- 본인 acceptance criteria 확인
- feature flag와 rollback 확인

# 25. 주요 리스크와 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| 게임 업데이트로 protocol/UI 변경 | 수집 중단 | schema discovery, adapter version, replay fixtures |
| 수집 계정 logout/제한 | 데이터 공백 | heartbeat, login-required alert, manual recovery runbook |
| 지도 스캔 비용 과다 | 계정/PC 부하 | discovery/detail 분리, adaptive frequency |
| 이벤트 구조 다양성 | 개발 비용 | generic lifecycle/scope + config mapping |
| activity score 불공정 | 운영 신뢰 훼손 | coverage, explainability, version, human review |
| Supabase 비용/throughput | 운영 비용 | summary read models, partition, selective Realtime |
| 개인정보/리포트 노출 | 신뢰·보안 문제 | default private, RLS, consent, audit |
| PC 종료/장애 | 실시간성 저하 | local recovery, cloud freshness 표시, optional dedicated mini-PC |
| 게임 ToS 불확실성 | 계정 위험 | 개인/비공개 사용 목적으로 본인이 리스크를 인지하고 수용함. 공식 UI 우선, rate limit, kill switch는 안전장치로 유지 |

# 26. 미해결 결정과 Capture Backlog

## 26.1 즉시 필요한 캡처

### 전투 리포트

```text
01_report_share_receive.pcapng
02_report_open_detail.pcapng
03_report_reply_send.pcapng
```

### 이벤트

```text
01_announcement_login.pcapng
02_event_tabs.pcapng
03_event_mail.pcapng
04_event_started_rankings.pcapng
05_event_final_rewards.pcapng
```

### 시즌

```text
01_season_login.pcapng
02_season_overview_tabs.pcapng
03_map_pan_scan.pcapng
04_open_one_season_building.pcapng
05_collect_or_contribute.pcapng
06_alliance_season_contribution.pcapng
```

## 26.2 제품 결정 필요

- 일반 웹의 공개 범위
- CBFW member/officer role 매핑 방식
- activity score 기본 가중치 승인
- battle report 익명 분석 기본값
- raw payload 보존 기간
- 수집 계정 운영 시간과 전용 PC 여부
- 게임 내 자동 회신의 허용 빈도

# Appendix A. Evidence Matrix

| Evidence | 주요 결론 | 제품 사용 |
|---|---|---|
| `darkwar_loading.pcapng` | 인증 login, arena auto request | login/reconnect workflow |
| `darkwar_alrank.pcapng` | roster 전체 및 presence field | alliance snapshots/activity |
| alliance local/cross PCAP | rangeType와 rank scope | ranking adapter |
| player profile PCAP | detailed 6-power fields | growth/detail snapshots |
| `darkwar_arena_match.pcapng` | weekly match, Top100, defense power | arena module |
| v0.4.1 code/tests | current schema/API/refresh baseline | migration source |
| APK/Lua strings | event/season/mail 후보 단서 | discovery priority only |

# Appendix B. Confirmed Command Registry

| Command | 용도 | 상태 |
|---|---|---|
| `alliance.rank` | alliance ranking | confirmed |
| `get.al.info` | alliance detail | confirmed |
| `al.rank` | alliance roster | confirmed |
| `server.rank` | player ranking | confirmed |
| `get.new.user.info` | player detailed profile | confirmed |
| `get.user.info.multi` | public/multi player summary | confirmed |
| `user.get.arena.info` | arena weekly/ranking info | confirmed |
| `user.arena.save.defend.army` | arena defense lineup | confirmed |

# Appendix C. 권장 Repository 구조

```text
darkwar-platform/
├─ apps/
│  └─ dashboard/                 # Web + Discord shared SPA
├─ packages/
│  ├─ ui/
│  ├─ api-client/
│  ├─ shared-types/
│  └─ scoring-explain/
├─ services/
│  ├─ collector-agent/           # Python
│  ├─ sync-worker/
│  ├─ job-worker/
│  └─ analysis-worker/
├─ modules/
│  ├─ core/
│  ├─ activity/
│  ├─ arena/
│  ├─ alliances/
│  ├─ players/
│  ├─ events/
│  │  └─ adapters/
│  ├─ seasons/
│  │  └─ adapters/
│  └─ battle-reports/
├─ supabase/
│  ├─ migrations/
│  ├─ functions/
│  ├─ tests/
│  └─ seed/
├─ protocol-fixtures/
├─ docs/
│  ├─ adr/
│  ├─ runbooks/
│  └─ specs/
└─ .github/workflows/
```

# Appendix D. 초기 Scoring Profile 예시

```yaml
profile: cbfw-weekly-v1
period: reset_week
minimum_coverage_for_score: 0.40
confidence:
  low: 0.40
  medium: 0.65
  high: 0.85

domains:
  presence:
    weight: 0.15
    metrics:
      - key: active_days
        normalization: target_ratio
        target: 5
      - key: inactivity_days
        normalization: recency_decay
  growth:
    weight: 0.15
    metrics:
      - key: power_delta_percentile
      - key: kills_delta_percentile
  alliance_contribution:
    weight: 0.25
    metrics:
      - key: alliance_event_target_ratio
      - key: season_contribution_percentile
  event_participation:
    weight: 0.25
    metrics:
      - key: core_event_participation_rate
      - key: event_rank_percentile
  combat:
    weight: 0.10
    metrics:
      - key: submitted_battle_activity
  competition:
    weight: 0.10
    metrics:
      - key: arena_participation
      - key: arena_score_percentile
```

# Appendix E. 운영 Runbook 최소 목록

- Collector 설치 및 수집 계정 연결
- ADB serial 확인과 본계정 denylist 검증
- Collector login-required 복구
- Supabase sync backlog 복구
- Weekly baseline 실패 처리
- Parser quarantine 분석
- 신규 event adapter 등록
- 신규 season/building mapping
- Battle report delivery 실패 처리
- RLS incident response
- Backup restore drill
- Emergency automation kill switch

# References

1. Discord, *How Activities Work*, Discord Developer Documentation, accessed 2026-07-28.
2. Discord, *Embedded App SDK Reference*, Discord Developer Documentation, accessed 2026-07-28.
3. Discord, *Networking - Security Considerations*, Discord Activities Development Guides, accessed 2026-07-28.
4. Supabase, *Postgres Changes*, Supabase Documentation, accessed 2026-07-28.
5. Supabase, *Row Level Security*, Supabase Documentation, accessed 2026-07-28.
6. Supabase, *Login with Discord*, Supabase Documentation, accessed 2026-07-28.
7. Supabase, *Edge Functions*, Supabase Documentation, accessed 2026-07-28.
8. Supabase, *Environment Variables*, Supabase Documentation, accessed 2026-07-28.
9. Supabase, *Queues*, Supabase Documentation, accessed 2026-07-28.
10. Supabase, *Cron*, Supabase Documentation, accessed 2026-07-28.

[^D1]: Discord, “How Activities Work,” Discord Developer Documentation, accessed 2026-07-28. https://docs.discord.com/developers/activities/how-activities-work
[^D2]: Discord, “Embedded App SDK Reference,” Discord Developer Documentation, accessed 2026-07-28. https://docs.discord.com/developers/developer-tools/embedded-app-sdk
[^D3]: Discord, “Networking - Security Considerations,” Discord Activities Development Guides, accessed 2026-07-28. https://docs.discord.com/developers/activities/development-guides/networking
[^S1]: Supabase, “Postgres Changes,” Supabase Documentation, accessed 2026-07-28. https://supabase.com/docs/guides/realtime/postgres-changes
[^S2]: Supabase, “Row Level Security,” Supabase Documentation, accessed 2026-07-28. https://supabase.com/docs/guides/database/postgres/row-level-security
[^S3]: Supabase, “Login with Discord,” Supabase Documentation, accessed 2026-07-28. https://supabase.com/docs/guides/auth/social-login/auth-discord
[^S4]: Supabase, “Edge Functions,” Supabase Documentation, accessed 2026-07-28. https://supabase.com/docs/guides/functions
[^S5]: Supabase, “Environment Variables,” Supabase Documentation, accessed 2026-07-28. https://supabase.com/docs/guides/functions/secrets
[^S6]: Supabase, “Queues,” Supabase Documentation, accessed 2026-07-28. https://supabase.com/docs/guides/queues
[^S7]: Supabase, “Cron,” Supabase Documentation, accessed 2026-07-28. https://supabase.com/docs/guides/cron
