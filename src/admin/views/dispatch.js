// ── Dispatch view — pending changes + commit ─────────────────────────────────
// The third pane. Shows the staged writes the author has accumulated and the
// commit affordance that bundles them into a single commit. Subscribes to
// state so any save in the form refreshes the list immediately.
//
// Row format (git-status shorthand):
//
//   M  POST-2026-001  src/content/posts/POST-2026-001-…md
//   A  POST-2026-005  src/content/posts/POST-2026-005-…md
//
// Click a pending row → open that post in the Manuscript pane (same code
// path as the Index click). Click the commit button → bundle all pending
// changes into one /api/commit-all call.

import { getState, setState, subscribe, clearPending } from "../state.js";
import { commitAll }                                   from "../lib/api.js";

const HISTORY_LIMIT = 5;
const sessionCommits = [];

let _onRowClick = null;

export function initDispatch(container, callbacks = {}) {
  if (!container) return;
  _onRowClick = callbacks.onRowClick || null;

  container.innerHTML = `
    <div class="dispatch">
      <div class="dispatch-header" id="dispatch-header"></div>
      <ul class="dispatch-list" id="dispatch-pending"></ul>
      <div class="dispatch-history">
        <h3 class="dispatch-history-title">recent commits</h3>
        <ul class="dispatch-commits" id="dispatch-commits"></ul>
      </div>
    </div>
  `;

  subscribe(() => render(getState()));
  render(getState());
}

/**
 * Public commit entry point — wired to `:w` in modes.js.
 */
export async function triggerCommit() {
  const { pendingChanges } = getState();
  if (!pendingChanges.length) {
    flash("nothing to commit");
    return;
  }

  const adds  = pendingChanges.filter(c => c.action === "add").map(c => c.id);
  const edits = pendingChanges.filter(c => c.action === "edit").map(c => c.id);
  const parts = [];
  if (adds.length)  parts.push(`add ${adds.length}: ${adds.join(", ")}`);
  if (edits.length) parts.push(`edit ${edits.length}: ${edits.join(", ")}`);
  const message = parts.join("; ") || `commit ${pendingChanges.length} changes`;

  const snapshot = pendingChanges.slice();

  setState({ status: "saving", statusMessage: "committing…" });

  try {
    const result = await commitAll({
      files:   snapshot.map(c => ({ filePath: c.filePath, content: c.content })),
      message,
    });

    if (result.ok) {
      sessionCommits.unshift({
        timestamp: new Date(),
        count:     snapshot.length,
        adds:      adds.length,
        edits:     edits.length,
        mode:      result.mode,
        ok:        true,
      });
      clearPending();
      setState({
        status:        "saved",
        statusMessage: `committed ${snapshot.length} change${snapshot.length > 1 ? "s" : ""}`,
      });
      setTimeout(() => setState({ status: null, statusMessage: "" }), 2500);
    } else {
      sessionCommits.unshift({
        timestamp: new Date(),
        count:     snapshot.length,
        adds:      adds.length,
        edits:     edits.length,
        ok:        false,
        error:     result.error,
      });
      setState({ status: "error", statusMessage: `commit failed: ${result.error}` });
    }
  } catch (e) {
    sessionCommits.unshift({
      timestamp: new Date(),
      count:     snapshot.length,
      ok:        false,
      error:     e.message,
    });
    setState({ status: "error", statusMessage: `network error: ${e.message}` });
  }
}

// ── Render ───────────────────────────────────────────────────────────────────
function render(state) {
  renderHeader(state);
  renderPending(state.pendingChanges || []);
  renderCommits();
}

function renderHeader(state) {
  const header = document.getElementById("dispatch-header");
  if (!header) return;

  const pending = state.pendingChanges || [];

  if (state.status === "saving") {
    header.innerHTML = `<span class="dispatch-status dispatch-status--saving">${escapeHTML(state.statusMessage || "committing…")}</span>`;
    return;
  }
  if (state.status === "error") {
    header.innerHTML = `
      <span class="dispatch-status dispatch-status--error">${escapeHTML(state.statusMessage || "error")}</span>
      ${pending.length ? renderCommitButton(pending.length) : ""}
    `;
    wireCommitButton();
    return;
  }
  if (state.status === "saved") {
    header.innerHTML = `<span class="dispatch-status dispatch-status--saved">${escapeHTML(state.statusMessage || "committed")}</span>`;
    return;
  }

  if (pending.length === 0) {
    header.innerHTML = `<span class="dispatch-empty-hint">no pending changes</span>`;
    return;
  }

  header.innerHTML = `
    <span class="dispatch-count">${pending.length} pending</span>
    ${renderCommitButton(pending.length)}
  `;
  wireCommitButton();
}

function renderCommitButton(n) {
  return `<button class="dispatch-btn" id="dispatch-commit">commit ${n}</button>`;
}

function wireCommitButton() {
  const btn = document.getElementById("dispatch-commit");
  if (btn) btn.addEventListener("click", triggerCommit);
}

function renderPending(pending) {
  const list = document.getElementById("dispatch-pending");
  if (!list) return;

  list.innerHTML = "";

  for (const change of pending) {
    const li = document.createElement("li");
    li.className = "dispatch-row";
    li.dataset.postId = change.id;

    const action = change.action || "edit";
    const prefix = action === "add" ? "A" : action === "delete" ? "D" : "M";

    li.innerHTML = `
      <span class="dispatch-action dispatch-action--${escapeAttr(action)}">${prefix}</span>
      <span class="dispatch-id">${escapeHTML(change.id || "")}</span>
      <span class="dispatch-path" title="${escapeAttr(change.filePath || "")}">${escapeHTML(change.filePath || "")}</span>
    `;

    li.addEventListener("click", () => {
      list.querySelectorAll(".dispatch-row.is-selected").forEach(r => r.classList.remove("is-selected"));
      li.classList.add("is-selected");
      if (_onRowClick) _onRowClick(change.id);
    });

    list.appendChild(li);
  }
}

function renderCommits() {
  const list = document.getElementById("dispatch-commits");
  if (!list) return;
  list.innerHTML = "";

  if (sessionCommits.length === 0) {
    const li = document.createElement("li");
    li.className = "dispatch-history-empty";
    li.textContent = "no commits this session";
    list.appendChild(li);
    return;
  }

  for (const c of sessionCommits.slice(0, HISTORY_LIMIT)) {
    const li = document.createElement("li");
    li.className = "dispatch-history-row" + (c.ok ? "" : " is-error");
    li.innerHTML = `
      <span class="dispatch-history-time">${escapeHTML(formatTime(c.timestamp))}</span>
      <span class="dispatch-history-msg">${escapeHTML(summarize(c))}</span>
      <span class="dispatch-history-result">${c.ok ? (c.mode === "local" ? "local" : "ok") : "fail"}</span>
    `;
    if (!c.ok && c.error) li.title = c.error;
    list.appendChild(li);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function summarize(c) {
  const parts = [];
  if (c.adds)  parts.push(`${c.adds} added`);
  if (c.edits) parts.push(`${c.edits} edited`);
  if (parts.length === 0) parts.push(`${c.count || 0} change${c.count === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function formatTime(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function flash(msg) {
  const el = document.getElementById("shell-status-state");
  if (!el) return;
  const original = el.textContent;
  el.textContent = msg;
  setTimeout(() => { el.textContent = original; }, 1500);
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function escapeAttr(s) { return escapeHTML(s); }
