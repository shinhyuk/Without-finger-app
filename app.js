// Classic MediaPipe FaceMesh (iOS Safari 호환성 위해 Tasks Vision에서 전환)
// FaceMesh는 dynamic loadScript로 가져옴 → ES module import 안 씀

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

let faceMesh = null;
let player = null;
let stream = null;
let enabled = true;
let armedLeft = true, armedRight = true, armedUp = true, armedDown = true;
let lastTriggerAt = 0;
let triggerThreshold = 0.35;
const rearmThreshold = 0.15;
let cooldownMs = 700;
let ytApiReady = false;
let stopFlag = false;
let lastFrameTs = 0;

const MP_VERSION = "0.4.1633559619";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MP_VERSION}`;

// MediaPipe FaceMesh refineLandmarks=true 인덱스
const EYE = {
  // 좌안 (사용자 왼쪽 눈)
  L_OUTER: 33, L_INNER: 133, L_TOP: 159, L_BOT: 145, L_IRIS: 468,
  // 우안
  R_OUTER: 263, R_INNER: 362, R_TOP: 386, R_BOT: 374, R_IRIS: 473,
};

// ---------- YouTube IFrame ----------
// race condition 방어: iframe_api가 우리 핸들러보다 먼저 콜백 호출했을 수도 있음.
if (typeof YT !== "undefined" && YT.Player) {
  ytApiReady = true;
}
window.onYouTubeIframeAPIReady = () => { ytApiReady = true; };
function waitForYT() {
  if (ytApiReady) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setInterval(() => {
      if (ytApiReady || (typeof YT !== "undefined" && YT.Player)) {
        ytApiReady = true;
        clearInterval(t);
        resolve();
      }
    }, 50);
  });
}

// ---------- Settings ----------
// v2: 시선 명령 매핑 변경 (좌/우=영상, 상/하=볼륨) → 임계값 스케일 다름
const SETTINGS_KEY = "wf-settings-v2";
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
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      playlist: playlistInput.value,
      trigger: triggerThreshold,
      cooldown: cooldownMs,
    }));
  } catch (_) {}
}

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

// ---------- Start flow ----------
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

    const ytReadyP = waitForYT().then(() => initPlayer(pid));
    const trackerP = initFaceMesh();

    await ytReadyP;
    statusEl.textContent = "유튜브 준비됨, 얼굴 인식 로딩...";

    await trackerP;

    statusEl.textContent = "추적 중";
    stopFlag = false;
    requestAnimationFrame(frameLoop);
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
  if (player && typeof player.previousVideo === "function") player.previousVideo();
});
exitBtn.addEventListener("click", () => {
  cleanup();
  setupScreen.classList.remove("hidden");
  playerScreen.classList.add("hidden");
  startBtn.disabled = false;
  startBtn.textContent = "시작 (카메라 권한 필요)";
});

// 카메라 미리보기 탭하면 수동으로 다음 영상 (face tracking 없이도 테스트 가능)
camEl.addEventListener("click", () => triggerNext());

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
    camEl.addEventListener("loadeddata", resolve, { once: true });
    camEl.addEventListener("error", () => reject(new Error("카메라 로드 실패")), { once: true });
  });
  await camEl.play().catch(() => {});
  // videoWidth가 0이 아닌 게 보장될 때까지 잠깐 대기
  for (let i = 0; i < 50 && camEl.videoWidth === 0; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

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

async function initFaceMesh() {
  statusEl.textContent = "FaceMesh 스크립트 다운로드...";
  if (typeof FaceMesh === "undefined") {
    await withTimeout(loadScript(`${MP_BASE}/face_mesh.js`), 20000, "스크립트");
  }
  if (typeof FaceMesh === "undefined") {
    throw new Error("FaceMesh 글로벌이 정의되지 않음");
  }

  statusEl.textContent = "FaceMesh 인스턴스 생성...";
  faceMesh = new FaceMesh({
    locateFile: (file) => `${MP_BASE}/${file}`,
  });
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  faceMesh.onResults(handleResults);

  statusEl.textContent = "FaceMesh 워밍업 (모델 로딩)...";
  // 첫 send가 내부적으로 WASM/모델을 로드함 → 완료될 때까지 대기
  await withTimeout(faceMesh.send({ image: camEl }), 60000, "FaceMesh 첫 추론");
}

// 한 눈에 대해 (iris - 중심) / 반축길이 = -1..+1 정규 변위.
// x: 카메라 image 좌표는 mirror된 사용자 시선과 반대지만 좌/우안 모두
//    "사용자가 왼쪽을 보면" iris가 image의 더 큰 x로 이동 → disp 양수.
function dispX(outerIdx, innerIdx, irisIdx, lm) {
  const a = lm[outerIdx].x, b = lm[innerIdx].x;
  const center = (a + b) / 2;
  const half = Math.abs(a - b) / 2;
  if (half < 0.001) return 0;
  return (lm[irisIdx].x - center) / half;
}
function dispY(topIdx, botIdx, irisIdx, lm) {
  const a = lm[topIdx].y, b = lm[botIdx].y;
  const center = (a + b) / 2;
  const half = Math.abs(b - a) / 2;
  if (half < 0.001) return 0;
  return (lm[irisIdx].y - center) / half;
}

function fmtSigned(v) {
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}

function handleResults(results) {
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    rawEl.textContent = "얼굴 미검출";
    dotEl.classList.remove("active");
    return;
  }
  const lm = results.multiFaceLandmarks[0];

  const dxL = dispX(EYE.L_OUTER, EYE.L_INNER, EYE.L_IRIS, lm);
  const dxR = dispX(EYE.R_OUTER, EYE.R_INNER, EYE.R_IRIS, lm);
  const gazeX = (dxL + dxR) / 2; // +: 사용자가 왼쪽을 봄 / -: 오른쪽

  const dyL = dispY(EYE.L_TOP, EYE.L_BOT, EYE.L_IRIS, lm);
  const dyR = dispY(EYE.R_TOP, EYE.R_BOT, EYE.R_IRIS, lm);
  const gazeY = (dyL + dyR) / 2; // +: 아래 / -: 위

  const absX = Math.abs(gazeX);
  const absY = Math.abs(gazeY);

  // 두 축이 동시에 임계값 넘으면 더 큰 쪽으로만 분기.
  let dir = "·";
  if (absX > absY) {
    if (gazeX > triggerThreshold) dir = "←";
    else if (gazeX < -triggerThreshold) dir = "→";
  } else {
    if (gazeY < -triggerThreshold) dir = "↑";
    else if (gazeY > triggerThreshold) dir = "↓";
  }

  rawEl.textContent = `${fmtSigned(gazeX)} ${fmtSigned(gazeY)} ${dir}`;
  dotEl.classList.toggle("active", dir !== "·");

  const ts = performance.now();
  if (enabled && ts - lastTriggerAt > cooldownMs) {
    if (dir === "←" && armedLeft) {
      armedLeft = false; lastTriggerAt = ts; triggerPrev();
    } else if (dir === "→" && armedRight) {
      armedRight = false; lastTriggerAt = ts; triggerNext();
    } else if (dir === "↑" && armedUp) {
      armedUp = false; lastTriggerAt = ts; triggerVolUp();
    } else if (dir === "↓" && armedDown) {
      armedDown = false; lastTriggerAt = ts; triggerVolDown();
    }
  }

  // 축 별로 중립 복귀 시 재무장.
  if (absX < rearmThreshold) {
    armedLeft = true;
    armedRight = true;
  }
  if (absY < rearmThreshold) {
    armedUp = true;
    armedDown = true;
  }
}

async function frameLoop() {
  if (stopFlag) return;
  const ts = performance.now();
  if (ts - lastFrameTs >= 33 && faceMesh && camEl.videoWidth > 0) {
    lastFrameTs = ts;
    try {
      await faceMesh.send({ image: camEl });
    } catch (_) {}
  }
  if (!stopFlag) requestAnimationFrame(frameLoop);
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

function triggerNext() {
  if (player && typeof player.nextVideo === "function") player.nextVideo();
}
function triggerPrev() {
  if (player && typeof player.previousVideo === "function") player.previousVideo();
}
function triggerVolUp() {
  if (!player || typeof player.setVolume !== "function") return;
  if (typeof player.isMuted === "function" && player.isMuted()) {
    try { player.unMute(); } catch (_) {}
  }
  const cur = typeof player.getVolume === "function" ? player.getVolume() : 50;
  player.setVolume(Math.min(100, (cur || 0) + 10));
}
function triggerVolDown() {
  if (!player || typeof player.setVolume !== "function") return;
  const cur = typeof player.getVolume === "function" ? player.getVolume() : 50;
  player.setVolume(Math.max(0, (cur || 0) - 10));
}

function cleanup() {
  stopFlag = true;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (player && typeof player.destroy === "function") {
    try { player.destroy(); } catch (_) {}
    player = null;
  }
  if (faceMesh && typeof faceMesh.close === "function") {
    try { faceMesh.close(); } catch (_) {}
    faceMesh = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopFlag = true;
  } else if (faceMesh) {
    stopFlag = false;
    requestAnimationFrame(frameLoop);
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

loadSettings();
