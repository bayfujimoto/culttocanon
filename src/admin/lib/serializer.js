// ── Markdown serializer ──────────────────────────────────────────────────────
// Convert a Post object back into the markdown-with-front-matter format that
// lives in src/content/posts/. Inverse of parseFrontMatter + post-loader.
//
// Conventions:
//   - empty / null / undefined fields are dropped from the front-matter
//   - empty arrays are dropped
//   - dates are emitted as YYYY-MM-DD (date-only) for the standard fields
//   - the body follows the closing `---` with a blank line

import yaml from "js-yaml";

// Order in which fields appear in serialized front-matter. Anything not listed
// gets appended at the end.
const FIELD_ORDER = [
  "id",
  "slug",
  "title",
  "created",
  "revised",
  "status",
  "kind",
  "register",
  "confidence",
  "subjects",
  "links",
  "visibility",
  "series",
  "epigraph",
];

export function serializePost(post) {
  const fm = buildFrontMatter(post);
  const yamlStr = yaml.dump(fm, {
    lineWidth:   -1,
    quotingType: '"',
    forceQuotes: false,
    flowLevel:   -1,
    sortKeys:    false,
  });

  const body = (post.body || "").replace(/\s+$/, ""); // trim trailing whitespace

  return `---\n${yamlStr}---\n\n${body}\n`;
}

function buildFrontMatter(post) {
  const out = {};

  // First, the fields we know about, in canonical order.
  for (const key of FIELD_ORDER) {
    const val = post[key];
    if (!shouldEmit(val)) continue;
    out[key] = normalize(key, val);
  }

  // Then anything else (defensive — there shouldn't be extras, but if a future
  // schema adds fields we don't recognize, preserve them).
  for (const [key, val] of Object.entries(post)) {
    if (key.startsWith("_")) continue;     // internal fields (_file, etc.)
    if (key === "body" || key === "length") continue;
    if (FIELD_ORDER.includes(key)) continue;
    if (!shouldEmit(val)) continue;
    out[key] = normalize(key, val);
  }

  return out;
}

function shouldEmit(val) {
  if (val === null || val === undefined || val === "") return false;
  if (Array.isArray(val) && val.length === 0)         return false;
  return true;
}

function normalize(key, val) {
  // Dates → ISO date string (YYYY-MM-DD)
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  return val;
}

/**
 * Build the file path under src/content/posts/ for a given post. Same
 * convention used by post-loader: {ID}-{slug}.md.
 */
export function filePathFor(post) {
  return `src/content/posts/${post.id}-${post.slug}.md`;
}
