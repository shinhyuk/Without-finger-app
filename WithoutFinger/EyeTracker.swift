import ARKit
import Combine

/// ARKit Face Tracking 기반 시선-업 감지기.
/// TrueDepth 카메라가 있는 기기(iPhone X 이상, iPad Pro 11"/12.9" 3세대 이상)에서 동작.
final class EyeTracker: NSObject, ObservableObject, ARSessionDelegate {

    @Published var isLookingUp = false
    @Published var status: String = "준비"
    @Published var rawValue: Float = 0

    /// 위로 본다고 판정하는 블렌드셰이프 임계값 (0~1).
    /// 과장된 동작을 가정하므로 비교적 높게 잡음.
    var triggerThreshold: Float = 0.55
    /// "다시 위를 봤다"고 인정하기 위해 일단 내려와야 하는 값.
    var rearmThreshold: Float = 0.20

    /// 위로 본 순간(엣지 트리거) 호출.
    var onLookUp: (() -> Void)?

    private let session = ARSession()
    private var armed = true

    override init() {
        super.init()
        session.delegate = self
    }

    func start() {
        guard ARFaceTrackingConfiguration.isSupported else {
            DispatchQueue.main.async {
                self.status = "이 기기는 Face Tracking 미지원 (TrueDepth 필요)"
            }
            return
        }
        let config = ARFaceTrackingConfiguration()
        config.isLightEstimationEnabled = false
        if #available(iOS 13.0, *) {
            config.maximumNumberOfTrackedFaces = 1
        }
        session.run(config, options: [.resetTracking, .removeExistingAnchors])
        DispatchQueue.main.async { self.status = "추적 중" }
    }

    func stop() {
        session.pause()
        DispatchQueue.main.async { self.status = "정지" }
    }

    // MARK: - ARSessionDelegate

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let face = anchors.compactMap({ $0 as? ARFaceAnchor }).first else { return }

        let lookUpL = face.blendShapes[.eyeLookUpLeft]?.floatValue ?? 0
        let lookUpR = face.blendShapes[.eyeLookUpRight]?.floatValue ?? 0
        let value = (lookUpL + lookUpR) / 2

        DispatchQueue.main.async {
            self.rawValue = value
            self.isLookingUp = value > self.triggerThreshold

            if self.armed && value > self.triggerThreshold {
                self.armed = false
                self.onLookUp?()
            } else if !self.armed && value < self.rearmThreshold {
                self.armed = true
            }
        }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        DispatchQueue.main.async {
            self.status = "오류: \(error.localizedDescription)"
        }
    }

    func sessionWasInterrupted(_ session: ARSession) {
        DispatchQueue.main.async { self.status = "세션 중단됨" }
    }

    func sessionInterruptionEnded(_ session: ARSession) {
        DispatchQueue.main.async { self.status = "추적 재개" }
    }
}
