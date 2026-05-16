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
import "./styles.css";

import { renderShell }    from "../shell/render-shell.js";
import { getAllPosts }    from "../lib/post-loader.js";
import { setState, getState } from "./state.js";

import { initRouter, navigate, currentRoute } from "./lib/router.js";
import { initModes, getFocusedPane, flashStatus } from "./lib/modes.js";

// ── Keymap legend (single keystrokes only) + `?` help reference ──────────────
// j/k/Enter only fire when Index is focused. Ex-commands (:update/:q/:new/:e) live
// in the help overlay, not the inline legend.
const ADMIN_KEYMAP_GROUPS = {
  i: [["j/k", "navigate"], ["Enter", "open"], ["m", "Manuscript"],
      ["d", "Dispatch"], [":", "cmd"], ["?", "help"]],
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
      ["j / k", "move cursor"], ["Enter", "open"] ] },
    { heading: "Editing", rows: [
      ["(focus a field)", "enter INSERT"], ["Esc", "leave field → NORMAL"] ] },
    { heading: "Command (:)", rows: [
      [":update", "save & commit"], [":q", "close post"], [":new", "new post"],
      [":e <id|slug>", "open by id/slug"] ] },
    { heading: "General", rows: [
      ["Esc", "focus Index / clear error"], ["?", "toggle this help"] ] },
  ],
};

import {
  renderIndex,
  setSelected   as setIndexSelected,
  moveCursor    as moveIndexCursor,
  activateCursor as activateIndexCursor,
} from "./views/index-view.js";

import {
  renderDashboard,
  renderEdit,
  renderNew,
} from "./views/manuscript.js";

import { initDispatch, commitWithPicker } from "./views/dispatch.js";
import { save as saveForm }               from "./forms/post-form.js";

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
  },
  onUpdate: () => {
    // If a form is open, save it first to stage the change; then gate the
    // commit through the bump-picker (which calls triggerCommit on confirm).
    if (getState().view === "edit" || getState().view === "new") {
      saveForm();
    }
    commitWithPicker();
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
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
