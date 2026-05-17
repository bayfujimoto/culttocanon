// ── Stateless signed session token ───────────────────────────────────────────
// Issued by passkey-verify after a verified assertion; checked by the
// admin-gate Edge Function and by commit-all before any GitHub write.
//
// Token = b64url(JSON{sub,iat,exp}) "." b64url(HMAC_SHA256(payload, secret)).
// Validation recomputes the HMAC and checks exp — no Blobs/network round trip,
// so the Edge gate stays a pure crypto check.
//
// Web Crypto only (no Node APIs): the Edge runtime is Deno and imports this
// module verbatim. Secret rotation: signing always uses SESSION_SECRET;
// verification also accepts SESSION_SECRET_PREVIOUS so live sessions survive
// exactly one rotation, then expire naturally.
//
//   SESSION_SECRET           required, 32+ random bytes (openssl rand -base64 32)
//   SESSION_SECRET_PREVIOUS  optional, previous secret during a rotation

const COOKIE_NAME = "ctc_sess";
const MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours
const enc = new TextEncoder();

function b64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlEncodeString(str) {
  return b64urlEncode(enc.encode(str));
}

function b64urlDecodeToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlDecodeToString(s) {
  return new TextDecoder().decode(b64urlDecodeToBytes(s));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sig);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signSession({ sub = "admin", ttlSeconds = MAX_AGE_SECONDS } = {}) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ sub, iat: now, exp: now + ttlSeconds });
  const encodedPayload = b64urlEncodeString(payload);
  const sig = await hmac(secret, encodedPayload);
  return `${encodedPayload}.${b64urlEncode(sig)}`;
}

// Returns the decoded payload if the token is well-formed, the signature
// matches the current or previous secret, and it has not expired; else null.
export async function verifySession(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const encodedPayload = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);

  let providedBytes;
  try {
    providedBytes = b64urlDecodeToBytes(providedSig);
  } catch {
    return null;
  }

  const secrets = [process.env.SESSION_SECRET, process.env.SESSION_SECRET_PREVIOUS].filter(
    Boolean
  );
  let matched = false;
  for (const secret of secrets) {
    const expected = await hmac(secret, encodedPayload);
    if (timingSafeEqual(expected, providedBytes)) {
      matched = true;
      break;
    }
  }
  if (!matched) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecodeToString(encodedPayload));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

export function readCookie(cookieHeader, name = COOKIE_NAME) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

// `secure` is dropped only for localhost http so `netlify dev` can set the
// cookie over plain HTTP; everywhere else it stays Secure.
export function cookieString(token, { secure = true } = {}) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearCookieString({ secure = true } = {}) {
  const attrs = [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    "Max-Age=0",
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export { COOKIE_NAME };
