// ── Marginalia view ──────────────────────────────────────────────────────────
// Paratext for the currently-open post. Shows status, kind, register, dates,
// confidence, subjects, and links, then the apparatus proper: footnotes and a
// works-cited list, each numbered to match the inline markers in the Read pane
// (see src/markdown/paratext.js). When no post is open, shows a brief hint.

import { marked } from "marked";

export function renderMarginalia(container, post, { allPosts, onSelect, versions, onVersionSelect, activeVersion } = {}) {
  if (!container) return;

  if (!post) {
    container.innerHTML = `
      <div class="marginalia-empty">
        no piece open
        <span class="marginalia-empty-sub">— paratext appears here</span>
      </div>
    `;
    return;
  }

  const rows = [];
  rows.push(["id",         post.id]);
  if (post.version) rows.push(["version", `v${escapeHTML(post.version)}`]);
  rows.push(["status",     `<span class="marginalia-status marginalia-status--${escapeAttr(post.status)}">${escapeHTML(post.status)}</span>`]);
  rows.push(["kind",       post.kind]);
  rows.push(["register",   post.register]);
  if (post.confidence) rows.push(["confidence", post.confidence]);
  rows.push(["created",    formatDate(post.created)]);
  if (post.revised) rows.push(["revised", formatDate(post.revised)]);
  rows.push(["length",     `${post.length} words`]);

  // The current live version is not part of `versions` (that array holds only
  // superseded snapshots). Synthesize a row for it at the top of the list so
  // it's clickable like any other; it routes via the `current` sentinel rather
  // than its semver (see public/main.js) so reloads land on the same diff and
  // a current version that happens to match a historical string never collides.
  const currentEntry = {
    key:      "current",
    version:  post.version,
    category: "current",
    revised:  formatDate(post.revised),
  };
  const verEntries = [currentEntry, ...(versions || []).slice().reverse()];
  {
    // Newest-first; each row shows version, revised date, and category.
    // URL fragment is `?v=X.Y.Z` (or `?v=current`) so reloads land on the
    // same diff. The click handler intercepts and goes through the SPA
    // navigator (see public/main.js); href is the no-JS fallback. Rows are
    // visually uniform; only the version currently being viewed
    // (`activeVersion`, set while a diff is open) gets `is-active` → bold.
    const verHtml = verEntries.map((v) => {
      const key = v.key || v.version || "earlier";
      const ver = v.version || "earlier";
      const cat = v.category || "patch";
      const rev = v.revised || "";
      const cls = "marginalia-version" + (key === activeVersion ? " is-active" : "");
      return `<a class="${cls}" ` +
             `data-version="${escapeAttr(key)}" href="?v=${escapeAttr(key)}">` +
             `v${escapeHTML(ver)}` +
             (rev ? ` · ${escapeHTML(rev)}` : "") +
             ` · ${escapeHTML(cat)}` +
             `</a>`;
    }).join("<br>");
    rows.push(["versions", verHtml]);
  }

  if (post.subjects?.length) {
    rows.push(["subjects",
      post.subjects.map(s => `<span class="marginalia-tag">${escapeHTML(s)}</span>`).join(" ")
    ]);
  }

  if (post.links?.length) {
    const linkHtml = post.links.map(id => {
      const target = (allPosts || []).find(p => p.id === id);
      const title  = target ? target.title : id;
      return `<a class="marginalia-link" data-post-id="${escapeAttr(id)}" href="#${escapeAttr(id)}">${escapeHTML(title)}</a>`;
    }).join("<br>");
    rows.push(["links →", linkHtml]);
  }

  // Incoming links — pieces that point at this one
  if (allPosts?.length) {
    const incoming = allPosts.filter(p => (p.links || []).includes(post.id));
    if (incoming.length) {
      const html = incoming.map(p =>
        `<a class="marginalia-link" data-post-id="${escapeAttr(p.id)}" href="#${escapeAttr(p.id)}">${escapeHTML(p.title)}</a>`
      ).join("<br>");
      rows.push(["← links", html]);
    }
  }

  container.innerHTML = `
    <dl class="marginalia">
      ${rows.map(([k, v]) => `
        <div class="marginalia-row">
          <dt class="marginalia-key">${escapeHTML(k)}</dt>
          <dd class="marginalia-val">${v}</dd>
        </div>
      `).join("")}
    </dl>
    ${renderParatext(post)}
  `;

  // Wire link clicks to switch posts in-place rather than navigating
  if (onSelect) {
    container.querySelectorAll(".marginalia-link").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const target = (allPosts || []).find(p => p.id === a.dataset.postId);
        if (target) onSelect(target);
      });
    });
  }

  // Wire version clicks → look up the entry by its routing key and fire the
  // callback. The caller (public/main.js) navigates to `/{slug}?v={key}`
  // so the URL stays in sync with what's displayed. The combined list includes
  // the synthetic current entry, keyed `current`.
  if (onVersionSelect) {
    container.querySelectorAll(".marginalia-version").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const v = verEntries.find(x => (x.key || x.version) === a.dataset.version);
        if (v) onVersionSelect(v);
      });
    });
  }
}

// ── Paratext sections: footnotes + works cited ──────────────────────────────
// Rendered from post.footnotes / post.citations (computed by the loader). Each
// entry carries an id (fn-N / cite-N) that the Read pane's markers point at via
// their href, and a `↩` back-link to the first marker (fnref-N / citeref-N).
// The cross-pane click-to-highlight wiring lands in Phase 2; the anchor hrefs
// are the no-JS fallback until then.
function renderParatext(post) {
  let html = "";

  if (post.footnotes?.length) {
    const items = post.footnotes.map((f) => `
      <li class="marginalia-note" id="fn-${f.num}" data-fn="${f.num}">
        <span class="marginalia-note-num">${f.num}</span>
        <span class="marginalia-note-body">${marked.parseInline(f.text || "")}<a class="marginalia-note-back" href="#fnref-${f.num}" data-fn-back="${f.num}" title="back to reference">↩</a></span>
      </li>`).join("");
    html += `
      <section class="marginalia-apparatus">
        <h3 class="marginalia-apparatus-head">footnotes</h3>
        <ol class="marginalia-apparatus-list">${items}</ol>
      </section>`;
  }

  if (post.citations?.length) {
    const items = post.citations.map((c) => `
      <li class="marginalia-cite" id="cite-${c.num}" data-cite="${c.num}">
        <span class="marginalia-note-num">[${c.num}]</span>
        <span class="marginalia-note-body">${formatCitation(c)}<a class="marginalia-note-back" href="#citeref-${c.num}" data-cite-back="${c.num}" title="back to reference">↩</a></span>
      </li>`).join("");
    html += `
      <section class="marginalia-apparatus">
        <h3 class="marginalia-apparatus-head">works cited</h3>
        <ol class="marginalia-apparatus-list">${items}</ol>
      </section>`;
  }

  return html;
}

// Format one citation entry: `Author, *Title* (Year), locator`, the whole line
// an outbound link when a url is present.
function formatCitation(c) {
  const author = escapeHTML(c.author || "");
  const title  = `<em>${escapeHTML(c.title || "")}</em>`;
  const year   = c.year ? ` (${escapeHTML(c.year)})` : "";
  const loc    = c.locator ? `, ${escapeHTML(c.locator)}` : "";
  const inner  = `${author}, ${title}${year}${loc}`;
  if (c.url) {
    return `<a class="marginalia-link" href="${escapeAttr(c.url)}" target="_blank" rel="noopener">${inner}</a>`;
  }
  return inner;
}

function formatDate(d) {
  if (!(d instanceof Date)) return "";
  return d.toISOString().slice(0, 10);
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function escapeAttr(s) { return escapeHTML(s); }
