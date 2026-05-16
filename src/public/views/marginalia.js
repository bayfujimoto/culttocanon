// ── Marginalia view ──────────────────────────────────────────────────────────
// Paratext for the currently-open post. Shows status, kind, register, dates,
// confidence, subjects, and links. When no post is open, shows a brief hint.

export function renderMarginalia(container, post, { allPosts, onSelect, versions, onVersionSelect } = {}) {
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
  rows.push(["status",     `<span class="marginalia-status marginalia-status--${escapeAttr(post.status)}">${escapeHTML(post.status)}</span>`]);
  rows.push(["kind",       post.kind]);
  rows.push(["register",   post.register]);
  if (post.confidence) rows.push(["confidence", post.confidence]);
  rows.push(["created",    formatDate(post.created)]);
  if (post.revised) rows.push(["revised", formatDate(post.revised)]);
  rows.push(["length",     `${post.length} words`]);

  if (versions?.length) {
    const verHtml = versions.map((v, i) =>
      `<a class="marginalia-version" data-idx="${i}" href="#v${i}">${escapeHTML(v.revised || "earlier")} · ${formatWords(v.words)}</a>`
    ).join("<br>");
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

  // Wire version clicks → show a diff of that version against the current text
  if (onVersionSelect && versions?.length) {
    container.querySelectorAll(".marginalia-version").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const v = versions[Number(a.dataset.idx)];
        if (v) onVersionSelect(v);
      });
    });
  }
}

function formatWords(n) {
  const w = Number(n) || 0;
  return w >= 1000 ? `${(w / 1000).toFixed(1)}k w` : `${w} w`;
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
