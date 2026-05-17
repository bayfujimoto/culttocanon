// ── Press-and-hold dither gate ───────────────────────────────────────────────
// The success/reset hooks are injected via initGate({ onSuccess, onReset })
// so the passkey ceremony can be wired in by the caller.
//
// Mirrors src/runtime/ctc-image-reveal.js where applicable. Same Bayer 4x4
// matrix the build pipeline uses (BAYER4 in build/dither.js). WIN=0.5 per-cell
// window matches the Read pane reveal. Phase is radial from the touch point:
// cells nearest the press start immediately, cells at the far corner start at
// (1 - WIN), all finish by progress = 1.

const W = 80, H = 80;
const CW = 4, CH = 4;
const COLS = Math.ceil(W / CW);
const ROWS = Math.ceil(H / CH);
const DUR = 1250;
const WIN = 0.5;
const REVERSE_DUR = 320;

const BAYER4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];

// Ink = admin phosphor; paper = true black.
const INK = [0x33, 0xff, 0x33];
const PAPER = [0, 0, 0];

export function initGate({ onSuccess, onReset } = {}) {
  const canvas = document.getElementById("gate");
  const stage  = document.getElementById("stage");
  const hint   = document.getElementById("hint");

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const imageData = ctx.createImageData(W, H);

  const state = {
    pressing: false,
    pressStart: 0,
    revealed: false,
    releaseStart: 0,
    cellPhases: new Float32Array(COLS * ROWS),
  };

  fillBlack();

  // ── Input ──────────────────────────────────────────────────────────────────

  stage.addEventListener("pointerdown", onPointerDown);
  stage.addEventListener("pointerup", onPointerUp);
  stage.addEventListener("pointercancel", onPointerUp);
  stage.addEventListener("contextmenu", (e) => e.preventDefault());

  // Keyboard fallback: space or enter holds the gate from canvas center.
  let kbHolding = false;
  window.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    if (kbHolding) return; // ignore auto-repeat
    e.preventDefault();
    kbHolding = true;
    startPress(W / 2, H / 2);
  });
  window.addEventListener("keyup", (e) => {
    if (e.key !== " " && e.key !== "Enter") return;
    if (!kbHolding) return;
    kbHolding = false;
    endPress();
  });

  function onPointerDown(e) {
    e.preventDefault();
    if (state.revealed) { reset(); return; }
    if (state.releaseStart) return;
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    const { px, py } = pointerToBuffer(e);
    startPress(px, py);
  }

  function onPointerUp() {
    if (!state.pressing) return;
    endPress();
  }

  function pointerToBuffer(e) {
    const r = canvas.getBoundingClientRect();
    return {
      px: Math.max(0, Math.min(W - 1, Math.floor((e.clientX - r.left) * W / r.width))),
      py: Math.max(0, Math.min(H - 1, Math.floor((e.clientY - r.top)  * H / r.height))),
    };
  }

  function startPress(px, py) {
    computeRadialPhases(px, py);
    state.pressing = true;
    state.pressStart = performance.now();
    hint.classList.add("hidden");
    requestAnimationFrame(frame);
  }

  function endPress() {
    state.pressing = false;
    if (state.revealed) return;
    state.releaseStart = performance.now();
    requestAnimationFrame(frame);
  }

  // ── Per-cell phase: distance from touch point, normalized to (1-WIN). ──

  function computeRadialPhases(px, py) {
    const corners = [
      Math.hypot(0     - px, 0     - py),
      Math.hypot(W - 1 - px, 0     - py),
      Math.hypot(0     - px, H - 1 - py),
      Math.hypot(W - 1 - px, H - 1 - py),
    ];
    const maxDist = Math.max.apply(null, corners) || 1;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const cellCx = col * CW + CW / 2;
        const cellCy = row * CH + CH / 2;
        const dist = Math.hypot(cellCx - px, cellCy - py);
        state.cellPhases[row * COLS + col] = (dist / maxDist) * (1 - WIN);
      }
    }
  }

  // ── Animation loop ──────────────────────────────────────────────────────────

  function frame(now) {
    if (state.pressing) {
      const progress = (now - state.pressStart) / DUR;
      if (progress >= 1) {
        renderFullDither();
        state.revealed = true;
        state.pressing = false;
        onSuccess?.();
        return;
      }
      renderPress(progress);
      requestAnimationFrame(frame);
      return;
    }
    if (state.releaseStart) {
      const elapsed = now - state.releaseStart;
      if (elapsed >= REVERSE_DUR) {
        state.releaseStart = 0;
        fillBlack();
        hint.classList.remove("hidden");
        return;
      }
      const fade = 1 - elapsed / REVERSE_DUR;
      renderUniform(fade);
      requestAnimationFrame(frame);
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  function pixel(px, py, lit) {
    const i = (py * W + px) * 4;
    const c = lit ? INK : PAPER;
    imageData.data[i]     = c[0];
    imageData.data[i + 1] = c[1];
    imageData.data[i + 2] = c[2];
    imageData.data[i + 3] = 255;
  }

  // Mid-press: each cell's brightness = clamp((progress - phase) / WIN, 0, 1).
  // A pixel is lit iff its Bayer threshold falls under the cell's brightness.
  function renderPress(progress) {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const phase = state.cellPhases[row * COLS + col];
        const cellT = Math.max(0, Math.min(1, (progress - phase) / WIN));
        for (let cy = 0; cy < CH; cy++) {
          for (let cx = 0; cx < CW; cx++) {
            const px = col * CW + cx;
            const py = row * CH + cy;
            if (px >= W || py >= H) continue;
            const threshold = BAYER4[py & 3][px & 3] / 16;
            pixel(px, py, cellT > threshold);
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // Uniform brightness across the whole buffer — used for the success state
  // (b = 1) and the reverse fade.
  function renderUniform(b) {
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const threshold = BAYER4[py & 3][px & 3] / 16;
        pixel(px, py, b > threshold);
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function renderFullDither() { renderUniform(1); }

  function fillBlack() {
    for (let i = 0; i < imageData.data.length; i += 4) {
      imageData.data[i]     = 0;
      imageData.data[i + 1] = 0;
      imageData.data[i + 2] = 0;
      imageData.data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // ── Reset (exposed so the caller can recover after a rejected passkey) ──────

  function reset() {
    state.revealed = false;
    state.pressing = false;
    state.releaseStart = 0;
    fillBlack();
    hint.classList.remove("hidden");
    onReset?.();
  }

  return { reset };
}
