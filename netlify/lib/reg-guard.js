// ── Registration guard ───────────────────────────────────────────────────────
// The register endpoints OVERWRITE the single primary credential, so they are
// dangerous if reachable. They are inert unless ALLOW_REGISTRATION=true. The
// one-time production passkey is created by setting that flag, deploying,
// registering at /gate?register, then unsetting the flag and redeploying.
//
// Returns null when registration is permitted, or an error response object
// (same shape commit-all uses) when it must be refused.

export function registrationRefusal() {
  if (process.env.ALLOW_REGISTRATION === "true") return null;
  return {
    statusCode: 403,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, error: "Registration is disabled" }),
  };
}
