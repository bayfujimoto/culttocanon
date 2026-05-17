// ── Netlify Blobs accessors ──────────────────────────────────────────────────
// Two stores back the passkey gate:
//   passkeys/primary   the single registered credential record
//   challenges/<cid>   short-lived, single-use auth/registration challenges
//
// Resolution order:
//   1. NETLIFY_SITE_ID + NETLIFY_BLOBS_TOKEN set → explicit real Blobs
//      (off-platform / production with credentials).
//   2. BLOBS_DEV_SANDBOX=true → local filesystem sandbox (unlinked
//      `netlify dev`; opt-in only so production can never fall back to it).
//   3. otherwise getStore("name") → ambient real Blobs (deployed
//      Functions/Edge, or `netlify dev` against a linked site).

import { getStore } from "@netlify/blobs";
import { fsStore } from "./fs-store.js";

function store(name) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) return getStore({ name, siteID, token });
  if (process.env.BLOBS_DEV_SANDBOX === "true") return fsStore(name);
  return getStore(name);
}

export function passkeysStore() {
  return store("passkeys");
}

export function challengesStore() {
  return store("challenges");
}

export const PRIMARY_KEY = "primary";
