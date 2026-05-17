// ── Netlify Function: /api/passkey/verify ────────────────────────────────────
// Verifies a WebAuthn assertion against the stored credential and the
// single-use challenge keyed by `cid`. On success: bumps the stored sign
// counter (replay protection), issues an 8h signed session cookie, returns
// { ok: true }. On any failure: 401, no cookie.
//
// Body: { cid, assertion }  (assertion = the AuthenticationResponseJSON)

import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { getRP } from "../lib/rp.js";
import { passkeysStore, challengesStore, PRIMARY_KEY } from "../lib/store.js";
import { signSession, cookieString } from "../lib/session.js";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return resp(405, { ok: false, error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return resp(400, { ok: false, error: "Invalid JSON body" });
  }

  const { cid, assertion } = body;
  if (!cid || !assertion) {
    return resp(400, { ok: false, error: "Missing cid or assertion" });
  }

  const { rpID, expectedOrigin } = getRP();
  const challenges = challengesStore();

  const record = await challenges.get(cid, { type: "json" });
  // Single-use: delete regardless of outcome so a challenge can't be replayed.
  await challenges.delete(cid);
  if (!record || record.kind !== "auth" || record.exp <= Date.now()) {
    return resp(401, { ok: false, error: "Challenge expired or invalid" });
  }

  const passkeys = passkeysStore();
  const cred = await passkeys.get(PRIMARY_KEY, { type: "json" });
  if (!cred) {
    return resp(409, { ok: false, error: "No passkey registered" });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: record.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: cred.credentialID,
        publicKey: new Uint8Array(Buffer.from(cred.publicKey, "base64")),
        counter: cred.counter ?? 0,
        transports: cred.transports,
      },
    });
  } catch (e) {
    return resp(401, { ok: false, error: e.message });
  }

  if (!verification.verified) {
    return resp(401, { ok: false, error: "Assertion not verified" });
  }

  cred.counter = verification.authenticationInfo.newCounter;
  await passkeys.setJSON(PRIMARY_KEY, cred);

  const token = await signSession({ sub: "admin" });
  const secure = expectedOrigin.startsWith("https:");

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookieString(token, { secure }),
    },
    body: JSON.stringify({ ok: true }),
  };
}

function resp(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
