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
import { serializePost, filePathFor } from "../lib/serializer.js";
import { stageChange } from "../state.js";

let _container = null;
let _post      = null;
let _isNew     = false;
let _dirty     = false;

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

  const fields = [
    field("title",      "title",      "text",     { required: true }),
    field("slug",       "slug",       "slug",     { required: true }),
    field("id",         "id",         "text",     { required: true, readonly: !isNew, monospace: true }),
    field("created",    "created",    "date",     { required: true }),
    field("revised",    "revised",    "date"),
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
        <button type="button" class="form-save" id="form-save">save&nbsp;<span class="form-save-hint">:w</span></button>
      </div>
      <div class="form-fields">
        ${fields.map(f => renderField(f, _post)).join("")}
      </div>
    </form>
  `;

  // Slug auto-fill from title
  wireSlugAutoFill();
  // Mark dirty on any change
  container.querySelectorAll("input, textarea, select").forEach(el => {
    el.addEventListener("input",  () => { _dirty = true; });
    el.addEventListener("change", () => { _dirty = true; });
  });
  // Save button
  container.querySelector("#form-save").addEventListener("click", save);
}

/**
 * Read the form, serialize it, stage it as a pending change. Called by `:w`
 * and by the Save button. Returns the staged change.
 *
 * No-op if no form is currently rendered (e.g., `:w` is pressed while the
 * dashboard is showing — we just want it to commit, not error).
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
      return `<input id="field-${f.name}" class="form-input" type="date" name="${f.name}" value="${escapeAttr(v)}">`;
    }
    case "select": {
      const opts = [`<option value="">—</option>`]
        .concat(f.values.map(v => `<option value="${escapeAttr(v)}" ${v === value ? "selected" : ""}>${escapeHTML(v)}</option>`));
      return `<select id="field-${f.name}" class="form-input" name="${f.name}">${opts.join("")}</select>`;
    }
    case "tags": {
      const v = Array.isArray(value) ? value.join(", ") : "";
      return `<input id="field-${f.name}" class="form-input is-mono" type="text" name="${f.name}" value="${escapeAttr(v)}" placeholder="comma-separated">`;
    }
    case "ids": {
      const v = Array.isArray(value) ? value.join("\n") : "";
      return `<textarea id="field-${f.name}" class="form-input is-mono" name="${f.name}" rows="3" placeholder="one POST-ID per line">${escapeHTML(v)}</textarea>`;
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
  const revisedRaw = v("#field-revised");
  data.revised  = revisedRaw ? new Date(revisedRaw + "T00:00:00Z") : null;

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
