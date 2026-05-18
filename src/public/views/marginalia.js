// ── Marginalia view ──────────────────────────────────────────────────────────
// Paratext for the currently-open post. Shows status, kind, register, dates,
// confidence, subjects, and links. When no post is open, shows a brief hint.

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
