// 시선 추적 공용 모듈. classic MediaPipe FaceMesh 기반.
// 사용법:
//   import { EyeTracker } from "../../eye-tracker.js";
//   const t = new EyeTracker(videoEl, {
//     onLeft: () => {...}, onRight, onUp, onDown,
//     onFrame: (gazeX, gazeY, dir) => {...},
//     onStatus: (msg) => {...},
//   });
//   await t.start();
//   ...
//   t.stop();

const MP_VERSION = "0.4.1633559619";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MP_VERSION}`;

// refineLandmarks=true 시 인덱스
const EYE = {
  L_OUTER: 33, L_INNER: 133, L_TOP: 159, L_BOT: 145, L_IRIS: 468,
  R_OUTER: 263, R_INNER: 362, R_TOP: 386, R_BOT: 374, R_IRIS: 473,
};

function noop() {}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("스크립트 로드 실패: " + src));
    document.head.appendChild(s);
  });
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} 타임아웃 (${ms / 1000}s)`)), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

function dispX(outer, inner, iris, lm) {
  const a = lm[outer].x, b = lm[inner].x;
  const c = (a + b) / 2, h = Math.abs(a - b) / 2;
  return h < 0.001 ? 0 : (lm[iris].x - c) / h;
}

function dispY(top, bot, iris, lm) {
  const a = lm[top].y, b = lm[bot].y;
  const c = (a + b) / 2, h = Math.abs(b - a) / 2;
  return h < 0.001 ? 0 : (lm[iris].y - c) / h;
}

export class EyeTracker {
  constructor(videoEl, opts = {}) {
    this.videoEl = videoEl;
    this.triggerThreshold = opts.triggerThreshold ?? 0.35;
    this.rearmThreshold = opts.rearmThreshold ?? 0.15;
    this.cooldownMs = opts.cooldownMs ?? 700;

    this.onLeft = opts.onLeft ?? noop;
    this.onRight = opts.onRight ?? noop;
    this.onUp = opts.onUp ?? noop;
    this.onDown = opts.onDown ?? noop;
    this.onFrame = opts.onFrame ?? noop;
    this.onStatus = opts.onStatus ?? noop;

    this.enabled = true;
    this.faceMesh = null;
    this.stream = null;
    this.armedLeft = true;
    this.armedRight = true;
    this.armedUp = true;
    this.armedDown = true;
    this.lastTriggerAt = 0;
    this.stopFlag = false;
    this.lastFrameTs = 0;
  }

  setEnabled(v) { this.enabled = !!v; }

  async start() {
    this.onStatus("카메라 시작...");
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 480 },
        height: { ideal: 360 },
        frameRate: { ideal: 30 },
      },
      audio: false,
    });
    this.videoEl.srcObject = this.stream;
    await new Promise((resolve, reject) => {
      this.videoEl.addEventListener("loadeddata", resolve, { once: true });
      this.videoEl.addEventListener("error", () => reject(new Error("카메라 로드 실패")), { once: true });
    });
    await this.videoEl.play().catch(() => {});
    for (let i = 0; i < 50 && this.videoEl.videoWidth === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    this.onStatus("FaceMesh 다운로드...");
    if (typeof FaceMesh === "undefined") {
      await withTimeout(loadScript(`${MP_BASE}/face_mesh.js`), 20000, "스크립트");
    }
    if (typeof FaceMesh === "undefined") {
      throw new Error("FaceMesh 글로벌이 정의되지 않음");
    }

    this.onStatus("FaceMesh 초기화...");
    this.faceMesh = new FaceMesh({
      locateFile: (file) => `${MP_BASE}/${file}`,
    });
    this.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    this.faceMesh.onResults((results) => this._handleResults(results));

    this.onStatus("FaceMesh 워밍업...");
    await withTimeout(this.faceMesh.send({ image: this.videoEl }), 60000, "FaceMesh 첫 추론");

    this.onStatus("추적 중");
    this.stopFlag = false;
    requestAnimationFrame(() => this._frameLoop());
  }

  stop() {
    this.stopFlag = true;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.faceMesh && typeof this.faceMesh.close === "function") {
      try { this.faceMesh.close(); } catch (_) {}
      this.faceMesh = null;
    }
  }

  _handleResults(results) {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      this.onFrame(0, 0, "·");
      return;
    }
    const lm = results.multiFaceLandmarks[0];

    const dxL = dispX(EYE.L_OUTER, EYE.L_INNER, EYE.L_IRIS, lm);
    const dxR = dispX(EYE.R_OUTER, EYE.R_INNER, EYE.R_IRIS, lm);
    const gazeX = (dxL + dxR) / 2;

    const dyL = dispY(EYE.L_TOP, EYE.L_BOT, EYE.L_IRIS, lm);
    const dyR = dispY(EYE.R_TOP, EYE.R_BOT, EYE.R_IRIS, lm);
    const gazeY = (dyL + dyR) / 2;

    const absX = Math.abs(gazeX);
    const absY = Math.abs(gazeY);

    let dir = "·";
    if (absX > absY) {
      if (gazeX > this.triggerThreshold) dir = "←";
      else if (gazeX < -this.triggerThreshold) dir = "→";
    } else {
      if (gazeY < -this.triggerThreshold) dir = "↑";
      else if (gazeY > this.triggerThreshold) dir = "↓";
    }

    this.onFrame(gazeX, gazeY, dir);

    const ts = performance.now();
    if (this.enabled && ts - this.lastTriggerAt > this.cooldownMs) {
      if (dir === "←" && this.armedLeft) {
        this.armedLeft = false; this.lastTriggerAt = ts; this.onLeft();
      } else if (dir === "→" && this.armedRight) {
        this.armedRight = false; this.lastTriggerAt = ts; this.onRight();
      } else if (dir === "↑" && this.armedUp) {
        this.armedUp = false; this.lastTriggerAt = ts; this.onUp();
      } else if (dir === "↓" && this.armedDown) {
        this.armedDown = false; this.lastTriggerAt = ts; this.onDown();
      }
    }

    if (absX < this.rearmThreshold) {
      this.armedLeft = true;
      this.armedRight = true;
    }
    if (absY < this.rearmThreshold) {
      this.armedUp = true;
      this.armedDown = true;
    }
  }

  async _frameLoop() {
    if (this.stopFlag) return;
    const ts = performance.now();
    if (ts - this.lastFrameTs >= 33 && this.faceMesh && this.videoEl.videoWidth > 0) {
      this.lastFrameTs = ts;
      try { await this.faceMesh.send({ image: this.videoEl }); } catch (_) {}
    }
    if (!this.stopFlag) requestAnimationFrame(() => this._frameLoop());
  }
}
