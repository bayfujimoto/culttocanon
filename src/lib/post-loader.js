// ── Post loader ──────────────────────────────────────────────────────────────
// Loads every markdown file under src/content/posts/ at build time via Vite's
// `import.meta.glob` and returns them as fully-parsed Post objects. Validation
// warnings print to the console — non-fatal in Phase 1 so we can see exactly
// where stub posts diverge from the schema.
//
// The Post object shape (after validation):
//   {
//     id:         "POST-2026-001",
//     slug:       "on-the-backrooms-as-canon",
//     title:      "On the Backrooms as Canon",
//     created:    Date,
//     revised:    Date | null,
//     status:     "draft" | "evergreen" | "abandoned",
//     kind:       "essay" | "fragment" | "note" | "review" | "fiction",
//     register:   one of REGISTER,
//     confidence: one of CONFIDENCE | null,
//     subjects:   string[],
//     links:      string[]       // post IDs
//     visibility: "public" | "unlisted" | "private",
//     series:     string | null,
//     epigraph:   string | null,
//     length:     number,        // word count of body (auto-computed)
//     body:       string,        // markdown body
//     _file:      "/src/content/posts/POST-2026-001-…md",
//   }

import { parseFrontMatter } from "./front-matter.js";
import { ENUMS } from "./vocabularies.js";
import { isPostId } from "./id.js";

// Vite glob: every .md file under src/content/posts/, eagerly imported as raw
// strings. New posts trigger an HMR reload.
const RAW_POSTS = import.meta.glob("/src/content/posts/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

const REQUIRED = ["id", "slug", "title", "created", "status", "kind", "register", "visibility"];

const ALL_POSTS = Object.entries(RAW_POSTS)
  .map(([file, raw]) => parseOne(file, raw))
  .filter(Boolean);

/**
 * Return every loaded post. Sort: most recently created first.
 */
export function getAllPosts() {
  return ALL_POSTS.slice().sort((a, b) => +b.created - +a.created);
}

/**
 * Return posts visible to the public (status not `abandoned` and visibility
 * `public`). Used by Browse on the public site.
 */
export function getPublicPosts() {
  return getAllPosts().filter(
    (p) => p.visibility === "public" && p.status !== "abandoned"
  );
}

export function getPostById(id) {
  return ALL_POSTS.find((p) => p.id === id) || null;
}

// ── Parse + validate a single file ───────────────────────────────────────────
function parseOne(file, raw) {
  const { data, body } = parseFrontMatter(raw);

  // Required fields
  for (const f of REQUIRED) {
    if (data[f] == null || data[f] === "") {
      warn(file, `missing required field \`${f}\``);
    }
  }

  // ID must match POST-YYYY-NNN
  if (data.id && !isPostId(data.id)) {
    warn(file, `id \`${data.id}\` does not match POST-YYYY-NNN`);
  }

  // Enum checks
  for (const [field, values] of Object.entries(ENUMS)) {
    const v = data[field];
    if (v == null) continue;          // optional fields are fine when null
    if (!values.includes(v)) {
      warn(file, `\`${field}\` value \`${v}\` not in [${values.join(", ")}]`);
    }
  }

  // Dates — gray-matter / js-yaml parses ISO dates to Date objects; otherwise
  // coerce strings to Date.
  const created = coerceDate(data.created);
  const revised = data.revised ? coerceDate(data.revised) : null;
  if (data.created && !created) warn(file, `created \`${data.created}\` not a parseable date`);
  if (data.revised && !revised) warn(file, `revised \`${data.revised}\` not a parseable date`);

  // Subject / link arrays default to []
  const subjects = Array.isArray(data.subjects) ? data.subjects : [];
  const links    = Array.isArray(data.links)    ? data.links    : [];

  return {
    id:         data.id,
    slug:       data.slug,
    title:      data.title,
    created,
    revised,
    status:     data.status,
    kind:       data.kind,
    register:   data.register,
    confidence: data.confidence ?? null,
    subjects,
    links,
    visibility: data.visibility,
    series:     data.series   ?? null,
    epigraph:   data.epigraph ?? null,
    length:     wordCount(body),
    body:       body.trim(),
    _file:      file,
  };
}

function coerceDate(v) {
  if (v instanceof Date && !Number.isNaN(+v)) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(+d)) return d;
  }
  return null;
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function warn(file, msg) {
  console.warn(`[post-loader] ${file.split("/").pop()}: ${msg}`);
}
