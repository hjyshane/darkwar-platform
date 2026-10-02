# 런북: 맥에서 캡처 파일로 업데이트하기

여행 중처럼 Windows 수집기 PC를 쓸 수 없을 때, 맥에서 캡처를 **손으로** 떠서
같은 Supabase에 올리는 절차다. 상시 수집이 아니라 "필요한 화면을 열고, 그동안
떠놓고, 끝나면 올린다"는 수동 경로다.

Windows의 `dw-capture`·`dw-ui-worker`·데스크톱 앱은 맥에서 돌지 않는다
(Npcap, BlueStacks ADB, Windows 작업 스케줄러에 묶여 있다). 맥에서 쓰는 것은 그
아래 절반뿐이다:

```
캡처 파일(.pcapng / .pcap) → dw-collector ingest-dir → 로컬 SQLite 저널 → dw-collector sync → Supabase
```

이 경로는 Windows에서도 매일 쓰는 것(`ingest-dir`)과 같은 코드다. 맥 때문에
추가된 것은 파일 읽기 쪽뿐이다 — classic pcap, Wi-Fi 외의 링크 타입(루프백,
`-i any`의 PKTAP, VPN의 raw IP), IPv6.

## 사전 준비 (맥에서 1회)

1. **저장소와 도구** — `uv`, 저장소 클론. 설치는 `docs/runbooks/mac-setup.md`
   (관리자 권한 없이, Docker 없이). 캡처 extra(scapy)는 필요 없다:

   ```bash
   cd ~/darkwar-platform/services/collector && uv sync
   ```

2. **Wireshark** (dumpcap 때문에) — 설치 디스크 이미지에 있는
   **"Install ChmodBPF"** 를 함께 설치한다. 이게 없으면 dumpcap이 `sudo` 없이는
   인터페이스를 열지 못한다. 설치 후 로그아웃/로그인 한 번.

   Wireshark 없이 내장 `tcpdump`만 써도 된다(아래 "tcpdump로" 참고). 둘 다
   읽힌다.

3. **`.env`** — 저장소 밖에 둔다. 맥은 여행에 들고 다니는 기계다.

   ```bash
   mkdir -p ~/dw-data ~/dw-captures
   ```

   `~/dw-data/.env`:

   ```
   SUPABASE_URL=https://<프로젝트>.supabase.co
   SUPABASE_SECRET_KEY=<secret key>
   DW_COLLECTOR_ID=<Windows 수집기와 같은 값>
   DW_SQLITE_PATH=/Users/<나>/dw-data/collector.db
   ```

   - **`DW_COLLECTOR_ID`는 Windows와 같은 값을 쓴다.** `collectors` 테이블에
     등록된 id만 받아들여지므로(FK), 새 UUID를 만들면 sync가 전부 실패한다.
     같은 id를 써도 충돌하지 않는다 — 중복 판정은 `idempotency_key`(원본
     페이로드 해시)로 하므로, 두 기계가 같은 화면을 떠도 행이 두 벌 되지 않는다.
   - **`SUPABASE_SECRET_KEY`는 RLS를 완전히 우회한다.** 이 파일은 저장소 안에
     두지 않고(`~/dw-data`), 맥을 잃어버리면 키를 즉시 교체한다.
   - 매번 이 파일을 쓰도록 셸에서 `export DW_ENV_FILE=~/dw-data/.env`
     (`~/.zshrc`에 넣어둬도 된다).

## 캡처 인터페이스 고르기

게임 트래픽이 지나가는 인터페이스를 떠야 한다.

| 게임이 도는 곳 | 인터페이스 | 비고 |
|---|---|---|
| 맥 자체 (BlueStacks Air, Apple Silicon의 iOS 앱) | `en0` (Wi-Fi) | 가장 흔한 경우. 유선이면 `en`번호 확인 |
| 아이폰을 맥의 "인터넷 공유"로 연결 | `bridge100` | 아이폰 트래픽이 맥을 거친다 |
| 잘 모르겠다 | `any` | 전부 뜬다. 읽는 쪽이 PKTAP을 풀어서 처리한다 |
| VPN을 켠 상태 | `utun*` | raw IP로 읽힌다 |

확인:

```bash
/Applications/Wireshark.app/Contents/MacOS/dumpcap -D
```

## 캡처하기

### dumpcap으로 (권장)

```bash
/Applications/Wireshark.app/Contents/MacOS/dumpcap \
  -i en0 -f "tcp port 8680" -b duration:300 \
  -w ~/dw-captures/trip.pcapng
```

그동안 게임에서 필요한 화면(연맹 랭킹, 이벤트 탭 등)을 연다. 끝나면 `Ctrl-C`.

**`-b duration:300`을 빼지 않는다.** 링 모드는 파일 이름에 일련번호와 시각을
붙인다(`trip_00001_20261002120000.pcapng`). 이게 중요한 이유:

> `ingest-dir`은 **파일 이름**으로 "이미 읽었음"을 기록한다. 다음 날 또
> `-w ~/dw-captures/trip.pcapng`로 떠서 같은 이름이 생기면, 그 파일은 **읽지
> 않고 조용히 건너뛴다.** 링 모드면 이름이 겹칠 수 없다.

### tcpdump로

```bash
sudo tcpdump -i en0 -w ~/dw-captures/$(date +%Y%m%d-%H%M%S).pcap 'tcp port 8680'
```

이름에 시각을 넣는 것은 위와 같은 이유다. `.pcap`(classic)도 그대로 읽힌다.

## 올리기

캡처를 멈춘 뒤:

```bash
cd ~/darkwar-platform/services/collector
uv run dw-collector ingest-dir --dir ~/dw-captures --min-age-seconds 0 \
  --collected-from-server 580
uv run dw-collector sync
```

- `--min-age-seconds 0`: 기본값 30초는 "dumpcap이 아직 쓰는 중인 파일"을 피하려는
  것이다. 캡처를 멈춘 뒤라면 기다릴 이유가 없다. **캡처가 돌고 있는 동안에는
  0을 쓰지 않는다** — 쓰다 만 파일을 읽고 "읽음"으로 기록해, 뒷부분을 잃는다.
- `--collected-from-server`: 캡처한 **계정의 서버**. 일부 응답은 대상 서버를
  담고 있지 않아 이 값으로 채운다. 기본값은 580이고, 다른 서버 계정으로 떴다면
  바꾼다.
- 출력에서 파일마다 `ingested=N`을 본다. `UNREADABLE`이 나오면 아래 문제 해결.
- `sync`는 `sent=N failed=0`이 정상. 실패한 행은 outbox에 남으므로 네트워크가
  돌아오면 같은 명령을 다시 돌리면 된다.

그다음 `https://cbfw.us`에서 확인한다. 안 바뀐 것처럼 보이면 브라우저 캐시부터
의심한다(강력 새로고침).

## 문제 해결

| 증상 | 원인 / 조치 |
|---|---|
| `UNREADABLE unsupported link type N` | 이 리더가 모르는 인터페이스 형식. `en0`이나 `any`로 다시 뜨고, 그래도 필요하면 N을 기록해 둔다 |
| 파일은 읽혔는데 `ingested=0 discovered=0` | 그 인터페이스로 게임 트래픽이 안 지나갔다. 표에서 인터페이스를 다시 고르거나 `any` |
| `done: 0 file(s)` | 전부 이미 읽은 이름이거나, 파일이 30초 안쪽이라 기다리는 중(`--min-age-seconds 0`) |
| `SUPABASE_URL and SUPABASE_SECRET_KEY are required` | `DW_ENV_FILE`이 셸에 없다. `export DW_ENV_FILE=~/dw-data/.env` |
| sync가 FK 오류로 전부 실패 | `DW_COLLECTOR_ID`가 Windows 값과 다르다 |
| dumpcap `permission denied` | ChmodBPF가 없다. 설치 후 재로그인 |

## 하지 말 것

- 캡처 파일·`collector.db`·`.env`를 저장소 안에 두거나 커밋하기. 캡처에는 계정
  UID와 세션 서명이 들어 있다.
- 캡처가 도는 중에 `--min-age-seconds 0`으로 `ingest-dir` 돌리기.
- 같은 이름으로 덮어쓰며 반복 캡처하기(링 모드나 시각 이름을 쓴다).
