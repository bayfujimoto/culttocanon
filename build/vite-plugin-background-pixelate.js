// ── Vite plugin: background pixelate ────────────────────────────────────────
// At dev-server start and at `vite build`, walks /public/backgrounds/ for
// source images (.jpg, .jpeg, .png) and emits a small `.pixelated.png`
// sibling for each by downscaling the source to PIXELATE_WIDTH px wide.
//
// The CSS in src/public/lib/background.css upscales these back up with
// `image-rendering: pixelated`, so each source pixel becomes a hard block
// at viewport scale — matching the treatment Bay approved in the 14-variant
// mockup test (see /bg-mockups/05-pixelate.html).
//
// Outputs go *next to* the source in /public/backgrounds/ rather than into
// dist/ directly. Vite's publicDir mechanism then copies them into the build
// output verbatim. Both flows work the same way:
//
//   dev:    plugin generates derivatives → Vite serves /public/* statically
//   build:  plugin generates derivatives → Vite copies /public/* to dist/
//
// Modeled on build/vite-plugin-image-dither.js, which handles a richer
// pipeline for post images. This one is intentionally simpler: one input,
// one output, no @2x variant.

import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";

// Source folder, relative to project root. Vite copies publicDir to dist/
// verbatim, so derivatives written here ship to clients automatically.
const BG_DIR = "public/backgrounds";

// Match mockup 05-pixelate.html — 80px wide, downscaled with a box-style
// area filter. Sharp's default `lanczos3` is too smooth for this; "mitchell"
// approximates a box filter and preserves block-average colour faithfully.
const PIXELATE_WIDTH = 80;
const RESIZE_KERNEL  = sharp.kernel.mitchell;

const SOURCE_EXTS = new Set([".jpg", ".jpeg", ".png"]);

// Virtual module exposing the discovered rotation list to client code. The
// directory is the single source of truth: src/public/lib/background.js
// imports BACKGROUND_IMAGES from here, so dropping a source into
// /public/backgrounds/ adds it to the daily rotation with no code edit.
const VIRTUAL_ID = "virtual:ctc-backgrounds";
const RESOLVED_VIRTUAL_ID = "\0" + VIRTUAL_ID;

function isDerivative(filename) {
  return /\.pixelated\.png$/.test(filename);
}

// Source path → bare name (no directory, no extension). Mirrors the idiom in
// pixelatedPathFor so the runtime URL (`<bare>.jpg`) stays in lockstep.
function bareNameOf(srcPath) {
  return path.basename(srcPath, path.extname(srcPath));
}

export function backgroundPixelatePlugin() {
  let projectRoot = process.cwd();
  // Recomputed each buildStart (which runs before module load in both dev and
  // build), cached here so the virtual module's load() returns the current
  // scan for this process.
  let bgNames = [];

  return {
    name: "ctc-background-pixelate",

    configResolved(config) {
      projectRoot = config.root || process.cwd();
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      return null;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        return `export const BACKGROUND_IMAGES = ${JSON.stringify(bgNames)};\n`;
      }
      return null;
    },

    // Fires at the start of both `vite dev` and `vite build`. Walks the
    // backgrounds folder, bakes any missing or stale derivatives, and
    // refreshes the rotation list served by the virtual module.
    async buildStart() {
      const bgRoot = path.resolve(projectRoot, BG_DIR);
      const sources = await findSourceImages(bgRoot);

      // Sorted ascending so rotation order is stable and tracks the numeric
      // naming scheme (001, 002, …).
      bgNames = sources.map(bareNameOf).sort();

      const t0 = Date.now();
      let generated = 0;
      let skipped   = 0;
      for (const src of sources) {
        try {
          const result = await bakeIfStale(src);
          if (result === "generated") generated += 1;
          else                        skipped   += 1;
        } catch (err) {
          this.warn(`[ctc-background-pixelate] failed on ${path.relative(projectRoot, src)}: ${err.message}`);
        }
      }

      if (sources.length > 0) {
        const ms = Date.now() - t0;
        const msg = `[ctc-background-pixelate] ${sources.length} sources · ${generated} generated · ${skipped} up-to-date · ${ms}ms`;
        this.info ? this.info(msg) : console.log(msg);
      }
    },
  };
}

// ── Internals ───────────────────────────────────────────────────────────────

async function findSourceImages(bgRoot) {
  let entries;
  try {
    entries = await fs.readdir(bgRoot, { withFileTypes: true });
  } catch {
    return []; // backgrounds dir doesn't exist — no-op
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (isDerivative(e.name)) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) continue;
    out.push(path.join(bgRoot, e.name));
  }
  return out;
}

// Compute the derivative path for a given source. The derivative always ends
// in `.pixelated.png` regardless of the source extension, so the runtime can
// construct the URL deterministically (`<bare>.pixelated.png`).
function pixelatedPathFor(srcPath) {
  const dir = path.dirname(srcPath);
  const bare = path.basename(srcPath, path.extname(srcPath));
  return path.join(dir, `${bare}.pixelated.png`);
}

// Skip the bake if the derivative exists and is newer than the source —
// preserves incremental rebuild semantics on `vite dev` restart.
async function bakeIfStale(srcPath) {
  const outPath = pixelatedPathFor(srcPath);
  try {
    const [srcStat, outStat] = await Promise.all([fs.stat(srcPath), fs.stat(outPath)]);
    if (outStat.mtimeMs >= srcStat.mtimeMs) return "skipped";
  } catch {
    // Derivative doesn't exist yet — fall through and bake.
  }

  const img = sharp(srcPath);
  const { width: srcW, height: srcH } = await img.metadata();
  if (!srcW || !srcH) {
    throw new Error("could not read source dimensions");
  }
  const outH = Math.max(1, Math.round(srcH * (PIXELATE_WIDTH / srcW)));

  await img
    .resize(PIXELATE_WIDTH, outH, { kernel: RESIZE_KERNEL })
    .png({ compressionLevel: 9, palette: true })
    .toFile(outPath);

  return "generated";
}
