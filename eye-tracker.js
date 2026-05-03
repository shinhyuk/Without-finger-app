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
    this.triggerThreshold = opts.triggerThreshold ?? 0.25;
    this.rearmThreshold = opts.rearmThreshold ?? 0.10;
    this.cooldownMs = opts.cooldownMs ?? 500;
    // 사용자가 정지 상태일 때 baseline이 천천히 따라가는 시간 상수.
    // 5초 → 짧은 시선 이동에는 baseline이 거의 안 움직임.
    this.baselineTau = opts.baselineTau ?? 5000;
    this.warmupFrames = opts.warmupFrames ?? 30;

    this.onLeft = opts.onLeft ?? noop;
    this.onRight = opts.onRight ?? noop;
    this.onUp = opts.onUp ?? noop;
    this.onDown = opts.onDown ?? noop;
    this.onFrame = opts.onFrame ?? noop;
    this.onStatus = opts.onStatus ?? noop;

    this.enabled = true;
    this.faceMesh = null;
    this.stream = null;

    // 모든 방향이 같은 armed 상태를 공유: 한 번 트리거하면 사용자가
    // baseline 근처(rearmThreshold 이내)로 돌아와야 다음 트리거가 가능.
    // 이게 "왔다 갔다" 동작이 양쪽 방향을 동시에 발화시키는 걸 막아준다.
    this.armed = true;
    this.lastTriggerAt = 0;
    this.stopFlag = false;
    this.lastFrameTs = 0;

    this._baselineSamples = [];
    this.baselineX = null;
    this.baselineY = null;
    this._lastTickTs = 0;
  }

  setEnabled(v) { this.enabled = !!v; }

  // 보정 다시 하기 (카메라 위치 바뀜, 자세 바뀜 등에 사용).
  recalibrate() {
    this._baselineSamples = [];
    this.baselineX = null;
    this.baselineY = null;
    this.armed = true;
    this.lastTriggerAt = 0;
  }

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

    const rawX = (
      dispX(EYE.L_OUTER, EYE.L_INNER, EYE.L_IRIS, lm) +
      dispX(EYE.R_OUTER, EYE.R_INNER, EYE.R_IRIS, lm)
    ) / 2;
    const rawY = (
      dispY(EYE.L_TOP, EYE.L_BOT, EYE.L_IRIS, lm) +
      dispY(EYE.R_TOP, EYE.R_BOT, EYE.R_IRIS, lm)
    ) / 2;

    const ts = performance.now();

    // ---- 1) Warmup: 첫 N프레임 평균을 baseline으로 잡음.
    if (this._baselineSamples.length < this.warmupFrames) {
      this._baselineSamples.push({ x: rawX, y: rawY });
      if (this._baselineSamples.length === this.warmupFrames) {
        const n = this.warmupFrames;
        this.baselineX = this._baselineSamples.reduce((s, p) => s + p.x, 0) / n;
        this.baselineY = this._baselineSamples.reduce((s, p) => s + p.y, 0) / n;
        this.onStatus("추적 중");
      } else {
        this.onStatus(`보정 ${this._baselineSamples.length}/${this.warmupFrames} (정면 응시)`);
      }
      this.onFrame(0, 0, "·");
      this._lastTickTs = ts;
      return;
    }

    // ---- 2) Baseline 천천히 따라가게 (정지 상태일 때만).
    // armed=false 동안 (즉 사용자가 일부러 시선을 옮긴 상태) baseline은
    // 갱신하지 않아서 "원래대로 돌아가는 동작"이 정확히 -delta로 잡혀
    // 재무장 트리거가 정확히 동작.
    if (this.armed && this._lastTickTs) {
      const dt = ts - this._lastTickTs;
      const alpha = 1 - Math.exp(-dt / this.baselineTau);
      this.baselineX += alpha * (rawX - this.baselineX);
      this.baselineY += alpha * (rawY - this.baselineY);
    }
    this._lastTickTs = ts;

    // ---- 3) 이동량 (delta from baseline) 으로 방향 판정.
    const dx = rawX - this.baselineX;
    const dy = rawY - this.baselineY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    let dir = "·";
    if (absX > absY) {
      if (dx > this.triggerThreshold) dir = "←";
      else if (dx < -this.triggerThreshold) dir = "→";
    } else {
      if (dy < -this.triggerThreshold) dir = "↑";
      else if (dy > this.triggerThreshold) dir = "↓";
    }

    this.onFrame(dx, dy, dir);

    // ---- 4) 단일 armed 플래그: 한 번 발화하면 baseline 근처 복귀까지 잠금.
    // 이게 "look left → return to center"가 right로 잘못 발화되는 걸 막아준다.
    if (this.enabled && this.armed && ts - this.lastTriggerAt > this.cooldownMs) {
      if (dir !== "·") {
        this.armed = false;
        this.lastTriggerAt = ts;
        if (dir === "←") this.onLeft();
        else if (dir === "→") this.onRight();
        else if (dir === "↑") this.onUp();
        else if (dir === "↓") this.onDown();
      }
    }

    // ---- 5) 재무장: 양 축 모두 baseline 근처로 돌아와야 함.
    if (!this.armed && absX < this.rearmThreshold && absY < this.rearmThreshold) {
      this.armed = true;
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
