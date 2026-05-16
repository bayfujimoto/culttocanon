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
const DUR = 1250;
const WIN = 0.5;
const HOVER_RADIUS = 14;
const HOVER_FLIP_PROB = 0.35;
const HOVER_BUCKET_MS = 80;

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
  const W = img.naturalWidth  || img.width;
  const H = img.naturalHeight || img.height;
  if (!W || !H) return;

  const noReveal = img.dataset.noReveal === "1";

  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  canvas.className = img.className.replace(/\bctc-dither\b/, "ctc-dither-canvas").trim();
  if (img.classList.contains("ctc-image--full")) canvas.classList.add("ctc-image--full");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", img.alt || "");
  if (!noReveal) canvas.setAttribute("tabindex", "0");

  // Preserve display dimensions so the canvas occupies the same space as
  // the <img> did. Explicit width/height attributes plus the inline style
  // keep the layout stable through the swap.
  canvas.setAttribute("width",  String(W));
  canvas.setAttribute("height", String(H));

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

  // Pre-paint with the dither image so first frame after swap shows the
  // same pixels the <img> was showing. No flicker.
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  // We need an Image because the original <img> is gone from the DOM.
  // Reload via the URL — the browser cache makes this synchronous.
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
    hover:    { x: null, y: null },
    // Lazy-loaded layers; populated on first click.
    layers:   null,
    layersLoading: false,
    layersError:   false,
  };

  // Per-cell random phase. Re-rolled on every click for a fresh dissolution
  // pattern; deterministic across frames within one transition.
  const COLS = Math.floor(W / CW);
  const ROWS = Math.floor(H / CH);
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
    state.hover.x = (e.clientX - r.left) * (canvas.width  / r.width);
    state.hover.y = (e.clientY - r.top)  * (canvas.height / r.height);
  });
  canvas.addEventListener("mouseleave", () => {
    state.hover.x = null;
    state.hover.y = null;
  });

  // Start the rAF loop. It's idle (single drawImage per frame) when the
  // canvas is at rest and no cursor is over it.
  function frame(now) {
    render(state, phase, opts, ctx, ditherImg, W, H, COLS, ROWS, now);
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
    }).catch(err => {
      state.layersError = true;
      state.layersLoading = false;
      console.warn("[ctc-image-reveal] layer load failed:", err);
    });
    return;
  }
  if (!state.layers) return;

  state.click = {
    time: performance.now(),
    direction: state.revealed ? "out" : "in",
  };
  rerollPhase(phase);
  state.revealed = !state.revealed;
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

function render(state, phase, opts, ctx, ditherImg, W, H, COLS, ROWS, now) {
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
      ctx.drawImage(ditherImg, 0, 0, W, H);
      if (!state.revealed) applyHoverFlicker(state.hover, ctx, ditherImg, W, H, now);
    }
    return;
  }

  // Mid-transition — base is the starting state, overlay the per-cell
  // stages on top.
  const baseLayer = dir === "in" ? ditherImg : state.layers.source;
  ctx.drawImage(baseLayer, 0, 0, W, H);

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
      ctx.drawImage(layer, x*CW, y*CH, CW, CH, x*CW, y*CH, CW, CH);
    }
  }
}

// ── Hover flicker ──────────────────────────────────────────────────────────
//
// Small-region getImageData/putImageData over the dither rest state. Reads
// the existing canvas pixels, flips a random ~35% of them within
// HOVER_RADIUS of the cursor, writes back. Cheap because the region is at
// most ~30×30 pixels in buffer space.

function applyHoverFlicker(hover, ctx, ditherImg, W, H, now) {
  if (hover.x == null) return;
  const hr = HOVER_RADIUS;
  const hx = hover.x, hy = hover.y;
  const tBucket = Math.floor(now / HOVER_BUCKET_MS);

  const x0 = Math.max(0, Math.floor(hx - hr));
  const x1 = Math.min(W, Math.ceil(hx + hr));
  const y0 = Math.max(0, Math.floor(hy - hr));
  const y1 = Math.min(H, Math.ceil(hy + hr));
  if (x1 <= x0 || y1 <= y0) return;

  const w = x1 - x0, h = y1 - y0;
  const imgd = ctx.getImageData(x0, y0, w, h);
  const data = imgd.data;
  const inkBoundary = (INK[0] + PAPER[0]) / 2;

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const x = x0 + dx, y = y0 + dy;
      const d = Math.hypot(x - hx, y - hy);
      if (d > hr) continue;
      const intensity = (hr - d) / hr;
      const r = rnd(x * 73 + y * 137 + tBucket * 19);
      if (r < intensity * HOVER_FLIP_PROB) {
        const i = (dy * w + dx) * 4;
        const isInk = data[i] < inkBoundary;
        if (isInk) {
          data[i] = PAPER[0]; data[i+1] = PAPER[1]; data[i+2] = PAPER[2];
        } else {
          data[i] = INK[0];   data[i+1] = INK[1];   data[i+2] = INK[2];
        }
      }
    }
  }
  ctx.putImageData(imgd, x0, y0);
}
