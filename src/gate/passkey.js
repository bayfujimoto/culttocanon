// ── Gate WebAuthn client ─────────────────────────────────────────────────────
// runPasskey()      authentication ceremony — the normal gate path.
// runRegistration() attestation ceremony — only reachable via /gate?register
//                   and only succeeds when the server's ALLOW_REGISTRATION
//                   flag is set.
//
// Each resolves on a verified server response and throws otherwise; the caller
// (main.js) maps success → redirect to /admin and failure → reset the canvas.

import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export async function runPasskey() {
  const { options, cid } = await postJSON("/api/passkey/challenge");
  const assertion = await startAuthentication({ optionsJSON: options });
  await postJSON("/api/passkey/verify", { cid, assertion });
}

export async function runRegistration() {
  const { options, cid } = await postJSON("/api/passkey/register/options");
  const attestation = await startRegistration({ optionsJSON: options });
  await postJSON("/api/passkey/register/verify", { cid, attestation });
}
