// ── Browse view ──────────────────────────────────────────────────────────────
// Phase 2: tree/flat toggle + keyboard navigation.
//
// In TREE mode, posts are grouped by `kind`. The order of groups follows the
// declared KIND vocabulary; within each group, posts are ordered as supplied
// (the loader pre-sorts by created date, descending).
//
// In FLAT mode, posts are a single flat list, same order.
//
// Keyboard navigation moves a cursor through the visible rows. Modes.js calls
// `moveCursor('up' | 'down')` and `activateCursor()`; the cursor is decoupled
// from the currently-opened post so navigating doesn't open new pieces — only
// Enter or click does that.

import { KIND, KIND_SHORT } from "../../lib/vocabularies.js";

const STORAGE_KEY = "browse.mode";

// ── Internal state ───────────────────────────────────────────────────────────
let _container = null;
let _posts     = [];
let _onSelect  = null;
let _mode      = restoreMode();
let _selectedId = null;   // the currently-OPENED piece (highlighted strongly)
let _cursorId   = null;   // keyboard cursor (subtle ring; may differ from selected)

// ── Public API ───────────────────────────────────────────────────────────────
export function renderBrowse(container, posts, { onSelect, selectedId } = {}) {
  _container  = container;
  _posts      = posts;
  _onSelect   = onSelect;
  if (selectedId !== undefined) _selectedId = selectedId;
  if (_cursorId == null) _cursorId = selectedId || posts[0]?.id || null;
  render();
}

/** Update which post is shown as "open". Cursor follows if it was empty. */
export function setSelected(id) {
  _selectedId = id;
  if (_cursorId == null) _cursorId = id;
  paintSelection();
}

/** Move the keyboard cursor. `direction` is "up" or "down". */
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

/** Open the post the cursor is on. */
export function activateCursor() {
  const post = _posts.find(p => p.id === _cursorId);
  if (post && _onSelect) _onSelect(post);
}

/** Toggle between tree and flat modes; re-render. */
export function toggleMode() {
  _mode = _mode === "tree" ? "flat" : "tree";
  localStorage.setItem(STORAGE_KEY, _mode);
  render();
}

export function getMode() { return _mode; }

// ── Internal render ──────────────────────────────────────────────────────────
function render() {
  if (!_container) return;

  if (_posts.length === 0) {
    _container.innerHTML = `<div class="browse-empty">no posts yet</div>`;
    return;
  }

  _container.innerHTML = `
    <div class="browse-toolbar">
      <button class="browse-toggle ${_mode === "tree" ? "is-active" : ""}" data-mode="tree" type="button">tree</button>
      <button class="browse-toggle ${_mode === "flat" ? "is-active" : ""}" data-mode="flat" type="button">flat</button>
      <span class="browse-count">${_posts.length} ${_posts.length === 1 ? "piece" : "pieces"}</span>
    </div>
    ${_mode === "tree" ? renderTree(_posts) : renderFlat(_posts)}
  `;

  // Wire toggle buttons
  _container.querySelectorAll(".browse-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.mode;
      if (next === _mode) return;
      _mode = next;
      localStorage.setItem(STORAGE_KEY, _mode);
      render();
    });
  });

  // Wire rows
  _container.querySelectorAll(".browse-row").forEach(row => {
    row.addEventListener("click", () => {
      _cursorId = row.dataset.postId;
      const post = _posts.find(p => p.id === _cursorId);
      if (post && _onSelect) _onSelect(post);
    });
  });

  paintSelection();
  paintCursor();
}

function renderFlat(posts) {
  return `<ul class="browse-list browse-list--flat">${posts.map(p => renderRow(p, { showKind: true })).join("")}</ul>`;
}

function renderTree(posts) {
  // Group by kind. Order groups by the canonical KIND vocabulary.
  const byKind = new Map();
  for (const k of KIND) byKind.set(k, []);
  for (const p of posts) {
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }
  const sections = [];
  for (const [k, group] of byKind) {
    if (!group.length) continue;
    sections.push(`
      <section class="browse-group">
        <h3 class="browse-group-heading">
          <span class="browse-group-kind">${escapeHTML(k)}</span>
          <span class="browse-group-count">${group.length}</span>
        </h3>
        <ul class="browse-list browse-list--tree">${group.map(p => renderRow(p, { showKind: false })).join("")}</ul>
      </section>
    `);
  }
  return sections.join("");
}

function renderRow(p, { showKind } = {}) {
  // YY-MM, e.g. 2026-05 → "26-05"
  const date = p.created instanceof Date ? p.created.toISOString().slice(2, 7) : "";
  const kind = showKind
    ? `<span class="browse-kind">${KIND_SHORT[p.kind] || "—"}</span>`
    : "";
  return `
    <li class="browse-row${showKind ? "" : " browse-row--no-kind"}" data-post-id="${escapeAttr(p.id)}">
      ${kind}
      <span class="browse-title">${escapeHTML(p.title)}</span>
      <span class="browse-date">${escapeHTML(date)}</span>
    </li>
  `;
}

function paintSelection() {
  if (!_container) return;
  _container.querySelectorAll(".browse-row.is-selected")
    .forEach(r => r.classList.remove("is-selected"));
  if (!_selectedId) return;
  const row = _container.querySelector(`.browse-row[data-post-id="${cssEscape(_selectedId)}"]`);
  if (row) row.classList.add("is-selected");
}

function paintCursor() {
  if (!_container) return;
  _container.querySelectorAll(".browse-row.is-cursor")
    .forEach(r => r.classList.remove("is-cursor"));
  if (!_cursorId) return;
  const row = _container.querySelector(`.browse-row[data-post-id="${cssEscape(_cursorId)}"]`);
  if (row) row.classList.add("is-cursor");
}

function visibleRows() {
  if (!_container) return [];
  return Array.from(_container.querySelectorAll(".browse-row"));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function restoreMode() {
  const m = localStorage.getItem(STORAGE_KEY);
  return m === "tree" || m === "flat" ? m : "flat";
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function escapeAttr(s) { return escapeHTML(s); }

// CSS.escape polyfill — IDs like ESS-2026-001 are safe but escaping is correct.
function cssEscape(s) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^\w-]/g, "\\$&");
}
