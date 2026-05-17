// ── Netlify Edge Function: admin-gate ────────────────────────────────────────
// The hard block in front of the admin editor. Runs before the netlify.toml
// rewrites on /admin, /admin/*, /admin.html. A valid, unexpired session cookie
// lets the request through to the existing rewrite (serves admin.html);
// anything else is redirected to /gate.
//
// Validation is a pure HMAC + exp check via the shared session lib — no Blobs
// or network round trip. That stateless design is the whole reason the session
// token is signed rather than a server-side session id.

import { readCookie, verifySession } from "../lib/session.js";

export default async function adminGate(request, context) {
  const cookie = request.headers.get("cookie");
  const token = readCookie(cookie);
  const payload = token ? await verifySession(token) : null;

  if (payload) return context.next();

  return Response.redirect(new URL("/gate", request.url), 302);
}

export const config = {
  path: ["/admin", "/admin/*", "/admin.html"],
};
