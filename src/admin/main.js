// ── Admin entry — Phase 3 ────────────────────────────────────────────────────
// Brings together the shell, the state store, the router, the mode engine,
// and the three pane views.
//
// Flow:
//   Index click  ──►  navigate(#/edit/<id>)
//                          │
//                          ▼
//                     router fires onRouteChange
//                          │
//                          ▼
//                     renderEdit(post) in Manuscript
//                          │
//                          ▼
//                     user edits, Save (or :update) stages a pending change
//                          │
//                          ▼
//                     Dispatch shows it; commit button bundles → /api/commit-all

import "../styles/tokens.css";
import "../shell/shell.css";
import "../styles/post-body.css";
import "../styles/tree-view.css";
import "./styles.css";

// ── Restore saved theme before the shell renders (no flash) ──────────────────
// admin.html ships data-theme="admin"; override from localStorage here, before
// renderShell paints. Default for a fresh session is RED. Scoped to the admin
// entry only — public (src/public/main.js) and gate (src/gate/main.js) never
// import this file, so [data-theme="public"] and the gate's green are untouched.
(function restoreAdminTheme() {
  const KEY = "ctc:admin:theme";
  const MAP = { green:"admin", red:"admin-red", amber:"admin-amber",
                ice:"admin-ice", mono:"admin-mono", slate:"admin-slate" };
  document.documentElement.dataset.surface = "admin";   // powers styles.css scoping
  let name = "red";                                      // fresh-session default
  try { const s = localStorage.getItem(KEY); if (s && MAP[s]) name = s; } catch {}
  document.documentElement.dataset.theme = MAP[name];
})();

import { renderShell }    from "../shell/render-shell.js";
import { getAllPosts }    from "../lib/post-loader.js";
import { setState, getState } from "./state.js";

import { initRouter, navigate, currentRoute } from "./lib/router.js";
import { initModes, getFocusedPane, flashStatus } from "./lib/modes.js";

// ── Keymap legend (single keystrokes only) + `?` help reference ──────────────
// j/k/Enter only fire when Index is focused. Ex-commands (:update/:q/:new/:e) live
// in the help overlay, not the inline legend.
const ADMIN_KEYMAP_GROUPS = {
  i: [["j/k", "navigate"], ["h/l", "collapse/expand"], ["Enter", "open"],
      ["m", "Manuscript"], ["d", "Dispatch"], [":", "cmd"], ["?", "help"]],
  m: [["Esc", "normal"], ["i", "Index"], ["d", "Dispatch"],
      [":", "cmd"], ["?", "help"]],
  d: [["i", "Index"], ["m", "Manuscript"], ["Esc", "reset"],
      [":", "cmd"], ["?", "help"]],
};

const ADMIN_HELP = {
  title: "CULT_TO_CANON — admin keys",
  sections: [
    { heading: "Panes", rows: [
      ["i", "focus Index"], ["m", "focus Manuscript"], ["d", "focus Dispatch"] ] },
    { heading: "Index", rows: [
      ["j / k", "move cursor"], ["h / l", "collapse / expand"],
      ["Enter", "toggle group / open"] ] },
    { heading: "Editing", rows: [
      ["(focus a field)", "enter INSERT"], ["Esc", "leave field → NORMAL"] ] },
    { heading: "Command (:)", rows: [
      [":update", "save (pick bump) / commit"], [":q", "close post"], [":new", "new post"],
      [":e <id|slug>", "open by id/slug"],
      [":theme [name]", "switch theme (green/red/amber/ice/mono/slate)"] ] },
    { heading: "General", rows: [
      ["Esc", "focus Index / clear error"], ["?", "toggle this help"] ] },
  ],
};

import {
  renderIndex,
  setSelected    as setIndexSelected,
  moveCursor     as moveIndexCursor,
  activateCursor as activateIndexCursor,
  collapseCursor as collapseIndexCursor,
  expandCursor   as expandIndexCursor,
} from "./views/index-view.js";

import {
  renderDashboard,
  renderEdit,
  renderNew,
} from "./views/manuscript.js";

import { initDispatch, triggerCommit }       from "./views/dispatch.js";
import { save as saveForm, isDirty }          from "./forms/post-form.js";

// ── Theme registry — friendly name → data-theme id. All dark; colors only. ──
// Source of truth for the `:theme` command. The early restore at the top of
// this file keeps a duplicate of the name→id map so it can run before imports
// resolve; keep the two in sync if themes are added.
const ADMIN_THEMES = {
  green: "admin",       red:  "admin-red",   amber: "admin-amber",
  ice:   "admin-ice",   mono: "admin-mono",  slate: "admin-slate",
};
const THEME_NAMES       = Object.keys(ADMIN_THEMES);
const THEME_STORAGE_KEY = "ctc:admin:theme";

function applyTheme(name) {
  document.documentElement.dataset.theme = ADMIN_THEMES[name];
  try { localStorage.setItem(THEME_STORAGE_KEY, name); } catch {}
}

// ── Shell ────────────────────────────────────────────────────────────────────
renderShell(document.getElementById("app"), {
  identity: { name: "CULT_TO_CANON", version: "v" + __THESIS_VERSION__ },
  panes: [
    { key: "i", label: "Index" },
    { key: "m", label: "Manuscript" },
    { key: "d", label: "Dispatch" },
  ],
  keymap: { groups: ADMIN_KEYMAP_GROUPS, getFocusedPane },
  help:   ADMIN_HELP,
});

// ── Pane bodies ──────────────────────────────────────────────────────────────
const indexBody = document.querySelector("#pane-i .shell-pane-body");
const manuBody  = document.querySelector("#pane-m .shell-pane-body");
const dispBody  = document.querySelector("#pane-d .shell-pane-body");

// ── Load posts ──────────────────────────────────────────────────────────────
const allPosts = getAllPosts();
const byId     = new Map(allPosts.map(p => [p.id, p]));
setState({ allPosts });

// ── Dispatch (init once, lives across routes) ────────────────────────────────
initDispatch(dispBody, {
  onRowClick: (id) => navigate(`#/edit/${id}`),
});

// ── Index (also persistent across routes) ───────────────────────────────────
renderIndex(indexBody, allPosts, {
  onSelect: (post) => navigate(`#/edit/${post.id}`),
});

// ── Router — drives Manuscript content based on URL ─────────────────────────
initRouter((route) => {
  setState({
    view:          route.view,
    currentPostId: route.id || null,
  });

  if (route.view === "edit") {
    const post = byId.get(route.id);
    if (!post) {
      manuBody.innerHTML = `<div class="dashboard"><p class="dashboard-empty">no piece with id <code>${escape(route.id)}</code></p></div>`;
      return;
    }
    renderEdit(manuBody, post);
    setIndexSelected(post.id);
    return;
  }
  if (route.view === "new") {
    renderNew(manuBody, allPosts);
    setIndexSelected(null);
    return;
  }
  // dashboard
  renderDashboard(manuBody, allPosts);
  setIndexSelected(null);
});

// ── Modes ────────────────────────────────────────────────────────────────────
initModes({
  onIndexNav: (action) => {
    if (action === "down") moveIndexCursor("down");
    else if (action === "up") moveIndexCursor("up");
    else if (action === "open") activateIndexCursor();
    else if (action === "collapse") collapseIndexCursor();
    else if (action === "expand") expandIndexCursor();
  },
  onUpdate: () => {
    // Two-step by design. If a form is open with unsaved edits, `:update`
    // means "stage this post" — saveForm() opens the per-post version picker
    // and stages on confirm. It does NOT commit. A second `:update` (form
    // clean, or from the dashboard) commits all pending changes; the version
    // decision already rides on each pending change, so no batch picker.
    const view = getState().view;
    if ((view === "edit" || view === "new") && isDirty()) {
      saveForm();
      return;
    }
    triggerCommit();
  },
  onQ: () => {
    navigate("#/");
  },
  onNew: () => {
    navigate("#/new");
  },
  onE: (arg) => {
    const post = byId.get(arg) || allPosts.find(p => p.slug === arg);
    if (post) navigate(`#/edit/${post.id}`);
    else      flashStatus(`no piece "${arg}"`);
  },
  onTheme: (arg) => {
    const list = THEME_NAMES.join(", ");
    if (!arg) { flashStatus(`themes: ${list}`); return; }
    const want = arg.toLowerCase();
    if (!(want in ADMIN_THEMES)) {
      flashStatus(`no theme "${arg}" — try: ${list}`);
      return;
    }
    applyTheme(want);
    flashStatus(`theme → ${want}`);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
