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

// Match public theme. If tokens.css changes, change these too.
const INK   = { r: 31,  g: 34,  b: 38  }; // #1f2226
const PAPER = { r: 213, g: 216, b: 219 }; // #d5d8db

// Pre-flattened Bayer 4×4 matrix indexed by (y%4)*4 + (x%4).
const BAYER4 = new Uint8Array([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

const TARGET_WIDTH_1X = 600;
const TARGET_WIDTH_2X = 1200;

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

    // 1-bit Bayer dither (ink/paper)
    await encodePngRgba(
      makeDither(data, W, H),
      W, H,
      targets[`dither${variant.suffix}`]
    );
    generated.push(targets[`dither${variant.suffix}`]);

    // 4-tone gray, interpolated between ink and paper
    await encodePngRgba(
      makeQuantBw(data, W, H),
      W, H,
      targets[`quantBw${variant.suffix}`]
    );
    generated.push(targets[`quantBw${variant.suffix}`]);

    // 8-color (per-channel 1-bit Bayer)
    await encodePngRgba(
      makeQuant(data, W, H),
      W, H,
      targets[`quant${variant.suffix}`]
    );
    generated.push(targets[`quant${variant.suffix}`]);

    // Optimized JPEG. Encode from the raw buffer we already have so we
    // don't re-decode the source.
    await sharp(data, { raw: { width: W, height: H, channels: info.channels } })
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

// ── Layer construction ──────────────────────────────────────────────────────
//
// `data` is RGBA or RGB raw pixel data; `channels` is 3 or 4. Each helper
// returns an RGBA Uint8Array suitable for sharp's raw input. Working in
// raw RGBA throughout avoids paying per-pixel sharp overhead.

function makeDither(data, W, H) {
  const channels = data.length / (W * H);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * channels;
      const lum = (0.299 * data[si] + 0.587 * data[si+1] + 0.114 * data[si+2]) / 255;
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

function makeQuantBw(data, W, H) {
  const channels = data.length / (W * H);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * channels;
      const lum = (0.299 * data[si] + 0.587 * data[si+1] + 0.114 * data[si+2]) / 255;
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

function makeQuant(data, W, H) {
  const channels = data.length / (W * H);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * channels;
      const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      const di = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        out[di + c] = (data[si + c] / 255 > t) ? 255 : 0;
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
