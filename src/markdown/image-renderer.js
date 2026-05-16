// ── Image renderer ─────────────────────────────────────────────────────────
// Emits the HTML for an `imageWithAttrs` token (see image-attributes.js).
// Three branches, chosen by the token's Pandoc classes:
//
//   default        — img.ctc-dither pointing at the dither.png with data-*
//                    URLs for the other bit-depth layers. The runtime
//                    enhancer (src/runtime/ctc-image-reveal.js) upgrades
//                    these to interactive canvases when they scroll into
//                    view.
//   .no-dither     — plain <img> at the optimized JPEG. Use for charts,
//                    screenshots, anything whose legibility is the point.
//   .no-reveal     — img.ctc-dither but flagged so the enhancer skips the
//                    click-to-reveal interaction. The dither stays static.
//   .full          — adds `ctc-image--full` class to escape the body column
//                    width; orthogonal to the dither/no-dither choice.
//
// The renderer needs the post's *folder name* to build relative URLs to the
// derived assets. The post-renderer passes it in via a factory function.
//
// URL convention (for a source image `figure-1.jpg` in post folder
// `<slug>/`):
//
//   /content/posts/<slug>/images/figure-1.dither.png       1x
//   /content/posts/<slug>/images/figure-1.dither@2x.png    2x retina
//   /content/posts/<slug>/images/figure-1.quantBw.png      4-tone gray
//   /content/posts/<slug>/images/figure-1.quant.png        8-color
//   /content/posts/<slug>/images/figure-1.optimized.jpg    full-color source
//
// During Vite build, the image-dither plugin (build/vite-plugin-image-dither.js)
// produces all of these in `dist/content/posts/<slug>/images/`. The public
// site serves the `content/` tree as a top-level path; see vite.config.js.

import { IMAGE_TOKEN_TYPE } from "./image-attributes.js";

/**
 * Build a marked renderer extension scoped to a particular post folder.
 * Use:
 *
 *   const renderer = makeImageRendererFor(post.folder);
 *   marked.use({ renderer: { [IMAGE_TOKEN_TYPE]: renderer } });
 *
 * Or pass it directly via `marked.use({ extensions: [...] })`.
 */
export function makeImageRendererExtension(postFolder) {
  return {
    name: IMAGE_TOKEN_TYPE,
    level: "inline",
    renderer(token) {
      const classes = new Set(token.classes || []);
      const alt     = token.text || "";
      const title   = token.title || null;

      // Resolve the source path. If it starts with `images/` we expand it to
      // the post's folder; otherwise we treat it as an absolute or full URL
      // and leave it alone. This keeps `![alt](https://...)` working for the
      // rare case someone references an external image.
      const rawHref = token.href || "";
      const resolved = resolveHref(rawHref, postFolder);

      // Bypass the dither entirely.
      if (classes.has("no-dither")) {
        return plainImg(resolved, alt, title, classes);
      }

      // Compute the four sibling URLs from the source path. If the path is
      // external (http(s)://) we can't dither it — fall back to plain.
      if (/^https?:/i.test(resolved.src) || resolved.external) {
        return plainImg(resolved, alt, title, classes);
      }

      const variants = variantsFor(resolved.src);
      const extraClass = classes.has("full") ? " ctc-image--full" : "";
      const revealAttr = classes.has("no-reveal") ? ` data-no-reveal="1"` : "";

      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";

      // The 1x dither is the default `src`; srcset upgrades to 2x on retina.
      // data-* attributes point at the bit-depth layers and the source
      // image. The runtime enhancer reads them on first click to lazy-load.
      return (
        `<img class="ctc-dither${extraClass}"` +
        ` src="${escapeAttr(variants.dither1x)}"` +
        ` srcset="${escapeAttr(variants.dither1x)} 1x, ${escapeAttr(variants.dither2x)} 2x"` +
        ` data-quantbw="${escapeAttr(variants.quantBw1x)}"` +
        ` data-quantbw-2x="${escapeAttr(variants.quantBw2x)}"` +
        ` data-quant="${escapeAttr(variants.quant1x)}"` +
        ` data-quant-2x="${escapeAttr(variants.quant2x)}"` +
        ` data-source="${escapeAttr(variants.source1x)}"` +
        ` data-source-2x="${escapeAttr(variants.source2x)}"` +
        ` alt="${escapeAttr(alt)}"${titleAttr}${revealAttr}` +
        ` loading="lazy" decoding="async">`
      );
    },
  };
}

// ── URL resolution ──────────────────────────────────────────────────────────

function resolveHref(rawHref, postFolder) {
  // External URL — return as-is, no rewriting.
  if (/^https?:/i.test(rawHref)) {
    return { src: rawHref, external: true };
  }

  // Absolute path (starts with `/`) — return as-is. The author is referencing
  // something in /public or another absolute location.
  if (rawHref.startsWith("/")) {
    return { src: rawHref, external: false };
  }

  // Relative path. The most common authoring form is `images/foo.jpg` from
  // inside a post folder; expand to the canonical content URL. Anything
  // else we treat as relative to the post folder verbatim.
  const stem = `/content/posts/${postFolder}/`;
  return { src: stem + rawHref, external: false };
}

/**
 * From a source path like `/content/posts/<slug>/images/foo.jpg`, return all
 * the variant URLs the runtime needs. The naming convention matches what
 * the Vite plugin emits.
 */
function variantsFor(srcPath) {
  // Split into base and extension. We discard the original extension because
  // the variants have their own — `.dither.png`, etc.
  const lastDot   = srcPath.lastIndexOf(".");
  const lastSlash = srcPath.lastIndexOf("/");
  const base = (lastDot > lastSlash) ? srcPath.slice(0, lastDot) : srcPath;

  return {
    dither1x:  base + ".dither.png",
    dither2x:  base + ".dither@2x.png",
    quantBw1x: base + ".quantBw.png",
    quantBw2x: base + ".quantBw@2x.png",
    quant1x:   base + ".quant.png",
    quant2x:   base + ".quant@2x.png",
    source1x:  base + ".optimized.jpg",
    source2x:  base + ".optimized@2x.jpg",
  };
}

// ── HTML emitters ───────────────────────────────────────────────────────────

function plainImg(resolved, alt, title, classes) {
  // For .no-dither we still try to point at `.optimized.jpg` if the source
  // looks like it'll have one (an in-repo image with an extension). If the
  // path is external or doesn't look like a source image, fall back to the
  // raw href.
  let src = resolved.src;
  if (!resolved.external) {
    src = trySwapToOptimized(resolved.src);
  }
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
  const klass     = classes.has("full") ? ` class="ctc-image--full"` : "";
  return (
    `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${titleAttr}${klass}` +
    ` loading="lazy" decoding="async">`
  );
}

function trySwapToOptimized(src) {
  // If the path lives under /content/posts/.../images/<name>.<ext>, return
  // <name>.optimized.jpg. Otherwise return the source unchanged.
  if (!src.includes("/images/")) return src;
  const lastDot   = src.lastIndexOf(".");
  const lastSlash = src.lastIndexOf("/");
  if (lastDot <= lastSlash) return src;
  return src.slice(0, lastDot) + ".optimized.jpg";
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
