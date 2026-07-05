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

import { getState, setState, subscribe, clearPending, upsertPost, removePost } from "../state.js";
import { commitAll }                                   from "../lib/api.js";
import { parseFrontMatter }                            from "../../lib/front-matter.js";
import { serializePost, folderNameFor }                from "../lib/serializer.js";
import {
  getHistoryById,
  appendVersion,
  historyPathFor,
  setHistory,
  wordCount,
} from "../../lib/history.js";
import { bumpVersion, bumpCategoryBetween } from "../lib/version.js";
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
 * Commit all pending changes. The version decision was already made per-post
 * at save time (see post-form.js → the statusbar picker), and rides on each
 * pending change as `bump` (edits) or `startVersion` (adds). There is no
 * batch picker here.
 *
 * For each `edit`: the staged content's `version` is bumped per the change's
 * own `bump`, `revised` is auto-stamped, the content is re-serialized, and a
 * history entry is appended for the *prior* body — labeled with the prior
 * version and the category that produced it (Model A semantic; see history.js).
 *
 * For each `add`: the staged content is committed with the chosen
 * `startVersion` (default "0.1.0"). No history entry is written — the version
 * timeline begins on the first edit, at which point that snapshot is captured
 * with category `"initial"`.
 */
export async function triggerCommit() {
  const { pendingChanges } = getState();
  if (!pendingChanges.length) {
    flash(queueSize() > 0 ? "queued images need a body edit to commit" : "nothing to commit");
    return;
  }

  const snapshot = pendingChanges.slice();
  // Only add/edit changes carry file content. Deletes contribute their own
  // deletion entries below, so seed `files` from the content-bearing changes.
  const files    = snapshot
    .filter(c => c.action === "add" || c.action === "edit")
    .map(c => ({ filePath: c.filePath, content: c.content }));
  // Snapshot the image queue at this moment too. Each entry becomes a
  // binary file in the commit; the queue is cleared on success below.
  const imageFiles = getQueueAsFiles();

  // Per-file commit headers, built as each change is processed.
  // Format: `{id} v{version} [{category}]`.
  const headers = [];

  // In-memory cache updates to apply after a successful commit. Keyed by id so
  // we don't apply anything if the server rejects the commit.
  const postUpdates    = new Map();
  const historyUpdates = new Map();
  // Ids removed by delete changes — cleared from the in-memory caches on a
  // successful commit.
  const deletedIds     = new Set();

  for (const change of snapshot) {
    if (change.action === "delete") {
      // Remove the post's whole folder (markdown + any images) and its history
      // sidecar. `filePath` is the post's `post.md`; strip the tail to get the
      // folder. Missing paths (e.g. a never-revised post has no sidecar) are
      // tolerated by both commit backends.
      const folder = change.filePath.replace(/\/post\.md$/, "");
      files.push({ filePath: folder, deleted: true, isDir: true });
      files.push({ filePath: historyPathFor(change.id), deleted: true });
      deletedIds.add(change.id);
      headers.push(`${change.id} [deleted]`);
      continue;
    }

    if (change.action === "add") {
      // Adds emit at the start version the author chose at save time
      // (0.1.0 or 1.0.0); fall back to whatever the content carries.
      const { data, body } = parseFrontMatter(change.content);
      const version  = change.startVersion || data?.version || "0.1.0";
      headers.push(`${change.id} v${version} [initial]`);
      postUpdates.set(change.id, postFromCommitted(data, body, version, {}));
      continue;
    }

    if (change.action !== "edit") continue;

    const { data, body } = parseFrontMatter(change.content);
    if (!data || Object.keys(data).length === 0) continue; // unparseable — leave as-is

    // Bump category was chosen per-post at save time. Guard against a change
    // staged without one (older code path / dev artifact): default to patch.
    let bump = change.bump;
    if (bump !== "patch" && bump !== "minor" && bump !== "major") {
      flash(`${change.id}: no bump chosen — defaulting to patch`);
      bump = "patch";
    }

    // Prior state = the post as loaded in memory at app boot.
    const prior        = (getState().allPosts || []).find(p => p.id === change.id);
    const priorVersion = prior?.version || data.version || "0.1.0";
    const newVersion   = bumpVersion(priorVersion, bump);

    // Append a history entry for the prior body.
    if (prior && typeof prior.body === "string") {
      const existing = getHistoryById(change.id);
      // Derive the category that produced `priorVersion`: "initial" if this
      // is the first revision (history empty), otherwise inferred from the
      // delta between the most recent entry's version and priorVersion.
      // bumpCategoryBetween throws when priorVersion is not strictly higher
      // than the last recorded version (e.g. a sidecar whose newest entry
      // equals the live version — an initial snapshot taken at the same
      // version). That's only a label; never let it abort the commit.
      let priorCategory = "initial";
      if (existing.versions.length > 0) {
        const lastVersion = existing.versions[existing.versions.length - 1].version;
        try {
          priorCategory = bumpCategoryBetween(lastVersion, priorVersion);
        } catch {
          priorCategory = "patch";
        }
      }

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
      historyUpdates.set(change.id, next);
    }

    // Bump version, auto-stamp revised, re-serialize.
    data.version = newVersion;
    data.revised = new Date();
    const restamped = serializePost({ ...data, body });
    change.content  = restamped;
    const f = files.find(x => x.filePath === change.filePath);
    if (f) f.content = restamped;

    postUpdates.set(change.id, postFromCommitted(data, body, newVersion, prior));

    headers.push(`${change.id} v${newVersion} [${bump}]`);
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

    const addsCount    = snapshot.filter(c => c.action === "add").length;
    const editsCount   = snapshot.filter(c => c.action === "edit").length;
    const deletesCount = snapshot.filter(c => c.action === "delete").length;

    if (result.ok) {
      sessionCommits.unshift({
        timestamp: new Date(),
        count:     snapshot.length,
        adds:      addsCount,
        edits:     editsCount,
        deletes:   deletesCount,
        images:    imageCount,
        mode:      result.mode,
        ok:        true,
      });
      // Refresh in-memory caches so a subsequent edit/bump on the same post
      // (without a page reload) sees the just-committed version and history.
      for (const post of postUpdates.values())     upsertPost(post);
      for (const [id, hist] of historyUpdates)     setHistory(id, hist);
      for (const id of deletedIds)                 removePost(id);
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
        deletes:   deletesCount,
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
  // Surface any unexpected throw in the commit pipeline instead of letting
  // the rejected promise vanish (which would make the button look dead).
  if (btn) btn.addEventListener("click", () => {
    triggerCommit().catch(e => {
      setState({ status: "error", statusMessage: `commit failed: ${e.message}` });
    });
  });
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

    // Version decision chosen at save time. Adds show "new vX.Y.Z";
    // edits show "bump → vX.Y.Z". Absent only for legacy/unstaged rows.
    let bumpText = "";
    if (action === "add" && change.startVersion) {
      bumpText = `new v${change.startVersion}`;
    } else if (action === "edit" && change.bump && change.newVersion) {
      bumpText = `${change.bump} → v${change.newVersion}`;
    }

    li.innerHTML = `
      <span class="dispatch-action dispatch-action--${escapeAttr(action)}">${prefix}</span>
      <span class="dispatch-id">${escapeHTML(change.id || "")}</span>
      <span class="dispatch-path" title="${escapeAttr(change.filePath || "")}">${escapeHTML(change.filePath || "")}</span>
      ${bumpText ? `<span class="dispatch-bump">${escapeHTML(bumpText)}</span>` : ""}
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
  if (c.adds)    parts.push(`${c.adds} added`);
  if (c.edits)   parts.push(`${c.edits} edited`);
  if (c.deletes) parts.push(`${c.deletes} deleted`);
  if (c.images)  parts.push(`${c.images} image${c.images > 1 ? "s" : ""}`);
  if (parts.length === 0) parts.push(`${c.count || 0} change${c.count === 1 ? "" : "s"}`);
  return parts.join(", ");
}

function formatTime(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Build the in-memory Post shape that matches what post-loader would produce
// for the just-committed content. Used to refresh `allPosts` so a follow-up
// edit/bump reads the new version instead of the boot-time snapshot.
//
//   data    parsed frontmatter (with version/revised already set for edits)
//   body    markdown body string
//   version the committed version (authoritative)
//   prior   the pre-commit Post when present (preserves _file / folder on edit)
function postFromCommitted(data, body, version, prior) {
  const trimmedBody = String(body ?? "").trim();
  const folder = prior?.folder || folderNameFor({ id: data.id, slug: data.slug });
  return {
    ...(prior || {}),
    id:         data.id,
    version,
    slug:       data.slug,
    title:      data.title,
    created:    data.created ?? prior?.created ?? null,
    revised:    data.revised ?? prior?.revised ?? null,
    status:     data.status,
    kind:       data.kind,
    register:   data.register,
    confidence: data.confidence ?? null,
    subjects:   Array.isArray(data.subjects) ? data.subjects : [],
    links:      Array.isArray(data.links)    ? data.links    : [],
    visibility: data.visibility,
    series:     data.series   ?? null,
    epigraph:   data.epigraph ?? null,
    length:     wordCount(trimmedBody),
    body:       trimmedBody,
    folder,
  };
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
