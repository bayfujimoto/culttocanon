// ── Netlify Function: /api/passkey/register/verify ───────────────────────────
// Verifies a WebAuthn attestation and writes it to passkeys/primary,
// overwriting any prior credential (re-registration needs no redeploy —
// Blobs is runtime state). Guarded by ALLOW_REGISTRATION.
//
// Body: { cid, attestation }  (attestation = the RegistrationResponseJSON)

import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getRP } from "../lib/rp.js";
import { passkeysStore, challengesStore, PRIMARY_KEY } from "../lib/store.js";
import { registrationRefusal } from "../lib/reg-guard.js";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return resp(405, { ok: false, error: "Method not allowed" });
  }

  const refusal = registrationRefusal();
  if (refusal) return refusal;

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return resp(400, { ok: false, error: "Invalid JSON body" });
  }

  const { cid, attestation } = body;
  if (!cid || !attestation) {
    return resp(400, { ok: false, error: "Missing cid or attestation" });
  }

  const { rpID, expectedOrigin } = getRP();
  const challenges = challengesStore();

  const record = await challenges.get(cid, { type: "json" });
  await challenges.delete(cid);
  if (!record || record.kind !== "reg" || record.exp <= Date.now()) {
    return resp(401, { ok: false, error: "Challenge expired or invalid" });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: attestation,
      expectedChallenge: record.challenge,
      expectedOrigin,
      expectedRPID: rpID,
    });
  } catch (e) {
    return resp(401, { ok: false, error: e.message });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return resp(401, { ok: false, error: "Attestation not verified" });
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  await passkeysStore().setJSON(PRIMARY_KEY, {
    credentialID: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: credential.transports,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    createdAt: new Date().toISOString(),
    rpID,
  });

  return resp(200, { ok: true });
}

function resp(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
