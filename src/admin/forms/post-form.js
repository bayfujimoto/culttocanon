// ── Post form ────────────────────────────────────────────────────────────────
// The unified form for the single post type. Renders inputs for every schema
// field, tracks an in-memory draft, and exposes a save() entry point that
// serializes the draft and stages it as a pending change.
//
// Field types in play:
//   text      — single-line strings (title, slug, series)
//   slug      — text with auto-fill button derived from title
//   date      — date-only YYYY-MM-DD
//   select    — single-pick from an enum
//   tags      — comma-separated list (subjects)
//   ids       — newline-separated list of post IDs (links)
//   textarea  — multi-line (epigraph, body)
//
// The form is uncontrolled — DOM inputs hold their own values and we read
// them on save. This is simpler than a controlled-state pattern and matches
// the way the bayfujimoto admin works.

import { STATUS, KIND, REGISTER, CONFIDENCE, VISIBILITY } from "../../lib/vocabularies.js";
import { slugify } from "../../lib/slug.js";
import { serializePost, filePathFor, folderNameFor } from "../lib/serializer.js";
import { stageChange, getState } from "../state.js";
import { createListbox } from "./listbox.js";
import { parseId, formatId } from "../../lib/id.js";
import { addImageToQueue } from "../lib/image-queue.js";
import { bumpVersion } from "../lib/version.js";
import { openBumpPicker, openStartVersionPicker } from "../lib/bump-picker.js";
import { lintParatext } from "../lib/paratext-lint.js";

let _container = null;
let _post      = null;
let _isNew     = false;
let _dirty     = false;
// Listbox instances built during the current render, mounted after innerHTML.
let _listboxes = [];

/**
 * Render the form into `container`. `post` is a Post-shaped draft (id, title,
 * etc.) — for new posts, the caller supplies a freshly-minted POST id and
 * empty fields.
 */
export function renderForm(container, post, { isNew = false } = {}) {
  _container = container;
  _post      = { ...post };
  _isNew     = isNew;
  _dirty     = false;
  _listboxes = [];

  const fields = [
    field("title",      "title",      "text",     { required: true }),
    field("slug",       "slug",       "slug",     { required: true }),
    field("id",         "id",         "text",     { required: true, readonly: !isNew, monospace: true }),
    field("created",    "created",    "date",     { required: true }),
    // `revised` is no longer hand-edited — the Dispatch flow stamps it
    // automatically when an edit is committed (see dispatch.js). Any existing
    // value on the draft is preserved through save() below.
    enumField("status",     "status",     STATUS,     { required: true }),
    enumField("kind",       "kind",       KIND,       { required: true }),
    enumField("register",   "register",   REGISTER,   { required: true }),
    enumField("confidence", "confidence", CONFIDENCE),
    enumField("visibility", "visibility", VISIBILITY, { required: true }),
    field("series",     "series",     "text"),
    field("subjects",   "subjects",   "tags"),
    field("links",      "links",      "ids"),
    field("epigraph",   "epigraph",   "textarea", { rows: 2 }),
    field("body",       "body",       "textarea", { rows: 20, monospace: true }),
  ];

  container.innerHTML = `
    <form class="form" id="post-form">
      <div class="form-header">
        <span class="form-title">${isNew ? "new piece" : escapeHTML(post.title || post.id)}</span>
        <span class="form-id">${escapeHTML(post.id || "—")}</span>
        <div class="form-actions" id="form-actions">
          <button type="button" class="form-save" id="form-save" title="stage / commit (:update)">update</button>
          ${isNew ? "" : `<button type="button" class="form-delete" id="form-delete" title="delete this piece">delete</button>`}
        </div>
      </div>
      <div class="form-fields">
        ${fields.map(f => renderField(f, _post)).join("")}
      </div>
    </form>
  `;

  // Mount custom listboxes (they back a hidden #field-<name> input)
  _listboxes.forEach(lb => lb.mount(container));
  // Slug auto-fill from title
  wireSlugAutoFill();
  // Date fields: validate YYYY-MM-DD on blur
  wireDateValidation();
  // Paste / drop image upload on the body textarea
  wireImageUpload();
  // "+ footnote" / "+ citation" insert helpers + live lint above the body
  mountParatextToolbar();
  // `[@` citation-key autocomplete inside the body textarea
  wireCitationAutocomplete();
  // Mark dirty on any change. Hidden inputs (listbox value carriers) dispatch
  // a bubbling `change`, so this loop catches them too.
  container.querySelectorAll("input, textarea, select").forEach(el => {
    el.addEventListener("input",  () => { _dirty = true; });
    el.addEventListener("change", () => { _dirty = true; });
  });
  // Save button
  container.querySelector("#form-save").addEventListener("click", save);
  // Delete button (existing posts only) — opens an inline slug-confirm gate.
  wireDeleteButton();
}

/**
 * Read the form, validate it, then open the statusbar version picker. The
 * pending change is staged on the picker's confirm — carrying the chosen
 * `bump` (edits) or `startVersion` (adds) plus a display `newVersion`. The
 * actual version/revised rewrite still happens at dispatch time so the
 * prior-body history snapshot is captured correctly (see dispatch.js).
 *
 * Called by `:update` (via the main handler) and by the Save button.
 * Interactive: returns nothing — the stage happens asynchronously via the
 * picker callback. On cancel, nothing is staged and the form stays dirty.
 *
 * No-op if no form is currently rendered (e.g., `:update` is pressed while
 * the dashboard is showing — we just want it to commit, not error).
 */
export function save() {
  if (!_container) return;
  if (!_container.querySelector("#field-id")) return;

  const data = readForm();

  // Advisory paratext lint — non-blocking, logged for the record at commit
  // time (the live toolbar readout is the primary surface while authoring).
  const lintIssues = lintParatext(data.body);
  if (lintIssues.length) {
    console.warn(`[paratext] ${lintIssues.length} issue(s) in ${data.id || "post"}:\n  ${lintIssues.join("\n  ")}`);
  }

  // Required-field guard — the form lets you elide them but we won't stage
  // an invalid post.
  for (const k of ["id", "slug", "title", "created", "status", "kind", "register", "visibility"]) {
    if (!data[k]) {
      flash(`missing ${k}`);
      return;
    }
  }

  // For a new post the ID minted at `:new` is provisional — its prefix used
  // the default kind. Re-derive the prefix from the kind the author actually
  // chose, keeping the already-minted year+sequence. Existing posts open with
  // `_isNew === false` and a readonly id, so their IDs are never touched.
  if (_isNew) {
    const parsed = parseId(data.id);
    if (parsed) data.id = formatId(data.kind, parsed.year, parsed.n);
  }

  const stage = (extra) => {
    const change = {
      id:       data.id,
      action:   _isNew ? "add" : "edit",
      filePath: filePathFor(data),
      content:  serializePost(data),
      ...extra,
    };
    stageChange(change);
    _dirty = false;
    flash(`staged ${change.id} → v${change.newVersion}`);
  };

  if (_isNew) {
    openStartVersionPicker(data, {
      onConfirm: (startVersion) => {
        data.version = startVersion;
        stage({ bump: null, startVersion, newVersion: startVersion });
      },
      onCancel: () => flash("save cancelled"),
    });
    return;
  }

  // Editing — bump relative to the post's current version. Read from the live
  // state.allPosts (refreshed by dispatch after each successful commit) so a
  // back-to-back save on the same open form doesn't bump from the stale value
  // captured when this form was first rendered.
  const live    = getState().allPosts.find(p => p.id === data.id);
  const current = live?.version || _post?.version || "0.1.0";
  openBumpPicker({ id: data.id, version: current }, {
    onConfirm: (category) => {
      const newVersion = bumpVersion(current, category);
      stage({ bump: category, startVersion: null, newVersion });
    },
    onCancel: () => flash("save cancelled"),
  });
}

export function isDirty() { return _dirty; }

// ── Delete flow ──────────────────────────────────────────────────────────────
// Deleting is a staged, committed operation like a save — never an immediate
// destructive act. The button swaps the header actions for a confirm gate that
// requires the author to retype the post's slug (the familiar "type the name
// to delete" pattern). On confirm we stage a `delete` change and hand off to
// the Dispatch pane, where it rides the next commit alongside any other work.
function wireDeleteButton() {
  const actions = _container.querySelector("#form-actions");
  const delBtn  = actions?.querySelector("#form-delete");
  if (!actions || !delBtn) return;            // new posts have no delete button
  delBtn.addEventListener("click", () => openDeleteConfirm(actions));
}

function openDeleteConfirm(actions) {
  const slug = _post?.slug || "";
  actions.innerHTML = `
    <span class="form-delete-prompt">type <code>${escapeHTML(slug)}</code> to confirm</span>
    <input type="text" id="form-delete-slug" class="form-delete-input"
           placeholder="slug" autocomplete="off" autocapitalize="off"
           spellcheck="false" aria-label="retype the slug to confirm deletion">
    <button type="button" class="form-delete-go" id="form-delete-go" disabled>delete</button>
    <button type="button" class="form-delete-cancel" id="form-delete-cancel">cancel</button>
  `;
  const input  = actions.querySelector("#form-delete-slug");
  const goBtn  = actions.querySelector("#form-delete-go");
  const cancel = actions.querySelector("#form-delete-cancel");

  const matches = () => input.value.trim() === slug && slug !== "";
  const sync    = () => { goBtn.disabled = !matches(); };
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter")  { e.preventDefault(); if (matches()) confirmDelete(); }
    if (e.key === "Escape") { e.preventDefault(); restoreActions(actions); }
  });
  goBtn.addEventListener("click", () => { if (matches()) confirmDelete(); });
  cancel.addEventListener("click", () => restoreActions(actions));
  input.focus();
}

// Restore the default update/delete buttons after a cancelled confirm.
function restoreActions(actions) {
  actions.innerHTML = `
    <button type="button" class="form-save" id="form-save" title="stage / commit (:update)">update</button>
    <button type="button" class="form-delete" id="form-delete" title="delete this piece">delete</button>
  `;
  actions.querySelector("#form-save").addEventListener("click", save);
  actions.querySelector("#form-delete").addEventListener("click", () => openDeleteConfirm(actions));
}

// Stage a delete for the open post and return to the dashboard — the pending
// deletion now lives in the Dispatch pane. filePathFor gives the post's
// `post.md`; Dispatch derives the folder + history sidecar to remove from it
// at commit time (see dispatch.js → triggerCommit, delete branch).
function confirmDelete() {
  const post = { id: _post.id, slug: _post.slug };
  stageChange({
    id:       post.id,
    action:   "delete",
    filePath: filePathFor(post),
  });
  _dirty = false;
  flash(`staged delete ${post.id}`);
  window.location.hash = "#/";
}

// ── Field builders ───────────────────────────────────────────────────────────
function field(name, label, type, opts = {}) {
  return { name, label, type, ...opts };
}

function enumField(name, label, values, opts = {}) {
  return { name, label, type: "select", values, ...opts };
}

// ── Renderers ────────────────────────────────────────────────────────────────
function renderField(f, post) {
  const value = post[f.name];
  return `
    <div class="form-row">
      <label class="form-label" for="field-${f.name}">${f.label}${f.required ? '<span class="form-req">*</span>' : ""}</label>
      <div class="form-control">${renderControl(f, value)}</div>
    </div>
  `;
}

function renderControl(f, value) {
  const mono = f.monospace ? " is-mono" : "";
  const ro   = f.readonly  ? " readonly" : "";

  switch (f.type) {
    case "text":
      return `<input id="field-${f.name}" class="form-input${mono}" type="text" name="${f.name}" value="${escapeAttr(value ?? "")}"${ro}>`;
    case "slug":
      return `
        <div class="form-slug-row">
          <input id="field-${f.name}" class="form-input is-mono" type="text" name="${f.name}" value="${escapeAttr(value ?? "")}">
          <button type="button" class="form-slug-fill" id="slug-fill" title="derive from title">↯</button>
        </div>
      `;
    case "date": {
      let v = "";
      if (value instanceof Date) v = value.toISOString().slice(0, 10);
      else if (typeof value === "string" && value) v = value.slice(0, 10);
      return `<input id="field-${f.name}" class="form-input is-mono form-date"
                type="text" inputmode="numeric" name="${f.name}"
                value="${escapeAttr(v)}" placeholder="YYYY-MM-DD"
                pattern="\\d{4}-\\d{2}-\\d{2}" aria-label="${escapeAttr(f.label)} (YYYY-MM-DD)">`;
    }
    case "select": {
      const lb = createListbox({ name: f.name, value: value ?? "", values: f.values });
      _listboxes.push(lb);
      return lb.html;
    }
    case "tags": {
      const v = Array.isArray(value) ? value.join(", ") : "";
      return `<input id="field-${f.name}" class="form-input is-mono" type="text" name="${f.name}" value="${escapeAttr(v)}" placeholder="comma-separated">`;
    }
    case "ids": {
      const v = Array.isArray(value) ? value.join("\n") : "";
      return `<textarea id="field-${f.name}" class="form-input is-mono" name="${f.name}" rows="3" placeholder="one post ID per line">${escapeHTML(v)}</textarea>`;
    }
    case "textarea":
      return `<textarea id="field-${f.name}" class="form-input${mono}" name="${f.name}" rows="${f.rows || 4}">${escapeHTML(value ?? "")}</textarea>`;
    default:
      return `<input id="field-${f.name}" class="form-input" type="text" name="${f.name}" value="${escapeAttr(value ?? "")}">`;
  }
}

// ── Wire slug auto-fill ──────────────────────────────────────────────────────
function wireSlugAutoFill() {
  const btn   = _container.querySelector("#slug-fill");
  const title = _container.querySelector("#field-title");
  const slug  = _container.querySelector("#field-slug");
  if (!btn || !title || !slug) return;
  btn.addEventListener("click", () => {
    if (!title.value) return;
    slug.value = slugify(title.value);
    _dirty = true;
  });
}

// ── Wire date-field validation ───────────────────────────────────────────────
// The OS date picker is gone (see listbox.js rationale); these are plain text
// fields, so guard the YYYY-MM-DD format on blur. The save() required-field
// guard still applies; this just gives early, in-place feedback.
function wireDateValidation() {
  _container.querySelectorAll(".form-date").forEach(el => {
    el.addEventListener("blur", () => {
      const v = el.value.trim();
      const ok = v === "" || isValidISODate(v);
      el.classList.toggle("is-invalid", !ok);
      if (!ok) flash(`${el.name}: expected YYYY-MM-DD`);
    });
  });
}

function isValidISODate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ── Wire image upload on the body textarea ──────────────────────────────────
// Paste an image from the clipboard, or drag an image file onto the textarea,
// and we:
//   1. queue the binary alongside the post for commit (image-queue.js)
//   2. insert a markdown reference `![](images/<name>)` at the caret
//   3. mark the form dirty so the change rides the next :update
//
// The post's image folder is derived from the form's current id+slug — for
// a new post being authored, this works as soon as those fields are filled
// in. If the author pastes before filling them in, we flash a hint.
function wireImageUpload() {
  const body = _container.querySelector("#field-body");
  if (!body) return;

  // Compute the post folder from the form's current state (so it picks up
  // unsaved edits to id or slug). Returns null if either is missing.
  const folderForCurrent = () => {
    const id   = (_container.querySelector("#field-id")?.value || "").trim();
    const slug = (_container.querySelector("#field-slug")?.value || "").trim();
    if (!id || !slug) return null;
    return folderNameFor({ id, slug });
  };

  body.addEventListener("paste", async (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter(i => i.kind === "file" && /^image\//.test(i.type));
    if (imageItems.length === 0) return;   // not an image paste — let it through

    e.preventDefault();
    const folder = folderForCurrent();
    if (!folder) {
      flash("set title + slug before uploading images");
      return;
    }

    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (!blob) continue;
      const res = await addImageToQueue(blob, folder);
      if (res?.error) {
        flash(res.error);
        continue;
      }
      if (res?.markdownRef) {
        insertAtCaret(body, `![](${res.markdownRef})`);
      }
    }
    _dirty = true;
  });

  body.addEventListener("dragover", (e) => {
    if (Array.from(e.dataTransfer?.types || []).includes("Files")) {
      e.preventDefault();
      body.classList.add("is-dropping");
    }
  });

  body.addEventListener("dragleave", () => {
    body.classList.remove("is-dropping");
  });

  body.addEventListener("drop", async (e) => {
    body.classList.remove("is-dropping");
    const files = Array.from(e.dataTransfer?.files || []).filter(f => /^image\//.test(f.type));
    if (files.length === 0) return;

    e.preventDefault();
    const folder = folderForCurrent();
    if (!folder) {
      flash("set title + slug before uploading images");
      return;
    }

    for (const file of files) {
      const res = await addImageToQueue(file, folder, { fromFilename: file.name });
      if (res?.error) {
        flash(res.error);
        continue;
      }
      if (res?.markdownRef) {
        insertAtCaret(body, `![](${res.markdownRef})`);
      }
    }
    _dirty = true;
  });
}

// Splice `text` into a textarea at the current caret, advance the caret
// past the inserted text, and dispatch an `input` event so the existing
// dirty-tracking listener fires.
function insertAtCaret(textarea, text) {
  const start = textarea.selectionStart;
  const end   = textarea.selectionEnd;
  const prev  = textarea.value;
  textarea.value = prev.slice(0, start) + text + prev.slice(end);
  const newPos = start + text.length;
  textarea.selectionStart = textarea.selectionEnd = newPos;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

// ── Paratext insert helpers ──────────────────────────────────────────────────
// A small toolbar above the body textarea with two buttons. Each splices a
// marker at the caret and appends the matching definition stub, so authoring a
// footnote or citation is one click plus filling in the blank. The syntax is
// the same the renderer parses (see src/markdown/paratext.js); numbering is
// computed at render time, so these only need to keep labels/keys unique.
function mountParatextToolbar() {
  const body = _container.querySelector("#field-body");
  if (!body) return;
  const control = body.closest(".form-control");
  if (!control || control.querySelector(".form-paratext-bar")) return;
  control.classList.add("form-control--body");   // positioning ctx for autocomplete

  const bar = document.createElement("div");
  bar.className = "form-paratext-bar";
  bar.innerHTML =
    `<button type="button" class="form-paratext-btn" id="pt-footnote" title="insert a footnote: marker at the caret + a definition to fill in">+ footnote</button>` +
    `<button type="button" class="form-paratext-btn" id="pt-citation" title="insert a citation: marker at the caret + a works-cited row to fill in">+ citation</button>` +
    `<span class="form-paratext-lint" id="pt-lint" aria-live="polite"></span>`;
  control.insertBefore(bar, body);
  bar.querySelector("#pt-footnote").addEventListener("click", insertFootnote);
  bar.querySelector("#pt-citation").addEventListener("click", insertCitation);

  // Live, non-blocking lint readout — updates as the body changes.
  body.addEventListener("input", updateParatextLint);
  updateParatextLint();
}

// Refresh the toolbar lint readout from the current body. Empty when clean;
// otherwise a count with the full list in the tooltip.
function updateParatextLint() {
  const body = _container.querySelector("#field-body");
  const el   = _container.querySelector("#pt-lint");
  if (!body || !el) return;
  const issues = lintParatext(body.value);
  if (!issues.length) {
    el.textContent = "";
    el.removeAttribute("title");
    el.classList.remove("has-issues");
    return;
  }
  el.textContent = `⚠ ${issues.length} paratext issue${issues.length > 1 ? "s" : ""}`;
  el.title = issues.join("\n");
  el.classList.add("has-issues");
}

// Insert `[^N]` at the caret and append a `[^N]: ` definition line at the end
// of the body, leaving the caret on the empty definition to type the note.
function insertFootnote() {
  const body = _container.querySelector("#field-body");
  if (!body) return;
  const label = nextFootnoteLabel(body.value);
  insertAtCaret(body, `[^${label}]`);

  let v = body.value;
  const needsNewline    = !/\n$/.test(v);
  const alreadyHasDefs  = /(^|\n)\[\^[^\]\s]+\]:/.test(v);
  body.value = v + (needsNewline ? "\n" : "") + (alreadyHasDefs ? "" : "\n") + `[^${label}]: `;
  const end = body.value.length;
  body.setSelectionRange(end, end);
  body.dispatchEvent(new Event("input", { bubbles: true }));
  body.focus();
  _dirty = true;
}

// Insert `[@key]` at the caret and add a stub row to the ::: citations block
// (creating the block at the end if it doesn't exist yet). Leaves the caret
// selecting the row's "Author" placeholder.
function insertCitation() {
  const body = _container.querySelector("#field-body");
  if (!body) return;
  const key = nextCitationKey(body.value);
  insertAtCaret(body, `[@${key}]`);

  const row = `${key} | Author | Title | Year | URL`;
  let v = body.value;
  if (/(^|\n):::[ \t]*citations[ \t]*\r?\n/.test(v)) {
    // Splice the row in just before the first block's closing :::.
    v = v.replace(/(:::[ \t]*citations[ \t]*\r?\n[\s\S]*?)(\r?\n:::[ \t]*)/, `$1\n${row}$2`);
  } else {
    if (!/\n$/.test(v)) v += "\n";
    v += `\n::: citations\n${row}\n:::\n`;
  }
  body.value = v;

  const idx = body.value.indexOf(row);
  if (idx >= 0) {
    const authorStart = idx + key.length + 3;      // past "key | "
    body.setSelectionRange(authorStart, authorStart + "Author".length);
  }
  body.dispatchEvent(new Event("input", { bubbles: true }));
  body.focus();
  _dirty = true;
}

// Next unused numeric footnote label (max existing + 1).
function nextFootnoteLabel(text) {
  let max = 0;
  for (const m of text.matchAll(/\[\^(\d+)\]/g)) max = Math.max(max, parseInt(m[1], 10));
  return max + 1;
}

// Next free `srcN` citation key not already used as a reference or row key.
function nextCitationKey(text) {
  const keys = new Set();
  for (const m of text.matchAll(/\[@([A-Za-z0-9_.:-]+)/g)) keys.add(m[1]);
  let n = 1;
  while (keys.has(`src${n}`)) n++;
  return `src${n}`;
}

// ── Citation-key autocomplete ────────────────────────────────────────────────
// Typing `[@` in the body offers the keys defined in the ::: citations block.
// Arrow keys move the selection; Enter/Tab accept; Esc dismisses; click
// selects. The dropdown anchors to the bottom of the body textarea — simple
// and predictable; caret-pixel anchoring is a possible later refinement.
let _acList  = null;
let _acItems = [];
let _acIndex = -1;

function wireCitationAutocomplete() {
  const body = _container.querySelector("#field-body");
  if (!body) return;
  const control = body.closest(".form-control");
  if (!control) return;

  _acList = document.createElement("ul");
  _acList.className = "form-cite-complete";
  _acList.hidden = true;
  control.appendChild(_acList);

  body.addEventListener("input",   () => refreshAutocomplete(body));
  body.addEventListener("keydown", (e) => handleAutocompleteKey(e, body));
  body.addEventListener("blur",    () => setTimeout(hideAutocomplete, 120));
  // mousedown (not click) so selection lands before the textarea's blur fires.
  _acList.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-key]");
    if (!li) return;
    e.preventDefault();
    acceptAutocomplete(body, li.dataset.key);
  });
}

// The partial citation key being typed immediately before the caret, or null
// when the caret isn't inside an open `[@…` reference.
function currentCitationPartial(body) {
  const before = body.value.slice(0, body.selectionStart);
  const m = /\[@([A-Za-z0-9_.:-]*)$/.exec(before);
  return m ? m[1] : null;
}

// Keys declared in the first ::: citations block.
function definedCitationKeys(text) {
  const keys = [];
  const block = /(?:^|\n):::[ \t]*citations[ \t]*\r?\n([\s\S]*?)\r?\n:::/.exec(text);
  if (block) {
    for (const line of block[1].split(/\r?\n/)) {
      const k = line.split("|")[0]?.trim();
      if (k) keys.push(k);
    }
  }
  return [...new Set(keys)];
}

function refreshAutocomplete(body) {
  const partial = currentCitationPartial(body);
  if (partial === null) { hideAutocomplete(); return; }
  const cands = definedCitationKeys(body.value).filter((k) => k.startsWith(partial));
  if (!cands.length) { hideAutocomplete(); return; }
  _acItems = cands;
  _acIndex = 0;
  _acList.innerHTML = cands.map((k, i) =>
    `<li data-key="${escapeAttr(k)}" class="${i === 0 ? "is-active" : ""}">${escapeHTML(k)}</li>`
  ).join("");
  _acList.hidden = false;
}

function handleAutocompleteKey(e, body) {
  if (_acList.hidden) return;
  if (e.key === "ArrowDown")    { e.preventDefault(); moveAutocomplete(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveAutocomplete(-1); }
  else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    acceptAutocomplete(body, _acItems[_acIndex]);
  } else if (e.key === "Escape") { e.preventDefault(); hideAutocomplete(); }
}

function moveAutocomplete(delta) {
  const items = Array.from(_acList.querySelectorAll("li"));
  if (!items.length) return;
  items[_acIndex]?.classList.remove("is-active");
  _acIndex = (_acIndex + delta + items.length) % items.length;
  items[_acIndex].classList.add("is-active");
  items[_acIndex].scrollIntoView({ block: "nearest" });
}

function acceptAutocomplete(body, key) {
  if (!key) { hideAutocomplete(); return; }
  const pos    = body.selectionStart;
  const before = body.value.slice(0, pos);
  const after  = body.value.slice(pos);
  const m = /\[@([A-Za-z0-9_.:-]*)$/.exec(before);
  if (!m) { hideAutocomplete(); return; }
  const start  = pos - m[1].length;               // just after "[@"
  const insert = key + "]";
  body.value = before.slice(0, start) + insert + after;
  const caret = start + insert.length;
  body.setSelectionRange(caret, caret);
  body.dispatchEvent(new Event("input", { bubbles: true }));
  hideAutocomplete();
  body.focus();
}

function hideAutocomplete() {
  if (!_acList) return;
  _acList.hidden = true;
  _acList.innerHTML = "";
  _acIndex = -1;
  _acItems = [];
}

// ── Read form back into a Post object ────────────────────────────────────────
function readForm() {
  const data = {};
  const v    = (sel) => (_container.querySelector(sel)?.value ?? "");
  const t    = (sel) => v(sel).trim();

  data.id       = t("#field-id");
  data.slug     = t("#field-slug");
  data.title    = t("#field-title");

  const createdRaw = v("#field-created");
  data.created  = createdRaw ? new Date(createdRaw + "T00:00:00Z") : null;
  // `revised` has no input — it's stamped automatically at dispatch. Carry any
  // existing value through unchanged so save() doesn't drop it pre-dispatch.
  data.revised  = _post?.revised ?? null;
  // `version` has no input either — it's bumped by the `:update` flow at
  // dispatch time. Carry it through unchanged so save() doesn't drop it; new
  // posts inherit "0.1.0" from the blank template in renderNew.
  data.version  = _post?.version ?? "0.1.0";

  data.status     = v("#field-status")     || null;
  data.kind       = v("#field-kind")       || null;
  data.register   = v("#field-register")   || null;
  data.confidence = v("#field-confidence") || null;
  data.visibility = v("#field-visibility") || null;
  data.series     = t("#field-series")     || null;

  data.subjects = v("#field-subjects").split(",").map(s => s.trim()).filter(Boolean);
  data.links    = v("#field-links").split("\n").map(s => s.trim()).filter(Boolean);

  data.epigraph = t("#field-epigraph") || null;
  data.body     = v("#field-body");

  return data;
}

// ── Flash a message in the statusline ───────────────────────────────────────
function flash(msg) {
  const el = document.getElementById("shell-status-state");
  if (!el) return;
  const original = el.textContent;
  el.textContent = msg;
  el.classList.add("shell-status-state--saved");
  setTimeout(() => {
    el.textContent = original;
    el.classList.remove("shell-status-state--saved");
  }, 1500);
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function escapeAttr(s) { return escapeHTML(s); }
