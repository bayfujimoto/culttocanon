// ── Post renderer ────────────────────────────────────────────────────────────
// Render a Post object into a DOM tree. The header carries the title and the
// epigraph (if present); the body is markdown parsed by `marked`. Marginalia
// is rendered separately (see src/public/marginalia.js).
//
// The renderer is intentionally light — no syntax highlighting, no math, no
// embeds yet. Phase 4 (iteration) can add what real pieces need.

import { marked, Marked } from "marked";
import { diffLines, diffSentences, diffWords } from "./line-diff.js";
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
 * Build the post header markup (kind/status, title, epigraph, id + dates).
 * Shared by `renderPost` and `renderDiff` so the diff view shows the same
 * header as the rendered post. Returns "" for a falsy post.
 */
function renderPostHeader(post) {
  if (!post) return "";

  const created = formatDate(post.created);

  return `
    <header class="post-header">
      <h1 class="post-title">${escapeHTML(post.title)}</h1>
      <div class="post-kind-row">
        <span class="post-kind">${escapeHTML(post.kind)}</span>
        <time class="post-kind-date" datetime="${created.iso}">${created.human}</time>
      </div>
      ${post.epigraph ? `<p class="post-epigraph">${escapeHTML(post.epigraph)}</p>` : ""}
    </header>
  `;
}

/**
 * Build the post colophon markup. The incunabula convention: id, version,
 * date in day.romanMonth.year form, and the site name — set in mono small
 * caps to echo the topbar register and to close the piece with explicit
 * bibliographic ceremony rather than trailing off. Returns "" for posts
 * without an id.
 */
function renderColophon(post) {
  if (!post || !post.id) return "";
  const parts = [ escapeHTML(post.id) ];
  if (post.version) parts.push(`v${escapeHTML(post.version)}`);
  const d = formatColophonDate(post.created);
  if (d) parts.push(d);
  parts.push("cult to canon");
  return `<footer class="post-colophon">${parts.join(" · ")}</footer>`;
}

/**
 * Render `post` into `container`. Replaces all contents of `container`.
 */
export function renderPost(post, container) {
  if (!post) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <article class="post">
      ${renderPostHeader(post)}
      <div class="post-body">${parseBodyFor(post)}</div>
      ${renderColophon(post)}
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
 * @param {Object} [opts.post]                        post, for the header
 * @param {string} opts.oldBody                       earlier body (or "")
 * @param {string} opts.newBody                       this version's body
 * @param {Object} opts.banner                        { id, version, category, date }
 * @param {Function|null} [opts.onPrev]               older entry, or null
 * @param {Function|null} [opts.onNext]               newer entry, or null
 * @param {Function} [opts.onClose]                   back to current state
 */
export function renderDiff(container, opts = {}) {
  const { post, oldBody, newBody, banner = {}, onPrev, onNext, onClose } = opts;

  const rows  = diffLines(oldBody || "", newBody || "");
  const SIGIL = { ctx: " ", add: "+", del: "-", mod: "~" };

  // Threshold for "this pair is too dissimilar to word-diff cleanly":
  // when >60% of word tokens are add/del, the pair likely describes
  // unrelated content that happened to align positionally, so we fall back
  // to plain red+green lines rather than rendering every-word-colored noise.
  const NOISE_THRESHOLD = 0.6;
  // When a del-run and add-run differ in length by more than this ratio,
  // skip word-diff pairing entirely — pairing assumes the runs describe
  // the same content edited; once sizes diverge, alignment is arbitrary.
  const SIZE_MISMATCH_RATIO = 2;

  // Coalesce adjacent del/add runs so a del-run immediately followed by an
  // add-run renders as merged word-diff paragraphs instead of a full red
  // paragraph + full green paragraph. ctx rows and unpaired add/del runs
  // render exactly as the old 1:1 mapping did.
  const renderLine = (type, html) =>
    `<div class="diff-line diff-line--${type}">` +
    `<span class="diff-sigil">${SIGIL[type] || " "}</span>` +
    `<span class="diff-text">${html || "&nbsp;"}</span>` +
    `</div>`;

  // Render a paired paragraph using sentence-grain alignment, then word-grain
  // inside each modified sentence. Unchanged sentences pass through neutral
  // so a paragraph with one rewritten sentence among four reads as plain
  // prose interrupted by one colored sentence — not whole-paragraph noise.
  // Returns { html, totalTokens, changedTokens } so the caller can apply the
  // paragraph-level noise guard against the aggregate word-token ratio.
  function renderSentenceSegments(segs) {
    const parts = [];
    let totalTokens = 0;
    let changedTokens = 0;
    const wholeSentence = (cls, text) => {
      // Treat a whole-sentence add/del as fully changed for the noise tally.
      const toks = text.split(/(\s+)/).filter(t => t.length > 0);
      totalTokens   += toks.length;
      changedTokens += toks.length;
      parts.push(`<span class="${cls}">${escapeHTML(text)}</span>`);
    };
    for (let i = 0; i < segs.length; ) {
      const s = segs[i];
      if (s.type === "ctx") {
        const toks = s.text.split(/(\s+)/).filter(t => t.length > 0);
        totalTokens += toks.length;
        parts.push(escapeHTML(s.text));
        i++;
        continue;
      }
      const dSents = [];
      while (i < segs.length && segs[i].type === "del") { dSents.push(segs[i].text); i++; }
      const aSents = [];
      while (i < segs.length && segs[i].type === "add") { aSents.push(segs[i].text); i++; }
      if (dSents.length && aSents.length) {
        const sp = Math.min(dSents.length, aSents.length);
        for (let q = 0; q < sp; q++) {
          const ws = diffWords(dSents[q], aSents[q]);
          const changed = ws.reduce((n, w) => n + (w.type !== "ctx" ? 1 : 0), 0);
          totalTokens   += ws.length;
          changedTokens += changed;
          const tooNoisy = changed / Math.max(ws.length, 1) > NOISE_THRESHOLD;
          if (tooNoisy) {
            parts.push(`<span class="diff-word--del">${escapeHTML(dSents[q])}</span>`);
            parts.push(`<span class="diff-word--add">${escapeHTML(aSents[q])}</span>`);
          } else {
            parts.push(ws.map(w =>
              w.type === "ctx"
                ? escapeHTML(w.text)
                : `<span class="diff-word--${w.type}">${escapeHTML(w.text)}</span>`
            ).join(""));
          }
        }
        for (let q = sp; q < dSents.length; q++) wholeSentence("diff-word--del", dSents[q]);
        for (let q = sp; q < aSents.length; q++) wholeSentence("diff-word--add", aSents[q]);
      } else {
        for (const t of dSents) wholeSentence("diff-word--del", t);
        for (const t of aSents) wholeSentence("diff-word--add", t);
      }
    }
    return { html: parts.join(""), totalTokens, changedTokens };
  }

  const out = [];
  for (let k = 0; k < rows.length; ) {
    const r = rows[k];
    if (r.type === "ctx") {
      out.push(renderLine("ctx", escapeHTML(r.text)));
      k++;
      continue;
    }
    // Gather a maximal del-run, then the add-run that immediately follows.
    // Blank lines have no words to diff — pairing them would word-render a
    // whole paragraph as all-add/all-del (the empty-old initial-publish case
    // splits to a single "" del). Emit them as plain rows and pair only the
    // content lines, so initial publishes stay clean +/- as before.
    const dels = [];
    while (k < rows.length && rows[k].type === "del") {
      const t = rows[k].text;
      if (t === "") out.push(renderLine("del", "&nbsp;"));
      else dels.push(t);
      k++;
    }
    const adds = [];
    while (k < rows.length && rows[k].type === "add") {
      const t = rows[k].text;
      if (t === "") out.push(renderLine("add", "&nbsp;"));
      else adds.push(t);
      k++;
    }

    if (dels.length && adds.length) {
      const ratio = Math.max(dels.length, adds.length) / Math.min(dels.length, adds.length);
      if (ratio > SIZE_MISMATCH_RATIO) {
        for (const t of dels) out.push(renderLine("del", escapeHTML(t)));
        for (const t of adds) out.push(renderLine("add", escapeHTML(t)));
        continue;
      }
      // Modified block: pair paragraphs by index. Inside each pair, align
      // sentences first so unchanged sentences pass through neutral and only
      // modified ones get word-diff treatment. If the aggregate word-level
      // change ratio for the paragraph still exceeds NOISE_THRESHOLD (i.e.
      // sentence-grain didn't find enough shared structure to be useful),
      // fall back to plain red+green for the whole pair.
      const paired = Math.min(dels.length, adds.length);
      for (let p = 0; p < paired; p++) {
        const sentSeg = diffSentences(dels[p], adds[p]);
        const r = renderSentenceSegments(sentSeg);
        const tooNoisy = r.changedTokens / Math.max(r.totalTokens, 1) > NOISE_THRESHOLD;
        if (tooNoisy) {
          out.push(renderLine("del", escapeHTML(dels[p])));
          out.push(renderLine("add", escapeHTML(adds[p])));
        } else {
          out.push(renderLine("mod", r.html));
        }
      }
      for (let p = paired; p < dels.length; p++) out.push(renderLine("del", escapeHTML(dels[p])));
      for (let p = paired; p < adds.length; p++) out.push(renderLine("add", escapeHTML(adds[p])));
    } else {
      // Pure deletion or pure insertion — render as today.
      for (const t of dels) out.push(renderLine("del", escapeHTML(t)));
      for (const t of adds) out.push(renderLine("add", escapeHTML(t)));
    }
  }
  const lines = out.join("");

  // Overview stats: total line-level additions and deletions. Shown in the
  // banner so the user can gauge change scope before diving in.
  let addCount = 0, delCount = 0;
  for (const r of rows) {
    if (r.type === "add") addCount++;
    else if (r.type === "del") delCount++;
  }

  const id   = banner.id       || "";
  const ver  = banner.version  || "";
  const cat  = banner.category || "";
  const date = banner.date     || "";

  const prevAttr = onPrev ? "" : "disabled";
  const nextAttr = onNext ? "" : "disabled";

  // Header (same as the rendered post) at the top, then the diff body, then
  // the banner — CSS pins the banner as a floating bar at the bottom of the
  // read pane (see .diff-banner in styles.css).
  container.innerHTML = `
    <article class="post post--diff">
      ${renderPostHeader(post)}
      <div class="diff-body">${lines}</div>
      <div class="diff-banner">
        <span class="diff-banner-label">
          reading diff:
          <span class="diff-banner-id">${escapeHTML(id)}</span>
          <span class="diff-banner-version">v${escapeHTML(ver)}</span>
          ${cat ? `<span class="diff-banner-category diff-banner-category--${escapeAttr(cat)}">[${escapeHTML(cat)}]</span>` : ""}
          ${date ? `<span class="diff-banner-sep">·</span><time class="diff-banner-date">${escapeHTML(date)}</time>` : ""}
          <span class="diff-banner-sep">·</span>
          <span class="diff-banner-stat"><span class="diff-banner-stat--add">+${addCount}</span> <span class="diff-banner-stat--del">−${delCount}</span></span>
        </span>
        <span class="diff-banner-nav-group">
          <button type="button" class="diff-banner-nav" data-nav="prev" ${prevAttr} title="older version">← prev</button>
          <button type="button" class="diff-banner-nav" data-nav="close" title="close diff (Esc)">close</button>
          <button type="button" class="diff-banner-nav" data-nav="next" ${nextAttr} title="newer version">next →</button>
        </span>
      </div>
    </article>
  `;

  container.querySelectorAll(".diff-banner-nav").forEach(btn => {
    btn.addEventListener("click", () => {
      const nav = btn.dataset.nav;
      if (nav === "prev"  && onPrev)  onPrev();
      else if (nav === "next"  && onNext)  onNext();
      else if (nav === "close" && onClose) onClose();
    });
  });
}

function formatDate(d) {
  if (!(d instanceof Date)) return { iso: "", human: "" };
  const iso   = d.toISOString().slice(0, 10);
  const human = d.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
  return { iso, human };
}

// Roman-numeral month in incunabula colophon style: "22.v.2026".
const ROMAN_MONTHS = ["i","ii","iii","iv","v","vi","vii","viii","ix","x","xi","xii"];
function formatColophonDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const day   = d.getDate();
  const month = ROMAN_MONTHS[d.getMonth()] || "";
  const year  = d.getFullYear();
  return `${day}.${month}.${year}`;
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function escapeAttr(s) {
  return escapeHTML(s);
}
