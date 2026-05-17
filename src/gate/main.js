// ── Gate entry point ─────────────────────────────────────────────────────────
// Wires the press-and-hold canvas to the passkey ceremony. Completing the hold
// fires the WebAuthn handshake; a verified assertion sets the session cookie
// server-side and we redirect to /admin. A rejected/failed ceremony resets the
// canvas so the rite can be retried.
//
// /gate?register runs the one-time registration ceremony instead (only
// succeeds when the server's ALLOW_REGISTRATION flag is set).

import "./gate.css";
import { initGate } from "./gate-canvas.js";
import { runPasskey, runRegistration } from "./passkey.js";

const statusEl = document.getElementById("status");
const isRegister = new URLSearchParams(location.search).has("register");
const ceremony = isRegister ? runRegistration : runPasskey;

let busy = false;
let gate;

function showStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.add("show");
  statusEl.classList.toggle("error", !!isError);
}

function clearStatus() {
  statusEl.classList.remove("show", "error");
  setTimeout(() => { statusEl.textContent = ""; }, 400);
}

async function onSuccess() {
  if (busy) return;
  busy = true;
  showStatus(isRegister ? "registering…" : "authenticating…", false);
  try {
    await ceremony();
    showStatus(isRegister ? "✓ registered" : "✓ unlocked", false);
    if (isRegister) {
      busy = false;
    } else {
      location.replace("/admin");
    }
  } catch (e) {
    console.error("[gate] ceremony failed:", e);
    showStatus(`✗ ${e?.message || "rejected"} — hold to retry`, true);
    busy = false;
    gate.reset();
  }
}

gate = initGate({ onSuccess, onReset: clearStatus });
