// ── Bump picker ──────────────────────────────────────────────────────────────
// Statusbar overlay that gates committing on a version-bump choice. Replaces
// the state row with a three-option chooser (patch / minor / major); on
// confirm, fires `onConfirm(category)`. Style mirrors the command-mode
// statusbar input.
//
// Keyboard contract:
//   1 / 2 / 3   highlight the corresponding category
//   Enter       confirm the highlighted category
//   Esc         cancel
//
// Outside clicks do NOT cancel — accidental clicks shouldn't drop a pending
// commit. The picker takes over `mode` ("picker") so the normal-mode key
// handlers in modes.js stand down while it is open.

import { bumpVersion } from "./version.js";
import { setMode }     from "./modes.js";

const CATEGORIES = [
  { key: "1", category: "patch", delta: "+0.0.1" },
  { key: "2", category: "minor", delta: "+0.1.0" },
  { key: "3", category: "major", delta: "+1.0.0" },
];

// Module-level state — at most one picker open at a time.
let _state = null;

/**
 * Open the bump picker.
 *
 * @param {Array}  pendingChanges   the staged changes from admin state
 * @param {Array}  allPosts         in-memory posts (current versions are read
 *                                   from here for the per-file projection)
 * @param {Object} callbacks        { onConfirm(category), onCancel() }
 */
export function openBumpPicker(pendingChanges, allPosts, { onConfirm, onCancel } = {}) {
  if (_state) return; // already open

  const stateRow = document.querySelector(".shell-statusbar-state");
  if (!stateRow) return;

  // ── Projection ──
  // If exactly one edit is pending, show its current → target version for
  // each category. Otherwise show just the delta (the per-file target is
  // ambiguous when multiple files are batched).
  const edits     = pendingChanges.filter(c => c.action === "edit");
  const addsCount = pendingChanges.filter(c => c.action === "add").length;

  let projection = null;
  if (edits.length === 1) {
    const post = (allPosts || []).find(p => p.id === edits[0].id);
    const cur  = post?.version || "0.1.0";
    projection = {
      id: edits[0].id,
      current: cur,
      patch:   bumpVersion(cur, "patch"),
      minor:   bumpVersion(cur, "minor"),
      major:   bumpVersion(cur, "major"),
    };
  }

  const optionHTML = CATEGORIES.map((c, i) => {
    const target = projection ? `v${projection[c.category]}` : c.delta;
    return `
      <span class="shell-picker-option" data-idx="${i}">
        <kbd>${c.key}</kbd>&nbsp;${c.category} → ${target}
      </span>
    `;
  }).join("");

  // Context: which posts the bump applies to.
  let contextText;
  if (edits.length === 1 && addsCount === 0) {
    contextText = `${projection.id} (v${projection.current})`;
  } else if (addsCount > 0 && edits.length === 0) {
    contextText = `${addsCount} new (adds emit at v0.1.0)`;
  } else if (edits.length > 0 && addsCount > 0) {
    contextText = `${edits.length} edit${edits.length === 1 ? "" : "s"}, ${addsCount} new`;
  } else {
    contextText = `${edits.length} edit${edits.length === 1 ? "" : "s"}`;
  }

  // Preserve the original state row so close() can restore it.
  const originalHTML = stateRow.innerHTML;

  stateRow.innerHTML = `
    <span class="shell-status-state shell-status-state--command shell-status-state--picker">
      <span class="shell-cmd-prompt">update</span>
      <span class="shell-picker-options">${optionHTML}</span>
      <span class="shell-picker-context">${escapeHTML(contextText)} · <kbd>↵</kbd> confirm · <kbd>Esc</kbd> cancel</span>
    </span>
    <span class="shell-status-mode shell-status-mode--picker" id="shell-status-mode">-- PICKER --</span>
    <span class="shell-status-time" id="shell-status-time"></span>
  `;

  setMode("picker");

  // Capture-phase listener so we beat any bubble-phase consumers. modes.js
  // is also capture-phase, but bails early when mode === "picker", so its
  // handler runs to that early-return and stays out of our way.
  const keydownHandler = (e) => onKey(e);
  document.addEventListener("keydown", keydownHandler, true);

  _state = {
    onConfirm,
    onCancel,
    selectedIdx: -1,
    originalHTML,
    keydownHandler,
  };
}

function onKey(e) {
  if (!_state) return;

  // 1 / 2 / 3 — highlight.
  const ki = CATEGORIES.findIndex(c => c.key === e.key);
  if (ki >= 0) {
    e.preventDefault();
    e.stopPropagation();
    selectIdx(ki);
    return;
  }

  // Enter — confirm the highlighted option (no-op if none).
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    if (_state.selectedIdx < 0) {
      flash("pick 1, 2, or 3 first");
      return;
    }
    const cat = CATEGORIES[_state.selectedIdx].category;
    const cb  = _state.onConfirm;
    close();
    cb?.(cat);
    return;
  }

  // Esc — cancel.
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    const cb = _state.onCancel;
    close();
    cb?.();
    return;
  }

  // Swallow everything else so stray keys don't trigger app behavior.
  e.preventDefault();
  e.stopPropagation();
}

function selectIdx(i) {
  if (!_state) return;
  _state.selectedIdx = i;
  document.querySelectorAll(".shell-picker-option").forEach((el, idx) => {
    el.classList.toggle("is-selected", idx === i);
  });
}

function close() {
  if (!_state) return;
  document.removeEventListener("keydown", _state.keydownHandler, true);
  const stateRow = document.querySelector(".shell-statusbar-state");
  if (stateRow) stateRow.innerHTML = _state.originalHTML;
  setMode("normal");
  _state = null;
}

function flash(msg) {
  const el = document.getElementById("shell-status-state");
  if (!el) return;
  const original = el.textContent;
  el.textContent = msg;
  setTimeout(() => { el.textContent = original; }, 1200);
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
