// ── Runtime image-reveal enhancer ──────────────────────────────────────────
// Finds every `img.ctc-dither` rendered into the Read pane by the
// image-renderer and upgrades it to an interactive canvas that animates
// from the 1-bit Bayer dither rest state through 4-tone gray and 8-color
// quant stages into the full-color photograph on click, and back on a
// second click. Hovering produces a small pixel flicker over the dither.
//
// Design choices (see docs/image-pipeline-plan_260516.md §6):
//
//   - Fixed canvas buffer sized to the loaded dither's natural dimensions.
//     CSS handles all display scaling via image-rendering: pixelated. Pane
//     resizes don't trigger any re-render; the dither stays crisp.
//
//   - Lazy initialization via IntersectionObserver. Each image upgrades to
//     a canvas as it approaches the viewport (rootMargin: 400px). It
//     downgrades back to an <img> when it leaves by more than two screen
//     heights, releasing the canvas memory.
//
//   - Source / quantBw / quant layers are NOT loaded until the reader's
//     first click. Until then, only the dither PNG is in flight.
//
//   - `.no-reveal` images upgrade to a canvas (for the hover flicker) but
//     ignore click events.
//
// The animation parameters match the v1.1 mockup that landed as final:
// 1.25s total, WIN=0.5 per cell, 8×10 buffer cells, three intermediate
// stages (dither → quantBw → quant → source), per-cell random timing
// re-rolled on each click.

import "./ctc-image-reveal.css";

const CW = 8, CH = 10;
const DUR = 625;
const REVERT_DELAY = 5000;
const WIN = 0.5;
const HOVER_RADIUS = 10;
const HOVER_FLIP_PROB = 0.08;
const HOVER_BUCKET_MS = 40;
const HOVER_TRAIL_DECAY = 0.32; // probability per frame that a flipped pixel restores

// Ink / paper colors for the hover-flip detection. Match the Vite plugin's
// emitted dither colors and the public theme tokens.
const INK = [31, 34, 38];     // #1f2226 — matches --fg in public theme
const PAPER = [213, 216, 219]; // #d5d8db — matches --bg in public theme

// Track which <img>s have been enhanced so we don't double-wrap on
// re-render. WeakSet keys by element so stale entries are GC'd when the
// element is removed from the DOM.
const ENHANCED = new WeakSet();

// Shared observer — one per page, finds dither images as they approach.
let observer = null;

function getObserver() {
  if (observer) return observer;
  observer = new IntersectionObserver(handleIntersections, {
    rootMargin: "400px 0px 400px 0px",
    threshold: 0,
  });
  return observer;
}

function handleIntersections(entries) {
  for (const entry of entries) {
    const img = entry.target;
    if (entry.isIntersecting) {
      // Approaching the viewport — upgrade to canvas if not already.
      if (!ENHANCED.has(img)) {
        ENHANCED.add(img);
        upgradeImage(img);
      }
    }
    // Note: we intentionally don't downgrade on exit for v1. The canvas is
    // small and the buffer cost is modest; tearing down and rebuilding adds
    // jank without much benefit. If memory profiling shows pressure, a
    // teardown branch can be added here.
  }
}

/**
 * Public entrypoint — register every `img.ctc-dither` under `root` (or the
 * whole document if `root` is null) with the IntersectionObserver. Safe to
 * call repeatedly; already-enhanced images are skipped.
 */
export function enhanceImages(root) {
  const scope = root || document;
  const imgs = scope.querySelectorAll("img.ctc-dither");
  const obs = getObserver();
  for (const img of imgs) {
    if (ENHANCED.has(img)) continue;
    obs.observe(img);
  }
}

// ── Per-image upgrade ──────────────────────────────────────────────────────

function upgradeImage(img) {
  // Stop watching this image — we're about to swap it for a canvas, and
  // the observer doesn't need to fire again.
  getObserver().unobserve(img);

  // Wait for the dither image to be loaded so we know its natural dimensions.
  // In practice it's almost always already cached because the <img> tag
  // started its fetch on page load. But handle the slow case gracefully.
  if (img.complete && img.naturalWidth > 0) {
    swap(img);
  } else {
    img.addEventListener("load", () => swap(img), { once: true });
    img.addEventListener("error", () => {
      // Dither failed to load — leave the broken <img> in place. The browser
      // will show its native broken-image marker; better than silently
      // disappearing.
      console.warn("[ctc-image-reveal] dither image failed to load:", img.src);
    }, { once: true });
  }
}

function swap(img) {
  const noReveal = img.dataset.noReveal === "1";

  const canvas = document.createElement("canvas");
  canvas.className = img.className.replace(/\bctc-dither\b/, "ctc-dither-canvas").trim();
  if (img.classList.contains("ctc-image--full")) canvas.classList.add("ctc-image--full");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", img.alt || "");
  if (!noReveal) canvas.setAttribute("tabindex", "0");

  // Adjacent visually-hidden caption carries the alt text for screen readers.
  let figcaption = null;
  if (img.alt) {
    figcaption = document.createElement("span");
    figcaption.className = "ctc-sr-only";
    figcaption.textContent = img.alt;
  }

  // Move the canvas in alongside / replacing the img.
  const parent = img.parentNode;
  if (!parent) return;
  parent.replaceChild(canvas, img);
  if (figcaption) parent.insertBefore(figcaption, canvas.nextSibling);

  const W = img.naturalWidth  || img.width;
  const H = img.naturalHeight || img.height;
  if (!W || !H) return;

  canvas.width  = W;
  canvas.height = H;
  canvas.setAttribute("width",  String(W));
  canvas.setAttribute("height", String(H));

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const ditherImg = new Image();
  ditherImg.decoding = "async";
  ditherImg.onload = () => {
    ctx.drawImage(ditherImg, 0, 0, W, H);
    initInteraction(canvas, ctx, ditherImg, W, H, {
      quantBwUrl: img.dataset.quantbw || "",
      quantUrl:   img.dataset.quant   || "",
      sourceUrl:  img.dataset.source  || "",
      noReveal,
    });
  };
  ditherImg.src = img.currentSrc || img.src;
}

// ── Interaction state and animation loop ───────────────────────────────────

function initInteraction(canvas, ctx, ditherImg, W, H, opts) {
  const state = {
    revealed: false,
    click:    null,
    hover:    { x: null, y: null, speed: 0, lastMove: null },
    // Lazy-loaded layers; populated on first click.
    layers:        null,
    layersLoading: false,
    layersError:   false,
    revertTimer:   null,
  };

  // Per-cell random phase. Re-rolled on every click for a fresh dissolution
  // pattern; deterministic across frames within one transition.
  const COLS = Math.ceil(W / CW);
  const ROWS = Math.ceil(H / CH);
  const phase = new Float32Array(COLS * ROWS);
  rerollPhase(phase);

  if (!opts.noReveal) {
    canvas.addEventListener("click", () => onClick(state, phase, opts, ctx, ditherImg, W, H));
    canvas.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick(state, phase, opts, ctx, ditherImg, W, H);
      }
    });
  }

  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    const nx = (e.clientX - r.left) * (canvas.width  / r.width);
    const ny = (e.clientY - r.top)  * (canvas.height / r.height);
    const dx = nx - (state.hover.x ?? nx);
    const dy = ny - (state.hover.y ?? ny);
    state.hover.x = nx;
    state.hover.y = ny;
    state.hover.speed = Math.hypot(dx, dy);
    state.hover.lastMove = performance.now();
  });
  canvas.addEventListener("mouseleave", () => {
    state.hover.x = null;
    state.hover.y = null;
    state.hover.speed = 0;
    state.hover.lastMove = null;
  });

  // Off-screen buffer for the hover trail. Seeded from the dither pixels;
  // flicker writes into it and a per-frame decay restores flipped pixels.
  ctx.drawImage(ditherImg, 0, 0, W, H);
  const trail = ctx.getImageData(0, 0, W, H);
  // Clean snapshot used as ground truth for decay restoration.
  const clean = new Uint8Array(trail.data);

  // Start the rAF loop. It's idle (single drawImage per frame) when the
  // canvas is at rest and no cursor is over it.
  function frame(now) {
    render(state, phase, opts, ctx, ditherImg, W, H, COLS, ROWS, now, trail, clean);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function onClick(state, phase, opts, ctx, ditherImg, W, H) {
  // Ensure layers are loaded before starting the animation. If the click
  // arrives before the lazy load completes, we kick off loading and bail —
  // a second click will start the animation once the layers are available.
  if (!state.layers && !state.layersLoading) {
    state.layersLoading = true;
    loadLayers(opts).then(layers => {
      state.layers = layers;
      state.layersLoading = false;
      // Start the animation immediately — no second click needed.
      startTransition(state, phase);
    }).catch(err => {
      state.layersError = true;
      state.layersLoading = false;
      console.warn("[ctc-image-reveal] layer load failed:", err);
    });
    return;
  }
  if (!state.layers) return;

  startTransition(state, phase);
}

function startTransition(state, phase) {
  clearTimeout(state.revertTimer);
  state.revertTimer = null;
  const direction = state.revealed ? "out" : "in";
  state.click = { time: performance.now(), direction };
  rerollPhase(phase);
  state.revealed = !state.revealed;
  if (direction === "in") {
    state.revertTimer = setTimeout(() => {
      state.revertTimer = null;
      if (state.revealed) startTransition(state, phase);
    }, REVERT_DELAY);
  }
}

// ── Layer loading ──────────────────────────────────────────────────────────

function loadLayers(opts) {
  const promises = [];
  const urls = { quantBw: opts.quantBwUrl, quant: opts.quantUrl, source: opts.sourceUrl };
  const layers = {};
  for (const key of Object.keys(urls)) {
    const url = urls[key];
    if (!url) {
      return Promise.reject(new Error("missing layer URL: " + key));
    }
    promises.push(loadImage(url).then(img => { layers[key] = img; }));
  }
  return Promise.all(promises).then(() => layers);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed: " + url));
    img.src = url;
  });
}

// ── Phase / random helpers ─────────────────────────────────────────────────

function rerollPhase(phase) {
  for (let i = 0; i < phase.length; i++) phase[i] = Math.random();
}

function rnd(n) {
  // Deterministic 0..1 hash, same algorithm as the mockup. The Math.sin
  // approach has known statistical issues but is fine for visual noise.
  return ((Math.sin(n * 12.9898 + 78.233) * 43758.5453) % 1 + 1) % 1;
}

// ── Rendering ──────────────────────────────────────────────────────────────

function render(state, phase, opts, ctx, ditherImg, W, H, COLS, ROWS, now, trail, clean) {
  // iOS Safari may reset imageSmoothingEnabled between frames.
  ctx.imageSmoothingEnabled = false;
  // Determine current mode.
  let dir = null, progress = 1;
  if (state.click) {
    const t = (now - state.click.time) / DUR;
    if (t >= 1) {
      state.click = null;
    } else {
      dir = state.click.direction;
      progress = t;
    }
  }

  if (!dir) {
    // Rest state — full-canvas redraw of either dither or source.
    if (state.revealed && state.layers) {
      ctx.drawImage(state.layers.source, 0, 0, W, H);
    } else {
      applyHoverFlicker(state.hover, ctx, ditherImg, W, H, now, trail, clean);
      ctx.putImageData(trail, 0, 0);
    }
    return;
  }

  // Mid-transition — base is the starting state, overlay the per-cell
  // stages on top.
  const baseLayer = dir === "in" ? ditherImg : state.layers.source;
  ctx.drawImage(baseLayer, 0, 0, W, H);

  // Each layer may differ in pixel size from the canvas buffer (e.g. on
  // retina the canvas is sized to the @2x dither but the lazily-loaded
  // source/quant layers are 1x). Sample each layer from its own pixel
  // space, scaled into the canvas cell, so the per-cell crop stays
  // correct regardless of the size mismatch. Scale factors are cached
  // per layer per frame — layer dimensions don't change between frames.
  const scaleCache = new Map();
  function layerScale(layer) {
    let s = scaleCache.get(layer);
    if (!s) {
      const lw = layer.naturalWidth  || layer.width;
      const lh = layer.naturalHeight || layer.height;
      s = { sxr: lw / W, syr: lh / H };
      scaleCache.set(layer, s);
    }
    return s;
  }

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      const cellStart = phase[i] * (1 - WIN);
      const cellT = (progress - cellStart) / WIN;
      let layer = null;
      if (dir === "in") {
        // dither → quantBw → quant → source
        if (cellT < 0)          continue;
        else if (cellT < 1/3)   layer = state.layers.quantBw;
        else if (cellT < 2/3)   layer = state.layers.quant;
        else                    layer = state.layers.source;
      } else {
        // source → quant → quantBw → dither
        if (cellT < 0)          continue;
        else if (cellT < 1/3)   layer = state.layers.quant;
        else if (cellT < 2/3)   layer = state.layers.quantBw;
        else                    layer = ditherImg;
      }
      const { sxr, syr } = layerScale(layer);
      const dw = Math.min(CW, W - x*CW);
      const dh = Math.min(CH, H - y*CH);
      ctx.drawImage(
        layer,
        x*CW*sxr, y*CH*syr, dw*sxr, dh*syr,
        x*CW,     y*CH,     dw,     dh
      );
    }
  }
}

// ── Hover flicker ──────────────────────────────────────────────────────────
//
// Operates on an off-screen ImageData buffer (trail) seeded from the dither.
// Each frame: (1) stochastically restore flipped pixels toward the clean dither
// — this is the trail decay; (2) flip new pixels near the cursor, scaled by
// movement speed — this is the disturbance. The caller composites the buffer
// onto the canvas with putImageData.

function applyHoverFlicker(hover, _ctx, _ditherImg, W, H, now, trail, clean) {
  const td = trail.data;
  const tBucket = Math.floor(now / HOVER_BUCKET_MS);

  // ── Decay: stochastically restore pixels that differ from the clean dither.
  for (let i = 0; i < td.length; i += 4) {
    if (td[i] === clean[i]) continue; // pixel is clean — skip
    const px = (i / 4) % W;
    const py = Math.floor((i / 4) / W);
    if (rnd(px * 53 + py * 97 + tBucket * 7) < HOVER_TRAIL_DECAY) {
      td[i]   = clean[i];
      td[i+1] = clean[i+1];
      td[i+2] = clean[i+2];
    }
  }

  // ── Write: flip pixels near cursor, scaled by speed. Skip if not moving.
  if (hover.x == null || hover.lastMove == null) return;
  const speedFactor = Math.min(hover.speed / 8, 1);
  if (speedFactor <= 0) return;

  const hr = HOVER_RADIUS;
  const hx = hover.x, hy = hover.y;

  const x0 = Math.max(0, Math.floor(hx - hr));
  const x1 = Math.min(W, Math.ceil(hx + hr));
  const y0 = Math.max(0, Math.floor(hy - hr));
  const y1 = Math.min(H, Math.ceil(hy + hr));

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const d = Math.hypot(px - hx, py - hy);
      if (d > hr) continue;
      const radial = (hr - d) / hr;
      const r = rnd(px * 73 + py * 137 + tBucket * 19);
      if (r < radial * speedFactor * HOVER_FLIP_PROB) {
        const i = (py * W + px) * 4;
        const isInk = clean[i] < (INK[0] + PAPER[0]) / 2;
        td[i]   = isInk ? PAPER[0] : INK[0];
        td[i+1] = isInk ? PAPER[1] : INK[1];
        td[i+2] = isInk ? PAPER[2] : INK[2];
      }
    }
  }
}
