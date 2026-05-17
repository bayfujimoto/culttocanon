---
title: Cult to Canon — as-built architecture
date: 2026-05-17
status: current
supersedes: build-plan_260515.md, versioning-implementation_260515.md
related: cult-to-canon-report_250515.md, admin-gate_260517.md, image-pipeline-plan_260516.md (archived)
---

# As-built architecture

A single up-to-date reference for how the site is structured. The conceptual brief lives in `cult-to-canon-report_250515.md`; this doc describes the shipped implementation as of v0.1.0 of the site thesis (`ESS-2026-000`). Earlier planning artifacts — `build-plan_260515.md` (removed in commit `eaf8207`), `versioning-implementation_260515.md` (same), and `image-pipeline-plan_260516.md` (archived, ready to remove) — are superseded by this document.

## 1. One paragraph

Cult to Canon is a Vite-built single-page application with three entry points — `/`, `/admin`, `/gate` — served from the same `dist/` directory by Netlify, with admin writes brokered through a Netlify Function that commits to GitHub via the Git Data API. Posts are markdown files with YAML front-matter, stored one-per-folder in `src/content/posts/<id-slug>/post.md` alongside their image sources; build-time Vite plugins generate dither/quant/optimized derivatives and stamp the topbar with the thesis version. The `/admin` route is hard-gated by a WebAuthn passkey via a Netlify Edge Function; a successful press-and-hold ceremony at `/gate` issues a stateless HMAC-signed session cookie. The browser-side admin uses vim-style modes for navigation, a forced bump picker for versioning, and an image queue that piggybacks binary uploads onto the same atomic commit that writes the post.

## 2. Entry points and routing

```
URL              File                                Theme              Edge gate
─────            ─────                               ─────              ─────
/                index.html  → src/public/main.js    data-theme=public  no
/admin           admin.html  → src/admin/main.js     data-theme=admin   YES
/admin/*         admin.html  (admin SPA router)      data-theme=admin   YES
/admin.html      admin.html                          data-theme=admin   YES
/gate            gate.html   → src/gate/main.js      data-theme=admin   no (it IS the gate)
/api/commit-all  netlify/functions/commit-all.js     —                  function checks session
/api/passkey/*   netlify/functions/passkey-*.js      —                  no (the ceremony itself)
/api/logout      netlify/functions/logout.js         —                  no
/*               index.html  (public SPA router)     data-theme=public  no
```

Public uses History API URLs (`/{slug}` or `/{id}`). Admin uses hash URLs (`#/edit/<id>`, `#/new`) so its routing never round-trips the server. `netlify.toml` wires the rewrites; the SPA catch-all is last so `/api/*` is not swallowed.

The Edge Function at `netlify/edge-functions/admin-gate.js` runs *before* the rewrites on `/admin`, `/admin/*`, `/admin.html`. It performs a pure HMAC + exp check on the `ctc_sess` cookie and either passes through to the rewrite or redirects to `/gate`. There is no Blobs or network round trip in the gate — the session token is signed precisely so this check stays a constant-time crypto operation. See `admin-gate_260517.md`.

## 3. Vite build

`vite.config.js` declares three Rollup inputs (`index.html`, `admin.html`, `gate.html`) and registers three plugins:

- `githubWritePlugin` (`src/admin/plugin/github-write.js`) — dev-only middleware on `/api/commit-all` that writes staged files (text and base64-binary) directly to the source tree, plus serves `/content/posts/*/images/*` from disk. The production equivalent is `netlify/functions/commit-all.js`.
- `thesisVersionPlugin` (`vite-plugin-thesis-version.js`) — at config time, finds the post whose `id` is `ESS-2026-000`, validates its `version` against `/^\d+\.\d+\.\d+$/`, and exposes the value as the build-time global `__THESIS_VERSION__`. Build fails if the thesis post is missing or malformed.
- `imageDitherPlugin` (`build/vite-plugin-image-dither.js`) — at build time, walks `src/content/posts/*/images/` and uses `sharp` to produce eight derivatives per source (see §6). In dev, also serves the source tree under `/content/posts/*/images/*`.

The public path `publicDir: "public"` serves `public/fonts/` (Commit Mono woff2). All output lands in `dist/`.

## 4. Shell

The TUI shell at `src/shell/render-shell.js` + `src/shell/shell.css` is rendered fresh for both public and admin. It draws an outer topbar (`CULT_TO_CANON v__THESIS_VERSION__`), three side-by-side panes with two draggable vertical gutters, a per-pane footer keymap legend, and a global statusbar containing the mode chip and command-mode input.

Default proportions are 30/45/25 (left/center/right), tuned per pane via the CSS custom properties `--pane-a-w` / `--pane-c-w` in `src/styles/tokens.css`. Pane widths and a per-pane collapsed state persist to `localStorage`. The right pane (Marginalia) collapses to a right-edge strip with a rotated label; clicking the strip or pressing `m` re-expands.

Pane keys differ per side:

- Public: `[b] Browse / [r] Read / [m] Marginalia`
- Admin:  `[i] Index / [m] Manuscript / [d] Dispatch`

The vim mode engines are separate (`src/public/lib/modes.js`, `src/admin/lib/modes.js`) but share the statusbar render and the help-overlay (`?`) toggle exposed from `render-shell.js`.

## 5. Content model

### Folder layout

Each post is a folder, not a file:

```
src/content/posts/<ID-slug>/
    post.md                  the post itself (front-matter + body)
    images/
        <name>.<ext>         author-uploaded source (committed)
        <name>.dither.png    build-time derivative (gitignored)
        <name>.dither@2x.png
        <name>.quantBw.png
        <name>.quantBw@2x.png
        <name>.quant.png
        <name>.quant@2x.png
        <name>.optimized.jpg
        <name>.optimized@2x.jpg
```

The folder co-locates a post with its image sources so deletion removes both. The post-loader (`src/lib/post-loader.js`) globs `src/content/posts/*/post.md` and validates each against the schema in `src/lib/vocabularies.js`. Errors are non-fatal — they log to the console — so a malformed in-progress post never blocks the build.

### Schema

Defined as plain arrays in `src/lib/vocabularies.js`; this is the single source of truth that the validator, the admin form, and Marginalia all read.

| Field        | Vocabulary                                                             | Source           |
|--------------|------------------------------------------------------------------------|------------------|
| `id`         | `{ESS\|FRG\|NOT\|REV\|FIC}-YYYY-NNN`                                    | `src/lib/id.js`  |
| `version`    | semver; first publish `0.1.0`                                          | bump picker      |
| `status`     | `draft` / `stable` / `dormant` / `abandoned`                           | `STATUS`         |
| `kind`       | `essay` / `fragment` / `note` / `review` / `fiction`                   | `KIND`           |
| `register`   | `academic` / `belletristic` / `plainspoken` / `discursive` / `polemical` | `REGISTER`     |
| `confidence` | `log` / `unlikely` / `possible` / `likely` / `highly-likely` / `certain` | `CONFIDENCE`   |
| `visibility` | `public` / `unlisted` / `private`                                      | `VISIBILITY`     |
| `subjects`   | open folksonomy, slug format                                           | author           |
| `links`      | array of post IDs                                                      | author           |

The 3-letter kind code (`KIND_SHORT` in the same file) is the post-ID prefix; one source of truth so the index column and the ID never drift.

### `-000` convention and the topbar

The zeroth sequence index of any kind — `ESS-YYYY-000`, `FRG-YYYY-000`, etc. — is reserved for site-framing meta-posts. The ID generator starts at `001` so the `-000` slot is never auto-assigned; it is only ever filled deliberately. The site thesis at `ESS-2026-000` is the only such document at v0.1.0.

The topbar string is bound to the thesis's `version` front-matter field via `thesisVersionPlugin`. When the thesis bumps, the topbar bumps. Wire is build-time; restart the dev server to see a bump in dev.

## 6. Image pipeline

Authoring stays one-paste-or-drag simple; the dither and its bit-depth derivatives are generated at deploy time; the runtime upgrades dither rest-states into interactive canvases via progressive enhancement. Readers without JavaScript see the dither — that *is* the canonical body-text representation.

### Markdown syntax

Standard markdown with optional Pandoc-style attributes:

```markdown
![alt](images/figure-1.jpg)              default: dither + click-reveal
![alt](images/chart.png){.no-dither}     plain <img> at the optimized JPEG
![alt](images/cover.jpg){.no-reveal}     dither only, no color reveal
![alt](images/hero.jpg){.full}           escape the body column (orthogonal)
```

Parsed by the marked extension at `src/markdown/image-attributes.js`; emitted by `src/markdown/image-renderer.js`.

### Build-time

`build/vite-plugin-image-dither.js` walks `src/content/posts/*/images/`, uses `sharp` to produce:

- 1-bit Bayer 4×4 dither (paper `#d5d8db`, ink `#073642`) at 600 / 1200 px wide
- 4-tone quantBw at the same widths
- 8-color quant at the same widths
- mozjpeg-encoded optimized source at the same widths

Skips re-processing when source mtimes haven't changed. `npm run dither <path>` runs the algorithm against a single file via the companion CLI at `build/dither.js`.

### Runtime enhancer

`src/runtime/ctc-image-reveal.js` finds every `<img class="ctc-dither">` and registers it with a shared `IntersectionObserver` (rootMargin 200px). When an image enters the viewport it is replaced with a `<canvas>` of identical dimensions, the dither PNG is drawn in, mouse/click/keyboard handlers attach, and the other three layers lazy-load on first click. Click animates a per-cell reveal through dither → quantBw → quant → optimized over 625 ms; click again reverses.

Mobile and iOS Safari each got their own pixel-correctness work: on `(hover: hover) = false` devices the hover-trail buffer is skipped entirely; on iOS the canvas is sized to device-pixel dimensions to defeat WebKit's tiled-canvas nearest-neighbor bug, with a post-draw threshold pass to snap pixels back to exactly INK or PAPER. PNGs ship with an embedded sRGB iCCP chunk so iOS doesn't mis-tag them as Display P3.

### Authoring loop

The admin's Manuscript pane (`src/admin/forms/post-form.js`) listens for `paste` and `drop` on the body textarea. Both routes go through `src/admin/lib/image-queue.js`, which validates type/size, base64-encodes the blob, and stores `(filename, {blob, base64, postSlug})`. The next commit bundles the queue alongside the `.md` file into a single Git Data API call (`netlify/functions/commit-all.js`).

## 7. Versioning

Every commit bumps the post's `version` — there is no commit-without-bump. The diff is the note.

### The bump picker

The version decision is made **per post, at save time** — not once for the whole commit batch. Saving a post (the Manuscript Save button, or `:update` on a dirty form) opens the statusbar picker (`src/admin/lib/bump-picker.js`):

- **Editing** an existing post → `openBumpPicker`: classify the change as **patch** (+0.0.1), **minor** (+0.1.0), or **major** (+1.0.0), each shown as the post's current → target version.
- A **new** post → `openStartVersionPicker`: choose the starting version, **v0.1.0** (work-in-progress) or **v1.0.0** (canon-on-arrival).

Until an option is chosen the change is not staged; cancel (Esc) leaves the form dirty and unstaged. The choice rides on the pending change as `bump`/`startVersion` (see `src/admin/state.js`) and is shown in the Dispatch row.

Final dispatch — `:update` with no dirty form open, or the Dispatch "update N" button — commits every pending change using the version decision it already carries. There is **no batch picker**; `triggerCommit()` takes no category. An `edit` change that somehow lacks a `bump` defaults to `patch` with a flashed warning.

The bump arithmetic itself is in `src/admin/lib/version.js`:

```
bumpVersion(current, category)     →  new semver
bumpCategoryBetween(prev, next)    →  "major" | "minor" | "patch"
```

### History sidecar files

Each post that has ever been revised gets a sidecar file at `src/content/history/<ID>.json`:

```json
{
  "id": "ESS-2026-001",
  "versions": [
    { "version": "0.1.0", "category": "initial", "revised": "2026-05-01",
      "words": 1200, "body": "…prior markdown…" }
  ]
}
```

`versions` is append-only, oldest first. Each entry is the post body **as it was before** the revision that produced the next state — the current live text is always the `.md` file, never duplicated into history. The category recorded on an entry is the one that *produced* that snapshot's version (Model A semantic): `"initial"` for the first publish, `"patch" | "minor" | "major"` thereafter.

`src/lib/history.js` exposes loaders; `src/lib/line-diff.js` is the diff algorithm used by Marginalia's inline diff view.

### Marginalia as version browser

On both public and admin sides, the Marginalia pane lists every version of the open post (number + date + category) and renders an inline diff against the immediate predecessor on selection. There is no separate archive post, no version-specific file — Marginalia is the only surface for prior versions, and each version is reachable via a stable URL through it.

## 8. Tree view

`src/lib/tree-view.js` is a shared collapsible-tree component, originally modeled on the bayfujimoto.com admin's Explorer pane. It is instance-based, persists expand state to `localStorage`, decouples cursor and selection, and rebinds its click handler when the host view swaps the mount element. Both Index (admin) and Browse (public, tree mode) delegate to it; Browse's flat mode is its own render path. `h`/`l` (or arrow keys) collapse and expand a branch in both panes.

Styling lives in `src/styles/tree-view.css`: compact, token-themed, full-pane highlight, no transition, no accent bar — the bayfujimoto Explorer look.

## 9. Admin write path

The admin never talks to GitHub directly. Both dev and production POST staged file writes to the same path, `/api/commit-all`:

- **Dev** (`vite dev`): `src/admin/plugin/github-write.js` is a Vite middleware that writes the payload to disk directly. No GitHub round trip; instant.
- **Dev** (`netlify dev`): the Netlify Function fields it; behavior matches production.
- **Production**: `netlify/functions/commit-all.js` performs the canonical multi-file Git Data API sequence —
  1. `GET /git/ref/heads/<branch>` for the current commit SHA
  2. `GET /git/commits/<sha>` for the tree SHA
  3. `POST /git/blobs` per file (binary as `encoding: "base64"`)
  4. `POST /git/trees` with `base_tree`
  5. `POST /git/commits` with the parent
  6. `PATCH /git/refs/heads/<branch>` to advance the pointer

This is the only privileged action the site exposes. It is gated by the same passkey session cookie as `/admin` — the function checks the cookie before any GitHub call and returns 401 on absence.

## 10. Themes

Two palettes live in `src/styles/tokens.css`, scoped by `[data-theme="public"]` vs `[data-theme="admin"]`:

- **Public** — cool light grey paper `#d5d8db` with Solarized accents (`#073642` ink, `#268bd2` blue, `#cb4b16` orange, etc.). Inherited from bayfujimoto.com's admin.
- **Admin** — IBM 5151 phosphor green on black: `#000000` bg, `#33ff33` fg, amber `#ffb000` for warnings, red `#ff3030` for errors. New for this project — the chiasmus of paper-public and phosphor-admin is itself part of the framing.

`:theme <name>` swaps palettes at runtime via the admin's mode engine for one-off testing.

## 11. Build phases (historical)

Phases 0–3 were the original build plan in `build-plan_260515.md` (since removed); Phase 4 is the iteration window that has been running since.

- **Phase 0 — Foundation** (commit `6cf7c9e`). Vite two-entry build, Netlify config, design tokens, shared three-pane shell.
- **Phase 1 — Content model** (same commit). Vocabularies, ID/slug helpers, front-matter parser, glob loader, marked renderer, four stub posts.
- **Phase 2 — Public site** (same commit). History-API router, vim modes, Browse tree/flat, Marginalia paratext.
- **Phase 3 — Admin port** (same commit). Hash router, admin vim engine, Index/Manuscript/Dispatch panes, dev plugin + Netlify Function on `/api/commit-all`.
- **Phase 4 — Iteration** (every commit since). Major work: ID taxonomy with semantic prefixes (`e816317`); thesis versioning system (`ab70e65`); shared tree-view (`eaf8207`); per-post image directories + dither pipeline (`f6925be` plus a long iOS Safari correctness chain through `65dcae2`); 3-column shell rework + hover-trail reveal (`474bb08`); WebAuthn passkey gate (`fd092a8`); schema vocabulary refinement (`4e9aefa`); default pane width tuning (`31a44d7`).

## 12. Source-of-truth pointers

When the architecture description and the code drift, the code wins. Authoritative locations:

- Schema vocabularies: `src/lib/vocabularies.js`
- Routing rewrites and gate paths: `netlify.toml`
- Vite plugin registration: `vite.config.js`
- Edge gate logic: `netlify/edge-functions/admin-gate.js`
- Session token contract: `netlify/lib/session.js`
- Versioning arithmetic: `src/admin/lib/version.js`
- History file shape: `src/lib/history.js` (the header comment)
- Image attribute classes: `src/markdown/image-attributes.js`
- Dither derivative names: `build/vite-plugin-image-dither.js`
