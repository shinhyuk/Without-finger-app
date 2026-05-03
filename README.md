# Without-finger-app

손가락 없이 시선만으로 유튜브 영상을 넘기는 앱.
**iPhone Safari에서 바로 쓸 수 있는 PWA 버전**과 native iOS 앱(Swift) 버전 두 가지를 포함합니다.

> 손이 자유롭지 못한 상태(요리 중, 운동 중 등)에서 영상을 넘기는 용도로 만든 사이드 프로젝트.

---

## 🌐 PWA 버전 (권장 — Mac 없이 바로 사용 가능)

### 동작 방식

1. iPhone Safari로 사이트 접속
2. 카메라 권한 허용 → 전면 카메라로 얼굴 추적 시작
3. **MediaPipe FaceLandmarker** 가 `eyeLookUpLeft` / `eyeLookUpRight` 블렌드셰이프를 매 프레임 측정
4. 평균값이 임계값(기본 0.55)을 넘으면 → YouTube IFrame Player API의 `nextVideo()` 호출 = 재생목록 다음 영상으로 점프
5. 다시 시선이 내려와야 (값 < 0.20) 다음 트리거 가능 + 0.7초 쿨다운

### ⚠️ 중요: 쇼츠 임베드 제약

**유튜브 쇼츠 자체는 iframe에 임베드 못 합니다** (X-Frame-Options).
대신 우회법:

1. 유튜브 모바일 앱 또는 웹에서 보고 싶은 쇼츠를 "재생목록에 저장" 으로 본인 재생목록에 추가
2. 그 재생목록 ID를 이 앱에 입력
3. → 일반 영상 플레이어에서 쇼츠가 순차 재생됨. 시선 위 = 다음 쇼츠

재생목록 ID 찾는 법: 유튜브에서 재생목록 열고 URL의 `list=PLxxxxx` 부분이 ID.
URL 통째로 붙여넣어도 자동 추출됩니다.

### GitHub Pages 배포

리포지토리를 public으로 전환한 뒤:

1. Settings → Pages
2. Source: `Deploy from a branch`
3. Branch: `claude/eye-tracking-swipe-EeOuy` (또는 `main`으로 머지 후 `main`) / `/ (root)`
4. 저장 후 `https://<username>.github.io/Without-finger-app/` 에서 접속

또는 로컬에서 바로 테스트하려면:

```bash
cd Without-finger-app
python3 -m http.server 8000
# 또는
npx serve .
```

→ Mac/PC와 iPhone이 같은 Wi-Fi에 있을 때 `http://<PC-IP>:8000` 으로 접속.
**단, getUserMedia는 HTTPS 또는 localhost에서만 동작하므로** 같은 Wi-Fi의 iPhone에선
HTTP IP 접근만으론 카메라가 안 켜집니다. 이럴 때는:

- ngrok / cloudflared 로 HTTPS 터널을 뚫거나
- 그냥 GitHub Pages 에 올리는 게 제일 편함

### 홈 화면에 추가 (네이티브 앱처럼)

iPhone Safari → 공유 → "홈 화면에 추가" 누르면 풀스크린 PWA로 동작.
iOS 16.4+ 부터 standalone PWA에서도 카메라 권한이 영구 저장됩니다.

### PWA 파일 구조

```
/
├── index.html              UI 마크업
├── app.js                  Face Tracking + YouTube 컨트롤
├── styles.css              모바일 다크 테마
├── manifest.webmanifest    PWA 매니페스트
├── sw.js                   서비스 워커 (오프라인 캐시)
├── icon.svg                앱 아이콘
```

### 튜닝 포인트 (앱 안에서)

- **위로 본다 판정값** 슬라이더: 0.20~0.90. 너무 자주 넘어가면 0.65~0.70, 잘 안 넘어가면 0.40 정도.
- **쿨다운**: 한 번 넘어간 뒤 다음 트리거까지 최소 간격.
- 둘 다 localStorage 에 저장됩니다.

---

## 📱 Native iOS 버전 (Mac 필요)

`WithoutFinger/` 폴더에 ARKit 기반 SwiftUI 앱이 들어있습니다.
PWA 보다 추적 정확도가 높지만 **Mac + Xcode 없이는 빌드/설치 불가**.

자세한 빌드법은 이 README의 이전 버전 또는 `WithoutFinger/` 내 코드 주석 참고.

요약:
```bash
brew install xcodegen
xcodegen generate
open WithoutFinger.xcodeproj
```

---

## ⚠️ iOS 의 근본적 제약 (양 버전 공통)

원래 요청은 "백그라운드에서 다른 앱(YouTube)을 자동 스와이프" 였지만 iOS는:

1. **백그라운드 카메라 접근 금지** — 앱(또는 PWA) 백그라운드 가면 카메라 정지
2. **다른 앱에 터치 주입 불가** — 안드로이드 AccessibilityService 같은 권한 없음

→ 그래서 두 버전 모두 **자체 화면 안에서 유튜브를 보면서 시선 추적** 하는 구조.

---

## 라이선스

MIT (해도 됨, 안 해도 됨, 알아서)
