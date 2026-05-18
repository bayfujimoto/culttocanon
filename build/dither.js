// ── Bayer 4×4 dither core ─────────────────────────────────────────────────
// Pure functions that produce the four derived bit-depth layers from a
// source RGB image. Used by both the Vite plugin (build/vite-plugin-image-
// dither.js) and the standalone CLI below. Output colors match the public
// theme in src/styles/tokens.css (ink/paper).
//
// CLI:  node build/dither.js <source.jpg> [--out <dir>]
// Plugin: imports { computeDerivatives, writeDerivativesForSource } from here.
//
// The algorithm itself is a faithful port of the v1.1 mockup that landed
// as final in the design conversation:
//   - 1-bit dither: Bayer 4×4 threshold with ink/paper output
//   - 4-tone quantBw: same threshold, 4-level grayscale interpolated
//     between ink and paper
//   - 8-color quant: per-channel 1-bit Bayer dither (CGA-like)
//   - optimized: JPEG re-encode at quality 85 with mozjpeg
//
// Source images are resized to a max width of 600px for 1× and 1200px for
// 2×. Smaller sources keep their native resolution. Aspect ratio is always
// preserved.

import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";
import url from "url";

// ── Constants ───────────────────────────────────────────────────────────────

// INK matches the public theme --fg. PAPER is intentionally a touch DARKER
// than the pane background (--bg #d5d8db / RGB 213,216,219) so paper-heavy
// image edges separate from the pane. Keep in sync with the PAPER/INK
// constants in src/runtime/ctc-image-reveal.js (hover-flicker detection).
const INK   = { r: 31,  g: 34,  b: 38  };  // #1f2226
const PAPER = { r: 203, g: 206, b: 209 };  // #cbced1 — darker than pane #d5d8db

// Pre-flattened Bayer 4×4 matrix indexed by (y%4)*4 + (x%4).
const BAYER4 = new Uint8Array([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

const TARGET_WIDTH_1X = 600;
const TARGET_WIDTH_2X = 1200;

// ── Tone ramp ────────────────────────────────────────────────────────────
// A single GLOBAL curve applied identically to every image before the Bayer
// threshold — no per-image histogram/auto-levels (that pulled each image's
// own darks/lights independently, making naturally-light images wash out).
//
// Pipeline for an input sample v in 0..1:
//   1. level:   x = (v - BLACK_POINT) / (WHITE_POINT - BLACK_POINT), clamped
//   2. gamma:   x = x ** TONE_GAMMA              (overall lightness)
//   3. S-curve: x = sigmoid((x - PIVOT)*CONTRAST) renormalized to 0..1
//
// The S-curve is the key shape control. A pure gamma curve only has steep
// slope at ONE end, so the other end flattens and crushes (many input
// values collapse to the same output → the dither can't separate them).
// The sigmoid adds slope at BOTH the shadow and highlight ends and eases
// the midtone, so dark values stay distinct from each other and light
// values stay distinct from each other.
//
// Lower WHITE_POINT  -> brights hit paper sooner (darker overall)
// Raise  BLACK_POINT -> darks crush to ink sooner
// TONE_GAMMA   >1 darkens midtones, <1 lifts
// TONE_CONTRAST 0 = no S-curve (linear); higher = stronger end-separation
//               + more midtone compression. ~3–6 is a useful range.
// TONE_PIVOT   tonal value the S-curve hinges around (0.5 = middle gray).
//               <0.5 favors shadow separation, >0.5 favors highlights.
//
// LIMIT: this is a global curve. It redistributes output slope but cannot
// separate input values that are already nearly equal. Images whose bright
// content occupies a very narrow source-luma window (e.g. an overcast sky
// all within ~0.04 luma) will still show little highlight contrast no
// matter how the S-curve is tuned — the separation isn't in the source to
// begin with. Fixing those specifically would require a local-contrast /
// CLAHE pre-pass, intentionally not done (keeps the pipeline global+simple).
//
// LIMIT 2 (dither resolution): the 1-bit 4×4 Bayer matrix has only ~3–4
// distinguishable density levels near the bright end before everything is
// paper. Empirically swept: NO tone-curve setting (S-curve contrast/pivot
// OR highlight roll-off knee/ceiling) adds highlight separation for
// normal-exposure images — the curve cannot represent tonal levels the
// dither physically cannot display. Bright regions reading coarse/flat is
// the medium, not a tuning miss. Real fix would be a finer/blue-noise
// dither (a change to the dithering core, not this curve) — deferred.
//
// Tune these, then regenerate derivatives (delete the stale ones so the
// mtime guard doesn't skip them) and reload the dither-ramp-test post.
// NOTE: keep BLACK_POINT low and TONE_GAMMA near 1 — a high black point or
// strong gamma flattens the shadows to a single value *before* the S-curve
// runs, and the S-curve can't restore slope the level/gamma stage destroyed.
// Do the end-separation with the S-curve, not by stacking gamma on top of it.
const BLACK_POINT   = 0.02; // input luma mapped to pure ink
const WHITE_POINT   = 1.00; // input luma mapped to pure paper
const TONE_GAMMA    = 1.15; // >1 darkens midtones, <1 lifts
const TONE_CONTRAST = 3.00; // S-curve steepness; 0 disables the S-curve
const TONE_PIVOT    = 0.65; // S-curve center (0.5 = middle gray)

// Highlight roll-off — applied LAST, only to curve outputs above the knee.
// Outputs ≤ HIGHLIGHT_KNEE pass through untouched (so shadows, midtones, and
// the dark values are bit-for-bit unchanged); the [knee, 1] band is squeezed
// into [knee, HIGHLIGHT_CEILING] so the brightest tones land short of the
// Bayer pure-paper threshold (~0.97) and very few pixels go pure paper.
// Lower HIGHLIGHT_CEILING -> even fewer pure-paper pixels. Set ceiling = 1.0
// to disable. Raise the knee to protect more of the upper midtones.
const HIGHLIGHT_KNEE    = 0.30; // outputs at/below this are never altered
const HIGHLIGHT_CEILING = 0.70; // max possible output (1.0 = no roll-off)

// ── Per-image gentle exposure correction ─────────────────────────────────
// The global curve above can't fix an image whose entire tonal mass sits at
// one exposure (e.g. 008: median luma ~0.56, almost no dark pixels). Any
// global curve dark enough for it would crush normal-exposure images, whose
// midtone IS that same luma. So, per image, nudge its median toward a target
// BEFORE the global curve — but only partway (EXPOSURE_STRENGTH < 1) and
// capped (EXPOSURE_MAX_SHIFT), so it never fully equalizes images the way
// the old auto-levels did (which washed light images out). Outlier images
// (very bright/dark) get corrected; near-target images are left alone.
//
//   shift = clamp(STRENGTH * (TARGET - median), ±MAX_SHIFT)
//   tone(v) = globalTone(v + shift)
//
// The correction is ASYMMETRIC: it only ever DARKENS bright outliers. The
// lightening direction is capped separately (EXPOSURE_MAX_LIFT) and defaults
// to 0, so genuinely dark images are never pushed brighter — preserving the
// "dark values unchanged" guarantee. Raise EXPOSURE_MAX_LIFT only if you
// also want under-exposed images opened up.
//
// EXPOSURE_STRENGTH 0 disables it entirely (pure global curve).
const EXPOSURE_TARGET_MEDIAN = 0.42; // luma the correction pulls medians toward
const EXPOSURE_STRENGTH      = 0.60; // 0 = off, 1 = fully snap to target
const EXPOSURE_MAX_SHIFT     = 0.18; // cap on DARKENING (bright images)
const EXPOSURE_MAX_LIFT      = 0.00; // cap on LIGHTENING (dark images); 0 = never lift

// A pure luma pre-shift saturates on very bright images (their pixels pile
// up in the curve's flat shadow toe). For BRIGHT outliers only, also lift
// the per-image BLACK point up toward the image's own p20 luma, so its
// bright-skewed range is stretched DOWN into ink (more of the image reads
// dark). Scaled by how far the median sits above the target, so normal/dark
// images get factor 0 → black point stays at BLACK_POINT → output identical
// to the pre-shift-only path. One-directional: dark images excluded by
// construction (excess = 0).
//
//   excess = clamp01((median - TARGET) / BLACKPT_EXCESS_RANGE)
//   localBlack = mix(BLACK_POINT, p20_luma, BLACKPT_STRENGTH * excess)
//                clamped to <= BLACKPT_CEIL
//
// BLACKPT_STRENGTH 0 disables just this stage (keeps the pre-shift).
const BLACKPT_STRENGTH     = 0.55; // 0 = off; how hard bright imgs darken
const BLACKPT_EXCESS_RANGE = 0.16; // median-above-target span that ramps it in
const BLACKPT_CEIL         = 0.45; // never push a per-image black point above this

const SUPPORTED_EXT = new Set([".jpg", ".jpeg", ".png"]);

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Read a source image and emit the eight derivative files alongside it.
 * Returns { generated: string[], skipped: string[] } with the paths
 * affected. Skips writes when the destination is newer than the source.
 *
 * @param {string} sourcePath  absolute path to the source image
 */
export async function writeDerivativesForSource(sourcePath) {
  const ext = path.extname(sourcePath).toLowerCase();
  if (!SUPPORTED_EXT.has(ext)) {
    return { generated: [], skipped: [], reason: "unsupported-extension" };
  }

  const dir  = path.dirname(sourcePath);
  const stem = path.basename(sourcePath, ext);
  const targets = derivativePaths(dir, stem);

  const sourceMtime = (await fs.stat(sourcePath)).mtimeMs;

  // mtime-based skip: if every derivative already exists and is newer than
  // the source, we have nothing to do.
  const upToDate = await allUpToDate(targets, sourceMtime);
  if (upToDate) {
    return { generated: [], skipped: Object.values(targets), reason: "up-to-date" };
  }

  // Generate the 1× and 2× source canvases. We do the resize once per
  // target width and reuse the resulting raw RGBA buffer for all
  // derivative layers at that resolution.
  const generated = [];

  for (const variant of [
    { suffix: "",    width: TARGET_WIDTH_1X },
    { suffix: "@2x", width: TARGET_WIDTH_2X },
  ]) {
    const pipeline = sharp(sourcePath, { failOn: "warning" })
      .rotate() // honor EXIF orientation
      .resize({ width: variant.width, withoutEnlargement: true });

    const { data, info } = await pipeline
      .raw()
      .toBuffer({ resolveWithObject: true });

    const W = info.width, H = info.height;
    const channels = info.channels;

    // Per-image tone curve: the fixed global curve, fed by a strength-capped
    // exposure pre-shift so outlier-exposure images (e.g. very bright ones)
    // are corrected without equalizing normal images. The three dither
    // layers (dither → quantBw → quant) use it; the optimized JPEG — the
    // final reveal frame — is left as the true original so click-to-reveal
    // lands on the unaltered photo.
    const tone = makeImageTone(data, W, H, channels);

    // 1-bit Bayer dither (ink/paper)
    await encodePngRgba(
      makeDither(data, W, H, tone),
      W, H,
      targets[`dither${variant.suffix}`]
    );
    generated.push(targets[`dither${variant.suffix}`]);

    // 4-tone gray, interpolated between ink and paper
    await encodePngRgba(
      makeQuantBw(data, W, H, tone),
      W, H,
      targets[`quantBw${variant.suffix}`]
    );
    generated.push(targets[`quantBw${variant.suffix}`]);

    // 8-color (per-channel 1-bit Bayer)
    await encodePngRgba(
      makeQuant(data, W, H, tone),
      W, H,
      targets[`quant${variant.suffix}`]
    );
    generated.push(targets[`quant${variant.suffix}`]);

    // Optimized JPEG — the final reveal frame. NOT tone-mapped: this is the
    // true original photo, just re-encoded from the raw buffer (no re-decode
    // of the source). The ramp is intentionally dither-only, so reveal ends
    // on the unaltered image.
    await sharp(data, { raw: { width: W, height: H, channels } })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(targets[`optimized${variant.suffix}`]);
    generated.push(targets[`optimized${variant.suffix}`]);
  }

  return { generated, skipped: [], reason: "ok" };
}

/**
 * Compute the canonical derivative paths for a given source.
 */
export function derivativePaths(dir, stem) {
  return {
    dither:      path.join(dir, `${stem}.dither.png`),
    "dither@2x": path.join(dir, `${stem}.dither@2x.png`),
    quantBw:     path.join(dir, `${stem}.quantBw.png`),
    "quantBw@2x":path.join(dir, `${stem}.quantBw@2x.png`),
    quant:       path.join(dir, `${stem}.quant.png`),
    "quant@2x":  path.join(dir, `${stem}.quant@2x.png`),
    optimized:   path.join(dir, `${stem}.optimized.jpg`),
    "optimized@2x": path.join(dir, `${stem}.optimized@2x.jpg`),
  };
}

// ── Tone curve ──────────────────────────────────────────────────────────────
//
// `globalTone(v)` maps a normalized 0..1 sample (luma, or a single colour
// channel) through the FIXED global level + gamma + S-curve defined by the
// constants up top. No per-image analysis: the same response is applied to
// every image so exposure differences between images are preserved rather
// than equalized. The layer builders receive it as `tone`.

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}


// Logistic sigmoid. Centered/steepness applied by the caller.
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

// Precompute the sigmoid's value at the 0 and 1 endpoints so the S-curve
// can be renormalized back to a full 0..1 range. Without this the sigmoid
// would itself compress the extremes — the exact crushing we're trying to
// remove. With it, the endpoints stay pinned (0→0, 1→1) and the curve only
// redistributes *slope*: shallow in the mid, steep at both ends.
const _S0 = sigmoid((0 - TONE_PIVOT) * TONE_CONTRAST);
const _S1 = sigmoid((1 - TONE_PIVOT) * TONE_CONTRAST);
const _SSPAN = (_S1 - _S0) || 1;

function sCurve(x) {
  if (TONE_CONTRAST === 0) return x; // disabled → linear passthrough
  return (sigmoid((x - TONE_PIVOT) * TONE_CONTRAST) - _S0) / _SSPAN;
}

// Highlight roll-off. Below the knee: identity (the dark/mid values are
// untouched). Above it: linearly remap [knee, 1] onto [knee, ceiling] so the
// top of the range can no longer reach the Bayer pure-paper threshold.
const _HL_RANGE = (1 - HIGHLIGHT_KNEE) || 1;
function highlightRolloff(y) {
  if (HIGHLIGHT_CEILING >= 1 || y <= HIGHLIGHT_KNEE) return y;
  const u = (y - HIGHLIGHT_KNEE) / _HL_RANGE; // 0..1 across the highlight band
  return HIGHLIGHT_KNEE + u * (HIGHLIGHT_CEILING - HIGHLIGHT_KNEE);
}

// `blackPoint` defaults to the global BLACK_POINT. The per-image path passes
// a HIGHER value for bright outliers so their bright-skewed range is
// stretched down into ink (more of the image reads dark). Everything
// downstream of the level stage (gamma, S-curve, roll-off) is unchanged.
function globalTone(v, blackPoint = BLACK_POINT) {
  const span = (WHITE_POINT - blackPoint) || 1;
  const leveled = clamp01((v - blackPoint) / span) ** TONE_GAMMA;
  return clamp01(highlightRolloff(sCurve(leveled)));
}

// Median Rec.601 luma (0..1) of a raw RGB(A) buffer, via a 256-bin
// histogram (exact median is unnecessary; the bin midpoint is plenty for a
// gentle exposure nudge and avoids sorting millions of pixels).
function medianLuma(data, W, H, channels) {
  const BINS = 256;
  const hist = new Uint32Array(BINS);
  const N = W * H;
  for (let p = 0; p < N; p++) {
    const si = p * channels;
    const l = 0.299 * data[si] + 0.587 * data[si+1] + 0.114 * data[si+2];
    let b = l | 0;
    if (b < 0) b = 0; else if (b >= BINS) b = BINS - 1;
    hist[b]++;
  }
  const half = N / 2;
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= half) return (b + 0.5) / BINS;
  }
  return 0.5;
}

// Luma value (0..1) at percentile `q` (0..1), via the same 256-bin
// histogram approach as medianLuma. Used for the per-image white point.
function percentileLuma(data, W, H, channels, q) {
  const BINS = 256;
  const hist = new Uint32Array(BINS);
  const N = W * H;
  for (let p = 0; p < N; p++) {
    const si = p * channels;
    const l = 0.299 * data[si] + 0.587 * data[si+1] + 0.114 * data[si+2];
    let b = l | 0;
    if (b < 0) b = 0; else if (b >= BINS) b = BINS - 1;
    hist[b]++;
  }
  const want = q * N;
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= want) return (b + 0.5) / BINS;
  }
  return 1;
}

// Build the tone curve for one image. Two stacked, one-directional
// corrections, both keyed off how far the image's median sits ABOVE the
// target (so normal/dark images get neither and fall through to the exact
// global curve):
//   1. luma pre-shift  — gentle, capped (EXPOSURE_*)
//   2. black-point lift — for bright outliers the per-image black point is
//      lerped up toward the image's own p20 luma (BLACKPT_*), stretching
//      its range down into ink — what the pre-shift alone can't do once
//      pixels pile into the curve's toe.
// Dark images: shift clamps to 0 AND excess = 0 → globalTone unchanged.
function makeImageTone(data, W, H, channels) {
  if (EXPOSURE_STRENGTH <= 0 && BLACKPT_STRENGTH <= 0) return globalTone;

  const m = medianLuma(data, W, H, channels);

  // Pre-shift (asymmetric: darken bright, never lift dark).
  let shift = EXPOSURE_STRENGTH * (EXPOSURE_TARGET_MEDIAN - m);
  if (shift < -EXPOSURE_MAX_SHIFT) shift = -EXPOSURE_MAX_SHIFT;
  if (shift >  EXPOSURE_MAX_LIFT)  shift =  EXPOSURE_MAX_LIFT;

  // Brightness excess: 0 for at/below-target images, ramps to 1 over
  // BLACKPT_EXCESS_RANGE above the target. Gates the black-point lift so
  // only bright outliers get it.
  let excess = (m - EXPOSURE_TARGET_MEDIAN) / (BLACKPT_EXCESS_RANGE || 1);
  excess = excess < 0 ? 0 : excess > 1 ? 1 : excess;

  let blackPoint = BLACK_POINT;
  if (BLACKPT_STRENGTH > 0 && excess > 0) {
    const p20 = percentileLuma(data, W, H, channels, 0.20);
    const t = BLACKPT_STRENGTH * excess;
    blackPoint = BLACK_POINT + t * (p20 - BLACK_POINT); // lerp toward p20
    if (blackPoint > BLACKPT_CEIL) blackPoint = BLACKPT_CEIL;
  }

  if (shift === 0 && blackPoint === BLACK_POINT) return globalTone;
  return (v) => globalTone(v + shift, blackPoint);
}

// ── Layer construction ──────────────────────────────────────────────────────
//
// `data` is RGBA or RGB raw pixel data. Each helper returns an RGBA
// Uint8Array suitable for sharp's raw input. Working in raw RGBA throughout
// avoids paying per-pixel sharp overhead. `tone` is the fixed global
// curve (globalTone), applied before the Bayer threshold.

function makeDither(data, W, H, tone) {
  const channels = data.length / (W * H);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * channels;
      const rawLum = (0.299 * data[si] + 0.587 * data[si+1] + 0.114 * data[si+2]) / 255;
      const lum = tone(rawLum);
      const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      const isPaper = lum > t;
      const di = (y * W + x) * 4;
      if (isPaper) {
        out[di] = PAPER.r; out[di+1] = PAPER.g; out[di+2] = PAPER.b; out[di+3] = 255;
      } else {
        out[di] = INK.r; out[di+1] = INK.g; out[di+2] = INK.b; out[di+3] = 255;
      }
    }
  }
  return out;
}

function makeQuantBw(data, W, H, tone) {
  const channels = data.length / (W * H);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * channels;
      const rawLum = (0.299 * data[si] + 0.587 * data[si+1] + 0.114 * data[si+2]) / 255;
      const lum = tone(rawLum);
      const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      // 4-level: quantize lum to {0, 1/3, 2/3, 1}
      const v = lum * 3;
      const floor = Math.floor(v);
      const frac  = v - floor;
      const step  = floor + (frac > t ? 1 : 0);
      const qv    = Math.max(0, Math.min(3, step)) / 3;
      // Interpolate between ink and paper.
      const di = (y * W + x) * 4;
      out[di]   = Math.round(INK.r + qv * (PAPER.r - INK.r));
      out[di+1] = Math.round(INK.g + qv * (PAPER.g - INK.g));
      out[di+2] = Math.round(INK.b + qv * (PAPER.b - INK.b));
      out[di+3] = 255;
    }
  }
  return out;
}

function makeQuant(data, W, H, tone) {
  const channels = data.length / (W * H);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * channels;
      const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      const di = (y * W + x) * 4;
      // Per-channel 1-bit Bayer, but tone-mapped first with the same curve
      // the luma layers use so light images keep colour structure instead
      // of clipping to white.
      for (let c = 0; c < 3; c++) {
        out[di + c] = (tone(data[si + c] / 255) > t) ? 255 : 0;
      }
      out[di + 3] = 255;
    }
  }
  return out;
}

// ── PNG encode helper ───────────────────────────────────────────────────────

async function encodePngRgba(rgba, W, H, outPath) {
  // withMetadata({ density: 72 }) embeds an sRGB colour profile (sRGB chunk).
  // Without it, iOS Safari treats untagged PNGs as Display P3 and converts
  // pixel values during getImageData(), breaking the INK/PAPER detection in
  // the hover-trail buffer.
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .withMetadata({ density: 72 })
    .png({ compressionLevel: 9, palette: true })
    .toFile(outPath);
}

// ── mtime check ─────────────────────────────────────────────────────────────

async function allUpToDate(targetMap, sourceMtime) {
  const targets = Object.values(targetMap);
  for (const t of targets) {
    try {
      const s = await fs.stat(t);
      if (s.mtimeMs < sourceMtime) return false;
    } catch {
      return false; // missing — needs generation
    }
  }
  return true;
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────
//
// When invoked directly (`node build/dither.js <path>`), generates the
// derivatives for one source image. Useful for inspecting plugin output
// without running the full Vite build.

const isMain = import.meta.url === url.pathToFileURL(process.argv[1] || "").href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: node build/dither.js <source-image>");
    process.exit(1);
  }
  const source = path.resolve(args[0]);
  console.log(`[dither] processing ${source}`);
  const t0 = Date.now();
  writeDerivativesForSource(source)
    .then(res => {
      const ms = Date.now() - t0;
      if (res.reason === "up-to-date") {
        console.log(`[dither] skipped — derivatives newer than source (${ms}ms)`);
      } else if (res.reason === "unsupported-extension") {
        console.error(`[dither] unsupported extension: ${path.extname(source)}`);
        process.exit(2);
      } else {
        console.log(`[dither] generated ${res.generated.length} files (${ms}ms)`);
        for (const f of res.generated) console.log("  " + path.relative(process.cwd(), f));
      }
    })
    .catch(err => {
      console.error(`[dither] failed: ${err.message}`);
      process.exit(3);
    });
}
