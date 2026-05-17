// ── Statusbar version picker ─────────────────────────────────────────────────
// Statusbar overlay that gates *saving a single post* on a version choice.
// Replaces the state row with a small numeric chooser; on confirm, fires
// `onConfirm(value)`. Style mirrors the command-mode statusbar input.
//
// Two entry points share one scaffold:
//
//   openBumpPicker(post, cbs)          edit — patch / minor / major, each
//                                      shown as current → target version.
//   openStartVersionPicker(post, cbs)  new  — start at v0.1.0 or v1.0.0.
//
// Keyboard contract:
//   1 / 2 / 3   highlight the corresponding option
//   Enter       confirm the highlighted option
//   Esc         cancel
//
// Outside clicks do NOT cancel — accidental clicks shouldn't drop a save.
// The picker takes over `mode` ("picker") so the normal-mode key handlers in
// modes.js stand down while it is open.

import { bumpVersion } from "./version.js";
import { setMode }     from "./modes.js";

// Module-level state — at most one picker open at a time.
let _state = null;

/**
 * Open the bump picker for a single edited post.
 *
 * @param {Object} post      the post being saved; `post.version` is its
 *                           current version (target projections derive from it)
 * @param {Object} callbacks { onConfirm(category), onCancel() } — `category`
 *                           is one of "patch" | "minor" | "major"
 */
export function openBumpPicker(post, { onConfirm, onCancel } = {}) {
  const cur = post?.version || "0.1.0";
  const options = [
    { key: "1", value: "patch", label: `patch → v${bumpVersion(cur, "patch")}` },
    { key: "2", value: "minor", label: `minor → v${bumpVersion(cur, "minor")}` },
    { key: "3", value: "major", label: `major → v${bumpVersion(cur, "major")}` },
  ];
  open({
    prompt:      "update",
    options,
    contextText: `${post?.id || "post"} (v${cur})`,
    onConfirm,
    onCancel,
  });
}

/**
 * Open the start-version picker for a new post.
 *
 * @param {Object} post      the new post being saved (used for id context)
 * @param {Object} callbacks { onConfirm(version), onCancel() } — `version`
 *                           is one of "0.1.0" | "1.0.0"
 */
export function openStartVersionPicker(post, { onConfirm, onCancel } = {}) {
  const options = [
    { key: "1", value: "0.1.0", label: "start → v0.1.0" },
    { key: "2", value: "1.0.0", label: "start → v1.0.0" },
  ];
  open({
    prompt:      "save",
    options,
    contextText: `${post?.id || "new post"} (new)`,
    onConfirm,
    onCancel,
  });
}

// ── Shared scaffold ──────────────────────────────────────────────────────────
/**
 * @param {Object} cfg
 * @param {string} cfg.prompt       statusbar prompt word ("update" / "save")
 * @param {Array}  cfg.options      [{ key, value, label }]
 * @param {string} cfg.contextText  right-side context line
 * @param {Function} cfg.onConfirm  called with the chosen option's `value`
 * @param {Function} cfg.onCancel
 */
function open({ prompt, options, contextText, onConfirm, onCancel }) {
  if (_state) return; // already open

  const stateRow = document.querySelector(".shell-statusbar-state");
  if (!stateRow) return;

  const optionHTML = options.map((o, i) => `
      <span class="shell-picker-option" data-idx="${i}">
        <kbd>${o.key}</kbd>&nbsp;${escapeHTML(o.label)}
      </span>
    `).join("");

  // Preserve the original state row so close() can restore it.
  const originalHTML = stateRow.innerHTML;

  stateRow.innerHTML = `
    <span class="shell-status-state shell-status-state--command shell-status-state--picker">
      <span class="shell-cmd-prompt">${escapeHTML(prompt)}</span>
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
    options,
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
  const ki = _state.options.findIndex(o => o.key === e.key);
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
      flash(`pick ${_state.options.map(o => o.key).join(", ")} first`);
      return;
    }
    const value = _state.options[_state.selectedIdx].value;
    const cb    = _state.onConfirm;
    close();
    cb?.(value);
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
