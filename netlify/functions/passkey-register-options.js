// ── Netlify Function: /api/passkey/register/options ──────────────────────────
// Issues WebAuthn registration options for the admin passkey. Guarded by
// ALLOW_REGISTRATION (see reg-guard.js) — overwriting the primary credential
// is destructive. The challenge is persisted under a random `cid` with the
// same 120s single-use contract as the auth challenge.

import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getRP } from "../lib/rp.js";
import { challengesStore } from "../lib/store.js";
import { registrationRefusal } from "../lib/reg-guard.js";

const CHALLENGE_TTL_MS = 120_000;

// Stable user handle for the single admin identity.
const ADMIN_USER_ID = new TextEncoder().encode("ctc-admin");

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return resp(405, { ok: false, error: "Method not allowed" });
  }

  const refusal = registrationRefusal();
  if (refusal) return refusal;

  const { rpID, rpName } = getRP();

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: ADMIN_USER_ID,
    userName: "admin",
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const cid = crypto.randomUUID();
  await challengesStore().setJSON(cid, {
    challenge: options.challenge,
    exp: Date.now() + CHALLENGE_TTL_MS,
    kind: "reg",
  });

  return resp(200, { ok: true, options, cid });
}

function resp(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
