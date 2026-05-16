// ── Index view — the admin's tree of all posts ───────────────────────────────
// Phase 3 mirror of the public Browse view, but shows every post — including
// drafts, abandoned, unlisted, and private. The author needs to see and reach
// all of them.
//
// Renders a compact collapsible tree (shared with Browse) grouped by kind.
// Item rows carry a visibility glyph, a status initial, and a YYYY-MM date.
// Click an item row to navigate to its edit route; click a group to collapse.

import { createTreeView } from "../../lib/tree-view.js";

let _container  = null;
let _posts      = [];
let _onSelect   = null;
let _selectedId = null;
let _tree       = null;

function ensureTree() {
  if (_tree) return _tree;
  _tree = createTreeView({
    storageKey: "index.expanded",
    renderItemMeta,
    onSelect: (post) => { if (_onSelect) _onSelect(post); },
  });
  return _tree;
}

export function renderIndex(container, posts, { onSelect, selectedId } = {}) {
  _container = container;
  _posts     = posts;
  _onSelect  = onSelect;
  if (selectedId !== undefined) _selectedId = selectedId;
  render();
}

export function setSelected(id) {
  _selectedId = id;
  _tree?.setSelected(id);
}

export function moveCursor(direction) { _tree?.moveCursor(direction); }
export function activateCursor()      { _tree?.activateCursor(); }
export function collapseCursor()      { _tree?.collapseOrParent(); }
export function expandCursor()        { _tree?.expandOrChild(); }

function render() {
  if (!_container) return;

  if (_posts.length === 0) {
    _container.innerHTML = `<div class="index-empty">no posts yet · <kbd>:new</kbd></div>`;
    return;
  }

  _container.innerHTML = `
    <div class="index-toolbar">
      <span class="index-count">${_posts.length} ${_posts.length === 1 ? "piece" : "pieces"}</span>
      <button class="index-new" type="button" title=":new">+ new</button>
    </div>
    <div class="index-tree-mount"></div>
  `;

  _container.querySelector(".index-new").addEventListener("click", () => {
    location.hash = "#/new";
  });

  const mount = _container.querySelector(".index-tree-mount");
  ensureTree().render(mount, _posts, { selectedId: _selectedId });
}

function renderItemMeta(p) {
  const date = p.created instanceof Date ? p.created.toISOString().slice(0, 7) : "";
  const visIcon = p.visibility === "private"  ? "·"
                : p.visibility === "unlisted" ? "○"
                :                                "●";
  const status = p.status || "?";
  return [
    `<span class="index-vis" title="${escapeAttr(p.visibility)}">${visIcon}</span>`,
    `<span class="index-status index-status--${escapeAttr(status)}">${escapeHTML(status[0])}</span>`,
    `<span class="index-date">${escapeHTML(date)}</span>`,
  ].join(" ");
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function escapeAttr(s) { return escapeHTML(s); }
