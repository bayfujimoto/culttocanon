// ── Semver utilities ─────────────────────────────────────────────────────────
// Pure functions for the versioning system:
//
//   bumpVersion(current, category)
//     Given a semver string and a category in
//     {"patch","minor","major"}, return the next version.
//
//   bumpCategoryBetween(prev, next)
//     Given two adjacent semver strings, derive the category that produced
//     the bump. Returns "major" | "minor" | "patch". Throws if `next` is
//     not strictly higher than `prev`. Used by the dispatch flow to label
//     prior-version history entries under the Model A semantic.
//
// The category "initial" is never produced by these helpers — it is reserved
// for the very first history entry of a post (the v0.1.0 publish), set
// explicitly by the dispatch flow when history is otherwise empty.

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * @param {string} current  e.g. "0.3.1"
 * @param {"patch"|"minor"|"major"} category
 * @returns {string}        e.g. "0.3.2"
 */
export function bumpVersion(current, category) {
  const m = SEMVER_RE.exec(current);
  if (!m) throw new Error(`Invalid semver: ${current}`);
  const major = +m[1], minor = +m[2], patch = +m[3];
  switch (category) {
    case "patch": return `${major}.${minor}.${patch + 1}`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "major": return `${major + 1}.0.0`;
    default:      throw new Error(`Unknown bump category: ${category}`);
  }
}

/**
 * Derive the bump category that produced `next` from `prev`.
 *
 * @param {string} prev  the earlier semver
 * @param {string} next  the later semver
 * @returns {"major"|"minor"|"patch"}
 * @throws if either string is malformed, or if `next` is not strictly
 *         higher than `prev` in some component.
 */
export function bumpCategoryBetween(prev, next) {
  const p = SEMVER_RE.exec(prev);
  const n = SEMVER_RE.exec(next);
  if (!p || !n) throw new Error(`Invalid semver pair: "${prev}" → "${next}"`);
  if (+n[1] > +p[1]) return "major";
  if (+n[2] > +p[2]) return "minor";
  if (+n[3] > +p[3]) return "patch";
  throw new Error(`Not a forward bump: "${prev}" → "${next}"`);
}
