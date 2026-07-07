// ── Post loader ──────────────────────────────────────────────────────────────
// Loads every post under src/content/posts/ at build time via Vite's
// `import.meta.glob` and returns them as fully-parsed Post objects. Validation
// warnings print to the console — non-fatal in Phase 1 so we can see exactly
// where stub posts diverge from the schema.
//
// As of the image-pipeline change (260516), each post is a *folder* rather
// than a single .md file: `src/content/posts/<slug>/post.md`, with images
// living as siblings under `<slug>/images/`. The folder layout lets the
// build's image-dither plugin co-locate derived assets with their source,
// and lets post deletion remove all associated images in one tree.
//
// The Post object shape (after validation):
//   {
//     id:         "ESS-2026-001",
//     version:    "0.3.1",       // semver; first publish is "0.1.0"
//     slug:       "on-the-backrooms-as-canon",
//     title:      "On the Backrooms as Canon",
//     created:    Date,
//     revised:    Date | null,
//     status:     "draft" | "stable" | "dormant" | "abandoned",
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
//     footnotes:  Array,         // { label, num, text } — ordered by first ref
//     citations:  Array,         // { key, num, author, title, year, url, locator }
//     folder:     "ESS-2026-001-on-the-backrooms-as-canon",  // post directory name
//     _file:      "/src/content/posts/ESS-2026-001-…/post.md",
//   }
//
// `footnotes` and `citations` are the post's paratext apparatus, parsed from
// the body by extractParatext (see src/markdown/paratext.js). They are the
// single source of truth for marker numbering, shared by the render extensions
// and the Marginalia view. Empty arrays when the post has no apparatus.

import { parseFrontMatter } from "./front-matter.js";
import { ENUMS } from "./vocabularies.js";
import { isPostId } from "./id.js";
import { wordCount } from "./history.js";
import { extractParatext } from "../markdown/paratext.js";

// Vite glob: each post's `post.md` lives under src/content/posts/<slug>/.
// Eagerly imported as raw strings. New posts trigger an HMR reload.
const RAW_POSTS = import.meta.glob("/src/content/posts/*/post.md", {
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
 * Return posts visible to the public (visibility `public`). Used by Browse
 * on the public site.
 */
export function getPublicPosts() {
  return getAllPosts().filter((p) => p.visibility === "public");
}

export function getPostById(id) {
  return ALL_POSTS.find((p) => p.id === id) || null;
}

// ── Parse + validate a single file ───────────────────────────────────────────
function parseOne(file, raw) {
  const { data, body, error } = parseFrontMatter(raw);

  // A YAML parse failure yields an empty `data` — every required field would
  // be undefined, silently corrupting downstream views. Skip the post loudly
  // rather than emitting a half-formed object.
  if (error) {
    warn(file, `front-matter failed to parse (${error}) — post skipped`);
    return null;
  }

  // Required fields
  for (const f of REQUIRED) {
    if (data[f] == null || data[f] === "") {
      warn(file, `missing required field \`${f}\``);
    }
  }

  // ID must match <KIND>-YYYY-NNN (kind short-code prefix; see lib/id.js)
  if (data.id && !isPostId(data.id)) {
    warn(file, `id \`${data.id}\` does not match <KIND>-YYYY-NNN`);
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

  // `folder` is the post's directory name under src/content/posts/, e.g.
  // "ESS-2026-001-on-the-backrooms-as-canon". The image renderer uses this
  // to build URLs to derived assets (image.dither.png and friends).
  const folder = folderFromFile(file);

  // Paratext apparatus — footnotes and citations parsed from the body. Any
  // lint warnings (orphan refs, undefined keys, unclosed blocks) print to the
  // console so authoring slips are visible during dev.
  const { footnotes, citations, warnings } = extractParatext(body);
  for (const w of warnings) warn(file, w);

  return {
    id:         data.id,
    version:    typeof data.version === "string" ? data.version : "0.1.0",
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
    footnotes,
    citations,
    folder,
    _file:      file,
  };
}

// Extract the post's directory name from its full file path. Given
// "/src/content/posts/ESS-2026-001-…/post.md" returns "ESS-2026-001-…".
function folderFromFile(file) {
  const parts = file.split("/");
  return parts[parts.length - 2] || "";
}

function coerceDate(v) {
  if (v instanceof Date && !Number.isNaN(+v)) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(+d)) return d;
  }
  return null;
}

function warn(file, msg) {
  // Show "<folder>/post.md" rather than just "post.md" so identical filenames
  // across many post folders stay distinguishable in the console.
  const parts = file.split("/");
  const tail  = parts.slice(-2).join("/");
  console.warn(`[post-loader] ${tail}: ${msg}`);
}
