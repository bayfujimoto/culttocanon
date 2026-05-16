// ── Post ID generation and parsing ───────────────────────────────────────────
// Cult to Canon post IDs follow the form:   <SHORT>-YYYY-NNN
//   <SHORT>  — the post's kind as a 3-letter code, upper-cased
//              (ESS, FRG, NOT, REV, FIC). See KIND_SHORT in vocabularies.js.
//   YYYY     — four-digit year the ID was minted (not when the piece will
//              be published; once minted, the year stays)
//   NNN      — zero-padded sequence number within that year, starting at 001
//
// Example: ESS-2026-001, FRG-2026-042, NOT-2027-001.
//
// The sequence is per-year and GLOBAL across kinds (the prefix does not scope
// it), so the namespace can be reused as time passes without numeric
// inflation. The prefix is decided from the post's kind at first save (see
// post-form.js); once a post exists its ID is frozen.

import { KIND_SHORT } from "./vocabularies.js";

// Regex is built from the actual short codes so it can never drift from the
// map. Group 1 = prefix, 2 = year, 3 = sequence.
const PREFIXES = Object.values(KIND_SHORT).map(s => s.toUpperCase());
const ID_RE = new RegExp(`^(${PREFIXES.join("|")})-(\\d{4})-(\\d{3})$`);

export function isPostId(s) {
  return typeof s === "string" && ID_RE.test(s);
}

export function parseId(s) {
  const m = ID_RE.exec(s);
  if (!m) return null;
  return { prefix: m[1], year: Number(m[2]), n: Number(m[3]) };
}

/** Upper-cased 3-letter prefix for a kind; "" for an unknown kind. */
export function kindToPrefix(kind) {
  return (KIND_SHORT[kind] || "").toUpperCase();
}

export function formatId(kind, year, n) {
  return `${kindToPrefix(kind)}-${String(year).padStart(4, "0")}-${String(n).padStart(3, "0")}`;
}

/**
 * Given the post's kind, the current year, and a list of existing IDs, return
 * the next ID for that year. Used by the Phase-3 admin's `:new` command.
 *
 * The sequence is global per year: the gap-fill scans every ID of `year`
 * regardless of prefix, so kinds share one numbering line.
 */
export function nextId(kind, year, existingIds) {
  const used = new Set(
    existingIds
      .map(parseId)
      .filter(p => p && p.year === year)
      .map(p => p.n)
  );
  let n = 1;
  while (used.has(n)) n++;
  return formatId(kind, year, n);
}
