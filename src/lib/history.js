// ── Revision history ─────────────────────────────────────────────────────────
// Each post that has ever been revised gets a sidecar history file:
//
//   src/content/history/<ID>.json
//   {
//     "id": "ESS-2026-001",
//     "versions": [
//       { "revised": "2026-05-01", "words": 1200, "body": "…prior markdown…" }
//     ]
//   }
//
// `versions` is append-only, oldest first. Each entry is the post body *as it
// was before* the revision that produced the next state. The current live text
// is always the .md file itself — it is never duplicated into history.
//
// Snapshots are captured by the admin Dispatch flow when an `edit` is
// committed; the history file rides the same /api/commit-all payload as the
// post. The public site reads these files to render the marginalia `versions`
// line and the inline diff.

// Vite glob: every history JSON, eagerly imported as a raw string. Resolves to
// an empty object when src/content/history/ has no files yet (fresh checkout).
const RAW_HISTORY = import.meta.glob("/src/content/history/*.json", {
  eager: true,
  query: "?raw",
  import: "default",
});

// Index by id (filename stem). Built once at module load.
const BY_ID = new Map();
for (const [file, raw] of Object.entries(RAW_HISTORY)) {
  const id = file.split("/").pop().replace(/\.json$/, "");
  try {
    const parsed = JSON.parse(raw);
    BY_ID.set(id, normalizeHistory(id, parsed));
  } catch (e) {
    console.warn(`[history] ${file}: failed to parse (${e.message}) — skipped`);
  }
}

/**
 * Shared word counter. Single implementation so the loader's `length` and a
 * version snapshot's `words` always agree.
 */
export function wordCount(text) {
  return String(text ?? "").split(/\s+/).filter(Boolean).length;
}

/**
 * Repo-relative path for a post's history sidecar. Mirrors the {ID}-{slug}.md
 * convention used by serializer.filePathFor — keyed on id only (no slug) so a
 * rename doesn't orphan the history.
 */
export function historyPathFor(id) {
  return `src/content/history/${id}.json`;
}

/**
 * Return the history object for a post id, or an empty shell when none exists.
 * Always shaped { id, versions: [] } so callers never branch on absence.
 */
export function getHistoryById(id) {
  return BY_ID.get(id) || { id, versions: [] };
}

/**
 * Pure: return a new history object with `entry` appended (oldest first).
 * `entry` = { revised, words, body }. Does not mutate `existing`.
 */
export function appendVersion(existing, entry) {
  const base = normalizeHistory(entry.id || existing?.id, existing);
  return {
    id: base.id,
    versions: [...base.versions, {
      revised: entry.revised,
      words:   entry.words,
      body:    entry.body,
    }],
  };
}

function normalizeHistory(id, obj) {
  return {
    id: obj?.id || id,
    versions: Array.isArray(obj?.versions) ? obj.versions : [],
  };
}
