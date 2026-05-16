// ── Manuscript view — Phase 3 ────────────────────────────────────────────────
// One of three states depending on the router:
//
//   dashboard  → no piece open. Shows a brief summary.
//   edit       → edit form for an existing post.
//   new        → fresh form with a minted <KIND>-YYYY-NNN id and empty fields.

import { renderForm } from "../forms/post-form.js";
import { nextId }     from "../../lib/id.js";

export function renderDashboard(container, allPosts) {
  if (!container) return;
  const total      = allPosts.length;
  const drafts     = allPosts.filter(p => p.status === "draft").length;
  const evergreens = allPosts.filter(p => p.status === "evergreen").length;
  const abandoned  = allPosts.filter(p => p.status === "abandoned").length;

  container.innerHTML = `
    <div class="dashboard">
      <h2 class="dashboard-heading">CULT_TO_CANON</h2>
      <p class="dashboard-sub">the archive at a glance</p>
      <dl class="dashboard-stats">
        <div><dt>total</dt><dd>${total}</dd></div>
        <div><dt>draft</dt><dd>${drafts}</dd></div>
        <div><dt>evergreen</dt><dd>${evergreens}</dd></div>
        <div><dt>abandoned</dt><dd>${abandoned}</dd></div>
      </dl>
      <div class="dashboard-hints">
        <p><kbd>i</kbd> focus Index · <kbd>j</kbd>/<kbd>k</kbd> navigate · <kbd>Enter</kbd> open</p>
        <p><kbd>:</kbd><kbd>new</kbd> new piece · <kbd>:</kbd><kbd>update</kbd> commit</p>
      </div>
    </div>
  `;
}

export function renderEdit(container, post) {
  renderForm(container, post, { isNew: false });
}

export function renderNew(container, allPosts) {
  const year = new Date().getFullYear();
  const kind = "essay";                       // matches blank.kind below
  // Provisional ID — the prefix is finalized from the chosen kind at first
  // save (see post-form.js save()).
  const id   = nextId(kind, year, allPosts.map(p => p.id));
  const blank = {
    id,
    version:    "0.1.0",
    slug:       "",
    title:      "",
    created:    new Date(),
    revised:    null,
    status:     "draft",
    kind,
    register:   "plainspoken",
    confidence: null,
    subjects:   [],
    links:      [],
    visibility: "private",   // safer default — author can flip to public after
    series:     null,
    epigraph:   null,
    body:       "",
  };
  renderForm(container, blank, { isNew: true });
}
