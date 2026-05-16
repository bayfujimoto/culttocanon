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

  const natW = img.naturalWidth  || img.width;
  const natH = img.naturalHeight || img.height;
  if (!natW || !natH) return;
  const aspect = natH / natW;

  // On iOS only, size the backing buffer to the *displayed* device-pixel box
  // instead of the dither's tiny natural size. iOS WebKit shows periodic black
  // bands when a small canvas is CSS-magnified with image-rendering: pixelated
  // (its tiled-canvas nearest-neighbor sampler reads past tile edges). Drawing
  // the dither magnified into a buffer that already matches the display box
  // means CSS never scales the canvas, so the buggy path is never hit.
  //
  // Every other browser keeps the natural-size buffer + CSS pixelated upscale,
  // which renders the chunky low-density dither we want and is unaffected by
  // the WebKit bug. (On HiDPI desktops, device-pixel sizing would otherwise
  // double the dither density — not what we want there.)
  const { W, H } = isIOS()
    ? targetBufferSize(canvas, aspect, natW, natH)
    : { W: natW, H: natH };

  canvas.width  = W;
  canvas.height = H;
  canvas.setAttribute("width",  String(W));
  canvas.setAttribute("height", String(H));

  const ctx = canvas.getContext("2d");
  // iOS: the buffer is the large device-pixel box, so the small dither is
  // magnified into it. Nearest-neighbor magnification of a small source on
  // iOS WebKit re-triggers the tiled-canvas black-band bug, so use bilinear
  // smoothing there — it interpolates across the source and never reads hard
  // tile edges. Desktop: buffer is the dither's natural size (no in-canvas
  // magnification); keep nearest so CSS image-rendering:pixelated stays crisp.
  ctx.imageSmoothingEnabled = isIOS();
  const ditherImg = new Image();
  ditherImg.decoding = "async";
  ditherImg.onload = () => {
    ctx.drawImage(ditherImg, 0, 0, W, H);
    initInteraction(canvas, ctx, ditherImg, W, H, aspect, natW, {
      quantBwUrl: img.dataset.quantbw || "",
      quantUrl:   img.dataset.quant   || "",
      sourceUrl:  img.dataset.source  || "",
      noReveal,
    });
  };
  ditherImg.src = img.currentSrc || img.src;
}

// After a bilinear drawImage on iOS (needed to avoid the tiled-canvas
// black-band bug with nearest-neighbor), snap every pixel back to exactly
// INK or PAPER. Bilinear interpolation creates grey midtones that destroy
// the crisp 1-bit look; thresholding restores it while keeping bands gone.
function thresholdCanvas(ctx, W, H) {
  const imageData = ctx.getImageData(0, 0, W, H);
  const d = imageData.data;
  const mid = (INK[0] + PAPER[0]) / 2; // 122
  for (let i = 0; i < d.length; i += 4) {
    const isInk = d[i] < mid;
    d[i]   = isInk ? INK[0]   : PAPER[0];
    d[i+1] = isInk ? INK[1]   : PAPER[1];
    d[i+2] = isInk ? INK[2]   : PAPER[2];
    // alpha left unchanged
  }
  ctx.putImageData(imageData, 0, 0);
}

// True on iOS / iPadOS (all browsers there are WebKit). Covers classic iOS
// UAs and iPadOS 13+, which reports a Mac UA but exposes multi-touch.
let _isIOS = null;
function isIOS() {
  if (_isIOS !== null) return _isIOS;
  const ua = navigator.userAgent || "";
  const classic = /iPad|iPhone|iPod/.test(ua);
  const iPadOS13 = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  _isIOS = classic || iPadOS13;
  return _isIOS;
}

// Compute the canvas backing-buffer size from the laid-out CSS box and the
// device pixel ratio. Falls back to the dither's natural size if the element
// isn't laid out yet (detached / display:none) so we never make a 0-sized
// buffer. Height is derived from W*aspect (not the measured rect height) so
// the two can't drift apart on sub-pixel rounding; CSS height:auto matches it.
function targetBufferSize(canvas, aspect, natW, natH) {
  const cssW = canvas.getBoundingClientRect().width;
  if (!cssW) return { W: natW, H: natH };
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(cssW * dpr));
  const H = Math.max(1, Math.round(W * aspect));
  return { W, H };
}

// ── Interaction state and animation loop ───────────────────────────────────

function initInteraction(canvas, ctx, ditherImg, W, H, aspect, natW, opts) {
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

  // Hover trail is pointer-device only — skip on touch-primary devices (iOS,
  // Android) where mousemove doesn't fire and the effect would never trigger.
  const hasHover = window.matchMedia("(hover: hover)").matches;

  // Geometry is mutable: the iOS ResizeObserver rebuilds it when the displayed
  // box changes (rotation), since a stale device-pixel buffer would get
  // CSS-magnified again and re-trigger the black-band bug. The rAF loop reads
  // live values. Cell size and hover radius scale by how much the buffer was
  // enlarged vs the dither's natural size (bufScale = nextW / natW), so the
  // *visible* dissolve granularity and hover footprint stay constant whether
  // the buffer is natural-size (desktop) or device-pixel-sized (iOS).
  const geom = { W, H, COLS: 0, ROWS: 0, cw: 0, ch: 0, hoverR: 0 };
  let phase = null;
  let trail = null, clean = null;
  // iOS only: a pre-thresholded ImageData snapshot of the dither at the current
  // buffer size. Reused every frame so we pay getImageData only once per resize,
  // not once per rAF tick. Null on non-iOS (trail/clean serve the same purpose
  // on hover-capable devices; non-iOS touch gets a plain drawImage per frame).
  let iosDitherFrame = null;

  function rebuildGeometry(nextW, nextH) {
    const bufScale = nextW / natW;
    geom.W = nextW;
    geom.H = nextH;
    geom.cw = Math.max(1, Math.round(CW * bufScale));
    geom.ch = Math.max(1, Math.round(CH * bufScale));
    geom.hoverR = Math.max(1, Math.round(HOVER_RADIUS * bufScale));
    geom.COLS = Math.ceil(nextW / geom.cw);
    geom.ROWS = Math.ceil(nextH / geom.ch);
    // Per-cell random phase. Re-rolled on every click for a fresh dissolution
    // pattern; deterministic across frames within one transition.
    phase = new Float32Array(geom.COLS * geom.ROWS);
    rerollPhase(phase);
    if (hasHover) {
      // Off-screen buffer for the hover trail. Seeded from the dither pixels;
      // flicker writes into it and a per-frame decay restores flipped pixels.
      ctx.drawImage(ditherImg, 0, 0, nextW, nextH);
      if (isIOS()) thresholdCanvas(ctx, nextW, nextH);
      trail = ctx.getImageData(0, 0, nextW, nextH);
      // Clean snapshot used as ground truth for decay restoration.
      clean = new Uint8Array(trail.data);
    } else if (isIOS()) {
      // No hover on iOS touch. Build the cached frame once so render() can
      // putImageData every tick instead of draw+threshold every tick.
      ctx.drawImage(ditherImg, 0, 0, nextW, nextH);
      thresholdCanvas(ctx, nextW, nextH);
      iosDitherFrame = ctx.getImageData(0, 0, nextW, nextH);
    }
  }
  rebuildGeometry(W, H);

  if (!opts.noReveal) {
    canvas.addEventListener("click", () => onClick(state, phase, opts));
    canvas.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick(state, phase, opts);
      }
    });
  }

  if (hasHover) {
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
  }

  // iOS only: rebuild the device-pixel buffer when the displayed width changes
  // (viewport rotation, pane resize), or a stale buffer gets CSS-magnified
  // again and re-triggers the black-band bug. Other browsers use the fixed
  // natural-size buffer and let CSS upscale fluidly — no rebuild needed.
  if (isIOS()) {
    // Guard against the initial fire and no-op resizes so we don't reroll the
    // dissolve phase on every layout tick.
    const ro = new ResizeObserver(() => {
      const cssW = canvas.getBoundingClientRect().width;
      if (!cssW) return;
      const dpr = window.devicePixelRatio || 1;
      const nextW = Math.max(1, Math.round(cssW * dpr));
      if (nextW === geom.W) return;
      const nextH = Math.max(1, Math.round(nextW * aspect));
      canvas.width  = nextW;
      canvas.height = nextH;
      canvas.setAttribute("width",  String(nextW));
      canvas.setAttribute("height", String(nextH));
      // iOS path (this whole block is gated on isIOS): bilinear, band-free.
      ctx.imageSmoothingEnabled = true;
      rebuildGeometry(nextW, nextH);
      // Cancel any in-flight transition — its phase array is now wrong-sized.
      state.click = null;
      render(state, phase, opts, ctx, ditherImg, geom, performance.now(), trail, clean, iosDitherFrame);
    });
    ro.observe(canvas);
  }

  // Start the rAF loop. It's idle (single drawImage per frame) when the
  // canvas is at rest and no cursor is over it.
  function frame(now) {
    render(state, phase, opts, ctx, ditherImg, geom, now, trail, clean, iosDitherFrame);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function onClick(state, phase, opts) {
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

function render(state, phase, opts, ctx, ditherImg, geom, now, trail, clean, iosDitherFrame) {
  const { W, H, COLS, ROWS, cw, ch, hoverR } = geom;
  // Re-assert every frame (iOS Safari can reset it). iOS uses bilinear so the
  // magnified dither stays band-free; desktop uses nearest for crisp pixels
  // that CSS image-rendering:pixelated then upscales.
  ctx.imageSmoothingEnabled = isIOS();
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
    } else if (trail && clean) {
      applyHoverFlicker(state.hover, W, H, hoverR, now, trail, clean);
      ctx.putImageData(trail, 0, 0);
    } else if (iosDitherFrame) {
      // iOS rest state: use the pre-thresholded snapshot so we don't pay
      // getImageData/putImageData every frame.
      ctx.putImageData(iosDitherFrame, 0, 0);
    } else {
      ctx.drawImage(ditherImg, 0, 0, W, H);
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
      const dw = Math.min(cw, W - x*cw);
      const dh = Math.min(ch, H - y*ch);
      ctx.drawImage(
        layer,
        x*cw*sxr, y*ch*syr, dw*sxr, dh*syr,
        x*cw,     y*ch,     dw,     dh
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

function applyHoverFlicker(hover, W, H, hoverR, now, trail, clean) {
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

  const hr = hoverR;
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
