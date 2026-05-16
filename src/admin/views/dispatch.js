// ── Dispatch view — pending changes + commit ─────────────────────────────────
// The third pane. Shows the staged writes the author has accumulated and the
// commit affordance that bundles them into a single commit. Subscribes to
// state so any save in the form refreshes the list immediately.
//
// Row format (git-status shorthand):
//
//   M  ESS-2026-001  src/content/posts/ESS-2026-001-…md
//   A  ESS-2026-005  src/content/posts/ESS-2026-005-…md
//
// Click a pending row → open that post in the Manuscript pane (same code
// path as the Index click). Click the commit button → bundle all pending
// changes into one /api/commit-all call.

import { getState, setState, subscribe, clearPending } from "../state.js";
import { commitAll }                                   from "../lib/api.js";
import { parseFrontMatter }                            from "../../lib/front-matter.js";
import { serializePost }                               from "../lib/serializer.js";
import {
  getHistoryById,
  appendVersion,
  historyPathFor,
  wordCount,
} from "../../lib/history.js";
import { bumpVersion, bumpCategoryBetween } from "../lib/version.js";
import { openBumpPicker }                   from "../lib/bump-picker.js";
import { getQueueAsFiles, clearQueue, queueSize } from "../lib/image-queue.js";

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
 * Public picker-gated commit entry point — wired to `:update` in modes.js
 * and to the Dispatch commit button. If there are pending changes, opens
 * the bump-picker; on confirm, calls `triggerCommit(category)`.
 */
export function commitWithPicker() {
  const { pendingChanges, allPosts } = getState();
  // Both text changes and queued images count as "things to commit". An
  // author could in theory queue an image without yet editing the body —
  // the bump-picker still wants to run because the image ride along with
  // the existing post's edit. v1 assumes at least one pending text change
  // accompanies any image queue, so guard on text changes here.
  if (!pendingChanges.length) {
    flash(queueSize() > 0 ? "queued images need a body edit to commit" : "nothing to commit");
    return;
  }
  openBumpPicker(pendingChanges, allPosts, {
    onConfirm: (category) => triggerCommit(category),
    onCancel:  () => {},
  });
}

/**
 * Lower-level: perform the commit with a known bump category.
 *
 * For each `edit`: the staged content's `version` is bumped per `category`,
 * `revised` is auto-stamped, the content is re-serialized, and a history
 * entry is appended for the *prior* body — labeled with the prior version
 * and the category that produced it (Model A semantic; see history.js).
 *
 * For each `add`: the staged content is committed as-is. The blank-template
 * default `version: "0.1.0"` rides through. No history entry is written —
 * the version timeline begins on the first edit, at which point the v0.1.0
 * snapshot is captured with category `"initial"`.
 *
 * @param {"patch"|"minor"|"major"} category  applies to edits only
 */
export async function triggerCommit(category) {
  const { pendingChanges } = getState();
  if (!pendingChanges.length) {
    flash("nothing to commit");
    return;
  }

  const snapshot = pendingChanges.slice();
  const files    = snapshot.map(c => ({ filePath: c.filePath, content: c.content }));
  // Snapshot the image queue at this moment too. Each entry becomes a
  // binary file in the commit; the queue is cleared on success below.
  const imageFiles = getQueueAsFiles();

  // Per-file commit headers, built as each change is processed.
  // Format: `{id} v{version} [{category}]`.
  const headers = [];

  for (const change of snapshot) {
    if (change.action === "add") {
      // Adds emit at the version the blank template stamped (default 0.1.0).
      const { data } = parseFrontMatter(change.content);
      const version  = data?.version || "0.1.0";
      headers.push(`${change.id} v${version} [initial]`);
      continue;
    }

    if (change.action !== "edit") continue;

    const { data, body } = parseFrontMatter(change.content);
    if (!data || Object.keys(data).length === 0) continue; // unparseable — leave as-is

    // Prior state = the post as loaded in memory at app boot.
    const prior        = (getState().allPosts || []).find(p => p.id === change.id);
    const priorVersion = prior?.version || data.version || "0.1.0";
    const newVersion   = bumpVersion(priorVersion, category);

    // Append a history entry for the prior body.
    if (prior && typeof prior.body === "string") {
      const existing = getHistoryById(change.id);
      // Derive the category that produced `priorVersion`: "initial" if this
      // is the first revision (history empty), otherwise inferred from the
      // delta between the most recent entry's version and priorVersion.
      const priorCategory = existing.versions.length === 0
        ? "initial"
        : bumpCategoryBetween(
            existing.versions[existing.versions.length - 1].version,
            priorVersion,
          );

      const priorRevised = prior.revised || prior.created;
      const next = appendVersion(existing, {
        id:       change.id,
        version:  priorVersion,
        category: priorCategory,
        revised:  toISODate(priorRevised),
        words:    wordCount(prior.body),
        body:     prior.body,
      });
      files.push({
        filePath: historyPathFor(change.id),
        content:  JSON.stringify(next, null, 2) + "\n",
      });
    }

    // Bump version, auto-stamp revised, re-serialize.
    data.version = newVersion;
    data.revised = new Date();
    const restamped = serializePost({ ...data, body });
    change.content  = restamped;
    const f = files.find(x => x.filePath === change.filePath);
    if (f) f.content = restamped;

    headers.push(`${change.id} v${newVersion} [${category}]`);
  }

  const imageCount = imageFiles.length;
  const imageNote  = imageCount > 0 ? ` + ${imageCount} image${imageCount > 1 ? "s" : ""}` : "";
  const message    = (headers.length > 0
    ? headers.join("; ")
    : `commit ${pendingChanges.length} changes`) + imageNote;

  setState({ status: "saving", statusMessage: "committing…" });

  try {
    // Concatenate text and binary file entries. Order doesn't matter to
    // the Git Data API — blobs are uploaded in parallel and the tree is
    // built from their SHAs.
    const result = await commitAll({
      files: [...files, ...imageFiles],
      message,
    });

    const addsCount  = snapshot.filter(c => c.action === "add").length;
    const editsCount = snapshot.filter(c => c.action === "edit").length;

    if (result.ok) {
      sessionCommits.unshift({
        timestamp: new Date(),
        count:     snapshot.length,
        adds:      addsCount,
        edits:     editsCount,
        images:    imageCount,
        mode:      result.mode,
        ok:        true,
      });
      clearPending();
      clearQueue();
      const summary = `committed ${snapshot.length} change${snapshot.length > 1 ? "s" : ""}` + imageNote;
      setState({
        status:        "saved",
        statusMessage: summary,
      });
      setTimeout(() => setState({ status: null, statusMessage: "" }), 2500);
    } else {
      sessionCommits.unshift({
        timestamp: new Date(),
        count:     snapshot.length,
        adds:      addsCount,
        edits:     editsCount,
        images:    imageCount,
        ok:        false,
        error:     result.error,
      });
      setState({ status: "error", statusMessage: `commit failed: ${result.error}` });
    }
  } catch (e) {
    sessionCommits.unshift({
      timestamp: new Date(),
      count:     snapshot.length,
      images:    imageCount,
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
  return `<button class="dispatch-btn" id="dispatch-commit">update ${n}</button>`;
}

function wireCommitButton() {
  const btn = document.getElementById("dispatch-commit");
  if (btn) btn.addEventListener("click", commitWithPicker);
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
  if (c.adds)   parts.push(`${c.adds} added`);
  if (c.edits)  parts.push(`${c.edits} edited`);
  if (c.images) parts.push(`${c.images} image${c.images > 1 ? "s" : ""}`);
  if (parts.length === 0) parts.push(`${c.count || 0} change${c.count === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function formatTime(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Coerce a Date|string into a YYYY-MM-DD string for the history entry.
function toISODate(v) {
  if (v instanceof Date && !Number.isNaN(+v)) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && v) {
    const d = new Date(v);
    if (!Number.isNaN(+d)) return d.toISOString().slice(0, 10);
  }
  return "";
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
