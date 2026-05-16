// ── Vite plugin: image dither pipeline ──────────────────────────────────────
// At build time, scans src/content/posts/<slug>/images/ for source images
// (.jpg, .jpeg, .png) and generates derivative layers (1-bit Bayer dither,
// 4-tone gray, 8-color quant, optimized JPEG) at 1× and 2× resolutions.
//
// Derivatives are written next to the source in src/content/posts/<slug>/
// images/. They're gitignored — see .gitignore.
//
// Two output paths:
//
//   - Build: emits the derivatives to dist/content/posts/<slug>/images/.
//     Original sources are NOT emitted (only the .optimized.jpg variant
//     ships to clients).
//
//   - Dev: registers a middleware that serves /content/posts/*/images/*
//     from the source tree, so the markdown renderer's URLs resolve. The
//     dither happens on dev-server startup (and on file change).
//
// See docs/image-pipeline-plan_260516.md §3 for the broader design.

import { promises as fs } from "fs";
import path from "path";
import { writeDerivativesForSource } from "./dither.js";

// Source images live here, relative to project root.
const POSTS_ROOT = "src/content/posts";

// The URL path Vite must serve them under. Matches what the image
// renderer in src/markdown/image-renderer.js produces.
const URL_PREFIX = "/content/posts/";

// File extensions we recognize as image sources.
const SOURCE_EXTS = new Set([".jpg", ".jpeg", ".png"]);

// File extensions we emit. Used to decide what to copy into dist.
const DERIVATIVE_PATTERNS = [
  /\.dither(\.@?2x)?\.png$/,
  /\.dither@2x\.png$/,
  /\.quantBw(\.@?2x)?\.png$/,
  /\.quantBw@2x\.png$/,
  /\.quant(\.@?2x)?\.png$/,
  /\.quant@2x\.png$/,
  /\.optimized\.jpg$/,
  /\.optimized@2x\.jpg$/,
];

function isDerivative(filename) {
  return DERIVATIVE_PATTERNS.some(p => p.test(filename));
}

export function imageDitherPlugin() {
  let projectRoot = process.cwd();

  return {
    name: "ctc-image-dither",

    configResolved(config) {
      projectRoot = config.root || process.cwd();
    },

    // Run the dither over every source image found in the post tree. This
    // fires at the start of both `vite build` and `vite dev`.
    async buildStart() {
      const sourcesRoot = path.resolve(projectRoot, POSTS_ROOT);
      const sources = await findSourceImages(sourcesRoot);

      const t0 = Date.now();
      let generated = 0;
      let skipped   = 0;
      for (const src of sources) {
        try {
          const res = await writeDerivativesForSource(src);
          if (res.generated.length > 0) generated += res.generated.length;
          else                          skipped += 1;
        } catch (err) {
          this.warn(`[ctc-image-dither] failed on ${path.relative(projectRoot, src)}: ${err.message}`);
        }
      }

      const ms = Date.now() - t0;
      if (sources.length > 0) {
        const msg = `[ctc-image-dither] ${sources.length} sources · ${generated} files generated · ${skipped} up-to-date · ${ms}ms`;
        this.info ? this.info(msg) : console.log(msg);
      }
    },

    // Dev-mode middleware: serve derivative files from the source tree under
    // /content/posts/*/images/*. The Vite root doesn't include src/ by
    // default, and we don't want to move source images into public/, so the
    // middleware bridges the gap.
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const u = req.url || "";
        if (!u.startsWith(URL_PREFIX)) return next();

        const relUrl = u.split("?")[0].slice(URL_PREFIX.length); // <slug>/images/<file>
        const onDisk = path.resolve(projectRoot, POSTS_ROOT, relUrl);

        // Guard against path traversal.
        const sources = path.resolve(projectRoot, POSTS_ROOT);
        if (!onDisk.startsWith(sources)) return next();

        try {
          const stat = await fs.stat(onDisk);
          if (!stat.isFile()) return next();
        } catch {
          return next();
        }

        const ext = path.extname(onDisk).toLowerCase();
        const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
                   : ext === ".png" ? "image/png"
                   : "application/octet-stream";

        const buf = await fs.readFile(onDisk);
        res.setHeader("Content-Type", mime);
        // Short cache during dev so changes propagate quickly.
        res.setHeader("Cache-Control", "no-cache");
        res.end(buf);
      });
    },

    // In build mode, emit every derivative into dist/. Vite's static-asset
    // pipeline doesn't see files outside its declared inputs, so we walk
    // the source tree at the end of the build and emit each derivative as
    // an asset via this.emitFile().
    async generateBundle() {
      const sourcesRoot = path.resolve(projectRoot, POSTS_ROOT);
      const entries = await listAllPostImageFiles(sourcesRoot);
      for (const e of entries) {
        if (!isDerivative(e.filename)) continue;
        const data = await fs.readFile(e.absPath);
        // The Rollup `fileName` is relative to dist/. We mirror the source
        // tree under /content/posts/<slug>/images/<filename>.
        const distRel = `content/posts/${e.slug}/images/${e.filename}`;
        this.emitFile({
          type: "asset",
          fileName: distRel,
          source: data,
        });
      }
    },
  };
}

// ── Filesystem helpers ──────────────────────────────────────────────────────

async function findSourceImages(sourcesRoot) {
  const out = [];
  let topLevel;
  try {
    topLevel = await fs.readdir(sourcesRoot, { withFileTypes: true });
  } catch {
    return out; // posts root doesn't exist yet — no-op
  }
  for (const post of topLevel) {
    if (!post.isDirectory()) continue;
    const imagesDir = path.join(sourcesRoot, post.name, "images");
    let images;
    try {
      images = await fs.readdir(imagesDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of images) {
      if (!f.isFile()) continue;
      if (isDerivative(f.name)) continue;
      const ext = path.extname(f.name).toLowerCase();
      if (!SOURCE_EXTS.has(ext)) continue;
      out.push(path.join(imagesDir, f.name));
    }
  }
  return out;
}

async function listAllPostImageFiles(sourcesRoot) {
  const out = [];
  let topLevel;
  try {
    topLevel = await fs.readdir(sourcesRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const post of topLevel) {
    if (!post.isDirectory()) continue;
    const imagesDir = path.join(sourcesRoot, post.name, "images");
    let images;
    try {
      images = await fs.readdir(imagesDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of images) {
      if (!f.isFile()) continue;
      out.push({
        slug:     post.name,
        filename: f.name,
        absPath:  path.join(imagesDir, f.name),
      });
    }
  }
  return out;
}
