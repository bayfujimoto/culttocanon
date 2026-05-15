// ── Post ID generation and parsing ───────────────────────────────────────────
// Cult to Canon post IDs follow the form:   POST-YYYY-NNN
//   POST     — fixed prefix (the only content type)
//   YYYY     — four-digit year the ID was minted (not when the piece will
//              be published; once minted, the year stays)
//   NNN      — zero-padded sequence number within that year, starting at 001
//
// Example: POST-2026-001, POST-2026-042, POST-2027-001.
//
// The sequence is per-year, so the namespace can be reused as time passes
// without numeric inflation. The admin (Phase 3) will track a counter file
// to mint new IDs; for hand-authored Phase 1 posts, the writer assigns
// the next number manually.

const ID_RE = /^POST-(\d{4})-(\d{3})$/;

export function isPostId(s) {
  return typeof s === "string" && ID_RE.test(s);
}

export function parseId(s) {
  const m = ID_RE.exec(s);
  if (!m) return null;
  return { year: Number(m[1]), n: Number(m[2]) };
}

export function formatId(year, n) {
  return `POST-${String(year).padStart(4, "0")}-${String(n).padStart(3, "0")}`;
}

/**
 * Given the current year and a list of existing IDs, return the next ID for
 * that year. Used by the Phase-3 admin's `:new` command.
 */
export function nextId(year, existingIds) {
  const used = new Set(
    existingIds
      .map(parseId)
      .filter(p => p && p.year === year)
      .map(p => p.n)
  );
  let n = 1;
  while (used.has(n)) n++;
  return formatId(year, n);
}
