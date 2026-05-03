import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs";

const MEDIAPIPE_WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const setupScreen = $("setup");
const playerScreen = $("player-screen");
const playlistInput = $("playlistInput");
const startBtn = $("startBtn");
const trigSlider = $("trigSlider");
const cdSlider = $("cdSlider");
const trigVal = $("trigVal");
const cdVal = $("cdVal");
const statusEl = $("status");
const rawEl = $("raw");
const dotEl = $("dot");
const toggleBtn = $("toggleBtn");
const backBtn = $("backBtn");
const exitBtn = $("exitBtn");
const camEl = $("cam");

// ---------- State ----------
let faceLandmarker = null;
let player = null;
let stream = null;
let rafId = null;
let armed = true;
let enabled = true;
let lastSwipeAt = 0;
let triggerThreshold = 0.55;
const rearmThreshold = 0.20;
let cooldownMs = 700;
let ytApiReady = false;
let lastDetectTs = -1;

// ---------- YouTube IFrame API ----------
window.onYouTubeIframeAPIReady = () => {
  ytApiReady = true;
};

function waitForYT() {
  return new Promise((resolve) => {
    if (ytApiReady) return resolve();
    const t = setInterval(() => {
      if (ytApiReady) {
        clearInterval(t);
        resolve();
      }
    }, 50);
  });
}

// ---------- Persisted settings ----------
const SETTINGS_KEY = "wf-settings-v1";
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.playlist) playlistInput.value = s.playlist;
    if (typeof s.trigger === "number") {
      triggerThreshold = s.trigger;
      trigSlider.value = String(s.trigger);
      trigVal.textContent = s.trigger.toFixed(2);
    }
    if (typeof s.cooldown === "number") {
      cooldownMs = s.cooldown;
      cdSlider.value = String(s.cooldown / 1000);
      cdVal.textContent = (s.cooldown / 1000).toFixed(1);
    }
  } catch (_) {}
}
function saveSettings() {
  const s = {
    playlist: playlistInput.value,
    trigger: triggerThreshold,
    cooldown: cooldownMs,
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch (_) {}
}

// ---------- UI bindings ----------
trigSlider.addEventListener("input", () => {
  triggerThreshold = parseFloat(trigSlider.value);
  trigVal.textContent = triggerThreshold.toFixed(2);
  saveSettings();
});

cdSlider.addEventListener("input", () => {
  cooldownMs = parseFloat(cdSlider.value) * 1000;
  cdVal.textContent = (cooldownMs / 1000).toFixed(1);
  saveSettings();
});

startBtn.addEventListener("click", async () => {
  const pid = extractPlaylistId(playlistInput.value.trim());
  if (!pid) {
    alert("재생목록 ID 또는 URL을 입력하세요.\n(예: PLxxxxxx 또는 youtube.com/playlist?list=...)");
    return;
  }
  saveSettings();
  startBtn.disabled = true;
  startBtn.textContent = "준비 중...";

  try {
    await initCamera();
    setupScreen.classList.add("hidden");
    playerScreen.classList.remove("hidden");
    statusEl.textContent = "초기화 중...";

    // YouTube와 모델을 병렬 로드: 모델이 늦게 떠도 영상은 먼저 재생됨.
    const ytReadyP = waitForYT().then(() => initPlayer(pid));
    const trackerP = initFaceLandmarker();

    await ytReadyP;
    await trackerP;

    statusEl.textContent = "추적 중";
    loop();
  } catch (e) {
    const msg = (e?.message || e) + "";
    statusEl.textContent = "오류: " + msg;
    console.error(e);
    alert("초기화 실패\n\n" + msg + "\n\n새로고침 후 다시 시도하세요.");
    cleanup();
    setupScreen.classList.remove("hidden");
    playerScreen.classList.add("hidden");
    startBtn.disabled = false;
    startBtn.textContent = "시작 (카메라 권한 필요)";
  }
});

toggleBtn.addEventListener("click", () => {
  enabled = !enabled;
  toggleBtn.textContent = enabled ? "⏸" : "▶";
});

backBtn.addEventListener("click", () => {
  if (player && typeof player.previousVideo === "function") {
    player.previousVideo();
  }
});

exitBtn.addEventListener("click", () => {
  cleanup();
  setupScreen.classList.remove("hidden");
  playerScreen.classList.add("hidden");
  startBtn.disabled = false;
  startBtn.textContent = "시작 (카메라 권한 필요)";
});

// ---------- Helpers ----------
function extractPlaylistId(input) {
  if (!input) return null;
  const m = input.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(input)) return input;
  return null;
}

async function initCamera() {
  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 480 },
      height: { ideal: 360 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  });
  camEl.srcObject = stream;
  await new Promise((resolve, reject) => {
    const ok = () => resolve();
    const fail = () => reject(new Error("카메라 영상 로드 실패"));
    camEl.addEventListener("loadeddata", ok, { once: true });
    camEl.addEventListener("error", fail, { once: true });
  });
  await camEl.play().catch(() => {});
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 타임아웃 (${ms / 1000}s)`));
    }, ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function fetchModelBuffer() {
  statusEl.textContent = "모델 다운로드 중...";
  const res = await fetch(FACE_MODEL_URL, { mode: "cors" });
  if (!res.ok) throw new Error(`모델 HTTP ${res.status}`);
  const total = parseInt(res.headers.get("content-length") || "0", 10);
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    statusEl.textContent =
      "모델 " + Math.floor((received / total) * 100) + "%";
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function initFaceLandmarker() {
  statusEl.textContent = "WASM 로딩...";
  const fileset = await withTimeout(
    FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE),
    20000,
    "WASM"
  );

  const modelBuffer = await withTimeout(fetchModelBuffer(), 60000, "모델 다운로드");

  statusEl.textContent = "엔진 초기화 중...";

  // iOS Safari는 GPU delegate가 hang하는 경우가 있어 CPU 우선.
  const tryCreate = (delegate) =>
    withTimeout(
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetBuffer: modelBuffer,
          delegate,
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
        runningMode: "VIDEO",
        numFaces: 1,
      }),
      15000,
      `${delegate} 초기화`
    );

  try {
    faceLandmarker = await tryCreate("CPU");
  } catch (e) {
    statusEl.textContent = "CPU 실패, GPU 시도...";
    faceLandmarker = await tryCreate("GPU");
  }
}

function initPlayer(playlistId) {
  player = new YT.Player("player", {
    height: "100%",
    width: "100%",
    playerVars: {
      listType: "playlist",
      list: playlistId,
      playsinline: 1,
      autoplay: 1,
      controls: 1,
      modestbranding: 1,
      rel: 0,
      fs: 1,
    },
    events: {
      onError: (e) => {
        statusEl.textContent = "재생 오류 코드: " + e.data;
      },
    },
  });
}

function loop() {
  rafId = requestAnimationFrame(loop);
  if (!faceLandmarker || !camEl.videoWidth) return;

  const ts = performance.now();
  if (ts === lastDetectTs) return;
  lastDetectTs = ts;

  let result;
  try {
    result = faceLandmarker.detectForVideo(camEl, ts);
  } catch (e) {
    return;
  }

  if (!result?.faceBlendshapes?.length) {
    rawEl.textContent = "얼굴 미검출";
    dotEl.classList.remove("active");
    return;
  }

  const cats = result.faceBlendshapes[0].categories;
  const lookUpL = cats.find((c) => c.categoryName === "eyeLookUpLeft")?.score ?? 0;
  const lookUpR = cats.find((c) => c.categoryName === "eyeLookUpRight")?.score ?? 0;
  const value = (lookUpL + lookUpR) / 2;

  rawEl.textContent = "up=" + value.toFixed(2);
  dotEl.classList.toggle("active", value > triggerThreshold);

  if (enabled && armed && value > triggerThreshold) {
    armed = false;
    if (ts - lastSwipeAt > cooldownMs) {
      lastSwipeAt = ts;
      triggerNext();
    }
  } else if (!armed && value < rearmThreshold) {
    armed = true;
  }
}

function triggerNext() {
  if (player && typeof player.nextVideo === "function") {
    player.nextVideo();
  }
}

function cleanup() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (player && typeof player.destroy === "function") {
    player.destroy();
    player = null;
  }
  if (faceLandmarker && typeof faceLandmarker.close === "function") {
    faceLandmarker.close();
    faceLandmarker = null;
  }
}

// Pause tracking when tab hidden (iOS suspends it anyway).
document.addEventListener("visibilitychange", () => {
  if (document.hidden && rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  } else if (!document.hidden && faceLandmarker && !rafId) {
    loop();
  }
});

// Service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// Init
loadSettings();
