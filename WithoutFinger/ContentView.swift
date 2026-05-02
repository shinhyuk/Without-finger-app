import SwiftUI

struct ContentView: View {

    @StateObject private var tracker = EyeTracker()
    @State private var swipeTrigger: Int = 0
    @State private var lastSwipeAt: Date = .distantPast
    @State private var enabled: Bool = true

    /// 연속 트리거 방지 쿨다운(초).
    private let cooldown: TimeInterval = 0.7

    var body: some View {
        ZStack(alignment: .top) {
            ShortsWebView(swipeTrigger: $swipeTrigger)
                .ignoresSafeArea()

            statusBar
                .padding(.top, 6)
        }
        .onAppear {
            tracker.onLookUp = handleLookUp
            tracker.start()
        }
        .onDisappear { tracker.stop() }
    }

    private var statusBar: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(tracker.isLookingUp ? Color.green : Color.gray.opacity(0.6))
                .frame(width: 10, height: 10)

            Text(enabled ? tracker.status : "OFF")
                .font(.caption2)
                .foregroundColor(.white)

            Text(String(format: "up=%.2f", tracker.rawValue))
                .font(.caption2.monospacedDigit())
                .foregroundColor(.white.opacity(0.7))

            Button(action: { enabled.toggle() }) {
                Image(systemName: enabled ? "eye.fill" : "eye.slash.fill")
                    .foregroundColor(.white)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.black.opacity(0.55))
        .clipShape(Capsule())
    }

    private func handleLookUp() {
        guard enabled else { return }
        let now = Date()
        guard now.timeIntervalSince(lastSwipeAt) > cooldown else { return }
        lastSwipeAt = now
        swipeTrigger &+= 1
    }
}
