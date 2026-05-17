---
title: Cult to Canon — admin passkey gate
date: 2026-05-17
status: current
related: architecture_260517.md
---

# Admin passkey gate

The `/admin` route and the `/api/commit-all` write endpoint are both protected by a single mechanism: a stateless HMAC-signed session cookie, issued only after a verified WebAuthn passkey assertion. There is no password, no email, no recovery flow. Losing the credential means re-registering from a trusted device with the one-time `ALLOW_REGISTRATION` flag set.

This doc describes the shipped implementation as of commit `fd092a8`.

## 1. Threat model

The admin can write to the repo by calling `/api/commit-all`, which holds a fine-grained GitHub PAT (`Contents: read & write` on `culttocanon` only). The PAT never leaves the server; it is only readable inside the Netlify Function. The gate's job is therefore narrow: prevent any unauthenticated request from reaching either the admin SPA's `localStorage` (which would leak in-progress drafts) or the commit endpoint (which would let an attacker write to the repo as Bay).

The model assumes:

- The attacker cannot read environment variables on Netlify.
- The attacker cannot register a new passkey unprompted (the registration flow is itself gated by `ALLOW_REGISTRATION`, a flag that is unset except during deliberate provisioning).
- The attacker cannot forge an HMAC-SHA256 signature without `SESSION_SECRET`.
- A reader without the passkey is not categorically distinguished from a reader of the public site. The gate is unremarkable, not adversarial.

## 2. Components

```
┌─────────────────────────────────────────────────────────────────┐
│ Reader's browser                                                │
│                                                                 │
│  /gate (gate.html → src/gate/main.js)                           │
│  ├─ src/gate/gate-canvas.js     press-and-hold dither canvas    │
│  └─ src/gate/passkey.js         WebAuthn ceremony driver        │
│                                                                 │
│  /admin (admin.html → src/admin/main.js)                        │
│  └─ ctc_sess cookie sent on every fetch (httpOnly)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │  HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Netlify Edge                                                    │
│  netlify/edge-functions/admin-gate.js                           │
│    pure HMAC + exp check; pass-through or 302 → /gate           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Netlify Functions                                               │
│  /api/passkey/challenge          one-time auth challenge        │
│  /api/passkey/verify             verify assertion, issue cookie │
│  /api/passkey/register/options   one-time registration setup    │
│  /api/passkey/register/verify    verify attestation, store cred │
│  /api/logout                     clear cookie                   │
│  /api/commit-all                 GitHub write (cookie-gated)    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Netlify Blobs                                                   │
│   passkeys/primary    the single registered credential          │
│   challenges/<cid>    short-lived single-use challenges         │
│                                                                 │
│ Local-dev fallback (BLOBS_DEV_SANDBOX=true)                     │
│   .netlify-blobs-dev/   filesystem sandbox via netlify/lib/fs-store.js │
└─────────────────────────────────────────────────────────────────┘
```

## 3. The session token

`netlify/lib/session.js` defines a stateless token:

```
Token = b64url(JSON{sub, iat, exp}) "." b64url(HMAC_SHA256(payload, secret))
```

Validation recomputes the HMAC and checks `exp` — no Blobs or network round trip — so the Edge gate stays a constant-time crypto check. The token is set as the `ctc_sess` cookie with `httpOnly; SameSite=Lax; Path=/`, plus `Secure` on HTTPS. Max age is 8 hours.

Signing uses `SESSION_SECRET`. Verification additionally accepts `SESSION_SECRET_PREVIOUS` so live sessions survive exactly one secret rotation, then expire naturally as their tokens TTL out. The module uses Web Crypto only (no Node APIs) because the Edge runtime is Deno and imports the same module verbatim.

## 4. Storage

Two Netlify Blobs stores:

- `passkeys/primary` — a single credential record `{ credentialID, publicKey (base64), counter, transports }`. The site is intentionally single-user; rather than support a multi-user table, the credential lives at a fixed key.
- `challenges/<cid>` — short-lived (≤2 min) single-use challenges, each tagged `{ kind: "auth" | "register", challenge, exp }`. Deleted after use regardless of outcome, so a challenge cannot be replayed.

Store resolution in `netlify/lib/store.js`:

1. `NETLIFY_SITE_ID` + `NETLIFY_BLOBS_TOKEN` set → explicit real Blobs. Used off-platform.
2. `BLOBS_DEV_SANDBOX=true` → `netlify/lib/fs-store.js` writes to `.netlify-blobs-dev/`. Used by unlinked `netlify dev`.
3. Otherwise `getStore(name)` → ambient real Blobs. Used by deployed Functions and `netlify dev` linked to the site.

`BLOBS_DEV_SANDBOX` is the only opt-in mechanism for the filesystem fallback, so production can never silently downgrade to it.

## 5. Authentication flow

The user lands on `/gate`. The press-and-hold canvas (`src/gate/gate-canvas.js`) dithers Bay's photo with the same Bayer pipeline as body images; completing a multi-second hold fires the `onSuccess` callback:

1. Browser → `POST /api/passkey/challenge`  
   Server generates a fresh challenge, stores it at `challenges/<cid>` with `kind: "auth"` and a 2-minute `exp`, returns `{ cid, challenge }`.
2. Browser → `navigator.credentials.get({ publicKey })`  
   The hardware key (or platform authenticator) signs the challenge.
3. Browser → `POST /api/passkey/verify { cid, assertion }`  
   Server: fetches `challenges/<cid>` and deletes it (single-use); checks `kind`, `exp`; fetches `passkeys/primary`; runs `@simplewebauthn/server`'s `verifyAuthenticationResponse` with the stored public key, the expected origin, the expected RPID; on success bumps the stored `counter` (replay protection), signs an 8-hour session token, sets `Set-Cookie: ctc_sess=…`.
4. Browser → `location.replace("/admin")` — the Edge Function now sees a valid cookie and lets the request through.

Failure at any step returns 401 with no cookie; the canvas resets so the rite can be retried.

## 6. Registration flow

Registration is *not* exposed to the public. It is reachable only by visiting `/gate?register` *and* having the server-side `ALLOW_REGISTRATION` flag set to `true` for that deploy. The flow mirrors authentication:

1. `POST /api/passkey/register/options` returns `{ cid, options }` (challenge + a fresh user handle).
2. `navigator.credentials.create({ publicKey })` runs the attestation ceremony locally.
3. `POST /api/passkey/register/verify { cid, attestation }` checks the challenge, runs `verifyRegistrationResponse`, and writes the resulting credential record to `passkeys/primary`. If `passkeys/primary` already exists, registration is rejected — there is one slot and replacement requires a deliberate Blobs delete.

After a single successful registration, `ALLOW_REGISTRATION` is unset on the Netlify dashboard. This is the only durable trust decision in the system.

## 7. Local dev

`.env` (gitignored) sets:

```
SESSION_SECRET=<random 32+ bytes>
BLOBS_DEV_SANDBOX=true
ALLOW_REGISTRATION=false
```

`netlify/lib/rp.js` falls back to RP ID `localhost` and origin `http://localhost:8888` when unset, which is what `netlify dev` serves. A credential registered locally is therefore bound to `localhost` and cannot authenticate against the real site — and vice versa. To exercise the gate end-to-end locally:

1. `ALLOW_REGISTRATION=true` in `.env`.
2. `npm run dev:netlify`.
3. Visit `http://localhost:8888/gate?register`, complete the registration ceremony.
4. `ALLOW_REGISTRATION=false`.
5. Visit `http://localhost:8888/gate`, complete the auth ceremony, get redirected to `/admin`.

The vanilla `npm run dev` (Vite alone) does not run the Edge Function or Functions at all; admin is reachable directly and saves go to disk via the dev plugin.

## 8. Why this shape

- **Stateless tokens** keep the Edge check fast and remove a hot path from Blobs.
- **httpOnly cookie** means the SPA never sees the token; XSS in the admin can't exfiltrate it.
- **Single-use challenges** prevent replay even if a TLS-terminating proxy is compromised mid-flight.
- **Single-credential store** matches the actual user model (one author, one device, occasionally rotated) without inventing a multi-user system that would never be exercised.
- **`ALLOW_REGISTRATION` flag** turns registration into a deliberate one-time action that requires server access to enable. There is no "forgot my passkey" link.
- **Same cookie for `/admin` and `/api/commit-all`** means the Edge check protects the document and the function check protects the action. Either gate alone would be insufficient: the Edge can't read the request body, the function can't intercept a directly-loaded admin SPA.

Further reading: Yubico's WebAuthn primer (<https://developers.yubico.com/WebAuthn/>); SimpleWebAuthn library docs (<https://simplewebauthn.dev/docs/>); Auth0's *Web Application Security* on stateless tokens; OWASP's *Authentication Cheat Sheet* §3 on signed-cookie session design.
