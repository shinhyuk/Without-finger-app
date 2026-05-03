import { EyeTracker } from "../../eye-tracker.js";

const $ = (id) => document.getElementById(id);
const setupScreen = $("setup");
const gameScreen = $("game");
const startEyeBtn = $("startEyeBtn");
const startTouchBtn = $("startTouchBtn");
const exitEyeBtn = $("exitEyeBtn");
const restartBtn = $("restartBtn");
const messageBtn = $("messageBtn");
const messageEl = $("message");
const messageText = $("message-text");
const boardEl = $("board");
const scoreEl = $("score");
const bestEl = $("best");
const hudEl = $("hud");
const statusEl = $("status");
const dirEl = $("dir");
const dotEl = $("dot");
const camEl = $("cam");

const SIZE = 4;
const BEST_KEY = "wf-2048-best";

let grid, score, gameOver, won, continueAfterWin = false;
let best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10);
let tracker = null;

// ---------- Game logic ----------
function emptyGrid() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
}

function reset() {
  grid = emptyGrid();
  score = 0;
  gameOver = false;
  won = false;
  continueAfterWin = false;
  spawn();
  spawn();
  hideMessage();
  render();
}

function spawn() {
  const empties = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) empties.push([r, c]);
    }
  }
  if (empties.length === 0) return null;
  const [r, c] = empties[Math.floor(Math.random() * empties.length)];
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  return [r, c];
}

// Slide a single line to the start (index 0). Returns {line, gain, mergedAt}
function slideLine(line) {
  const filtered = line.filter((v) => v !== 0);
  const out = [];
  const mergedAt = []; // 인덱스 in `out` 가 새로 합쳐진 위치
  let gain = 0;
  let i = 0;
  while (i < filtered.length) {
    if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
      const sum = filtered[i] * 2;
      out.push(sum);
      mergedAt.push(out.length - 1);
      gain += sum;
      i += 2;
    } else {
      out.push(filtered[i]);
      i++;
    }
  }
  while (out.length < SIZE) out.push(0);
  return { line: out, gain, mergedAt };
}

function move(direction) {
  if (gameOver) return false;
  if (won && !continueAfterWin) return false;

  const before = JSON.stringify(grid);
  let totalGain = 0;
  const mergedCells = new Set();

  if (direction === "left") {
    for (let r = 0; r < SIZE; r++) {
      const { line, gain, mergedAt } = slideLine(grid[r]);
      grid[r] = line;
      totalGain += gain;
      for (const c of mergedAt) mergedCells.add(`${r},${c}`);
    }
  } else if (direction === "right") {
    for (let r = 0; r < SIZE; r++) {
      const reversed = [...grid[r]].reverse();
      const { line, gain, mergedAt } = slideLine(reversed);
      grid[r] = line.reverse();
      totalGain += gain;
      for (const idx of mergedAt) mergedCells.add(`${r},${SIZE - 1 - idx}`);
    }
  } else if (direction === "up") {
    for (let c = 0; c < SIZE; c++) {
      const col = [];
      for (let r = 0; r < SIZE; r++) col.push(grid[r][c]);
      const { line, gain, mergedAt } = slideLine(col);
      for (let r = 0; r < SIZE; r++) grid[r][c] = line[r];
      totalGain += gain;
      for (const r of mergedAt) mergedCells.add(`${r},${c}`);
    }
  } else if (direction === "down") {
    for (let c = 0; c < SIZE; c++) {
      const col = [];
      for (let r = 0; r < SIZE; r++) col.push(grid[r][c]);
      col.reverse();
      const { line, gain, mergedAt } = slideLine(col);
      const reversed = line.reverse();
      for (let r = 0; r < SIZE; r++) grid[r][c] = reversed[r];
      totalGain += gain;
      for (const idx of mergedAt) mergedCells.add(`${SIZE - 1 - idx},${c}`);
    }
  }

  const moved = JSON.stringify(grid) !== before;
  if (!moved) return false;

  score += totalGain;
  if (score > best) {
    best = score;
    try { localStorage.setItem(BEST_KEY, String(best)); } catch (_) {}
  }

  const spawnPos = spawn();

  // 최대값 검사
  let maxVal = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] > maxVal) maxVal = grid[r][c];
    }
  }
  if (maxVal >= 2048 && !won) {
    won = true;
  }

  if (!hasAnyMove()) {
    gameOver = true;
  }

  render(mergedCells, spawnPos);

  if (gameOver) {
    showMessage("게임 오버", "다시 시작");
  } else if (won && !continueAfterWin) {
    showMessage("2048 달성! 🎉", "계속 플레이");
  }

  return true;
}

function hasAnyMove() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) return true;
      if (c + 1 < SIZE && grid[r][c] === grid[r][c + 1]) return true;
      if (r + 1 < SIZE && grid[r][c] === grid[r + 1][c]) return true;
    }
  }
  return false;
}

// ---------- Rendering ----------
function buildBoardCells() {
  boardEl.innerHTML = "";
  for (let i = 0; i < SIZE * SIZE; i++) {
    const cell = document.createElement("div");
    cell.className = "cell empty";
    boardEl.appendChild(cell);
  }
}

function render(mergedCells = new Set(), spawnPos = null) {
  const cells = boardEl.children;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const idx = r * SIZE + c;
      const v = grid[r][c];
      const cell = cells[idx];
      cell.textContent = v || "";
      cell.className = "cell" + (v ? ` v${v}` : " empty");
      if (mergedCells.has(`${r},${c}`)) cell.classList.add("merged");
      if (spawnPos && spawnPos[0] === r && spawnPos[1] === c) cell.classList.add("spawned");
    }
  }
  scoreEl.textContent = score;
  bestEl.textContent = best;
}

function showMessage(text, btnText) {
  messageText.textContent = text;
  messageBtn.textContent = btnText;
  messageEl.classList.remove("hidden");
}
function hideMessage() { messageEl.classList.add("hidden"); }

// ---------- Input ----------
function handleDirection(d) {
  // 메시지 떠 있을 때 시선 입력은 무시 (재시작 버튼만 받음)
  if (!messageEl.classList.contains("hidden")) return;
  move(d);
}

document.addEventListener("keydown", (e) => {
  const map = {
    ArrowLeft: "left", ArrowRight: "right",
    ArrowUp: "up", ArrowDown: "down",
    a: "left", d: "right", w: "up", s: "down",
  };
  const d = map[e.key];
  if (d) {
    e.preventDefault();
    handleDirection(d);
  }
});

// 보드 위 스와이프
let touchStart = null;
boardEl.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1) {
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
}, { passive: true });
boardEl.addEventListener("touchend", (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx < 24 && ady < 24) return;
  if (adx > ady) {
    handleDirection(dx > 0 ? "right" : "left");
  } else {
    handleDirection(dy > 0 ? "down" : "up");
  }
});

// ---------- Buttons ----------
restartBtn.addEventListener("click", reset);
messageBtn.addEventListener("click", () => {
  if (won && !gameOver && !continueAfterWin) {
    continueAfterWin = true;
    hideMessage();
  } else {
    reset();
  }
});

startTouchBtn.addEventListener("click", () => {
  setupScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  reset();
});

startEyeBtn.addEventListener("click", async () => {
  startEyeBtn.disabled = true;
  startEyeBtn.textContent = "준비 중...";
  setupScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  hudEl.classList.remove("hidden");
  camEl.classList.remove("hidden");
  reset();

  tracker = new EyeTracker(camEl, {
    onLeft: () => handleDirection("left"),
    onRight: () => handleDirection("right"),
    onUp: () => handleDirection("up"),
    onDown: () => handleDirection("down"),
    onFrame: (gx, gy, dir) => {
      dirEl.textContent = dir;
      dotEl.classList.toggle("active", dir !== "·");
    },
    onStatus: (msg) => {
      statusEl.textContent = msg;
    },
  });

  try {
    await tracker.start();
  } catch (e) {
    statusEl.textContent = "오류: " + (e?.message || e);
    alert("시선 추적 초기화 실패\n\n" + (e?.message || e) + "\n\n키보드/스와이프로는 계속 플레이 가능합니다.");
    hudEl.classList.add("hidden");
    camEl.classList.add("hidden");
    tracker = null;
    startEyeBtn.disabled = false;
    startEyeBtn.textContent = "👁️ 시선 켜고 시작";
  }
});

exitEyeBtn.addEventListener("click", () => {
  if (tracker) {
    tracker.stop();
    tracker = null;
  }
  hudEl.classList.add("hidden");
  camEl.classList.add("hidden");
});

// ---------- Init ----------
buildBoardCells();
bestEl.textContent = best;
