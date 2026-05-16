// ── Browse view ──────────────────────────────────────────────────────────────
// Phase 2: tree/flat toggle + keyboard navigation.
//
// In TREE mode, posts are rendered as a compact collapsible tree grouped by
// `kind` (shared with the admin Index — see ../../lib/tree-view.js). Groups
// collapse/expand and the state persists to localStorage.
//
// In FLAT mode, posts are a single flat list, ordered as supplied (the loader
// pre-sorts by created date, descending). The flat list is unchanged from
// Phase 2 — its own row markup, CSS, cursor, and selection logic.
//
// Keyboard navigation moves a cursor through the visible rows. Modes.js calls
// `moveCursor`, `activateCursor`, `collapseCursor`, `expandCursor` (tree only),
// and `toggleMode`. The cursor is decoupled from the currently-opened post so
// navigating doesn't open new pieces — only Enter or click does that.

import { KIND_SHORT } from "../../lib/vocabularies.js";
import { createTreeView } from "../../lib/tree-view.js";

const STORAGE_KEY = "browse.mode";

// ── Internal state ───────────────────────────────────────────────────────────
let _container = null;
let _posts     = [];
let _onSelect  = null;
let _mode      = restoreMode();
let _selectedId = null;   // the currently-OPENED piece (highlighted strongly)
let _cursorId   = null;   // FLAT-mode keyboard cursor (tree owns its own)
let _tree       = null;

function ensureTree() {
  if (_tree) return _tree;
  _tree = createTreeView({
    storageKey: "browse.tree.expanded",
    renderItemMeta,
    onSelect: (post) => { if (_onSelect) _onSelect(post); },
  });
  return _tree;
}

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
  if (_mode === "tree") _tree?.setSelected(id);
  else                  paintSelection();
}

/** Move the keyboard cursor. `direction` is "up" or "down". */
export function moveCursor(direction) {
  if (_mode === "tree") { _tree?.moveCursor(direction); return; }
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
  if (_mode === "tree") { _tree?.activateCursor(); return; }
  const post = _posts.find(p => p.id === _cursorId);
  if (post && _onSelect) _onSelect(post);
}

/** h / ← — collapse a group / jump to parent. Tree mode only. */
export function collapseCursor() {
  if (_mode === "tree") _tree?.collapseOrParent();
}

/** l / → — expand a group / enter first child. Tree mode only. */
export function expandCursor() {
  if (_mode === "tree") _tree?.expandOrChild();
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
    <div class="browse-content"></div>
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

  const content = _container.querySelector(".browse-content");

  if (_mode === "tree") {
    ensureTree().render(content, _posts, { selectedId: _selectedId });
    return;
  }

  // FLAT mode — unchanged from Phase 2.
  content.innerHTML = renderFlat(_posts);
  content.querySelectorAll(".browse-row").forEach(row => {
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
  return `<ul class="browse-list browse-list--flat">${posts.map(renderRow).join("")}</ul>`;
}

function renderRow(p) {
  // YY-MM, e.g. 2026-05 → "26-05"
  const date = p.created instanceof Date ? p.created.toISOString().slice(2, 7) : "";
  return `
    <li class="browse-row" data-post-id="${escapeAttr(p.id)}">
      <span class="browse-kind">${KIND_SHORT[p.kind] || "—"}</span>
      <span class="browse-title">${escapeHTML(p.title)}</span>
      <span class="browse-date">${escapeHTML(date)}</span>
    </li>
  `;
}

// Tree-mode item metadata: a YY-MM date, right-aligned.
function renderItemMeta(p) {
  const date = p.created instanceof Date ? p.created.toISOString().slice(2, 7) : "";
  return escapeHTML(date);
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
