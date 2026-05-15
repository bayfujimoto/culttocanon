// ── Index view — the admin's tree of all posts ───────────────────────────────
// Phase 3 mirror of the public Browse view, but shows every post — including
// drafts, abandoned, unlisted, and private. The author needs to see and reach
// all of them.
//
// Groups by kind. Click a row to navigate to its edit route.

import { KIND } from "../../lib/vocabularies.js";

const KIND_SHORT = {
  essay:    "ess",
  fragment: "frg",
  note:     "not",
  review:   "rev",
  fiction:  "fic",
};

let _container = null;
let _posts     = [];
let _onSelect  = null;
let _cursorId  = null;
let _selectedId = null;

export function renderIndex(container, posts, { onSelect, selectedId } = {}) {
  _container  = container;
  _posts      = posts;
  _onSelect   = onSelect;
  if (selectedId !== undefined) _selectedId = selectedId;
  if (_cursorId == null) _cursorId = selectedId || posts[0]?.id || null;
  render();
}

export function setSelected(id) {
  _selectedId = id;
  if (_cursorId == null) _cursorId = id;
  paintSelection();
}

export function moveCursor(direction) {
  if (!_container) return;
  const rows = visibleRows();
  if (rows.length === 0) return;
  const idx = rows.findIndex(r => r.dataset.postId === _cursorId);
  let next;
  if (idx === -1)                next = 0;
  else if (direction === "down") next = Math.min(rows.length - 1, idx + 1);
  else                            next = Math.max(0, idx - 1);
  _cursorId = rows[next].dataset.postId;
  paintCursor();
  rows[next].scrollIntoView({ block: "nearest" });
}

export function activateCursor() {
  const post = _posts.find(p => p.id === _cursorId);
  if (post && _onSelect) _onSelect(post);
}

function render() {
  if (!_container) return;

  if (_posts.length === 0) {
    _container.innerHTML = `<div class="index-empty">no posts yet · <kbd>:new</kbd></div>`;
    return;
  }

  // Group by kind; preserve KIND order
  const byKind = new Map();
  for (const k of KIND) byKind.set(k, []);
  for (const p of _posts) {
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }

  const sections = [];
  for (const [k, group] of byKind) {
    if (!group.length) continue;
    sections.push(`
      <section class="index-group">
        <h3 class="index-group-heading">
          <span class="index-group-kind">${escapeHTML(k)}</span>
          <span class="index-group-count">${group.length}</span>
        </h3>
        <ul class="index-list">${group.map(renderRow).join("")}</ul>
      </section>
    `);
  }

  _container.innerHTML = `
    <div class="index-toolbar">
      <span class="index-count">${_posts.length} ${_posts.length === 1 ? "piece" : "pieces"}</span>
      <button class="index-new" type="button" title=":new">+ new</button>
    </div>
    ${sections.join("")}
  `;

  _container.querySelector(".index-new").addEventListener("click", () => {
    location.hash = "#/new";
  });

  _container.querySelectorAll(".index-row").forEach(row => {
    row.addEventListener("click", () => {
      _cursorId = row.dataset.postId;
      const post = _posts.find(p => p.id === _cursorId);
      if (post && _onSelect) _onSelect(post);
    });
  });

  paintSelection();
  paintCursor();
}

function renderRow(p) {
  const date = p.created instanceof Date ? p.created.toISOString().slice(0, 7) : "";
  const visIcon = p.visibility === "private"  ? "·"
                : p.visibility === "unlisted" ? "○"
                :                                "●";
  return `
    <li class="index-row" data-post-id="${escapeAttr(p.id)}">
      <span class="index-kind">${KIND_SHORT[p.kind] || "—"}</span>
      <span class="index-title">${escapeHTML(p.title)}</span>
      <span class="index-vis"  title="${escapeAttr(p.visibility)}">${visIcon}</span>
      <span class="index-date">${escapeHTML(date)}</span>
      <span class="index-status index-status--${escapeAttr(p.status)}">${escapeHTML(p.status[0])}</span>
    </li>
  `;
}

function paintSelection() {
  if (!_container) return;
  _container.querySelectorAll(".index-row.is-selected").forEach(r => r.classList.remove("is-selected"));
  if (!_selectedId) return;
  const row = _container.querySelector(`.index-row[data-post-id="${cssEscape(_selectedId)}"]`);
  if (row) row.classList.add("is-selected");
}

function paintCursor() {
  if (!_container) return;
  _container.querySelectorAll(".index-row.is-cursor").forEach(r => r.classList.remove("is-cursor"));
  if (!_cursorId) return;
  const row = _container.querySelector(`.index-row[data-post-id="${cssEscape(_cursorId)}"]`);
  if (row) row.classList.add("is-cursor");
}

function visibleRows() {
  if (!_container) return [];
  return Array.from(_container.querySelectorAll(".index-row"));
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function escapeAttr(s) { return escapeHTML(s); }

function cssEscape(s) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^\w-]/g, "\\$&");
}
