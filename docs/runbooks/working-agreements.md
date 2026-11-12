# 작업 방식 (CLAUDE.md에 없는 것만)

2026-11-12에 `docs/handover.md` 꼬리(「작업 방식에서 지켜야 할 것」, 원문은 `docs/log/2026-08-and-earlier-tail.md`)에서 추렸다. `RAISE EXCEPTION` 롤백, "스키마를 바꾸면 저장소 전체 grep", 로컬 전체 검증 명령, pgTAP 로컬 실행은 CLAUDE.md에 이미 있어 뺐다.

## 세션 끝에 브랜치를 푸시한다. 미완성이어도.

맥과 윈도우 사이에 충돌이 난 적은 한 번도 없다 — 두 머신이 같은 파일을 동시에 고치지 않기 때문이다. 실제로 손해를 낸 것은 언제나 **푸시하지 않은 브랜치**였다.

- `feat-battle-rank` — 파서를 다 써놓고 푸시하지 않아 다른 머신에서 안 보였고, 문서 두 개가 "미승격"으로 잘못 적혔다.
- `docs-capture-backlog` — 운영 런북 381줄이 origin에는 있는데 `main`에 머지가 안 돼 몇 주 동안 없는 문서였다.
- `feat-operability` — 로컬에만 있던 브랜치. 내용이 이미 다른 경로로 `main`에 들어가 있어 잃은 것은 없었다.

규칙은 하나다: **`origin/main`이 유일한 진실이고 머신은 캐시다.** 세션 시작에 `git fetch --prune`, 세션 끝에 푸시.

## 화면 기능은 양쪽 방향을 다 눌러본다

즐겨찾기를 "켜기"만 확인하고 완료로 보고했다가 "끄기가 안 된다"는 지적을 받았다. 토글·추가/삭제·열기/닫기는 되돌리는 쪽까지 확인한다.

## GitHub 인증이 막히면 키 문제가 아닐 가능성이 높다

Windows에서는 ssh-agent가 서비스라 `Set-Service -StartupType Automatic` + `ssh-add` 한 번이면 끝이다(2026-08-02 확인). WSL에서 `Permission denied (publickey)`가 나면 새 키를 만들지 말고 `eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519_github`.

## 워크트리의 마이그레이션은 `db push`에 안 보인다 → [traps.md](traps.md)
