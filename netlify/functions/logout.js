// ── Netlify Function: /api/logout ────────────────────────────────────────────
// Clears the session cookie. The next /admin request fails the Edge gate and
// is redirected to /gate.

import { getRP } from "../lib/rp.js";
import { clearCookieString } from "../lib/session.js";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  const secure = getRP().expectedOrigin.startsWith("https:");

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearCookieString({ secure }),
    },
    body: JSON.stringify({ ok: true }),
  };
}
