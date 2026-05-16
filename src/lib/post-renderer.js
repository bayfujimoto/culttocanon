// ── Post renderer ────────────────────────────────────────────────────────────
// Render a Post object into a DOM tree. The header carries the title and the
// epigraph (if present); the body is markdown parsed by `marked`. Marginalia
// is rendered separately (see src/public/marginalia.js).
//
// The renderer is intentionally light — no syntax highlighting, no math, no
// embeds yet. Phase 4 (iteration) can add what real pieces need.

import { marked } from "marked";
import { diffLines } from "./line-diff.js";

marked.setOptions({
  gfm:       true,
  breaks:    false,
  pedantic:  false,
});

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
      <div class="post-body">${marked.parse(post.body || "")}</div>
    </article>
  `;
}

/**
 * Render an inline unified diff of a prior `version` against the current
 * `post` body into `container`. `version` = { revised, words, body }.
 * `onClose` is invoked when the banner's [×] is clicked (Esc is wired by the
 * caller). Replaces all contents of `container`.
 */
export function renderDiff(post, version, container, { onClose } = {}) {
  if (!post || !version) {
    container.innerHTML = "";
    return;
  }

  const rows = diffLines(version.body || "", post.body || "");
  const SIGIL = { ctx: " ", add: "+", del: "-" };

  const lines = rows.map(r => {
    const sigil = SIGIL[r.type] || " ";
    return `<div class="diff-line diff-line--${r.type}">` +
           `<span class="diff-sigil">${sigil}</span>` +
           `<span class="diff-text">${escapeHTML(r.text) || "&nbsp;"}</span>` +
           `</div>`;
  }).join("");

  const from = version.revised || "earlier";

  container.innerHTML = `
    <article class="post post--diff">
      <div class="diff-banner">
        <span class="diff-banner-label">diff: ${escapeHTML(from)} → current</span>
        <button type="button" class="diff-banner-close" id="diff-close" title="back to reading (Esc)">×</button>
      </div>
      <div class="diff-body">${lines}</div>
    </article>
  `;

  const btn = container.querySelector("#diff-close");
  if (btn && onClose) btn.addEventListener("click", onClose);
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
