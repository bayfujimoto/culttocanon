---
title: Cult to Canon — Versioning System Implementation Plan
date: 2026-05-15
status: draft
---

# Versioning System — Implementation Plan

Plan for adding per-post semantic versioning, the `:update` commit flow, and version-aware extensions to the existing Marginalia version browser and line-diff. Companion to `build-plan_260515.md` (now historical, all phases complete).

---

## 1. Recap of settled decisions

- Every post carries a `version` field (semver). First publish is `0.1.0`.
- Every committed update is a version bump. No silent saves.
- The admin `:w` ex-command is replaced by `:update`, which opens a three-option dropdown: **patch** (+0.0.1) / **minor** (+0.1.0) / **major** (+1.0.0). Selection by `1` / `2` / `3`.
- Commit messages carry only the new version and bump category (e.g. `ESS-2026-007 v0.4.1 [patch]`). The diff is the note. No free-text commit message.
- The Marginalia pane is the sole surface for version history. Every committed version appears there. Clicking a row opens the diff against the immediate predecessor. No separate archive posts or version-suffixed files. All categories visible by default.
- The site's framing thesis is `ESS-2026-000`. The topbar's version string is bound to that post's `version` field via a build-time Vite plugin.
- History-entry semantics follow **Model A**: each entry's `version` and `category` describe the snapshot itself — the version the body was at, and the category that produced that version. They do not describe the bump being applied at the moment the entry is recorded.

## 2. Scope

**In scope:** schema additions (`version` on every post; `version` + `category` on each history entry); migration of the four existing stub posts; bootstrap of `ESS-2026-000`; Vite plugin for the topbar; admin commit-flow refactor (`:w` → `:update`, bump-picker, version-bump inside `triggerCommit`, write `version` + `category` into each history entry); extension of the existing Marginalia versions row to display the new metadata; extension of the existing diff surface to label by version; verification.

**Out of scope (deferred):** GitHub OAuth; per-version OG metadata; RSS-feed integration with version events; backfilling history (sidecar directory is currently empty); admin keymap customization beyond the `:update` rename.

## 3. What already exists

Inventory of the existing infrastructure this plan extends rather than duplicates.

- **`src/lib/history.js`** — eager-loaded history sidecars from `src/content/history/{ID}.json`. Schema today: `{ id, versions: [{ revised, words, body }] }`. Append-only, oldest first; each entry's `body` is the post body *as it was before* the revision that produced the next state. API: `getHistoryById`, `appendVersion`, `historyPathFor`, `wordCount`.
- **`src/lib/line-diff.js`** — LCS-based `diffLines(oldText, newText)`. No deps.
- **`src/public/views/marginalia.js`** — already renders a `versions` row from a `versions` prop, with per-version click handlers wired through `onVersionSelect(v)`. Current row shows `revised` date + word count.
- **`src/admin/views/dispatch.js`** — `triggerCommit()` already snapshots each edited post's prior body into the history sidecar during the commit and rides the sidecar in the `commit-all` payload. Also auto-stamps `revised` to the dispatch date and re-serializes.
- **`src/admin/forms/post-form.js`** — uncontrolled form; `save()` reads it, serializes via `serializePost`, calls `stageChange`. `readForm()` already preserves untouched fields (`revised`) by copying from `_post`; the same pattern will carry `version`.
- **`src/admin/lib/serializer.js`** — `FIELD_ORDER` controls frontmatter field order; serialization drops null/empty fields.
- **`src/admin/lib/modes.js`** — vim mode engine. Ex-commands dispatched in `executeCommand` (currently `w`, `q`, `new`, `e`).
- **`src/admin/main.js`** — wires the modes' `handlers.onW` to: `saveForm()` first (if a form is open), then `triggerCommit()`. The admin shell is rendered with a hardcoded `identity: { name: "CULT_TO_CANON", version: "v0.1.0" }`.
- **`src/content/history/`** — empty (only `.gitkeep`). No legacy migration needed.

## 4. Phases

### Phase A — Schema & migration

| Step | Action | File(s) |
|------|--------|---------|
| A.1 | Add `version` to `FIELD_ORDER` in the serializer, between `id` and `slug` (or wherever feels canonical — `id`/`version`/`slug` reads well) | `src/admin/lib/serializer.js` |
| A.2 | Add `version: "0.1.0"` to the frontmatter of the four existing stub posts | `src/content/posts/ESS-2026-001-…md` plus the other three |
| A.3 | Add `version: "0.1.0"` to the `blank` post template in `renderNew` | `src/admin/views/manuscript.js` |
| A.4 | Carry `version` through the form: read it from `_post` in `readForm()` (parallel to how `revised` is currently carried — `data.version = _post?.version ?? "0.1.0"`); no UI input | `src/admin/forms/post-form.js` |
| A.5 | Extend the history-entry schema: each entry gains `version` (string) and `category` (`"patch"`, `"minor"`, `"major"`, or `"initial"`). Update the JSDoc at the top of `history.js` and the `appendVersion` parameter shape | `src/lib/history.js` |
| A.6 | Verify `src/lib/id.js` (`nextId`, `parseId`, `formatId`) is unaffected (it is, but confirm) | `src/lib/id.js` |

### Phase B — Bootstrap `ESS-2026-000`

| Step | Action | File(s) |
|------|--------|---------|
| B.1 | Create `src/content/posts/ESS-2026-000-site-thesis.md` with `id: ESS-2026-000`, `slug: site-thesis`, `version: "0.1.0"`, `status: draft`, `kind: essay`, `register: academic`, `subjects: [site-thesis]`, `visibility: public`, placeholder body | new file |
| B.2 | Reserve the `-000` slot as a convention: only site-framing documents occupy the zeroth slot of any kind | docs note in this file |

### Phase C — Vite plugin for topbar binding

| Step | Action | File(s) |
|------|--------|---------|
| C.1 | Write `vite-plugin-thesis-version.js`. Walks `src/content/posts/`, finds the file with frontmatter `id: ESS-2026-000`, extracts `version`. Fails the build if the file is missing or the version is malformed semver. Exposes `__THESIS_VERSION__` via `define` | `vite-plugin-thesis-version.js` (new) |
| C.2 | Register the plugin in `vite.config.js` | `vite.config.js` |
| C.3 | Replace the hardcoded `version: "v0.1.0"` in `renderShell({ identity: … })` in `src/admin/main.js` with `version: "v" + __THESIS_VERSION__`. Do the same in `src/public/main.js` | `src/admin/main.js`, `src/public/main.js` |
| C.4 | Optional ambient declaration for `__THESIS_VERSION__` | `src/types/globals.d.ts` (new, optional) |

**Plugin reference:**

```js
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import matter from 'gray-matter';

const POSTS_DIR = 'src/content/posts';
const THESIS_ID = 'ESS-2026-000';

export function thesisVersionPlugin() {
  return {
    name: 'thesis-version',
    config() {
      const dir = resolve(process.cwd(), POSTS_DIR);
      const files = readdirSync(dir).filter(f => f.endsWith('.md'));
      let version = null;
      for (const f of files) {
        const { data } = matter(readFileSync(join(dir, f), 'utf8'));
        if (data.id === THESIS_ID) {
          if (!/^\d+\.\d+\.\d+$/.test(data.version)) {
            throw new Error(`Thesis ${THESIS_ID}: invalid version "${data.version}"`);
          }
          version = data.version;
          break;
        }
      }
      if (!version) throw new Error(`Thesis ${THESIS_ID} not found in ${POSTS_DIR}`);
      return { define: { __THESIS_VERSION__: JSON.stringify(version) } };
    },
  };
}
```

### Phase D — Admin commit flow: `:w` → `:update`

Concrete refactor of the existing path. Current flow: `:w` → `handlers.onW` (in `main.js`) → `saveForm()` (stages) → `triggerCommit()` (snapshots prior body to history sidecar, auto-stamps `revised`, posts to `commit-all`). The new flow renames the command to `:update`, inserts a bump-picker between staging and committing, and writes the new `version` into the post frontmatter and the prior version's `version` + `category` into the appended history entry.

| Step | Action | File(s) |
|------|--------|---------|
| D.1 | In `modes.js` `executeCommand`, remove `case "w":` and add `case "update":`. The handler calls a renamed `handlers.onUpdate` | `src/admin/lib/modes.js` |
| D.2 | Rename `handlers.onW` → `handlers.onUpdate` in `main.js`. Handler body: (a) if a form is open, call `saveForm()` to stage; (b) if `pendingChanges` is empty, flash "nothing to commit" and return; (c) otherwise open the bump-picker with a continuation that, on confirm, calls `triggerCommit(category)` | `src/admin/main.js` |
| D.3 | Build the bump-picker. Statusbar overlay, parallel structure to the command-mode input. Three options: patch / minor / major. Keyboard: `1` / `2` / `3` to select; `Enter` to confirm; `Esc` to cancel. Renders, for each pending edit, the current version → target version so the author sees what is about to happen | `src/admin/lib/bump-picker.js` (new) |
| D.4 | Implement `bumpVersion(current, category)` and `bumpCategoryBetween(prev, next)` as pure functions. `bumpVersion` is used by the picker (to show targets) and by `triggerCommit` (to apply). `bumpCategoryBetween` is used by `triggerCommit` to derive the prior version's category for the new history entry | `src/admin/lib/version.js` (new) |
| D.5 | Modify `triggerCommit(category)` in `dispatch.js`. For each `edit` change: bump the staged content's `version` per `category` and re-serialize; append a history entry `{ version: <prior post version>, category: <category that produced the prior version>, revised: <prior revised>, words, body: <prior body> }`. The prior-version's category is derived: if `getHistoryById(id).versions.length === 0`, it is `"initial"`; otherwise it is `bumpCategoryBetween(lastEntry.version, priorPostVersion)`. For each `add` change: stamp `version: "0.1.0"` if not present; no history seeding (history begins on the first edit, at which point an entry for `v0.1.0` is appended with category `"initial"`) | `src/admin/views/dispatch.js`, `src/lib/history.js` |
| D.6 | New commit message format: `{id} v{newVersion} [{category}]` for single-file commits; join headers with semicolons for multi-file commits. Replace the existing `parts`-array message construction near the top of `triggerCommit` | `src/admin/views/dispatch.js` |
| D.7 | Update labels and help: form save button "save :w" → "update :update" (`form-save-hint` span); `ADMIN_KEYMAP_GROUPS` `:` row legend; `ADMIN_HELP.sections` "Command (:)" rows (`:w save & commit` → `:update update`); dashboard hint in `manuscript.js` (`<kbd>:</kbd><kbd>w</kbd> commit` → `<kbd>:</kbd><kbd>update</kbd> update`); the dispatch.js doc-comment "wired to `:w` in modes.js" → "wired to `:update` in modes.js" | `src/admin/forms/post-form.js`, `src/admin/main.js`, `src/admin/views/manuscript.js`, `src/admin/views/dispatch.js` |

**`bumpVersion` and `bumpCategoryBetween` reference:**

```js
export function bumpVersion(current, category) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`Invalid semver: ${current}`);
  const major = +m[1], minor = +m[2], patch = +m[3];
  switch (category) {
    case "patch": return `${major}.${minor}.${patch + 1}`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "major": return `${major + 1}.0.0`;
    default: throw new Error(`Unknown bump category: ${category}`);
  }
}

export function bumpCategoryBetween(prev, next) {
  const p = /^(\d+)\.(\d+)\.(\d+)$/.exec(prev);
  const n = /^(\d+)\.(\d+)\.(\d+)$/.exec(next);
  if (!p || !n) throw new Error(`Invalid semver pair: ${prev} → ${next}`);
  if (+n[1] > +p[1]) return "major";
  if (+n[2] > +p[2]) return "minor";
  if (+n[3] > +p[3]) return "patch";
  throw new Error(`Not a bump: ${prev} → ${next}`);
}
```

**Model A semantic.** Each history entry records the snapshot's identity: its `version` is what the body was at, and its `category` is the category that produced that version (or `"initial"` for the initial publish). At commit time, the just-chosen category describes how the *new* version was produced — it is recorded onto the entry that gets appended at the *next* commit, when the now-new version itself becomes prior. The prior-version's category is therefore derived at append time via `bumpCategoryBetween(lastEntry.version, priorPostVersion)`, or set to `"initial"` if the post has no prior history. No transient state on the post frontmatter is required.

### Phase E — Marginalia: surface the new metadata

`src/public/views/marginalia.js` already renders the `versions` list and wires clicks. Adjustments only.

| Step | Action | File(s) |
|------|--------|---------|
| E.1 | Add a `version` row in the Marginalia DL alongside `status`, `kind`, etc., showing the post's current version from frontmatter | `src/public/views/marginalia.js` |
| E.2 | Change the existing versions row to display `v{X.Y.Z} · {revised} · {category}` per entry instead of the current `{revised} · {words}`. Color-code: patch muted, minor standard fg, major accent (Solarized blue on public; amber on admin). No filtering — all categories visible by default | `src/public/views/marginalia.js` plus the relevant `.css` |
| E.3 | Change each version link's href from `#v<i>` to `?v={X.Y.Z}` | `src/public/views/marginalia.js` |
| E.4 | Router: on `?v=X.Y.Z`, find the matching history entry for the current post by version string and fire `onVersionSelect(entry)` (or a new dedicated callback if the existing one's contract is awkward) | `src/public/lib/router.js`, `src/public/main.js` |

### Phase F — Diff viewer extension

The diff renderer (`diffLines`) and the per-version click handler (`onVersionSelect`) exist. The view that consumes `onVersionSelect` and renders the diff into a buffer is wired in `src/public/main.js` (confirm during implementation; F.1 is an audit step).

| Step | Action | File(s) |
|------|--------|---------|
| F.1 | Audit: locate where `onVersionSelect` is wired in `src/public/main.js` and which view consumes the resulting diff. Confirm the diff currently renders against the immediate predecessor and not the current state. | `src/public/main.js`, public read view |
| F.2 | Add a chrome banner above the diff: `Reading diff: {id} v{X.Y.Z} [{category}] · {date} · [view current] [prev] [next]`. Click handlers: prev/next walk adjacent entries; "view current" clears the `?v=` param | diff surface |
| F.3 | Ensure URL stays in sync with the selected version (set `?v=X.Y.Z` when entering diff mode; clear on exit) | router, diff surface |
| F.4 | Admin parity: if admin Marginalia surfaces the same versions list (it may; confirm), apply the same chrome and behavior | admin views |

### Phase G — Verification

| Step | Action |
|------|--------|
| G.1 | Bump `ESS-2026-000` from `0.1.0` → `0.1.1` (patch). Rebuild. Confirm topbar reads `CULT_TO_CANON v0.1.1`. |
| G.2 | Bump to `0.2.0` (minor). Confirm topbar updates. |
| G.3 | Bump to `1.0.0` (major). Confirm topbar updates. |
| G.4 | On a non-thesis post, perform three sequential `:update` commits — patch, minor, major. Confirm the sidecar JSON in `src/content/history/` shows three entries with correct `version` and `category`. Confirm Marginalia displays three rows. |
| G.5 | Click each Marginalia version row. Confirm the diff renders correctly, the URL updates to `?v=X.Y.Z`, and the chrome banner shows version + category. |
| G.6 | Temporarily delete `ESS-2026-000-site-thesis.md`. Confirm `vite build` fails with a clear error. |
| G.7 | Corrupt the thesis `version` field to `"abc"`. Confirm the Vite plugin throws and the build fails. |
| G.8 | Inspect a GitHub commit produced by `:update`. Confirm the message matches `{id} v{newVersion} [{category}]`. |
| G.9 | Open a draft post (`status: draft`, `visibility: private`). Bump it via `:update`. Confirm the version still increments and the version row appears in admin Marginalia. |

## 5. Sequencing & dependencies

```
A ──┬─→ B ─→ C ─→ G.1–G.3
    │
    └─→ D ─→ E ─→ F ─→ G.4–G.9
```

- A is foundational; everything depends on it.
- B and C can proceed in parallel after A.
- D depends only on A.
- E depends on D (real bump categories in history) and on A (the new entry fields).
- F depends on E.

## 6. Deferred / non-goals

- Branching or parallel-version support. Versioning is linear by design.
- Per-version Open Graph or social-card metadata.
- Author-facing tooling to un-bump or rewrite history. Git is the source of truth; rewriting it requires raw git, intentionally.
- Cross-post version aggregation (e.g., "show all major bumps across the site"). Easy to add later; not Phase 1.
- Backfilling history entries from git log (no legacy history exists).

---

*Provisional. The versioning system has not been tested under real writing volume; phases E and F may need adjustment once a few months of bumps have produced real history.*
