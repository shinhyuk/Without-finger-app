# Without-finger-app

손가락 없이 시선만으로 유튜브 쇼츠를 넘기기 위한 iOS 앱.
ARKit Face Tracking으로 "위를 본다" 동작을 감지해서, 앱 내 임베드된
유튜브 쇼츠 WebView를 다음 영상으로 자동 스와이프합니다.

---

## ⚠️ 중요: iOS의 제약 (먼저 읽어주세요)

원래 요청은 "백그라운드에서 돌면서 다른 앱(유튜브)을 위로 스와이프"였지만,
iOS에서는 **두 가지 모두 시스템적으로 불가능**합니다.

| 원하는 동작 | iOS 가능 여부 | 이유 |
|---|---|---|
| 백그라운드 카메라 사용 | ❌ 불가 | 앱이 백그라운드 가면 카메라 세션 자동 종료 (App Store 정책 + OS 강제) |
| 다른 앱(YouTube)에 터치 주입 | ❌ 불가 | 안드로이드 AccessibilityService 같은 권한이 iOS에는 없음 |
| 앱 내부 WebView에서 쇼츠 보면서 시선 감지 → 자동 스와이프 | ✅ 가능 | 이 앱이 구현한 방식 |

→ 그래서 이 앱은 **자체 화면에 유튜브 쇼츠를 임베드**해서 띄우고,
   앱이 포그라운드에 있는 동안 시선을 추적합니다.

---

## 동작 방식

1. 앱 실행 → ARKit `ARFaceTrackingConfiguration` 시작 (TrueDepth 전면 카메라).
2. `eyeLookUpLeft`, `eyeLookUpRight` 블렌드셰이프 평균값을 매 프레임 읽음.
3. 평균값이 `triggerThreshold` (기본 0.55) 를 넘기면 → 스와이프 한 번.
4. 다시 `rearmThreshold` (기본 0.20) 아래로 내려와야 다음 트리거 가능.
5. 거기에 0.7초 쿨다운까지 적용 → 한 번 보면 정확히 한 번만 넘어감.

캘리브레이션 없이 시선을 "확실히" 위로 올렸을 때만 인식되도록 임계값이 높게
잡혀 있습니다. 너무 둔감하거나 민감하면 `EyeTracker.swift`의
`triggerThreshold` 값을 조정하세요.

## 요구사항

- **iPhone X 이상** (TrueDepth 카메라 필요). 시뮬레이터에선 안 돌아감.
- iOS 16+
- Xcode 15+

## 빌드 방법

### 옵션 A — xcodegen 사용 (권장)

```bash
brew install xcodegen
cd Without-finger-app
xcodegen generate
open WithoutFinger.xcodeproj
```

Xcode에서 자기 Apple ID로 서명 설정한 뒤 실기기에 빌드.

### 옵션 B — 수동으로 Xcode 프로젝트 만들기

1. Xcode → New Project → iOS App → SwiftUI, Swift, 이름 `WithoutFinger`.
2. 생성된 `ContentView.swift`, `WithoutFingerApp.swift` 삭제.
3. 이 저장소의 `WithoutFinger/` 폴더에 있는 4개 .swift 파일을 모두 추가:
   - `WithoutFingerApp.swift`
   - `ContentView.swift`
   - `EyeTracker.swift`
   - `ShortsWebView.swift`
4. Info.plist에 다음 키 추가:
   - `NSCameraUsageDescription` = `"시선 추적을 위해 전면 카메라를 사용합니다."`
5. Signing & Capabilities에서 자기 팀 선택.
6. 실기기에 빌드.

## 파일 구조

```
WithoutFinger/
├── WithoutFingerApp.swift   앱 진입점
├── ContentView.swift        UI + 상태 표시 + 트리거 디바운스
├── EyeTracker.swift         ARKit Face Tracking 로직
├── ShortsWebView.swift      WKWebView 래퍼 + JS 스와이프 코드
└── Info.plist               카메라 권한 등
```

## 알려진 한계

- 유튜브 모바일 웹의 쇼츠 DOM 구조가 바뀌면 자동 스와이프 자바스크립트
  (`ShortsWebView.swift` 안의 `swipeUpJS`) 수정이 필요할 수 있음.
- 로그인이 필요한 경우 WebView 안에서 직접 로그인해야 합니다.
- 앱이 백그라운드로 가면 ARKit 세션이 멈춥니다 (OS 제약).
- 음소거 정책상 자동 재생을 위해 `mediaTypesRequiringUserActionForPlayback = []`
  을 설정했지만, 첫 재생을 위해 한 번 화면을 탭해야 할 수도 있음.

## 튜닝 포인트

| 값 | 위치 | 기본값 | 의미 |
|---|---|---|---|
| `triggerThreshold` | `EyeTracker.swift` | 0.55 | 위로 본다고 판단할 최소값 |
| `rearmThreshold` | `EyeTracker.swift` | 0.20 | 다시 트리거 받기 위해 내려가야 할 값 |
| `cooldown` | `ContentView.swift` | 0.7s | 연속 스와이프 최소 간격 |
