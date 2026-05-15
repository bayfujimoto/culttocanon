// ── Slug generation ──────────────────────────────────────────────────────────
// Convert a piece's title into a URL-safe slug. The slug is part of the file
// path and the public URL, and once written it should stay stable — renames
// after publication require a redirect.
//
// Convention:
//   - lowercase ASCII
//   - words separated by single hyphens
//   - strip apostrophes, smart quotes, em dashes, periods, parentheses
//   - drop articles "a", "an", "the" only at the start
//   - collapse runs of non-word chars to one hyphen
//   - max 80 chars (truncate at word boundary)

const LEADING_ARTICLES = /^(?:a|an|the)\s+/i;

export function slugify(title) {
  if (!title) return "";

  let s = title.trim();

  // Drop leading article so "The Backrooms" → "backrooms" not "the-backrooms"
  s = s.replace(LEADING_ARTICLES, "");

  // Normalize unicode and strip diacritics
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

  // Replace smart quotes, em/en dashes, ellipsis with their plain ASCII
  s = s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/…/g, "...");

  // Lowercase, drop everything that isn't a word char or space or hyphen,
  // then collapse whitespace and hyphens to single hyphens.
  s = s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  // Truncate at 80 chars, preferring a hyphen boundary
  if (s.length > 80) {
    const cut = s.slice(0, 80);
    const lastHyphen = cut.lastIndexOf("-");
    s = lastHyphen > 40 ? cut.slice(0, lastHyphen) : cut;
  }

  return s;
}
