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
import { renderPost, renderDiff } from "../lib/post-renderer.js";
import { getHistoryById }   from "../lib/history.js";
import {
  renderBrowse,
  setSelected   as setBrowseSelected,
  moveCursor    as moveBrowseCursor,
  activateCursor as activateBrowseCursor,
  toggleMode    as toggleBrowseMode,
} from "./views/browse.js";
import { renderMarginalia } from "./views/marginalia.js";
import { initRouter, navigate } from "./lib/router.js";
import { initModes, getFocusedPane, flashStatus } from "./lib/modes.js";

// ── Keymap legend (single keystrokes only) + `?` help reference ──────────────
// Per-pane groups: j/k/Enter/t only fire when Browse is focused, so they appear
// only in group `b`. Ex-commands (:e/:q/:home) live in the help overlay, not
// the inline legend.
const PUBLIC_KEYMAP_GROUPS = {
  b: [["j/k", "navigate"], ["Enter", "open"], ["t", "tree/flat"],
      ["r", "Read"], ["m", "Marginalia"], [":", "cmd"], ["?", "help"]],
  r: [["b", "Browse"], ["m", "Marginalia"], ["Esc", "reset"],
      [":", "cmd"], ["?", "help"]],
  m: [["b", "Browse"], ["r", "Read"], ["Esc", "reset"],
      [":", "cmd"], ["?", "help"]],
};

const PUBLIC_HELP = {
  title: "CULT_TO_CANON — keys",
  sections: [
    { heading: "Panes", rows: [
      ["b", "focus Browse"], ["r", "focus Read"], ["m", "focus Marginalia"] ] },
    { heading: "Browse", rows: [
      ["j / k", "move cursor"], ["Enter", "open piece"],
      ["t", "toggle tree / flat"] ] },
    { heading: "Command (:)", rows: [
      [":e <id|slug>", "open a piece"], [":q", "close current piece"],
      [":home", "return to /"] ] },
    { heading: "General", rows: [
      ["Esc", "focus Browse / clear error"], ["?", "toggle this help"] ] },
  ],
};

// ── Shell ────────────────────────────────────────────────────────────────────
renderShell(document.getElementById("app"), {
  identity: { name: "CULT_TO_CANON", version: "v0.1.0" },
  panes: [
    { key: "b", label: "Browse" },
    { key: "r", label: "Read" },
    { key: "m", label: "Marginalia" },
  ],
  keymap: { groups: PUBLIC_KEYMAP_GROUPS, getFocusedPane },
  help:   PUBLIC_HELP,
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
let diffOpen    = false;   // true while the Read pane shows a version diff

// ── Render helpers (do not touch the URL) ────────────────────────────────────
function showPost(post) {
  currentPost = post;
  diffOpen    = false;
  renderPost(post, readBody);
  renderMarginalia(margBody, post, {
    allPosts:        posts,
    onSelect:        openPost,
    versions:        getHistoryById(post.id).versions,
    onVersionSelect: (version) => showDiff(post, version),
  });
  setBrowseSelected(post.id);
}

// Show an inline unified diff of `version` against the current post body.
// Esc or the banner's [×] returns to the normal reading view.
function showDiff(post, version) {
  diffOpen = true;
  renderDiff(post, version, readBody, { onClose: closeDiff });
}

function closeDiff() {
  if (!diffOpen) return;
  diffOpen = false;
  if (currentPost) renderPost(currentPost, readBody);
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
    else flashStatus(`no piece "${arg}"`);
  },
  onCommandQ:    () => navigate("/"),
  onCommandHome: () => navigate("/"),
  onReset:       () => closeDiff(),
});
