# 런북: 수집기 운영 프로토콜

무엇을 어디서 어떤 순서로 돌리는지. 설치는 `collector-setup.md`, 발견 세션의
화면 순서는 `capture-sweep.md`, 무엇을 아직 찍어야 하는지는
`../capture-backlog.md`에 있다.

## 절대 규칙

| 규칙 | 이유 |
|---|---|
| 수집기 명령(`dw-capture`, `dw-collector *`)은 **Windows** `C:\darkwar-platform`에서만 | Npcap이 Windows 전용이고, SQLite 저널이 로컬 디스크에 있어야 한다 |
| DB·대시보드·테스트는 **WSL** `~/Projects/DW_app`에서만 | 툴체인이 여기 있고 CI와 같은 환경이다 |
| 캡처와 sync는 **같은 PowerShell 창**에서 | 환경변수와 `DW_SQLITE_PATH`가 같아야 한다 |
| 저널은 로컬 디스크(`C:\DW_data`)에, 공유 드라이브(`U:\`, `\\wsl$`) 금지 | SQLite WAL을 9p/SMB 위에서 쓰면 손상 위험이 실재한다 |
| pcap·저널·`.env`는 저장소 밖에 | 계정 UID와 세션 서명이 들어 있다(§5.2) |

**WSL에서 수집기를 돌리면 조용히 실패한다.** `DW_SQLITE_PATH`가 없으면 그
체크아웃 안의 빈 저널을 만들고, sync는 `sent=0`을 보고한다 — "보낼 게 없다"와
구분되지 않는다. 그래서 `sync`가 사용한 저널 경로를 출력한다. 출력의
`journal=` 줄이 기대한 경로인지 항상 확인한다.

## 명령 지도

| 명령 | 어디서 | 무엇을 |
|---|---|---|
| `dw-capture` | Windows | 라이브 패시브 캡처 → 저널 (Ctrl+C로 중지) |
| `dw-collector scan-capture --pcap X` | Windows/WSL | pcap 파일을 파이프라인에 통과 → 저널 |
| `dw-collector sync` | Windows | 저널 outbox → Supabase (1회) |
| `dw-sync` | Windows | sync를 주기 반복 + 하트비트 보고 |
| `dw-collector journal-summary` | 어디서나 | 저널 내용 요약(커맨드·테이블·outbox) |
| `dw-collector retry-outbox` | Windows | 실패/전송완료 행을 다시 대기로 |
| `dw-collector extract-fixture` | 어디서나 | pcap → 살균 fixture (살균기 없으면 거부) |
| `dw-collector replay --fixture X` | 어디서나 | fixture 1개를 파이프라인에 통과 |
| `dw-collector init-db` | 어디서나 | 저널 생성 |
| `dw-jobs`, `dw-ui-worker` | — | 아직 미구현(수집 계정·ADB 필요) |

`supabase`, `pnpm`, `pytest`는 전부 WSL.

## A. 일상 수집

```powershell
cd C:\darkwar-platform\services\collector
. ..\..\dw-env.ps1
uv run dw-capture
```

게임에서 필요한 화면을 연다(닫았다 다시 열어야 요청이 나간다). Ctrl+C로 중지하면
카운터가 찍힌다 — `ingested`(확정 커맨드) · `discovered`(미확인) ·
`rejected`(파싱 실패, 0이어야 정상) · `resync_bytes`/`gap_skips`(0이 아니면 패킷
유실).

```powershell
uv run dw-collector sync
```

`journal=` 경로와 `sent=N failed=0`을 확인한다. 그다음 WSL에서:

```bash
cd ~/Projects/DW_app && pnpm dev
```

## B. 발견 세션 (Wireshark 병행)

`capture-sweep.md`의 화면 순서를 따르되, **Wireshark를 함께 켠다.** 캡처 필터는
`tcp port 8680`, 저장은 pcapng.

Npcap은 같은 어댑터에 여러 캡처 핸들을 허용하므로 둘이 서로 패킷을 뺏지 않는다.

끝나면 pcap을 별도 저널로 스캔해 라이브 결과와 비교한다.

```powershell
uv run dw-collector scan-capture --pcap C:\DW_data\probe.pcapng --db C:\DW_data\probe.db
uv run dw-collector journal-summary --db C:\DW_data\probe.db
uv run dw-collector sync --db C:\DW_data\probe.db
```

`--db`를 빼면 기본 저널을 보게 되므로 스캔 결과가 올라가지 않는다.

## C. pcap → fixture → 파서 (승격 절차)

1. shape 확인 — 스캔 후 `schema_observations`를 본다. **UID가 있는지, 개인별인지
   집계인지** 판정한다(`capture-sweep.md`의 판정표)
2. 살균기 작성 — `sanitize.py`에 커맨드별 함수. 살균기가 없으면
   `extract-fixture`가 **거부한다**
3. fixture 추출

   ```powershell
   uv run dw-collector extract-fixture --pcap C:\DW_data\probe.pcapng `
     --command <command> --out ..\..\protocol-fixtures\decoded\<command>\<name>.json `
     --captured-at 2026-07-30T04:40:00+00:00
   ```

4. manifest 기록 — `protocol-fixtures/manifests/`에 원본 sha256과 메모
5. 정규화기 + 테스트 — 정상/널/불량, provenance 테스트(fixture == sanitize(실캡처))
6. PR **1개당 파서 1개**

`--captured-at`은 추측하지 않는다. pcap에는 응답의 신뢰할 wall clock이 없으므로
payload의 서버 시각(`updateTime` 등)에서 취하고 manifest에 근사임을 적는다.

## D. 코드 업데이트 (양쪽)

PR 머지 후:

```bash
cd ~/Projects/DW_app && git pull && pnpm install
```

마이그레이션이 포함됐으면 WSL에서:

```bash
supabase db reset && supabase test db
```

Windows 쪽:

```powershell
cd C:\darkwar-platform; git pull; cd services\collector; uv sync --extra capture
```

**순서가 중요하다.** `db reset`은 클라우드를 비우므로, 그 전에 Windows 저널이
최신인지 확인하고 그 후 E를 수행한다.

## E. 스키마 변경 후 재동기화

`supabase db reset`은 클라우드를 비우지만 **저널은 전부 기억하고 있다.** 잃은 것은
없고 다시 보내면 된다.

```powershell
uv run dw-collector retry-outbox --already-sent
uv run dw-collector sync
```

클라우드 쪽 유니크 키가 중복을 흡수하므로 여러 번 보내도 행이 늘지 않는다.

## F. 장애 대응

| 증상 | 조치 |
|---|---|
| sync가 `Connection refused` / `WinError 10061` | 스택이 내려갔다. WSL에서 `supabase start`. "already running"인데 `Stopped services`에 kong이 있으면 `supabase stop && supabase start` |
| outbox에 `dead_letter`가 쌓임 | 원인을 고친 뒤 `retry-outbox --dead-letters` |
| 백오프 때문에 안 나감 | `retry-outbox` (플래그 없이) |
| `sent=0`인데 데이터가 있어야 함 | 출력의 `journal=` 경로 확인. WSL에서 돌렸거나 `--db`를 안 준 것 |
| `rejected > 0` | 아는 커맨드인데 파싱 실패. 로그의 커맨드명을 보고 파서 수정 |
| `gap_skips > 0` 또는 `resync_bytes`가 큼 | 패킷 유실. 큰 응답이 통째로 사라졌을 수 있으니 그 세션 결과를 신뢰하지 말고 다시 찍는다 |
| WSL에서 `docker: command not found` | Docker Desktop → Settings → Resources → WSL integration |

## G. 상태 점검

```powershell
uv run dw-collector journal-summary
```

WSL에서 클라우드 쪽:

```bash
supabase test db          # 스키마·RLS
cd services/collector && uv run pytest   # 파이프라인
```

수집기 건강 상태(`collectors`, `collector_heartbeats`)는 `dw-sync`가 매 주기
보고한다 — 침묵 15분이면 `degraded`, 데드레터가 있으면 `sync_backlog`.
