# Cult to Canon — Preliminary Build Plan

*Drafted 2026-05-15, in dialogue. Companion to `cult-to-canon-report_250515.md`.*

> **Status: completed.** All phases (0–4) are built. This document is preserved as the historical design record of the May 2026 planning session; current work is tracked in subsequent docs, beginning with `versioning-implementation_260515.md`.

This document records the design and architectural decisions reached in the planning session of May 15, 2026, and lays out the build sequence to follow. The conceptual frame lives in the companion report; this document addresses the practical questions of how the site will be made.

---

## 1. Project Summary

Cult to Canon is a text-primary website organized around the contested process by which marginal works are elevated to legitimate cultural standing — and the apocryphal counterparts that gesture always produces. The site will hold heterogeneous writing (essays, fragments, notes, reviews, fictions) under a single authorial sensibility and a unifying TUI aesthetic.

The two binding agents, per the report's Part Five, are:

- the conceptual phrase *cult to canon*, and
- the singular authorial voice.

The site does not aspire to monetization, scale, or platform reach. It is a slow-web outpost in the lineage of Andy Matuschak, Tom Critchlow, Gwern Branwen, and Maria Popova, inflected toward criticism, fiction, and cultural argument rather than knowledge management.

## 2. Hosting and Infrastructure

| Item               | Decision |
|--------------------|----------|
| Hosting            | Netlify (free tier) |
| Serverless         | Netlify Functions (commit-all pattern, ported from bayfujimoto.com) |
| Repository         | `bayfujimoto/culttocanon` — already created and linked to `/Documents/CultToCanon` |
| Initial URL        | `culttocanon.netlify.app`; custom domain deferred |
| Build              | Vite |
| Source language    | Vanilla JavaScript (no framework) |
| Content format     | Markdown with YAML front-matter |

Netlify was chosen over Cloudflare Pages on grounds of path-dependence: the bayfujimoto.com codebase already includes a `commit-all.js` Netlify Function for in-browser commits to GitHub, which ports directly. Cloudflare Pages would require rewriting that function as a Worker. The Netlify free tier (100 GB bandwidth, generous function invocations) is sufficient for the site's expected scale.

The domain decision has been deferred. Per Christopher Alexander's *A Pattern Language* (1977), genuine form emerges from the iterated solution of specific problems, not from the imposition of a prior plan. The site will deploy to its Netlify subdomain until the writing has produced enough surface to make a custom-domain choice feel earned.

## 3. Visual Identity

The site is a TUI (terminal user interface) site in the lineage of Olia Lialina's *A Vernacular Web* (2005) and the broader Net Art tradition that reads interface choices as critical interventions. Mark Fisher's *Ghosts of My Life* (2014) frames the obsolete terminal aesthetic as hauntological — carrying the residue of computational futures that did not arrive.

Two distinct palettes are in use.

**Public site** inherits the existing bayfujimoto.com admin palette:

- Cool light grey background (`#d5d8db`)
- Dark grey foreground — `#4d5158` body, `#1f2226` focused
- Solarized accents, eight colors used semantically (blue for the mode chip, etc.)
- Fonts: Commit Mono (monospace) for chrome and labels; EB Garamond (serif) for body, where appropriate

**Admin** uses a new palette: **IBM 5151 phosphor green on black**:

- Background: pure black `#000000`
- Foreground: saturated emerald `#33ff33`
- Muted variants via opacity for secondary text
- Amber `#ffb000` for warning states
- Red `#ff3030` for errors
- Optional dim cyan `#00cccc` for hyperlinks (preserving the early-CRT bicolor)

The two palettes enact a chiasmus: the public side is *paper* — a manuscript culture in light. The admin is *phosphor* — a computational culture in dark. The writer crosses a visible threshold when entering the workshop.

**Topbar identity**: `CULT_TO_CANON v0.1.0`, with cursor blink, mirroring bayfujimoto.com's `ARCHIVE_SYS v0.1.0`.

## 4. Three-Pane TUI Layout

The asymmetric three-pane layout from bayfujimoto.com's admin is preserved verbatim, including the draggable gutters, the `localStorage` size persistence, the vim-style mode engine with `:` ex-commands, and the mobile tabstrip that swaps panes at narrow widths.

```
┌────────────┬─────────────────────┐
│            │  [pane 2]           │
│  [pane 1]  │  (top right)        │
│  (left,    ├─────────────────────┤
│   full     │  [pane 3]           │
│   height)  │  (bottom right)     │
└────────────┴─────────────────────┘
```

### Admin panes (port and rename)

| Position    | Key | Label       | Function |
|-------------|-----|-------------|----------|
| Left        | `i` | Index       | Tree of posts; navigate by metadata |
| Top right   | `m` | Manuscript  | Edit form for current post (analog of bayfujimoto.com's Record) |
| Bottom right| `d` | Dispatch    | Pending changes; commit to GitHub; session commit history |

### Public panes (new)

| Position    | Key | Label       | Function |
|-------------|-----|-------------|----------|
| Left        | `b` | Browse      | Posts list — toggle between hierarchical tree and flat sortable list |
| Top right   | `r` | Read        | Currently-selected post; vim-buffer behavior; empty placeholder with hint before first selection |
| Bottom right| `m` | Marginalia  | Per-piece paratext — status, dates, links, related pieces |

*Marginalia* adapts Gérard Genette's notion of paratext (*Seuils*, 1987) — the apparatus around a text — to the digital-garden lineage's emphasis on showing the work's seams. Per piece, it surfaces what is normally hidden: when written, when revised, what status the author assigns, what other pieces this one connects to (and which connect back).

## 5. Content Model and Metadata Schema

**Single content type.** Every piece is a *post*. Differentiation is metadata-driven, not folder-driven. The unified container is itself an argument: the site refuses to pre-sort writing into bins before it has been read. The arrangement follows the commonplace-book tradition (Bacon, Locke, Coleridge, Auden) and its digital descendants in the gardening movement.

### Front-matter schema

```yaml
id:           POST-2026-001
slug:         on-the-backrooms-as-canon
title:        On the Backrooms as Canon
created:      2026-05-15
revised:      2026-05-20
status:       draft
kind:         essay
register:     academic
confidence:   possible
subjects:     [analog-horror, canon-formation, youtube]
links:        [POST-2026-007, POST-2026-012]
visibility:   public
series:       null
epigraph:     null
length:       1840          # auto-computed
```

### Field vocabularies

**`status`** (3 values, minimal start)
`draft` · `evergreen` · `abandoned`. Finer gradations (`seedling`, `revising`, `budding`) can be introduced when patterns in actual writing reveal a need.

**`kind`** (5 values, minimal start)
`essay` · `fragment` · `note` · `review` · `fiction`. Additional values — `dialogue`, `list`, `commentary`, `lecture`, `case-study`, `translation`, `bibliography` — may be added as the writing requires them.

**`register`** (7 values, full)
`academic` · `belletristic` · `plainspoken` · `hybrid` · `performative` · `polemical` · `lyric`. The five from the report's Part Four, plus *polemical* (the Hazlitt/Macdonald lineage) and *lyric* (the Carson/Nelson lyric-essay register).

**`confidence`** (6 values, full Gwern vocabulary)
`log` · `unlikely` · `possible` · `likely` · `highly-likely` · `certain`. Drawn from Gwern Branwen's metadata convention; permits the writer to register epistemic posture alongside formal posture.

**`subjects`** — open folksonomy, slug format (lowercase, hyphenated, no spaces). The admin form autocompletes existing values to surface inconsistencies. Flat tag space; hierarchies hidden behind tags would lock in commitments prematurely (per Bowker and Star, *Sorting Things Out*, 1999).

**`links`** — array of post IDs. The constellation model: manual cross-references between pieces. Bidirectional display in Marginalia (outgoing and incoming both shown).

**`visibility`** (3 values)
`public` (in Browse) · `unlisted` (URL-only) · `private` (admin only). The `unlisted` state makes the show-its-seams posture practical: drafts can be shared with specific readers without committing to public listing.

## 6. Repository Structure

```
CultToCanon/
├── docs/
│   ├── cult-to-canon-report_250515.md
│   └── build-plan_260515.md            ← this document
├── src/
│   ├── content/
│   │   └── posts/                      ← all posts here, single directory
│   ├── public/                         ← reader-facing site
│   │   ├── app/                        ← router, state, renderer
│   │   ├── views/                      ← Browse, Read, Marginalia
│   │   └── styles/
│   ├── admin/                          ← ported TUI admin
│   │   ├── views/                      ← Index, Manuscript, Dispatch
│   │   ├── forms/                      ← unified post form
│   │   ├── lib/                        ← id, slug, serializer, api
│   │   └── styles/
│   └── styles/
│       ├── tokens.css                  ← shared tokens (typography, layout)
│       ├── public.css                  ← public palette (inherits bayfujimoto admin)
│       └── admin.css                   ← phosphor green palette
├── netlify/
│   └── functions/
│       └── commit-all.js
├── netlify.toml
├── vite.config.js
└── README.md
```

## 7. Code to Port from bayfujimoto.com

Confirmed by reading the source. The following modules transfer with the listed adaptations.

| From bayfujimoto.com                | Adaptation needed |
|-------------------------------------|-------------------|
| `src/admin/shell.js`                | Verbatim — pane resize logic, openRecord helper |
| `src/admin/main.js`                 | Rewrite SERIES_TYPES → POST_KINDS; rename Explorer→Index, Record→Manuscript, Log→Dispatch |
| `src/admin/views/explorer.js`       | Adapt for single post type; tree built on metadata categories rather than series/type |
| `src/admin/views/edit-item.js`      | Adapt for single post type; one form schema |
| `src/admin/views/new-item.js`       | Single creation flow; no type selection |
| `src/admin/views/log.js`            | Rename to `dispatch.js`; function unchanged |
| `src/admin/forms/*`                 | Refactor `type-fields.js` to dispatch on metadata rather than content type |
| `src/admin/lib/id-generator.js`     | Verbatim, with `POST` prefix |
| `src/admin/lib/slug-generator.js`   | Verbatim |
| `src/admin/lib/serializer.js`       | Adapt for new schema |
| `src/admin/lib/api.js`              | Verbatim — commit-all wiring |
| `src/admin/plugin/github-write.js`  | Verbatim |
| `src/admin/statusline.js`           | Verbatim, with letter remappings (e→i, r→m, l→d) |
| `src/admin/modes.js`                | Verbatim, with command remappings |
| `src/admin/nav.js`                  | Verbatim, with pane-key remappings |
| `netlify/functions/commit-all.js`   | Verbatim |
| `src/styles/tokens.css`             | Fork: keep typography and layout tokens; rewrite admin palette as phosphor green; keep public palette tokens unchanged |
| `vite.config.js`                    | Verbatim, with input adjustments |

The public-facing site is built fresh — bayfujimoto.com's public side uses a different rendering strategy and is not a useful template for Cult to Canon's reader experience. The reader-facing router, view system, and markdown renderer are new.

## 8. Build Phases

**Phase 0 — Foundation.** Scaffold the repo; Vite config; `tokens.css` with both palettes; Netlify deploy wired up; topbar and statusbar shells rendering; `CULT_TO_CANON v0.1.0` visible at `culttocanon.netlify.app`.

**Phase 1 — Content model.** Implement the post schema in code; write three to four stub posts of different `kind` values to stress-test the schema; markdown parser; single-post rendering.

**Phase 2 — Public site.** Build the public three-pane shell with the phosphor-free public palette. Browse view (tree + flat list toggle). Read view (vim-buffer behavior, empty hint state). Marginalia view (per-piece paratext). Public router. Mode engine.

**Phase 3 — Admin port.** Port the TUI admin from bayfujimoto.com. Rename panes and keys. Refactor forms for the unified post type. Wire up `commit-all` for in-browser GitHub writes. GitHub OAuth setup.

**Phase 4 — Iteration.** Whatever phases 2 and 3 produced will need revision once real pieces inhabit it. This phase is named in advance precisely so the build does not pretend to be finished before it is tested by use.

## 9. Deferred / Open Items

| Item                          | Status |
|-------------------------------|--------|
| Custom domain                 | Deferred; deploy under `culttocanon.netlify.app` until a name feels earned |
| GitHub OAuth setup            | Surfaces in Phase 3 |
| RSS feed                      | Consider for Phase 4; consonant with the slow-web posture if desired |
| About / colophon page         | Defer; let voice emerge first |
| Homepage problem (per report) | Decide late; the empty-Read default is the current placeholder |
| Analytics                     | None (consonant with no-monetization posture) |
| Comments                      | None |
| Search                        | Defer; consider in Phase 2 if Browse insufficient |
| Subject hierarchies           | Decide later; flat folksonomy for now |
| Additional `kind` values      | Add as the writing requires |
| Additional `status` gradations| Add as patterns emerge |

---

*This plan, like the site itself, is provisional. Phase 4 exists in acknowledgment that the design will change once the writing tests it. The structure named here is the minimal vessel; the actual form of Cult to Canon will be discovered in the iterated work of filling it.*
