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
import "../styles/tree-view.css";
import "./styles.css";

import { renderShell, setMobileActivePane } from "../shell/render-shell.js";
import { getPublicPosts }   from "../lib/post-loader.js";
import { renderPost, renderDiff } from "../lib/post-renderer.js";
import { getHistoryById }   from "../lib/history.js";
import {
  renderBrowse,
  setSelected    as setBrowseSelected,
  moveCursor     as moveBrowseCursor,
  activateCursor as activateBrowseCursor,
  collapseCursor as collapseBrowseCursor,
  expandCursor   as expandBrowseCursor,
  toggleMode     as toggleBrowseMode,
} from "./views/browse.js";
import { renderMarginalia } from "./views/marginalia.js";
import { initRouter, navigate } from "./lib/router.js";
import { initModes, getFocusedPane, flashStatus } from "./lib/modes.js";
import { initBackground, setBackgroundTreatment } from "./lib/background.js";

// ── Keymap legend (single keystrokes only) + `?` help reference ──────────────
// Per-pane groups: j/k/Enter/t only fire when Browse is focused, so they appear
// only in group `b`. Ex-commands (:e/:q/:home) live in the help overlay, not
// the inline legend.
const PUBLIC_KEYMAP_GROUPS = {
  b: [["j/k", "navigate"], ["h/l", "collapse/expand"], ["Enter", "open"],
      ["t", "tree/flat"], ["r", "Read"], ["m", "Marginalia"],
      [":", "cmd"], ["?", "help"]],
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
      ["j / k", "move cursor"], ["h / l", "collapse / expand (tree)"],
      ["Enter", "toggle group / open piece"], ["t", "toggle tree / flat"] ] },
    { heading: "Command (:)", rows: [
      [":e <id|slug>", "open a piece"], [":q", "close current piece"],
      [":home", "return to /"],
      [":bg <treatment>", "background: original / pixelated / duotone / off"] ] },
    { heading: "General", rows: [
      ["Esc", "focus Browse / clear error"], ["?", "toggle this help"] ] },
  ],
};

// ── Background ───────────────────────────────────────────────────────────────
// Mount the daily-rotating background layer before the shell. The reader's
// `:bg <treatment>` preference (persisted to localStorage) is restored here.
initBackground();

// ── Shell ────────────────────────────────────────────────────────────────────
renderShell(document.getElementById("app"), {
  identity: { name: "CULT_TO_CANON", version: "v" + __THESIS_VERSION__ },
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

// ── Render helpers ──────────────────────────────────────────────────────────
// State lives in the URL: `/<slug>` shows the post; `/<slug>?v=X.Y.Z` shows
// the diff for that version. The router resolves the URL into one of the
// showPost / showDiff calls below; user actions (clicking a version row,
// closing the diff) navigate() to a new URL and let the router re-resolve.

// Marginalia uses identical options whether we're in post or diff mode, so
// the version list stays clickable while a diff is open.
function marginaliaOptionsFor(post) {
  return {
    allPosts:        posts,
    onSelect:        openPost,
    versions:        getHistoryById(post.id).versions,
    onVersionSelect: (entry) => navigate(`/${post.slug}?v=${entry.version}`),
  };
}

function showPost(post) {
  currentPost = post;
  diffOpen    = false;
  renderPost(post, readBody);
  renderMarginalia(margBody, post, marginaliaOptionsFor(post));
  setBrowseSelected(post.id);
}

// Show an inline unified diff of `entry` against its immediate predecessor.
// Backward-diff semantic: the diff shows the changes that produced `entry`.
// For the first entry (no predecessor) the diff runs against an empty body,
// so the initial publish renders as all-additions.
// Esc or the banner's "view current" button navigates back to the post.
function showDiff(post, entry) {
  currentPost = post;
  diffOpen    = true;

  const history = getHistoryById(post.id).versions;
  const idx     = history.findIndex(e => e.version === entry.version);

  const oldBody  = idx > 0 ? history[idx - 1].body : "";
  const newBody  = entry.body || "";
  const prevEntry = idx > 0                       ? history[idx - 1] : null;
  const nextEntry = idx >= 0 && idx + 1 < history.length ? history[idx + 1] : null;

  renderDiff(readBody, {
    oldBody,
    newBody,
    banner: {
      id:       post.id,
      version:  entry.version,
      category: entry.category,
      date:     entry.revised,
    },
    onPrev:  prevEntry ? () => navigate(`/${post.slug}?v=${prevEntry.version}`) : null,
    onNext:  nextEntry ? () => navigate(`/${post.slug}?v=${nextEntry.version}`) : null,
    onClose: closeDiff,
  });

  renderMarginalia(margBody, post, marginaliaOptionsFor(post));
  setBrowseSelected(post.id);
}

function closeDiff() {
  if (!diffOpen || !currentPost) return;
  navigate(`/${currentPost.slug}`);
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
  if (window.matchMedia("(max-width: 700px)").matches) setMobileActivePane("r");
}

// ── Render Browse with current data ──────────────────────────────────────────
renderBrowse(browseBody, posts, { onSelect: openPost });

// ── Wire the router as the single source of truth ────────────────────────────
initRouter((slug, path, version) => {
  if (!slug) {
    showEmpty();
    return;
  }
  const post = bySlug.get(slug) || byId.get(slug);
  if (!post) {
    showNotFound(path);
    return;
  }
  if (version) {
    const entry = getHistoryById(post.id).versions.find(e => e.version === version);
    if (entry) {
      showDiff(post, entry);
    } else {
      flashStatus(`no version v${version} for ${post.slug}`);
      showPost(post);
    }
  } else {
    showPost(post);
  }
});

// ── Wire the mode engine ─────────────────────────────────────────────────────
initModes({
  onBrowseNav: (action) => {
    if (action === "down") moveBrowseCursor("down");
    else if (action === "up") moveBrowseCursor("up");
    else if (action === "open") activateBrowseCursor();
    else if (action === "collapse") collapseBrowseCursor();
    else if (action === "expand") expandBrowseCursor();
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
  onCommandBg:   (arg) => {
    if (!setBackgroundTreatment(arg)) {
      flashStatus(`:bg ${arg}? try original / pixelated / duotone / off`);
    }
  },
  onReset:       () => closeDiff(),
});
