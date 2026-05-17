# Cult to Canon

A text-primary, TUI-aesthetic archive of essays, fragments, notes, reviews, and fiction, organized around the contested process by which marginal works become legitimate cultural property — and the apocryphal counterparts that gesture produces.

See `docs/cult-to-canon-report_250515.md` for the conceptual brief and `docs/architecture_260517.md` for the as-built architecture.

## Status

Phases 0–4 complete. The public site renders at `/` with vim-style modes, a tree/flat Browse, URL routing, Marginalia paratext, build-time dithered body images with click-to-reveal color, and per-post version history. The admin at `/admin` provides Index / Manuscript / Dispatch panes for editing, image paste/drop, and atomic GitHub commits, gated behind a WebAuthn passkey at `/gate`.

## Development

```sh
npm install
npm run dev          # vite dev server at http://localhost:8080
npm run dev:netlify  # netlify dev at http://localhost:8888 (gate + functions)
npm run build        # production build to dist/
npm run preview      # preview the built output
npm run dither <img> # run the image-dither pipeline against a single source
```

Use `npm run dev` for everyday public/admin work; in vanilla Vite the passkey gate is bypassed and admin saves write directly to disk via the `github-write` middleware. Use `npm run dev:netlify` when you need the gate, the Netlify Functions, or `.netlify-blobs-dev/` (the local Blobs sandbox).

Open `http://localhost:8080/` for the public side and `http://localhost:8080/admin.html` for the admin.

## Deployment

The site builds with `npm run build` to `dist/` and deploys to Netlify. The `netlify.toml` wires the function directory, the `/admin` Edge gate, the passkey + commit-all redirects, and the SPA catch-all.

### Environment variables

| Variable                   | Purpose                                                          |
|----------------------------|------------------------------------------------------------------|
| `SESSION_SECRET`           | HMAC key for signed session cookies (`openssl rand -base64 32`). |
| `SESSION_SECRET_PREVIOUS`  | Optional — accepted during a one-shot secret rotation.           |
| `ALLOW_REGISTRATION`       | Set to `true` only while registering a new passkey, then unset.  |
| `GITHUB_TOKEN`             | Fine-grained PAT, Contents R/W on this repo only.                |
| `GITHUB_OWNER`             | `bayfujimoto`.                                                   |
| `GITHUB_REPO`              | `culttocanon`.                                                   |
| `GITHUB_BRANCH`            | Optional, defaults to `main`.                                    |

The PAT is read only by `netlify/functions/commit-all.js`; it never leaves the server. The passkey gate is described in detail in `docs/admin-gate_260517.md`.

## Layout

```
CultToCanon/
├── index.html                public entry         (data-theme="public")
├── admin.html                admin entry          (data-theme="admin")
├── gate.html                 passkey gate         (data-theme="admin")
├── netlify.toml              build + redirects + edge gate + function dir
├── vite.config.js            three-entry Vite build; registers all plugins
├── vite-plugin-thesis-version.js   binds topbar version to ESS-2026-000
├── public/fonts/             Commit Mono woff2 files
├── build/
│   ├── dither.js                   Bayer 4×4 dither CLI (npm run dither)
│   └── vite-plugin-image-dither.js build-time image derivative generator
├── netlify/
│   ├── edge-functions/
│   │   └── admin-gate.js           hard block in front of /admin
│   ├── functions/
│   │   ├── commit-all.js           GitHub Git Data API multi-file commits
│   │   ├── passkey-challenge.js
│   │   ├── passkey-verify.js
│   │   ├── passkey-register-options.js
│   │   ├── passkey-register-verify.js
│   │   └── logout.js
│   └── lib/                        session/cookie/blobs helpers
├── src/
│   ├── content/
│   │   ├── posts/<id-slug>/        each post is a folder
│   │   │   ├── post.md
│   │   │   └── images/             source images only (derivatives gitignored)
│   │   └── history/<ID>.json       prior-version snapshots
│   ├── styles/                     tokens.css, post-body.css, tree-view.css
│   ├── lib/                        front-matter, post-loader, id, slug,
│   │                               post-renderer, history, line-diff,
│   │                               tree-view, vocabularies
│   ├── markdown/                   image-attributes, image-renderer
│   ├── runtime/                    ctc-image-reveal (canvas enhancer)
│   ├── shell/                      shared three-pane TUI shell
│   ├── gate/                       press-and-hold canvas + passkey ceremony
│   ├── public/                     reader-facing site
│   │   ├── main.js, styles.css
│   │   ├── views/browse.js, marginalia.js
│   │   └── lib/router.js, modes.js
│   └── admin/                      in-browser editor
│       ├── main.js, styles.css, state.js
│       ├── views/index-view.js, manuscript.js, dispatch.js
│       ├── forms/post-form.js, listbox.js
│       ├── lib/router.js, modes.js, serializer.js, api.js,
│       │   bump-picker.js, image-queue.js, version.js
│       └── plugin/github-write.js  Vite dev middleware
└── docs/
    ├── cult-to-canon-report_250515.md    conceptual brief
    ├── architecture_260517.md            as-built architecture overview
    ├── admin-gate_260517.md              passkey + session design
    ├── thesis-reading-list_260515.md     working bibliography
    └── writing-practice_260515.md        on what to write and how
```

`dist/`, `node_modules/`, `.netlify-blobs-dev/`, and the image dither derivatives under `src/content/posts/*/images/` are all gitignored build artifacts.

## Schema

Each post carries front-matter from a fixed vocabulary, defined in `src/lib/vocabularies.js` and validated at load time. Summary:

| Field        | Vocabulary                                                             |
|--------------|------------------------------------------------------------------------|
| `id`         | `{ESS\|FRG\|NOT\|REV\|FIC}-YYYY-NNN`, stable across renames            |
| `version`    | semver; first publish is `0.1.0`; every commit bumps                   |
| `status`     | `draft` / `stable` / `dormant` / `abandoned`                           |
| `kind`       | `essay` / `fragment` / `note` / `review` / `fiction`                   |
| `register`   | `academic` / `belletristic` / `plainspoken` / `discursive` / `polemical` |
| `confidence` | `log` / `unlikely` / `possible` / `likely` / `highly-likely` / `certain` |
| `visibility` | `public` / `unlisted` / `private`                                      |
| `subjects`   | open folksonomy, slug format                                           |
| `links`      | array of post IDs (constellation model, bidirectional in Marginalia)   |

The `-000` slot of any kind is reserved for site-framing meta-posts. `ESS-2026-000` is the site thesis; its `version` field is bound to the topbar string via `vite-plugin-thesis-version.js`.

## Body images

Inline images use standard markdown syntax with Pandoc-style attributes:

```markdown
![alt text](images/figure-1.jpg)            <!-- default: dither + click-reveal -->
![chart](images/chart.png){.no-dither}      <!-- plain <img>; for screenshots, diagrams -->
![cover](images/cover.jpg){.no-reveal}      <!-- dither only; no color reveal -->
![hero](images/hero.jpg){.full}             <!-- escape body column width -->
```

The Vite plugin at `build/vite-plugin-image-dither.js` walks `src/content/posts/*/images/` at build time and produces eight derivatives per source (1-bit Bayer dither, 4-tone gray, 8-color quant, optimized JPEG, each at 1× and 2×). Only the source is committed; all derivatives are gitignored. The runtime enhancer at `src/runtime/ctc-image-reveal.js` upgrades visible `<img class="ctc-dither">` into interactive canvases.

In the admin, pasting or dragging an image into the body textarea inserts a markdown reference at the caret and queues the binary for the next commit; the queue is bundled into the atomic Git Data API commit by `netlify/functions/commit-all.js` (or written to disk by the dev plugin).

## Vim keybindings

### Public

| Mode    | Key                       | Action                              |
|---------|---------------------------|-------------------------------------|
| normal  | `b` / `r` / `m`           | focus Browse / Read / Marginalia    |
| normal  | `j` / `k` / `↓` / `↑`     | navigate Browse rows                |
| normal  | `h` / `l` / `←` / `→`     | collapse / expand tree branch       |
| normal  | `Enter`                   | open piece under cursor             |
| normal  | `t`                       | toggle tree / flat                  |
| normal  | `?`                       | toggle help overlay                 |
| normal  | `Esc`                     | close overlay / reset to Browse     |
| normal  | `:`                       | enter command mode                  |
| command | `:e <id-or-slug>`         | open piece                          |
| command | `:q` / `:home`            | close current piece                 |

### Admin

| Mode    | Key                       | Action                              |
|---------|---------------------------|-------------------------------------|
| normal  | `i` / `m` / `d`           | focus Index / Manuscript / Dispatch |
| normal  | `j` / `k` / `↓` / `↑`     | navigate Index                      |
| normal  | `h` / `l` / `←` / `→`     | collapse / expand tree branch       |
| normal  | `Enter`                   | open piece under cursor             |
| normal  | `?` / `Esc`               | help overlay / reset focus          |
| normal  | `:`                       | enter command mode                  |
| command | `:update`                 | save + open the bump picker, then commit (replaces `:w`) |
| command | `:q`                      | close form, back to dashboard       |
| command | `:new`                    | new piece form                      |
| command | `:e <id>`                 | open piece by id                    |
| command | `:theme <name>`           | switch palette                      |

`:update` is the gated commit verb: it saves the open form, then opens a bump picker that forces the author to classify the change as patch / minor / major before staging the commit. Every commit bumps the post's `version` — there is no commit-without-bump. The diff is the note.

## Commit conventions

Each commit in this repository is a record of a human–AI work session. The subject describes what was produced; the body describes the collaboration that produced it.

```
[short subject line describing what was produced or changed]

Directed by: [what the human asked for, decided, or specified]
Produced by: AI (Claude)
Human decisions: [any notable choices, overrides, or departures]
```
