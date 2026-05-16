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
import { stageChange } from "../state.js";
import { createListbox } from "./listbox.js";
import { parseId, formatId } from "../../lib/id.js";
import { addImageToQueue } from "../lib/image-queue.js";

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
        <button type="button" class="form-save" id="form-save">update&nbsp;<span class="form-save-hint">:update</span></button>
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
  // Mark dirty on any change. Hidden inputs (listbox value carriers) dispatch
  // a bubbling `change`, so this loop catches them too.
  container.querySelectorAll("input, textarea, select").forEach(el => {
    el.addEventListener("input",  () => { _dirty = true; });
    el.addEventListener("change", () => { _dirty = true; });
  });
  // Save button
  container.querySelector("#form-save").addEventListener("click", save);
}

/**
 * Read the form, serialize it, stage it as a pending change. Called by
 * `:update` (via the main handler) and by the Save button. Returns the
 * staged change.
 *
 * No-op if no form is currently rendered (e.g., `:update` is pressed while
 * the dashboard is showing — we just want it to commit, not error).
 */
export function save() {
  if (!_container) return null;
  if (!_container.querySelector("#field-id")) return null;

  const data = readForm();

  // Required-field guard — the form lets you elide them but we won't stage
  // an invalid post.
  for (const k of ["id", "slug", "title", "created", "status", "kind", "register", "visibility"]) {
    if (!data[k]) {
      flash(`missing ${k}`);
      return null;
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

  const change = {
    id:       data.id,
    action:   _isNew ? "add" : "edit",
    filePath: filePathFor(data),
    content:  serializePost(data),
  };

  stageChange(change);
  _dirty = false;
  flash(`staged ${change.id}`);
  return change;
}

export function isDirty() { return _dirty; }

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
