# Citations & Footnotes — implementation plan

*Drafted 2026-07-06. Companion to `architecture_260517.md`. Status: proposed.*

## 1. Decisions locked

Settled in the planning exchange of 2026-07-06:

- **Two separate systems.** Footnotes are authorial asides; citations are a bibliography of external works. Each renders as its own labeled block in Marginalia.
- **Inline markdown authoring.** Both are placed by typing markers in the body textarea. No new admin form field is required to author them.
- **Structured, lightweight citations with a link.** Each citation carries fixed fields (author, title, year, url) rather than freeform prose. The url is the point of a citation, not an optional extra.
- **Inline marker → highlight in Marginalia.** A superscript in the Read pane, clicked, scrolls to and highlights its entry in the Marginalia pane; the entry links back to the marker.

## 2. Why the definitions live in the body

The single most consequential architectural fact: version history snapshots (`src/lib/history.js`) store the post's markdown **`body`** and nothing else, and the diff view (`renderDiff` in `post-renderer.js`) diffs `oldBody` against `newBody`. Any paratext held in YAML front-matter would therefore be invisible to the version browser and the diff — a footnote reworded between v0.2.0 and v0.3.0 would leave no trace in Marginalia's own diff surface.

Keeping footnote and citation definitions inside the body means:

1. They are versioned and diffed by the existing machinery with zero new code.
2. There is a single authoring surface (the body textarea), consistent with the "inline markdown" decision and with how images already work (`![](images/…)` markers, `post-form.js`).
3. The `-000` colophon/incunabula register of the site is preserved: the apparatus is part of the text, not metadata bolted alongside it.

This is why the front-matter-list option is rejected, not merely unchosen.

## 3. Authoring syntax

### 3.1 Footnotes — standard Pandoc/GFM

Reference inline, definition anywhere in the body:

```markdown
The origin is empty.[^origin]

[^origin]: Kermode's order of canonization runs the other way; see *The Classic*.
```

- Labels may be numeric (`[^1]`) or named (`[^origin]`). Named is preferred — stable across insertions.
- Definition bodies accept inline markdown (emphasis, links).
- Display number is assigned by **order of first reference** in the document, not by label.
- Only referenced footnotes are numbered and rendered. An **unreferenced definition is not rendered** and raises a non-blocking lint warning in the admin — it is a dangling note, almost always an editing slip.

### 3.2 Citations — inline marker + in-body definition block

Reference inline:

```markdown
…the order Kermode describes.[@kermode1975]      <!-- → [1] -->
…as noted earlier.[@kermode1975, 42]             <!-- → [1], "p. 42" in the entry -->
```

Definitions in a fenced block, conventionally placed at the foot of the body. The block is parsed for Marginalia and **stripped from the rendered Read output**:

```markdown
::: citations
kermode1975 | Frank Kermode | The Classic | 1975 | https://archive.org/…
backrooms2019 | Anonymous | "The Backrooms" (4chan /x/) | 2019 | https://…
:::
```

Columns are positional, pipe-delimited: **`key | author | title | year | url`**. `year` and `url` may be empty (trailing pipes optional); `key`, `author`, `title` are required. The renderer italicizes `title`, formats the entry as `Author, *Title* (Year)`, and makes the whole entry an outbound link to `url`.

**Locators.** The optional text after the comma in a reference renders alongside the entry. A bare number or numeric range (`42`, `42–45`) is prefixed `p.` / `pp.`; anything else (`§3`, `ch. 2`, `fig. 4`) renders **verbatim**. The locator is free text, not a controlled vocabulary — deliberately lightweight, matching the site's register.

*Named-field variant (deferred).* If positional columns prove error-prone, the block body can instead be parsed as YAML (`kermode1975: {author: …, title: …, year: 1975, url: …}`). The positional form is the v1 recommendation for typing speed; the parser is small enough to support both later.

## 4. Data flow

```
body markdown
   │
   ▼
extractParatext(body)  ──►  { footnotes:[{label,num,html}], citations:[{key,num,author,title,year,url,locator?}] }
   │                                   │
   │                                   └────────────► renderMarginalia()  (two new sections)
   ▼
per-post Marked instance (parseBodyFor)
   ├─ paratext extension emits inline <sup> markers with anchor ids + numbers
   └─ strips footnote defs and the ::: citations block from Read output
   │
   ▼
renderPost()  →  Read pane
```

Numbering is the shared contract between the rendered markers and the Marginalia entries. To keep them identical, `extractParatext` is the single source of truth for order and number; the Marked extension is handed the same computed index (mirroring how `makeImageRendererExtension(post.folder)` is handed the folder in `post-renderer.js`).

**Code-safety.** Markers inside inline code or fenced code blocks must not be treated as references. This is the decisive reason to implement parsing as Marked inline/block **extensions** rather than raw regex over the body string — Marked does not run inline extensions inside code spans. `extractParatext` therefore performs a Marked parse + `walkTokens` collection pass, not an independent regex scan, so the extractor and the renderer agree by construction.

## 5. Rendering — Read pane

- Footnote reference → `<sup class="fn-ref"><a id="fnref-N" data-fn="N" href="#fn-N">N</a></sup>`.
- Citation reference → `<sup class="cite-ref"><a id="citeref-N" data-cite="N" href="#cite-N">[N]</a></sup>`.

Two visually distinct marker styles (bare superscript numeral for notes, bracketed for citations) reinforce the "two separate systems" decision. Styling lives in `src/styles/post-body.css`, using the existing Solarized accent tokens.

Footnote definitions and the `::: citations` block are consumed by the extension and never appear in the rendered article body.

## 6. Rendering — Marginalia

Two new sections appended after the existing metadata `<dl>` and version browser in `src/public/views/marginalia.js`, each with a small-caps mono header matching the current TUI register:

- **`footnotes`** — ordered list; each item `id="fn-N" data-fn="N"`, content is the definition's rendered HTML, prefixed by its number, with a `↩` back-link to `#fnref-N`.
- **`works cited`** — ordered **by first reference** (the same sequence as the markers, so entry number always equals marker number); each item `id="cite-N" data-cite="N"`, formatted `Author, *Title* (Year)` as a link to `url`, with a `↩` back-link to `#citeref-N`.

Sections render only when the post has entries. While a diff is open, Marginalia keeps showing the current post's paratext (consistent with how it already shows current metadata during a diff); per-version paratext is a possible later refinement.

## 7. Cross-pane interaction

Wired in `showPost` (`src/public/main.js`) after both panes render, since both live in one document:

- **Marker → entry.** Delegated click handler on `readBody` for `.fn-ref a, .cite-ref a`: `preventDefault`, scroll the matching `#fn-N` / `#cite-N` into view in `margBody`, apply a transient `.is-cited` highlight class (short CSS fade). On mobile (`max-width: 700px`), first `setMobileActivePane("m")` so the entry is visible before scrolling.
- **Entry → marker.** Click handler on Marginalia entries scrolls `readBody` to the corresponding `#fnref-N` / `#citeref-N` and flashes it; on mobile switches to the Read pane.

Highlight is a CSS-only animation on a toggled class (`src/public/styles.css`), no timers beyond one `setTimeout` to remove the class — matching the existing `flash()` pattern in the codebase.

## 8. Admin authoring aids

The core requirement (author by typing markers) needs **no** admin change — the body textarea already accepts the syntax and stages/commits/diffs it through the existing `:update` flow. The following are graded conveniences, sequenced so the feature is usable before any of them land:

- **Insert helpers** (`post-form.js`): two buttons / keybindings above the body textarea that splice a footnote stub (`[^label]` at caret + `\n[^label]: ` appended) and a citation stub (`[@key]` at caret + a row in the `::: citations` block, created if absent). Reuse the existing `insertAtCaret` helper.
- **Citation-key autocomplete**: on typing `[@`, offer keys already defined in the block. Optional; mirrors the subjects autocomplete idea.
- **Lint on save** (`src/admin/lib/paratext-lint.js`, new): warn via the existing `flash()` statusline on — footnote reference with no definition (and vice-versa), duplicate footnote label, citation reference to an undefined key, duplicate citation key, citation missing `url`, unused citation definition. Warnings are non-blocking; the required-field guard in `save()` is untouched.

## 9. Versioning & diff behavior

No new versioning logic. Because definitions live in the body, editing a footnote or citation is an ordinary body edit that rides the `:update` bump picker and appears in the inline diff. The diff renders raw markdown (it does not run Marked), so the marker/definition **source** is what shows in a diff — deliberate and legible. Rendering markers inside diffs is an explicit non-goal for v1.

## 10. Files to touch

New:

- `src/markdown/paratext.js` — Marked extensions (footnote ref, footnote def strip, citation ref, `::: citations` block strip) + `extractParatext(body)`.
- `src/admin/lib/paratext-lint.js` — validation (Phase 3).
- `test/paratext.test.js` — extractor unit tests.

Modified:

- `src/lib/post-loader.js` — compute `post.footnotes` / `post.citations` in `parseOne`; extend the Post-shape doc comment.
- `src/lib/post-renderer.js` — register the paratext extension on the per-post Marked instance in `parseBodyFor`, passing the computed index.
- `src/public/views/marginalia.js` — render the two sections; wire entry → Read scroll.
- `src/public/main.js` — wire marker ↔ entry interaction in `showPost`, incl. mobile pane switch.
- `src/styles/post-body.css` — marker styling.
- `src/public/styles.css` — Marginalia section + highlight styling.
- `src/admin/forms/post-form.js` — insert helpers, optional autocomplete, lint call on save (Phase 2–3).
- `package.json` — add a `test` script (`node --test test/*.test.js`); no runtime dependency added (parsing is hand-rolled on the existing `marked`).

## 11. Implementation phases

1. **Parsing + read + marginalia (core).** `paratext.js` extractor and extensions; wire into `post-loader`, `post-renderer`, `marginalia.js`; marker styling. Deliverable: a post with footnotes and citations renders markers in Read and both sections in Marginalia. Author by typing raw syntax.
2. **Cross-pane interaction + admin insert helpers.** Marker ↔ entry highlight/scroll; insert buttons/keybindings in the form.
3. **Lint + autocomplete polish.** `paratext-lint.js`, `[@` key autocomplete.

## 12. Testing / verification

- **Unit** (`test/paratext.test.js`): extractor over fixtures — numeric and named footnotes; first-reference ordering; citation block parse incl. empty `year`/`url`; locator formatting (`[@k, 42]` → "p. 42", `[@k, 42–45]` → "pp. 42–45", `[@k, §3]` → "§3"); **markers inside inline code and fenced blocks are ignored**; orphan reference, orphan footnote definition (dropped + warned), duplicate key, undefined-key reference.
- **Build**: `npm run build` succeeds; `npm run preview` renders `ESS-2026-001` (seeded with sample footnotes + citations) with correct markers, both Marginalia sections, and working click-to-highlight in both directions.
- **Regression**: a post with no paratext renders identically to today (no empty sections, no stray markers); the version diff of a paratext edit shows the raw syntax change.
- **Screenshot** the three-pane public view after seeding, to confirm the marker/entry visual register matches the TUI palette.

## 13. Resolved (2026-07-06)

The three questions left open in the first draft are now settled and folded into the sections above:

- **Unreferenced footnote definitions** — dropped from the render, flagged by a non-blocking admin lint warning; only referenced footnotes are numbered (§3.1).
- **Citation ordering in Marginalia** — by first reference, so entry number always equals marker number (§6).
- **Locator vocabulary** — free text, not controlled: bare numbers/ranges get `p.`/`pp.`, everything else renders verbatim (§3.2).

No open questions remain; the design is ready to implement against §11.
