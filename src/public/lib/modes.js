// ── Mode engine (public) ─────────────────────────────────────────────────────
// Vim-style modal navigation for the public site. Two modes:
//
//   normal   — letter keys fire actions. b/r/m switch focused pane.
//              j/k navigate the Browse list. Enter opens the highlighted row.
//              `t` toggles Browse tree/flat. `:` enters command mode.
//   command  — the statusbar's state row is replaced with an input. The user
//              types `:e <id-or-slug>` or `:q`, Enter executes, Esc cancels.
//
// Vim modality is desktop-only. On mobile (<=700px) all keyboard handling is
// short-circuited; tap and mouse carry the interaction model.

import {
  rerenderKeymap,
  toggleHelp,
  closeHelp,
  isHelpOpen,
} from "../../shell/render-shell.js";

const COMMANDS = [
  { name: "e",    needsArg: true,  hint: "open <id-or-slug>" },
  { name: "q",    needsArg: false, hint: "close current piece" },
  { name: "home", needsArg: false, hint: "return to /" },
];

let mode          = "normal";
let focusedPane   = "b";
let handlers      = {};
let listenersAttached = false;

function isMobile() {
  return window.matchMedia("(max-width: 700px)").matches;
}

// ── Init ─────────────────────────────────────────────────────────────────────
/**
 * Initialize the mode engine.
 *
 *   handlers = {
 *     onFocusChange(paneKey),    // b/r/m fired
 *     onBrowseNav('down'|'up'|'open'),
 *     onBrowseToggle(),          // `t` fired
 *     onCommandE(arg),           // `:e <arg>`
 *     onCommandQ(),              // `:q`
 *     onCommandHome(),           // `:home`
 *     onReset(),                 // Esc pressed (no overlay open)
 *   }
 */
export function initModes(h = {}) {
  handlers = h;
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("mousedown", onMouseDown);
  wirePaneFocus();
  setFocusedPane(focusedPane);
  setMode("normal");
}

// Clicking a pane gives it focus (matches the click→focus pattern of
// bayfujimoto.com's admin). Initial focus is the Browse pane.
function wirePaneFocus() {
  document.querySelectorAll(".shell-pane[data-pane]").forEach((pane) => {
    pane.addEventListener("mousedown", () => {
      const key = pane.dataset.pane;
      if (key) setFocusedPane(key);
    });
  });
}

// ── Keydown ──────────────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (isMobile()) return;

  // If the user is typing in any other input field on the page, leave keys alone.
  if (isEditable(e.target) && !e.target.classList.contains("shell-cmd-input")) return;

  if (mode === "command") {
    return onCommandKey(e);
  }

  // normal mode
  // Help overlay toggle. This document handler is capture-phase, so it runs
  // before the overlay's own keydown — toggleHelp() handles both open and
  // close from here; the overlay's listener is a redundant safety net.
  if (e.key === "?") {
    toggleHelp();
    e.preventDefault();
    return;
  }

  // Esc — if the overlay is open, close it; otherwise return focus to the
  // primary pane (Browse) and clear any error flash.
  if (e.key === "Escape") {
    e.preventDefault();
    if (isHelpOpen()) { closeHelp(); return; }
    clearErrorFlash();
    handlers.onReset?.();
    setFocusedPane("b");
    return;
  }

  // Pane switching
  if (e.key === "b" || e.key === "r" || e.key === "m") {
    setFocusedPane(e.key);
    e.preventDefault();
    return;
  }

  // Browse navigation
  if (focusedPane === "b") {
    if (e.key === "j" || e.key === "ArrowDown") {
      handlers.onBrowseNav?.("down");
      e.preventDefault();
      return;
    }
    if (e.key === "k" || e.key === "ArrowUp") {
      handlers.onBrowseNav?.("up");
      e.preventDefault();
      return;
    }
    if (e.key === "Enter") {
      handlers.onBrowseNav?.("open");
      e.preventDefault();
      return;
    }
    if (e.key === "t") {
      handlers.onBrowseToggle?.();
      e.preventDefault();
      return;
    }
  }

  // Command mode entry
  if (e.key === ":") {
    enterCommandMode();
    e.preventDefault();
    return;
  }
}

// ── Command mode ─────────────────────────────────────────────────────────────
function enterCommandMode() {
  setMode("command");
  const stateRow = document.querySelector(".shell-statusbar-state");
  if (!stateRow) return;
  stateRow.innerHTML = `
    <span class="shell-status-state shell-status-state--command">
      <span class="shell-cmd-prompt">:</span><input class="shell-cmd-input" type="text" autocomplete="off" spellcheck="false">
    </span>
    <span class="shell-status-mode shell-status-mode--command" id="shell-status-mode">-- COMMAND --</span>
    <span class="shell-status-time" id="shell-status-time"></span>
  `;
  const input = stateRow.querySelector(".shell-cmd-input");
  input.focus();
}

function exitCommandMode() {
  setMode("normal");
  const stateRow = document.querySelector(".shell-statusbar-state");
  if (!stateRow) return;
  stateRow.innerHTML = `
    <span class="shell-status-state" id="shell-status-state">⏵ ready</span>
    <span class="shell-status-mode  shell-status-mode--normal" id="shell-status-mode">-- NORMAL --</span>
    <span class="shell-status-time"  id="shell-status-time"></span>
  `;
}

function onCommandKey(e) {
  const input = e.target;
  if (e.key === "Escape") {
    e.preventDefault();
    exitCommandMode();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    executeCommand(input.value.trim());
    exitCommandMode();
    return;
  }
  if (e.key === "Backspace" && input.value === "") {
    e.preventDefault();
    exitCommandMode();
    return;
  }
}

function executeCommand(raw) {
  if (!raw) return;
  const [name, ...rest] = raw.split(/\s+/);
  const arg = rest.join(" ");
  switch (name) {
    case "e":
      if (arg) handlers.onCommandE?.(arg);
      break;
    case "q":
      handlers.onCommandQ?.();
      break;
    case "home":
      handlers.onCommandHome?.();
      break;
    default:
      flashStatus(`not a command: ${name}`);
  }
}

// ── Error flash ──────────────────────────────────────────────────────────────
// One cancelable timer. The state cell's resting value is always "⏵ ready"
// (the shell template and exitCommandMode both set it), so we reset to that
// rather than capturing-and-restoring — which let a mid-flash Esc restore
// stale text. Exported so every flash path (including the entry file) shares
// this single cancelable mechanism.
let flashTimer = null;

export function flashStatus(msg) {
  if (flashTimer) clearTimeout(flashTimer);
  // Defer one tick so the message lands in the rebuilt #shell-status-state
  // after command mode exits (executeCommand runs before exitCommandMode).
  flashTimer = setTimeout(() => {
    const stateEl = document.getElementById("shell-status-state");
    if (!stateEl) { flashTimer = null; return; }
    stateEl.textContent = `! ${msg}`;
    stateEl.classList.add("shell-status-state--error");
    flashTimer = setTimeout(() => {
      stateEl.textContent = "⏵ ready";
      stateEl.classList.remove("shell-status-state--error");
      flashTimer = null;
    }, 2000);
  }, 0);
}

export function clearErrorFlash() {
  if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
  const el = document.getElementById("shell-status-state");
  if (el && el.classList.contains("shell-status-state--error")) {
    el.classList.remove("shell-status-state--error");
    el.textContent = "⏵ ready";
  }
}

// ── Mode + pane state ────────────────────────────────────────────────────────
function setMode(m) {
  mode = m;
  const chip = document.getElementById("shell-status-mode");
  if (chip) {
    chip.textContent = `-- ${m.toUpperCase()} --`;
    chip.className = "shell-status-mode shell-status-mode--" + m;
  }
}

function setFocusedPane(key) {
  focusedPane = key;
  document.querySelectorAll(".shell-pane").forEach((p) => {
    p.classList.toggle("is-focused", p.dataset.pane === key);
  });
  handlers.onFocusChange?.(key);
  rerenderKeymap();
}

export function getMode()        { return mode; }
export function getFocusedPane() { return focusedPane; }

// Mouse anywhere outside the command input cancels command mode.
function onMouseDown(e) {
  if (mode !== "command") return;
  if (e.target.closest(".shell-cmd-input")) return;
  exitCommandMode();
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function isEditable(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const t = (el.type || "").toLowerCase();
    return ["text", "search", "email", "url", "tel", "number", "password", ""].includes(t);
  }
  return false;
}
