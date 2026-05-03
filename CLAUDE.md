# CLAUDE.md

이 프로젝트에서 작업할 때 따라야 할 규칙.

## Workflow

- 작업이 완료되면 **항상 다음 순서로 마무리**:
  1. `git add` → `git commit` (의미 있는 메시지)
  2. `git push -u origin <branch>`
  3. **PR까지 자동 생성** (별도 요청 없어도)
  4. PR 본문에는 `## Summary` 와 `## Test plan` 섹션 포함
  5. PR 생성 직후 CI 상태 / 리뷰 코멘트 한 번 확인
- 동일 head 브랜치에 이미 열린 PR이 있으면 **새로 만들지 말고** 푸시만 (기존 PR이 자동 갱신됨)
- 사소한 수정(1~2줄)이라도 위 흐름은 동일하게 적용

## 브랜치

- 개발 브랜치: `claude/eye-tracking-swipe-EeOuy`
- main에 직접 푸시 금지

## 코드 스타일

- 한국어 UI 텍스트 그대로 유지 (사용자가 한국어로 요청)
- 주석은 WHY 만 (WHAT은 코드가 말하게)
- iOS Safari 호환성 항상 우선 고려 (이 앱이 그 위에서 돌기 때문)
