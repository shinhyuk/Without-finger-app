import SwiftUI

@main
struct WithoutFingerApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
                .statusBar(hidden: true)
        }
    }
}
