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

// 시선 베이스라인 자동 보정.
// 카메라 각도/얼굴 비대칭 때문에 "정면 응시" 시 gazeX/gazeY가 0이 아닌 경우가 많음.
// 시작 시 N프레임 평균을 베이스라인으로, 이후 중립 구간에서 천천히 드리프트.
let baselineX = 0, baselineY = 0, basePitch = 0;
let calibFrames = 0;
const CALIB_FRAMES = 30;
const BASELINE_ALPHA = 0.01;
let lastFaceTs = 0;
const FACE_LOST_RESET_MS = 1500;

// 머리 pitch(끄덕임)와 eye gaze Y를 모두 받되 SUM이 아닌 MAX(절댓값) 으로 결합.
// 이유: 머리만 끄덕이면 VOR(전정안반사)로 눈은 화면 유지 위해 반대로 보정 → eye gaze Y와
// pitch가 부호 반대로 나와 SUM시 서로 상쇄돼 0 근처로 깎임. MAX는 상쇄 없이 강한 신호가
// 살아남음. 둘 중 어느 쪽이든 임계값 넘으면 트리거.
const PITCH_SCALE = 7;

const MP_VERSION = "0.4.1633559619";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@${MP_VERSION}`;

// MediaPipe FaceMesh refineLandmarks=true 인덱스.
// 눈꺼풀 점은 시선 따라 같이 움직여서 세로 기준으로 못 씀 → corner + iris 경계점만 사용.
const EYE = {
  L_OUTER: 33, L_INNER: 133, L_IRIS: 468, L_IRIS_RING: [469, 470, 471, 472],
  R_OUTER: 263, R_INNER: 362, R_IRIS: 473, R_IRIS_RING: [474, 475, 476, 477],
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

// 안구 중심은 눈 양 끝(corner) 중점 — 시선과 무관해서 안정적.
// X 정규화 단위는 corner 거리의 절반 (눈 폭).
// Y 정규화 단위는 iris 반지름 — corner 거리는 세로 iris 가동 범위보다 너무 커서
// 위/아래 변위가 임계값을 못 넘김 (iris 반지름이 세로 운동 한계와 비슷한 스케일).
function irisRadius(centerIdx, ringIdxs, lm) {
  const c = lm[centerIdx];
  let sum = 0;
  for (const i of ringIdxs) {
    const p = lm[i];
    sum += Math.hypot(p.x - c.x, p.y - c.y);
  }
  return sum / ringIdxs.length;
}
function eyeGaze(outerIdx, innerIdx, irisIdx, ringIdxs, lm) {
  const o = lm[outerIdx], i = lm[innerIdx], r = lm[irisIdx];
  const cx = (o.x + i.x) / 2;
  const cy = (o.y + i.y) / 2;
  const halfX = Math.hypot(o.x - i.x, o.y - i.y) / 2;
  const radY = irisRadius(irisIdx, ringIdxs, lm);
  if (halfX < 0.001 || radY < 0.001) return { x: 0, y: 0 };
  return { x: (r.x - cx) / halfX, y: (r.y - cy) / radY };
}

// 머리 pitch: 코 끝(1)과 양 눈 corner 평균 y의 차이를 두 눈 거리로 정규화.
// 정면 응시 시 baseline ≈ +0.4 (코가 눈 아래 있으니까).
// 머리 숙이면 foreshortening으로 코가 눈에 가까워짐 → 값 감소 (위쪽).
// 머리 들면 코가 더 아래로 보임 → 값 증가 (아래쪽).
// 우리 컨벤션 (+ = 아래)와 일치하므로 그대로 합산.
function headPitch(lm) {
  const lo = lm[33], li = lm[133], ro = lm[263], ri = lm[362];
  const eyeMidY = (lo.y + li.y + ro.y + ri.y) / 4;
  const eyeWidth = Math.hypot(ro.x - lo.x, ro.y - lo.y);
  const nose = lm[1];
  if (eyeWidth < 0.001) return 0;
  return (nose.y - eyeMidY) / eyeWidth;
}

function fmtSigned(v) {
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}

function handleResults(results) {
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    if (lastFaceTs > 0 && performance.now() - lastFaceTs > FACE_LOST_RESET_MS) {
      calibFrames = 0; baselineX = 0; baselineY = 0; basePitch = 0;
    }
    rawEl.textContent = "얼굴 미검출";
    dotEl.classList.remove("active");
    return;
  }
  lastFaceTs = performance.now();
  const lm = results.multiFaceLandmarks[0];

  const gL = eyeGaze(EYE.L_OUTER, EYE.L_INNER, EYE.L_IRIS, EYE.L_IRIS_RING, lm);
  const gR = eyeGaze(EYE.R_OUTER, EYE.R_INNER, EYE.R_IRIS, EYE.R_IRIS_RING, lm);
  const gazeX = (gL.x + gR.x) / 2; // image 기준 raw 시선 변위
  const gazeY = (gL.y + gR.y) / 2;
  const pitch = headPitch(lm);

  if (calibFrames < CALIB_FRAMES) {
    baselineX = (baselineX * calibFrames + gazeX) / (calibFrames + 1);
    baselineY = (baselineY * calibFrames + gazeY) / (calibFrames + 1);
    basePitch = (basePitch * calibFrames + pitch) / (calibFrames + 1);
    calibFrames++;
    rawEl.textContent = `정면 응시 보정중 ${calibFrames}/${CALIB_FRAMES}`;
    dotEl.classList.remove("active");
    return;
  }

  // 베이스라인 빼서 "중립 = 0" 좌표계로. +: 사용자 왼쪽 / 아래.
  const adjX = gazeX - baselineX;
  const adjGazeY = gazeY - baselineY;
  const rawPitchDev = pitch - basePitch;
  const adjPitch = rawPitchDev * PITCH_SCALE;
  // VOR로 두 신호가 반대 부호로 상쇄될 수 있어 SUM 대신 절댓값 큰 쪽 채택.
  const adjY = Math.abs(adjGazeY) > Math.abs(adjPitch) ? adjGazeY : adjPitch;
  const absX = Math.abs(adjX);
  const absY = Math.abs(adjY);

  // 각 축 독립적으로 임계값 검사 (이전 winner-takes-all은 X 노이즈가 Y 트리거를 막음).
  let xTrig = "";
  if (adjX > triggerThreshold) xTrig = "←";
  else if (adjX < -triggerThreshold) xTrig = "→";
  let yTrig = "";
  if (adjY < -triggerThreshold) yTrig = "↑";
  else if (adjY > triggerThreshold) yTrig = "↓";
  // 두 축 모두 트리거되면 절댓값 큰 쪽이 우선.
  let dir = "·";
  if (xTrig && yTrig) dir = absX > absY ? xTrig : yTrig;
  else if (xTrig) dir = xTrig;
  else if (yTrig) dir = yTrig;

  // 디버그 가독성: 어느 신호가 트리거에 기여하는지 보이도록 eye/pitch 분리 표시.
  rawEl.textContent = `X${fmtSigned(adjX)} eY${fmtSigned(adjGazeY)} pY${fmtSigned(adjPitch)} ${dir}`;
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

  // 중립 구간에서만 베이스라인 천천히 갱신 (raw 단위로).
  if (absX < rearmThreshold && absY < rearmThreshold) {
    baselineX += BASELINE_ALPHA * adjX;
    baselineY += BASELINE_ALPHA * adjGazeY;
    basePitch += BASELINE_ALPHA * rawPitchDev;
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
  calibFrames = 0; baselineX = 0; baselineY = 0; basePitch = 0; lastFaceTs = 0;
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
