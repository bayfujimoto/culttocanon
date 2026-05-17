// ── Admin mode engine ────────────────────────────────────────────────────────
// Vim-style modal navigation for the admin TUI. Modes:
//
//   normal   — letter keys fire actions. i/m/d switch focused pane.
//              j/k navigate the Index list. Enter opens.
//              `:` enters command mode. `?` toggles help (deferred).
//   insert   — an editable field has focus; keys flow to it. Esc → normal.
//   command  — the statusbar's state row is replaced with an input. The user
//              types `:update`, `:q`, `:new`, `:e <id>`, etc.
//
// Auto-transitions: focusing any editable input flips NORMAL → INSERT;
// blurring takes INSERT → NORMAL. The COMMAND-mode input is excluded so it
// doesn't trigger auto-INSERT.

import {
  rerenderKeymap,
  toggleHelp,
  closeHelp,
  isHelpOpen,
} from "../../shell/render-shell.js";

let mode             = "normal";
let focusedPane      = "i";
let handlers         = {};
let listenersAttached = false;

function isMobile() {
  return window.matchMedia("(max-width: 700px)").matches;
}

// ── Init ─────────────────────────────────────────────────────────────────────
/**
 *   handlers = {
 *     onFocusChange(paneKey),
 *     onIndexNav('up'|'down'|'open'),
 *     onUpdate():         save the open form (if any) and gate commit through
 *                         the bump-picker (:update)
 *     onQ():              close the current post
 *     onNew():            new post
 *     onE(arg):           :e <id> — open by id
 *   }
 */
export function initModes(h = {}) {
  handlers = h;
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener("keydown",  onKeyDown, true);
  document.addEventListener("focusin",  onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  document.addEventListener("mousedown", onMouseDown);
  wirePaneFocus();
  setFocusedPane(focusedPane);
  setMode("normal");
}

function wirePaneFocus() {
  document.querySelectorAll(".shell-pane[data-pane]").forEach((pane) => {
    pane.addEventListener("mousedown", () => {
      const key = pane.dataset.pane;
      if (key) setFocusedPane(key);
    });
  });
}

// ── Auto-transitions on focus ────────────────────────────────────────────────
function onFocusIn(e) {
  if (isMobile()) return;
  if (mode === "command") return;
  if (isUserEditable(e.target)) setMode("insert");
}

function onFocusOut(e) {
  if (isMobile()) return;
  if (mode === "command") return;
  if (isUserEditable(e.target)) {
    queueMicrotask(() => {
      if (!isUserEditable(document.activeElement) && mode === "insert") {
        setMode("normal");
      }
    });
  }
}

// ── Keydown ──────────────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (isMobile()) return;

  // Inside a non-command editable, leave keys alone.
  if (isEditable(e.target) && !e.target.classList.contains("shell-cmd-input")) {
    // Allow Esc to drop INSERT and return to NORMAL by blurring.
    if (mode === "insert" && e.key === "Escape") {
      e.target.blur();
      e.preventDefault();
    }
    return;
  }

  if (mode === "command") {
    return onCommandKey(e);
  }

  // Picker mode (bump-picker open) — the picker installs its own capture-
  // phase listener and owns all keystrokes. modes.js stays out of the way.
  if (mode === "picker") {
    return;
  }

  // Normal mode
  // Help overlay toggle. This document handler is capture-phase, so it runs
  // before the overlay's own keydown — toggleHelp() handles both open and
  // close from here; the overlay's listener is a redundant safety net.
  if (e.key === "?") {
    toggleHelp();
    e.preventDefault();
    return;
  }

  // Esc — if the overlay is open, close it; otherwise return focus to the
  // primary pane (Index) and clear any error flash.
  if (e.key === "Escape") {
    e.preventDefault();
    if (isHelpOpen()) { closeHelp(); return; }
    clearErrorFlash();
    setFocusedPane("i");
    return;
  }

  if (e.key === "i" || e.key === "m" || e.key === "d") {
    setFocusedPane(e.key);
    e.preventDefault();
    return;
  }

  if (focusedPane === "i") {
    if (e.key === "j" || e.key === "ArrowDown") {
      handlers.onIndexNav?.("down");
      e.preventDefault();
      return;
    }
    if (e.key === "k" || e.key === "ArrowUp") {
      handlers.onIndexNav?.("up");
      e.preventDefault();
      return;
    }
    if (e.key === "h" || e.key === "ArrowLeft") {
      handlers.onIndexNav?.("collapse");
      e.preventDefault();
      return;
    }
    if (e.key === "l" || e.key === "ArrowRight") {
      handlers.onIndexNav?.("expand");
      e.preventDefault();
      return;
    }
    if (e.key === "Enter") {
      handlers.onIndexNav?.("open");
      e.preventDefault();
      return;
    }
  }

  if (e.key === ":") {
    enterCommandMode();
    e.preventDefault();
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
  stateRow.querySelector(".shell-cmd-input").focus();
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
  }
}

function executeCommand(raw) {
  if (!raw) return;
  const [name, ...rest] = raw.split(/\s+/);
  const arg = rest.join(" ");
  switch (name) {
    case "update": handlers.onUpdate?.(); break;
    case "q":      handlers.onQ?.(); break;
    case "new":    handlers.onNew?.(); break;
    case "e":      if (arg) handlers.onE?.(arg); break;
    case "theme":  handlers.onTheme?.(arg); break;
    case "help":   flashStatus("help is not yet implemented"); break;
    default:       flashStatus(`not a command: ${name}`);
  }
}

// ── Error flash ──────────────────────────────────────────────────────────────
// One cancelable timer; resets to the canonical resting text "⏵ ready" rather
// than capturing-and-restoring (which let a mid-flash Esc restore stale text).
// Exported so every flash path (incl. the entry file) shares this mechanism.
let flashTimer = null;

export function flashStatus(msg) {
  if (flashTimer) clearTimeout(flashTimer);
  // Defer one tick so the message lands in the rebuilt #shell-status-state
  // after command mode exits (executeCommand runs before exitCommandMode).
  flashTimer = setTimeout(() => {
    const el = document.getElementById("shell-status-state");
    if (!el) { flashTimer = null; return; }
    el.textContent = `! ${msg}`;
    el.classList.add("shell-status-state--error");
    flashTimer = setTimeout(() => {
      el.textContent = "⏵ ready";
      el.classList.remove("shell-status-state--error");
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

// ── Setters ──────────────────────────────────────────────────────────────────
export function setMode(m) {
  mode = m;
  const chip = document.getElementById("shell-status-mode");
  if (chip) {
    chip.textContent = `-- ${m.toUpperCase()} --`;
    chip.className   = "shell-status-mode shell-status-mode--" + m;
  }
}

export function setFocusedPane(key) {
  focusedPane = key;
  // If the target pane is collapsed, expand it before focusing.
  const targetPane = document.getElementById(`pane-${key}`);
  if (targetPane?.classList.contains("is-collapsed")) {
    targetPane.click();
  }
  document.querySelectorAll(".shell-pane").forEach((p) => {
    p.classList.toggle("is-focused", p.dataset.pane === key);
  });
  handlers.onFocusChange?.(key);
  rerenderKeymap();
}

export function getMode()        { return mode; }
export function getFocusedPane() { return focusedPane; }

// Clicking outside the command bar cancels command mode.
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
    return ["text", "search", "email", "url", "tel", "number", "password", "date", ""].includes(t);
  }
  return false;
}

function isUserEditable(el) {
  return isEditable(el) && !el.classList.contains("shell-cmd-input");
}
