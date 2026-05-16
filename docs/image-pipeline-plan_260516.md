---
title: Image dither pipeline — implementation plan
date: 2026-05-16
status: planning
supersedes: none
related: build-plan_260515.md, cult-to-canon-report_250515.md
---

# Image dither pipeline — implementation plan

> Build-time dithered images for body prose in Cult to Canon. Authoring stays one-paste-or-drag simple; the dither and its bit-depth derivatives are generated at deploy time by a Vite plugin; the runtime enhances dither rest-states into interactive canvases via progressive enhancement. Readers without JavaScript still see the dither — that *is* the canonical body-text representation of the image.

## 1. Architecture in one paragraph

The admin author pastes or drags a single image into the post's body textarea. A markdown reference is inserted at the caret; the binary is queued for upload alongside the post's `.md` file on the next commit. The Netlify Function that handles GitHub writes accepts both text and binary blobs and commits them atomically through the Git Data API. At deploy, a Vite plugin walks every post's `images/` folder and uses `sharp` to produce the derived bit-depth layers — 1-bit Bayer dither, 4-tone gray, 8-color quant — at both 1× and 2× resolutions. The public renderer emits each inline image as a plain `<img>` pointing at the dither variant (so the page is already correct on first paint and stays correct without JavaScript). A small runtime enhancer uses `IntersectionObserver` to upgrade visible images into `<canvas>` elements with click-to-reveal interaction, lazy-loading the source image only on first click.

## 2. Asset model

Each post becomes a folder rather than a single `.md` file. The folder co-locates the post's prose with its image assets so deleting a post deletes its images, and so the Git diff for a post is contained in one tree:

```
src/content/posts/<post-slug>/
  post.md
  images/
    <image-name>.jpg                  # author-uploaded source (committed)
    <image-name>.dither.png           # build-time derivative
    <image-name>.dither@2x.png        # build-time derivative (retina)
    <image-name>.quantBw.png          # build-time derivative
    <image-name>.quantBw@2x.png       # build-time derivative (retina)
    <image-name>.quant.png            # build-time derivative
    <image-name>.quant@2x.png         # build-time derivative (retina)
    <image-name>.optimized.jpg        # build-time downscaled source
    <image-name>.optimized@2x.jpg     # build-time retina source
```

Only `<image-name>.<ext>` is committed by the admin; everything `.dither.*`, `.quantBw.*`, `.quant.*`, and `.optimized.*` is `.gitignore`d under `images/` and generated fresh by the build. The `build-plan_260515.md` already has a single-post-type model with a flat `src/content/posts/` directory; this change converts each post from a file to a folder. Existing index/list generators iterate folder entries instead of `.md` files and resolve to `<folder>/post.md` for content. The migration is a one-time rename — anything that currently exists as `<slug>.md` becomes `<slug>/post.md`.

## 3. Build-time pipeline — Phase 2

A new Vite plugin at `build/vite-plugin-image-dither.js` runs during the build. It depends on `sharp` (added to `package.json`) for image decode, downscale, and PNG encode. The plugin walks `src/content/posts/*/images/` and, for each source image not already accompanied by an up-to-date set of derivatives (judged by mtime comparison), produces the eight derived files listed above.

The dither algorithm is the Bayer 4×4 you settled on, hard-coded with the standard recursive matrix:

```js
const BAYER4 = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
```

with paper color `#d5d8db` and ink color `#073642` for the 1-bit and 4-tone layers, and pure CGA-style two-level-per-channel for the quant. Target sizing is 600px wide for 1× and 1200px wide for 2×, with proportional height; images smaller than 600px wide ship at native resolution only (no upscaling). The optimized source is JPEG at quality 85 with `mozjpeg` enabled. The build output lands in `dist/posts/<slug>/images/` mirroring the source structure.

A small companion script at `build/dither.js` exposes the dither operation as a standalone CLI for testing — `npm run dither -- src/content/posts/foo/images/bar.jpg` runs the same algorithm against a single file and writes the derivatives, useful for inspecting what the build will produce without running the full Vite build.

## 4. Markdown extension — Phase 1

Image syntax stays standard markdown:

```markdown
![alt text](images/figure-1.jpg)
```

The default behavior on render is the dither-and-reveal treatment. Three Pandoc-style attribute classes provide opt-out:

- `{.no-dither}` — render as a plain `<img>` pointing at the optimized source. Use for screenshots, charts, diagrams.
- `{.no-reveal}` — render the dither but disable the click-to-reveal interaction. The image stays in its 1-bit B&W form permanently. Use when the dither *is* the image (i.e., the typographic register is the point and the color is irrelevant).
- `{.full}` — render as a plain `<img>` at full unconstrained width, bypassing the body column. Use for hero or panoramic images.

The attribute syntax is parsed by a small marked extension at `src/markdown/image-attributes.js`. The renderer at `src/markdown/image-renderer.js` switches output based on the parsed class.

## 5. Admin authoring experience — Phase 3

The admin's Manuscript pane already has a markdown body textarea (ported from bayfujimoto.com's edit-item form). Two new handlers extend it.

A **paste handler** listens for `paste` events on the textarea. If `e.clipboardData.items` contains an image MIME type, the handler intercepts before the default paste, generates a filename — `<post-slug>-paste-<index>.<ext>` where `<index>` is the next unused integer in the post's `images/` folder — and inserts `![](images/<filename>)\n` at the caret position. The image blob is added to a pending-uploads queue keyed by filename. A small inline indicator next to the markdown reference shows "uploading" until the next commit clears it.

A **drag-drop handler** listens for `drop` events on the textarea. If `e.dataTransfer.files` contains image files, the handler runs the same insertion logic for each file, using the file's original name (slugified, suffixed `-2`, `-3`, etc. on collision within the post's images folder). Multi-file drops insert in sequence at the caret.

Both handlers route through a new module at `src/admin/lib/image-queue.js` that:

1. Validates the MIME type and size (max 10MB per image for v1; reject and toast on overflow).
2. Reads the blob into base64 for later commit.
3. Stores the entry in a `Map<filename, {blob, base64, postSlug}>` held in admin session state.
4. Returns the auto-generated filename so the caller can splice the markdown reference.

The existing `src/admin/lib/upload.js` is the integration point — it's already responsible for assembling the commit payload, and v1 just needs it to walk the image-queue and include each entry's base64-encoded blob alongside the `.md` file. No persistence of pending uploads across page reloads in v1; the admin commits before navigating away, or loses the queue. If this becomes painful, Phase 4 adds IndexedDB persistence.

The existing `netlify/functions/commit-all.js` is the bigger lift. The current implementation almost certainly uses GitHub's Contents API (`PUT /repos/:owner/:repo/contents/:path`), which is per-file and therefore non-atomic across multiple writes. Multi-file atomic commits require the Git Data API:

1. `GET /repos/:owner/:repo/git/ref/heads/main` to read the current commit SHA.
2. `GET /repos/:owner/:repo/git/commits/:sha` to read the current tree SHA.
3. `POST /repos/:owner/:repo/git/blobs` once per file (text and binary) to create blobs; binary blobs are submitted with `"encoding": "base64"`.
4. `POST /repos/:owner/:repo/git/trees` with the existing tree's SHA as `base_tree` and the new/changed files in the `tree` array.
5. `POST /repos/:owner/:repo/git/commits` with the new tree SHA and the previous commit SHA as the parent.
6. `PATCH /repos/:owner/:repo/git/refs/heads/main` to advance the branch pointer to the new commit.

This is the canonical multi-file-commit recipe and is documented at <https://docs.github.com/en/rest/git>. The function gets meaningfully longer but stays under ~150 lines.

## 6. Runtime renderer — Phase 2

The image renderer in `src/markdown/image-renderer.js` emits one of three element trees depending on the markdown attributes:

```html
<!-- Default (dither-and-reveal) -->
<img
  class="ctc-dither"
  src="/posts/<slug>/images/<name>.dither.png"
  srcset="/posts/<slug>/images/<name>.dither.png 1x, /posts/<slug>/images/<name>.dither@2x.png 2x"
  data-quantbw="/posts/<slug>/images/<name>.quantBw.png"
  data-quant="/posts/<slug>/images/<name>.quant.png"
  data-source="/posts/<slug>/images/<name>.optimized.jpg"
  alt="..."
  width="600" height="400"
  loading="lazy"
>

<!-- .no-dither -->
<img src=".../<name>.optimized.jpg" srcset="..." alt="..." width=".." height=".." loading="lazy">

<!-- .no-reveal -->
<img src=".../<name>.dither.png" srcset="..." alt="..." width=".." height=".." loading="lazy">
```

A runtime enhancer at `src/runtime/ctc-image-reveal.js` (loaded once per page from the Read pane) finds every `img.ctc-dither` on the page and registers it with a shared `IntersectionObserver`. When an image enters the viewport (rootMargin 200px so it initializes just before becoming visible), the observer fires `enhance(img)`:

1. Replace the `<img>` with a `<canvas>` of identical CSS dimensions, transferring the `alt` text to an adjacent visually-hidden `<figcaption>` for screen readers.
2. Load the dither PNG into the canvas via a fresh `Image()` element pointing at the same `src`. The dither file is small (typically < 10KB) and is already in the browser cache because the `<img>` triggered its load.
3. Attach `mousemove`, `mouseleave`, and `click` handlers, plus `Enter`/`Space` keyboard handlers via `tabindex="0"`.
4. Defer loading the other three layers until the user's first `click` — at which point the enhancer loads `data-quantbw`, `data-quant`, and `data-source` in parallel as `Image` elements, waits for them all (Promise.all of `decode()`), then runs the per-cell random animation from the mockup.

Hover flicker uses the small-region `getImageData` / `putImageData` approach from the v1.1 mockup — radius 14px in source coordinates, ~35% flip probability scaled by intensity, 80ms time-bucketed randomness. The animation duration is the 1.25-second value you settled on, with WIN=0.5 for the per-cell window, transitioning through dither → quantBw → quant → source on click-in and the reverse on click-out.

Memory management: a `WeakRef` to the canvas plus an `IntersectionObserver` that also fires on *exit* lets the enhancer release the four `Image` references and reset the canvas to a 1×1 transparent buffer when an image leaves the viewport by more than two screen-heights. Re-entering the viewport reloads the dither (cheap; cached) and waits for click to reload the rest. This keeps the memory of a long post bounded regardless of how many images it contains.

## 7. JS-disabled fallback

The default HTML rendered server-side already points `<img src>` at the dither PNG, so a reader without JavaScript sees the 1-bit Bayer dither version of every body image. They lose the color reveal but not the image's presence, the alt text, or the typographic coherence of the page. This is, in the project's terms, the correct fallback: the dither *is* the canonical body-text version of the image, and the color reveal is optional ornament.

For browsers without `IntersectionObserver` (vanishingly few in 2026), the enhancer falls back to enhancing all images on `DOMContentLoaded` rather than lazily — same outcome, slightly more work up front.

## 8. File paths and modules — new and modified

```
build/
  vite-plugin-image-dither.js          NEW
  dither.js                            NEW (standalone CLI for testing)

src/markdown/
  image-attributes.js                  NEW (marked extension)
  image-renderer.js                    NEW (custom <img> emitter)

src/runtime/
  ctc-image-reveal.js                  NEW (browser enhancer)
  ctc-image-reveal.css                 NEW (canvas styling, image-rendering: pixelated)

src/admin/forms/
  body-editor.js                       MODIFY (paste/drop handlers)

src/admin/lib/
  image-queue.js                       NEW (pending-uploads map)
  upload.js                            MODIFY (bundle image queue into commit)

netlify/functions/
  commit-all.js                        REWRITE (Git Data API, multi-file atomic)

package.json                           MODIFY (add sharp, marked-extensions)
vite.config.js                         MODIFY (register image-dither plugin)
.gitignore                             MODIFY (ignore generated PNG/JPG derivatives)
```

The biggest single change is `commit-all.js`; everything else slots cleanly into existing files or adds new ones.

## 9. Migration sequence across existing phases

The image system threads through the phases you've already settled rather than carving out a new one:

- **Phase 1 (content model).** Convert post layout from `<slug>.md` to `<slug>/post.md`. Add `images/` subfolder. Write the marked attributes extension and the custom image renderer. Update the post-loader to handle the folder layout. *No image-processing or admin work yet.*
- **Phase 2 (public site).** Land the Vite plugin and the runtime enhancer. At this point you can hand-place a JPEG in a post folder, run a build, and see the dither/reveal end-to-end in the public Read pane.
- **Phase 3 (admin port).** Land the paste/drop handlers, the image-queue module, the upload.js extension, and the rewritten commit-all.js. At this point the full author-to-reader loop works.
- **Phase 4 (iteration).** IndexedDB persistence of pending uploads across page reloads. Web Worker for the dither operation if Vite-side becomes a bottleneck. Blue noise as an optional dither method (premade noise texture shipped in `public/`). Per-post frontmatter override for default dither method, in case a particular essay wants halftone or atkinson for thematic reasons.

## 10. Verification checklist

A working v1 satisfies:

- The build plugin produces eight derivatives per source image and skips re-processing on `npm run build` when source mtimes haven't changed.
- A paste of an image into the body textarea inserts a markdown reference at the caret and queues the blob.
- A drag-drop does the same; multi-file drops insert sequentially.
- `npm run commit` (or whatever the admin's commit button triggers) writes a single Git commit containing the modified `post.md` and all queued image binaries.
- The Read pane on a public deploy shows the dither version on first paint, with no flash of unstyled content.
- Clicking a body image animates the per-cell color reveal over 1.25s; clicking again reverses.
- Hovering an unrevealed image produces a small pixel-level flicker within ~14px of the cursor.
- An image marked `{.no-dither}` renders as a plain `<img>` with no canvas enhancement and no event listeners.
- An image marked `{.no-reveal}` renders the dither but does not animate on click.
- A page with ten images loads under 2s on a 3G profile and stays under 50MB of resident memory while scrolling.
- A reader with JavaScript disabled sees the dither version of every image with correct alt text and no broken layout.

## 11. Decisions deferred to Phase 4

- **Keyboard interaction details.** v1 ships with `tabindex="0"` and Enter/Space activating the click. Whether to add focus-visible styling distinct from the hover flicker is a Phase 4 polish question.
- **Touch interaction.** v1 maps `tap` to click. Whether `long-press` substitutes for hover (with a faint haptic on iOS) waits for Phase 4.
- **Animated GIFs.** Out of scope for v1. The build plugin skips `.gif` files; the renderer falls through to a plain `<img>` if it encounters one. Phase 4 may add per-frame dithering for short loops, but the more likely answer is to discourage GIFs in body prose entirely.
- **Cropping and aspect ratio.** v1 honors the source image's native aspect ratio. Phase 4 may add explicit crop directives in the markdown attribute syntax (`{.crop=16x9 .focal=0.4,0.6}` or similar).
- **Per-image bit-depth overrides.** v1 always runs the four-stage chain. If a particular image looks better with fewer stages (small images, very high-contrast subjects), Phase 4 can add `{.stages=2}` to skip the quantBw and quant intermediates.

---

*References: Bryce Bayer, "An optimum method for two-level rendition of continuous tone pictures," IEEE Int. Conf. on Communications (1973); Robert Ulichney, Digital Halftoning (MIT Press, 1987); GitHub Git Data API documentation at docs.github.com/en/rest/git; Pandoc image attribute syntax at pandoc.org/MANUAL.html#extension-link_attributes.*
