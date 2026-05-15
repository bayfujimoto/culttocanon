// ── Public entry — Phase 2 ───────────────────────────────────────────────────
// Wires the public TUI to the URL, the keyboard, and the post archive.
//
//   URL  ──┐                       ┌── click in Browse
//          │                       │
//          ▼                       ▼
//        router  ──→  showPost  ←──  (calls navigate)
//          │             │
//          │             ├── renders Read
//          │             ├── renders Marginalia
//          │             └── highlights row in Browse
//          │
//          ▼
//        history.pushState updates address bar
//
// The router is the single source of truth for what's rendered. Every other
// action (click, keystroke, command) flows through `navigate()` and back to
// the router's handler.

import "../styles/tokens.css";
import "../shell/shell.css";
import "../styles/post-body.css";
import "./styles.css";

import { renderShell }      from "../shell/render-shell.js";
import { getPublicPosts }   from "../lib/post-loader.js";
import { renderPost }       from "../lib/post-renderer.js";
import {
  renderBrowse,
  setSelected   as setBrowseSelected,
  moveCursor    as moveBrowseCursor,
  activateCursor as activateBrowseCursor,
  toggleMode    as toggleBrowseMode,
} from "./views/browse.js";
import { renderMarginalia } from "./views/marginalia.js";
import { initRouter, navigate } from "./lib/router.js";
import { initModes }        from "./lib/modes.js";

// ── Shell ────────────────────────────────────────────────────────────────────
renderShell(document.getElementById("app"), {
  identity: { name: "CULT_TO_CANON", version: "v0.1.0" },
  panes: [
    { key: "b", label: "Browse" },
    { key: "r", label: "Read" },
    { key: "m", label: "Marginalia" },
  ],
});

// ── Pane bodies ──────────────────────────────────────────────────────────────
const browseBody = document.querySelector("#pane-b .shell-pane-body");
const readBody   = document.querySelector("#pane-r .shell-pane-body");
const margBody   = document.querySelector("#pane-m .shell-pane-body");

// ── Load posts and index by slug + id ────────────────────────────────────────
const posts = getPublicPosts();
const bySlug = new Map(posts.map(p => [p.slug, p]));
const byId   = new Map(posts.map(p => [p.id,   p]));

let currentPost = null;

// ── Render helpers (do not touch the URL) ────────────────────────────────────
function showPost(post) {
  currentPost = post;
  renderPost(post, readBody);
  renderMarginalia(margBody, post, { allPosts: posts, onSelect: openPost });
  setBrowseSelected(post.id);
}

function showEmpty() {
  currentPost = null;
  readBody.innerHTML = `
    <div class="read-empty">
      select a piece from Browse
      <span class="read-empty-sub">— or press <kbd>:</kbd> then <kbd>e</kbd>&nbsp;&lt;id&gt;</span>
    </div>
  `;
  renderMarginalia(margBody, null);
  setBrowseSelected(null);
}

function showNotFound(path) {
  currentPost = null;
  readBody.innerHTML = `
    <div class="read-empty">
      no piece at <code>${path}</code>
      <span class="read-empty-sub">— press <kbd>:</kbd><kbd>home</kbd> to return</span>
    </div>
  `;
  renderMarginalia(margBody, null);
  setBrowseSelected(null);
}

// ── Public action: open a post (entrypoint for clicks, commands, etc.) ──────
function openPost(post) {
  if (!post) return;
  navigate("/" + post.slug);
}

// ── Render Browse with current data ──────────────────────────────────────────
renderBrowse(browseBody, posts, { onSelect: openPost });

// ── Wire the router as the single source of truth ────────────────────────────
initRouter((slug, path) => {
  if (!slug) {
    showEmpty();
    return;
  }
  const post = bySlug.get(slug) || byId.get(slug);
  if (post) showPost(post);
  else      showNotFound(path);
});

// ── Wire the mode engine ─────────────────────────────────────────────────────
initModes({
  onBrowseNav: (action) => {
    if (action === "down") moveBrowseCursor("down");
    else if (action === "up") moveBrowseCursor("up");
    else if (action === "open") activateBrowseCursor();
  },
  onBrowseToggle: () => {
    toggleBrowseMode();
  },
  onCommandE: (arg) => {
    const post = bySlug.get(arg) || byId.get(arg);
    if (post) openPost(post);
    else {
      // Flash an error via statusbar
      const stateEl = document.getElementById("shell-status-state");
      if (stateEl) {
        const original = stateEl.textContent;
        stateEl.textContent = `! no piece "${arg}"`;
        stateEl.classList.add("shell-status-state--error");
        setTimeout(() => {
          stateEl.textContent = original;
          stateEl.classList.remove("shell-status-state--error");
        }, 2000);
      }
    }
  },
  onCommandQ:    () => navigate("/"),
  onCommandHome: () => navigate("/"),
});
