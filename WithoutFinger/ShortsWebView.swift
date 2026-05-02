import SwiftUI
import WebKit

struct ShortsWebView: UIViewRepresentable {

    /// 외부에서 카운터를 증가시키면 한 번 스와이프 트리거.
    @Binding var swipeTrigger: Int

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.bounces = false
        webView.allowsBackForwardNavigationGestures = false
        webView.customUserAgent =
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 " +
            "Mobile/15E148 Safari/604.1"

        if let url = URL(string: "https://m.youtube.com/shorts") {
            webView.load(URLRequest(url: url))
        }

        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if context.coordinator.lastTrigger != swipeTrigger {
            context.coordinator.lastTrigger = swipeTrigger
            webView.evaluateJavaScript(Self.swipeUpJS, completionHandler: nil)
        }
    }

    final class Coordinator {
        weak var webView: WKWebView?
        var lastTrigger: Int = 0
    }

    /// 쇼츠 컨테이너를 찾아 한 화면만큼 위로 스크롤하고,
    /// 백업으로 ArrowDown 키 이벤트도 디스패치한다.
    private static let swipeUpJS: String = """
    (function() {
      try {
        var key = new KeyboardEvent('keydown', {
          key: 'ArrowDown', code: 'ArrowDown',
          keyCode: 40, which: 40, bubbles: true, cancelable: true
        });
        document.dispatchEvent(key);
        if (document.body) document.body.dispatchEvent(key);

        var selectors = [
          'ytm-reel-video-renderer',
          'ytd-reel-video-renderer',
          'ytm-shorts-shelf-renderer',
          '[is-shorts]',
          '#shorts-container'
        ];
        var scrolled = false;
        for (var i = 0; i < selectors.length && !scrolled; i++) {
          var els = document.querySelectorAll(selectors[i]);
          if (!els.length) continue;
          var node = els[0];
          while (node && node !== document.body) {
            var cs = getComputedStyle(node);
            var oy = cs.overflowY;
            if ((oy === 'scroll' || oy === 'auto') &&
                node.scrollHeight > node.clientHeight) {
              node.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
              scrolled = true;
              break;
            }
            node = node.parentElement;
          }
        }
        if (!scrolled) {
          window.scrollBy({ top: window.innerHeight, left: 0, behavior: 'smooth' });
        }
      } catch (e) {
        window.scrollBy(0, window.innerHeight);
      }
    })();
    """
}
