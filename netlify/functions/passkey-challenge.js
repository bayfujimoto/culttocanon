// ── Netlify Function: /api/passkey/challenge ─────────────────────────────────
// Issues WebAuthn authentication options for the single registered credential.
// The challenge is persisted to the `challenges` Blob under a random opaque
// `cid` with a 120s expiry; passkey-verify reads it back by `cid` and deletes
// it (single-use). Returns { options, cid }.

import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { getRP } from "../lib/rp.js";
import { passkeysStore, challengesStore, PRIMARY_KEY } from "../lib/store.js";

const CHALLENGE_TTL_MS = 120_000;

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return resp(405, { ok: false, error: "Method not allowed" });
  }

  const { rpID } = getRP();

  const cred = await passkeysStore().get(PRIMARY_KEY, { type: "json" });
  if (!cred) {
    return resp(409, { ok: false, error: "No passkey registered" });
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [{ id: cred.credentialID, transports: cred.transports }],
    userVerification: "preferred",
  });

  const cid = crypto.randomUUID();
  await challengesStore().setJSON(cid, {
    challenge: options.challenge,
    exp: Date.now() + CHALLENGE_TTL_MS,
    kind: "auth",
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
