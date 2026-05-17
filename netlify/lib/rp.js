// ── WebAuthn relying-party config ────────────────────────────────────────────
// A passkey is bound to its rpID; the verifier must pin rpID + expectedOrigin
// to the exact host the credential was created against. Production values come
// from env (set in Netlify site settings); with nothing set we fall back to
// localhost so `netlify dev` works with no configuration.
//
//   WEBAUTHN_RP_ID            e.g. "culttocanon.com"
//   WEBAUTHN_RP_NAME          e.g. "Cult to Canon"
//   WEBAUTHN_EXPECTED_ORIGIN  e.g. "https://culttocanon.com"

export function getRP() {
  const rpID = process.env.WEBAUTHN_RP_ID || "localhost";
  const rpName = process.env.WEBAUTHN_RP_NAME || "Cult to Canon";
  const expectedOrigin =
    process.env.WEBAUTHN_EXPECTED_ORIGIN || "http://localhost:8888";
  return { rpID, rpName, expectedOrigin };
}
