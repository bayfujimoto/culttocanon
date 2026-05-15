# Cult to Canon

A text-primary, TUI-aesthetic archive of essays, fragments, notes, reviews, and fiction, organized around the contested process by which marginal works become legitimate cultural property — and the apocryphal counterparts that gesture produces.

See `docs/cult-to-canon-report_250515.md` for the conceptual brief and `docs/build-plan_260515.md` for architecture and phase plan.

## Status

**Phases 0–3 complete.** Public site renders posts at `/` with vim-style modes, tree/flat Browse, URL routing, and Marginalia paratext. Admin at `/admin` provides Index / Manuscript / Dispatch panes for editing and committing.

## Development

```sh
npm install
npm run dev      # vite dev server at http://localhost:8080
npm run build    # production build to dist/
npm run preview  # preview the built output
```

Open `http://localhost:8080/` for the public side and `http://localhost:8080/admin.html` for the admin.

In dev mode, saving a post writes the markdown file directly to `src/content/posts/` via the Vite middleware. No GitHub auth needed locally.

## Deployment

The site builds with `npm run build` to `dist/` and deploys to Netlify. The `netlify.toml` is already wired with the redirects and function directory.

### Admin commits in production

For the production admin to commit changes back to the GitHub repo, set these environment variables in Netlify (Site settings → Environment variables):

| Variable          | Value                                  |
|-------------------|----------------------------------------|
| `GITHUB_TOKEN`    | Fine-grained PAT, scope = Contents R/W |
| `GITHUB_OWNER`    | `bayfujimoto`                          |
| `GITHUB_REPO`     | `culttocanon`                          |
| `GITHUB_BRANCH`   | `main` (optional, default)             |

The PAT should be a *fine-grained* token, scoped to this single repository, with **Contents** permission set to **Read and write**.

The Netlify Function at `netlify/functions/commit-all.js` reads these env vars; the token never leaves the server.

## Layout

```
CultToCanon/
├── index.html                public entry         (data-theme="public")
├── admin.html                admin entry          (data-theme="admin")
├── netlify.toml              build + redirects + function dir
├── vite.config.js            two-entry Vite build + github-write plugin
├── public/fonts/             Commit Mono woff2 files
├── netlify/functions/
│   └── commit-all.js         production commit handler
├── src/
│   ├── content/posts/        markdown posts (front-matter + body)
│   ├── styles/
│   │   ├── tokens.css        both palettes (public + phosphor admin)
│   │   └── post-body.css     rendered-post typography
│   ├── lib/                  shared loaders, parsers, generators
│   │   ├── vocabularies.js   STATUS / KIND / REGISTER / CONFIDENCE / VISIBILITY
│   │   ├── id.js             POST-YYYY-NNN parser + generator
│   │   ├── slug.js           title → slug
│   │   ├── front-matter.js   YAML front-matter parser
│   │   ├── post-loader.js    glob + validate
│   │   └── post-renderer.js  Post → DOM via marked
│   ├── shell/                shared TUI shell (renderer + CSS)
│   ├── public/               reader-facing site
│   │   ├── main.js
│   │   ├── styles.css
│   │   ├── views/
│   │   │   ├── browse.js
│   │   │   └── marginalia.js
│   │   └── lib/
│   │       ├── router.js
│   │       └── modes.js
│   └── admin/                in-browser editor
│       ├── main.js
│       ├── styles.css
│       ├── state.js          pubsub for pendingChanges
│       ├── views/
│       │   ├── index-view.js
│       │   ├── manuscript.js
│       │   └── dispatch.js
│       ├── forms/
│       │   └── post-form.js
│       ├── lib/
│       │   ├── router.js     hash router
│       │   ├── modes.js      admin vim engine
│       │   ├── serializer.js Post → markdown
│       │   └── api.js
│       └── plugin/
│           └── github-write.js  Vite dev middleware
└── docs/
    ├── cult-to-canon-report_250515.md
    └── build-plan_260515.md
```

## Vim keybindings

### Public

| Mode     | Key                         | Action                          |
|----------|-----------------------------|---------------------------------|
| normal   | `b` / `r` / `m`             | focus Browse / Read / Marginalia |
| normal   | `j` / `k` / `↓` / `↑`       | navigate Browse rows             |
| normal   | `Enter`                     | open piece under cursor          |
| normal   | `t`                         | toggle tree / flat               |
| normal   | `:`                         | enter command mode               |
| command  | `:e <id-or-slug>`           | open piece                       |
| command  | `:q` / `:home`              | close current piece              |

### Admin

| Mode     | Key                         | Action                          |
|----------|-----------------------------|---------------------------------|
| normal   | `i` / `m` / `d`             | focus Index / Manuscript / Dispatch |
| normal   | `j` / `k` / `Enter`         | navigate / open in Index        |
| normal   | `:`                         | enter command mode               |
| command  | `:w`                        | save (if form open) + commit pending |
| command  | `:q`                        | close form, back to dashboard    |
| command  | `:new`                      | new piece form                   |
| command  | `:e <id>`                   | open piece by id                 |

## Commit conventions

Each commit in this repository is a record of a human-AI work session. Subject describes what was produced; body describes the collaboration that produced it.

```
[short subject line describing what was produced or changed]

Directed by: [what the human asked for, decided, or specified]
Produced by: AI (Claude)
Human decisions: [any notable choices, overrides, or departures]
```
