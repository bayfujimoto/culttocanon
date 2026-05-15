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
//                     user edits, Save (or :w) stages a pending change
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
import { initModes, renderAdminKeymap }       from "./lib/modes.js";

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

import { initDispatch, triggerCommit } from "./views/dispatch.js";
import { save as saveForm }            from "./forms/post-form.js";

// ── Shell ────────────────────────────────────────────────────────────────────
renderShell(document.getElementById("app"), {
  identity: { name: "CULT_TO_CANON", version: "v0.1.0" },
  panes: [
    { key: "i", label: "Index" },
    { key: "m", label: "Manuscript" },
    { key: "d", label: "Dispatch" },
  ],
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
  onW: () => {
    // If a form is open and dirty, save it first; then commit.
    if (getState().view === "edit" || getState().view === "new") {
      saveForm();
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
    else      flashError(`no piece "${arg}"`);
  },
});

renderAdminKeymap();

// ── Helpers ──────────────────────────────────────────────────────────────────
function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function flashError(msg) {
  const el = document.getElementById("shell-status-state");
  if (!el) return;
  const original = el.textContent;
  el.textContent = `! ${msg}`;
  el.classList.add("shell-status-state--error");
  setTimeout(() => {
    el.textContent = original;
    el.classList.remove("shell-status-state--error");
  }, 2000);
}
