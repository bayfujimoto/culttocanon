// ── Shared collapsible tree view ─────────────────────────────────────────────
// A compact, Explorer-style collapsible tree. Posts are grouped by `kind`; the
// tree is exactly two levels deep (group → item). Group rows carry a ▼/▶ marker
// and a count; item rows carry a `·` marker, the title, and pane-specific
// trailing metadata (date, status glyph).
//
// State model mirrors the old Index/Browse views:
//   _cursorId   — keyboard cursor, keyed by node `path` (subtle left-ring)
//   _selectedId — the currently-OPENED post id (strong highlight); decoupled
//                 from the cursor so navigating doesn't open pieces.
//
// Expansion is a Set<string> of group paths persisted to localStorage. First
// run (empty set) opens every group so the archive's shape is visible at once.
//
// Instance-based: Index and Browse each create their own, so cursor/expand
// state never collides.

import { KIND } from "./vocabularies.js";

const INDENT_PX       = 14;
const ROW_PAD_LEFT_PX = 8;

/**
 * createTreeView({ storageKey, renderItemMeta, onSelect })
 *
 *   storageKey      localStorage key for the expanded-paths set
 *   renderItemMeta  (post) => trailing HTML for a leaf row (date, glyphs…)
 *   onSelect        (post) => void — fired when a leaf is activated
 */
export function createTreeView({ storageKey, renderItemMeta, onSelect } = {}) {
  let _container  = null;
  let _posts      = [];
  let _model      = null;
  let _expanded   = loadExpanded(storageKey);
  let _cursorPath = null;          // node path the keyboard cursor sits on
  let _selectedId = null;          // post id currently open
  let _boundEl    = null;          // element the click handler is attached to

  // ── Public API ─────────────────────────────────────────────────────────────
  function render(container, posts, { selectedId } = {}) {
    _container = container;
    _posts     = posts;
    if (selectedId !== undefined) _selectedId = selectedId;

    _model = buildModel(posts);

    // First run: open every group.
    if (_expanded.size === 0) {
      for (const g of _model.children) _expanded.add(g.path);
    }

    // Default the cursor to the first visible row.
    if (_cursorPath == null) {
      _cursorPath = _model.children[0]?.path ?? null;
    }

    paint();

    // The host view rebuilds its pane body (and thus the mount element) on
    // every render — including tree/flat toggles. Rebind to the live element
    // whenever it changes so clicks keep working.
    if (_boundEl !== _container) {
      _boundEl?.removeEventListener("click", onTreeClick);
      _container.addEventListener("click", onTreeClick);
      _boundEl = _container;
    }
  }

  /** Update which post is shown as "open". */
  function setSelected(id) {
    _selectedId = id;
    paintSelection();
  }

  /** Move the keyboard cursor through all visible rows (groups + items). */
  function moveCursor(direction) {
    const rows = visibleRows();
    if (rows.length === 0) return;
    const idx = rows.findIndex(r => r.dataset.path === _cursorPath);
    let next;
    if (idx === -1)                next = 0;
    else if (direction === "down") next = Math.min(rows.length - 1, idx + 1);
    else                           next = Math.max(0, idx - 1);
    _cursorPath = rows[next].dataset.path;
    paintCursor();
    rows[next].scrollIntoView({ block: "nearest" });
  }

  /** h / ← : collapse an expanded group, else jump to the parent group. */
  function collapseOrParent() {
    const row = cursorRow();
    if (!row) return;
    const { path, type } = row.dataset;

    if (type === "group" && _expanded.has(path)) {
      _expanded.delete(path);
      saveExpanded(storageKey, _expanded);
      rerender();
      return;
    }
    const parent = parentPath(path);
    if (!parent) return;
    _cursorPath = parent;
    paintCursor();
    cursorRow()?.scrollIntoView({ block: "nearest" });
  }

  /** l / → : expand a collapsed group, else move to its first child. */
  function expandOrChild() {
    const row = cursorRow();
    if (!row) return;
    const { path, type } = row.dataset;
    if (type !== "group") return;

    if (!_expanded.has(path)) {
      _expanded.add(path);
      saveExpanded(storageKey, _expanded);
      rerender();
      return;
    }
    const rows = visibleRows();
    const idx  = rows.indexOf(row);
    const nextRow = rows[idx + 1];
    if (nextRow && nextRow.dataset.path.startsWith(path + "/")) {
      _cursorPath = nextRow.dataset.path;
      paintCursor();
      nextRow.scrollIntoView({ block: "nearest" });
    }
  }

  /** Enter: toggle a group, or open the item the cursor is on. */
  function activateCursor() {
    const row = cursorRow();
    if (!row) return;
    const { path, type, postId } = row.dataset;
    if (type === "item") {
      const post = _posts.find(p => p.id === postId);
      if (post && onSelect) onSelect(post);
      return;
    }
    if (_expanded.has(path)) _expanded.delete(path);
    else                     _expanded.add(path);
    saveExpanded(storageKey, _expanded);
    rerender();
  }

  return {
    render,
    setSelected,
    moveCursor,
    collapseOrParent,
    expandOrChild,
    activateCursor,
  };

  // ── Click handling ─────────────────────────────────────────────────────────
  function onTreeClick(e) {
    const row = e.target.closest(".tree-row");
    if (!row || !_container.contains(row)) return;
    const { path, type, postId } = row.dataset;

    if (type === "item") {
      _cursorPath = path;
      const post = _posts.find(p => p.id === postId);
      if (post && onSelect) onSelect(post);
      paintCursor();
      return;
    }

    _cursorPath = path;
    if (_expanded.has(path)) _expanded.delete(path);
    else                     _expanded.add(path);
    saveExpanded(storageKey, _expanded);
    rerender();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function rerender() {
    _model = buildModel(_posts);
    paint();
  }

  function paint() {
    _container.innerHTML = `<div class="tree">${renderNode(_model, 0)}</div>`;
    paintSelection();
    paintCursor();
  }

  function renderNode(node, depth) {
    const isRoot = node.type === "root";
    if (isRoot) {
      return node.children.map(c => renderNode(c, depth)).join("");
    }

    const isItem  = node.type === "item";
    const isOpen  = !isItem && _expanded.has(node.path);
    const indent  = depth * INDENT_PX + ROW_PAD_LEFT_PX;

    const marker = isItem ? "·" : (isOpen ? "▼" : "▶");
    const rowClass = "tree-row " + (isItem ? "tree-item" : "tree-group");

    let html = `<div class="${rowClass}" data-path="${escapeAttr(node.path)}" data-type="${node.type}"${isItem ? ` data-post-id="${escapeAttr(node.post.id)}"` : ""} style="padding-left: ${indent}px">`;
    html += `<span class="tree-marker">${marker}</span>`;
    html += `<span class="tree-label">${escapeHTML(node.label)}</span>`;
    if (isItem) {
      const meta = renderItemMeta ? renderItemMeta(node.post) : "";
      if (meta) html += `<span class="tree-meta">${meta}</span>`;
    } else {
      html += `<span class="tree-count">${node.count}</span>`;
    }
    html += `</div>`;

    if (!isItem && isOpen) {
      for (const child of node.children) html += renderNode(child, depth + 1);
    }
    return html;
  }

  function paintSelection() {
    _container.querySelectorAll(".tree-row.is-selected")
      .forEach(r => r.classList.remove("is-selected"));
    if (!_selectedId) return;
    const row = _container.querySelector(
      `.tree-row[data-post-id="${cssEscape(_selectedId)}"]`);
    if (row) row.classList.add("is-selected");
  }

  function paintCursor() {
    _container.querySelectorAll(".tree-row.is-cursor")
      .forEach(r => r.classList.remove("is-cursor"));
    if (!_cursorPath) return;
    const row = _container.querySelector(
      `.tree-row[data-path="${cssEscape(_cursorPath)}"]`);
    if (row) row.classList.add("is-cursor");
  }

  function visibleRows() {
    return Array.from(_container.querySelectorAll(".tree-row"));
  }

  function cursorRow() {
    return _container.querySelector(
      `.tree-row[data-path="${cssEscape(_cursorPath)}"]`);
  }
}

// ── Model ──────────────────────────────────────────────────────────────────
function buildModel(posts) {
  const byKind = new Map();
  for (const k of KIND) byKind.set(k, []);
  for (const p of posts) {
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }

  const root = { type: "root", path: "", children: [] };
  for (const [kind, group] of byKind) {
    if (!group.length) continue;
    const groupNode = {
      type:     "group",
      kind,
      label:    kind,
      path:     kind,
      count:    group.length,
      children: group.map(post => ({
        type:  "item",
        label: post.title || post.id || "(untitled)",
        path:  `${kind}/${post.id}`,
        post,
      })),
    };
    root.children.push(groupNode);
  }
  return root;
}

// ── Expansion persistence ────────────────────────────────────────────────────
function loadExpanded(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveExpanded(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {}
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function parentPath(path) {
  if (!path) return null;
  const i = path.lastIndexOf("/");
  return i === -1 ? null : path.slice(0, i);
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
