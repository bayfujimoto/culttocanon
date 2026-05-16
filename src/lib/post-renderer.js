// ── Post renderer ────────────────────────────────────────────────────────────
// Render a Post object into a DOM tree. The header carries the title and the
// epigraph (if present); the body is markdown parsed by `marked`. Marginalia
// is rendered separately (see src/public/marginalia.js).
//
// The renderer is intentionally light — no syntax highlighting, no math, no
// embeds yet. Phase 4 (iteration) can add what real pieces need.

import { marked, Marked } from "marked";
import { diffLines } from "./line-diff.js";
import { imageAttributesExtension } from "../markdown/image-attributes.js";
import { makeImageRendererExtension }  from "../markdown/image-renderer.js";
import { enhanceImages }               from "../runtime/ctc-image-reveal.js";

marked.setOptions({
  gfm:       true,
  breaks:    false,
  pedantic:  false,
});

// ── Per-post markdown parsing ──────────────────────────────────────────────
// The image renderer needs to know the post's folder name (so it can build
// URLs to derived assets). Marked's extensions are configured globally on the
// `marked` singleton, so we mint a fresh Marked instance for each post and
// register both the image-attributes tokenizer and the folder-scoped
// renderer on it. The shared `marked` singleton is left untouched and stays
// available for any callers (e.g. the diff view) that don't need image
// rewriting.
function parseBodyFor(post) {
  if (!post) return "";
  const m = new Marked({ gfm: true, breaks: false, pedantic: false });
  m.use({
    extensions: [
      imageAttributesExtension,
      makeImageRendererExtension(post.folder || ""),
    ],
  });
  return m.parse(post.body || "");
}

/**
 * Render `post` into `container`. Replaces all contents of `container`.
 */
export function renderPost(post, container) {
  if (!post) {
    container.innerHTML = "";
    return;
  }

  const created = formatDate(post.created);
  const revised = post.revised ? formatDate(post.revised) : null;

  container.innerHTML = `
    <article class="post">
      <header class="post-header">
        <div class="post-kind-row">
          <span class="post-kind">${escapeHTML(post.kind)}</span>
          <span class="post-status post-status--${escapeAttr(post.status)}">${escapeHTML(post.status)}</span>
        </div>
        <h1 class="post-title">${escapeHTML(post.title)}</h1>
        ${post.epigraph ? `<p class="post-epigraph">${escapeHTML(post.epigraph)}</p>` : ""}
        <div class="post-meta">
          <span class="post-meta-id">${escapeHTML(post.id)}</span>
          <span class="post-meta-sep">·</span>
          <time class="post-meta-date" datetime="${created.iso}">${created.human}</time>
          ${revised ? `<span class="post-meta-sep">·</span><time class="post-meta-revised" datetime="${revised.iso}">revised ${revised.human}</time>` : ""}
        </div>
      </header>
      <div class="post-body">${parseBodyFor(post)}</div>
    </article>
  `;

  // Hand the freshly-rendered container to the runtime image enhancer.
  // It's a no-op when there are no `img.ctc-dither` elements, so this is
  // safe on every render. Static import so the swap happens synchronously
  // after the DOM is in place — no first-click race.
  enhanceImages(container);
}

/**
 * Render an inline unified diff into `container`. The diff is between
 * `oldBody` and `newBody`; the banner describes which version is being
 * shown and offers navigation between adjacent versions and back to the
 * current state.
 *
 * Backward-diff semantic: the diff shows the changes that *produced* the
 * version named in `banner`. For the first entry in history (no predecessor),
 * callers pass `oldBody: ""` so the initial publish renders as all-additions.
 *
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {string} opts.oldBody                       earlier body (or "")
 * @param {string} opts.newBody                       this version's body
 * @param {Object} opts.banner                        { id, version, category, date }
 * @param {Function|null} [opts.onPrev]               older entry, or null
 * @param {Function|null} [opts.onNext]               newer entry, or null
 * @param {Function} [opts.onClose]                   back to current state
 */
export function renderDiff(container, opts = {}) {
  const { oldBody, newBody, banner = {}, onPrev, onNext, onClose } = opts;

  const rows  = diffLines(oldBody || "", newBody || "");
  const SIGIL = { ctx: " ", add: "+", del: "-" };

  const lines = rows.map(r => {
    const sigil = SIGIL[r.type] || " ";
    return `<div class="diff-line diff-line--${r.type}">` +
           `<span class="diff-sigil">${sigil}</span>` +
           `<span class="diff-text">${escapeHTML(r.text) || "&nbsp;"}</span>` +
           `</div>`;
  }).join("");

  const id   = banner.id       || "";
  const ver  = banner.version  || "";
  const cat  = banner.category || "";
  const date = banner.date     || "";

  const prevAttr = onPrev ? "" : "disabled";
  const nextAttr = onNext ? "" : "disabled";

  container.innerHTML = `
    <article class="post post--diff">
      <div class="diff-banner">
        <span class="diff-banner-label">
          reading diff:
          <span class="diff-banner-id">${escapeHTML(id)}</span>
          <span class="diff-banner-version">v${escapeHTML(ver)}</span>
          ${cat ? `<span class="diff-banner-category diff-banner-category--${escapeAttr(cat)}">[${escapeHTML(cat)}]</span>` : ""}
          ${date ? `<span class="diff-banner-sep">·</span><time class="diff-banner-date">${escapeHTML(date)}</time>` : ""}
        </span>
        <span class="diff-banner-nav-group">
          <button type="button" class="diff-banner-nav" data-nav="prev" ${prevAttr} title="older version">← prev</button>
          <button type="button" class="diff-banner-nav" data-nav="current" title="back to current (Esc)">view current</button>
          <button type="button" class="diff-banner-nav" data-nav="next" ${nextAttr} title="newer version">next →</button>
        </span>
      </div>
      <div class="diff-body">${lines}</div>
    </article>
  `;

  container.querySelectorAll(".diff-banner-nav").forEach(btn => {
    btn.addEventListener("click", () => {
      const nav = btn.dataset.nav;
      if (nav === "prev"    && onPrev)  onPrev();
      else if (nav === "next"    && onNext)  onNext();
      else if (nav === "current" && onClose) onClose();
    });
  });
}

function formatDate(d) {
  if (!(d instanceof Date)) return { iso: "", human: "" };
  const iso   = d.toISOString().slice(0, 10);
  const human = d.toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  return { iso, human };
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function escapeAttr(s) {
  return escapeHTML(s);
}
