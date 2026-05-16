// ── Field vocabularies — single source of truth ──────────────────────────────
// Every enumerated field in the post schema is defined here. The admin form
// (Phase 3) reads these to build select inputs; the validator (post-loader.js)
// reads them to check that authored values are in-bounds; Marginalia reads
// them to display human-friendly labels.
//
// To add or remove a value: edit the array. Renames require a content sweep.
//
// These match the build-plan §5 schema. Minimal-start sets for `status` and
// `kind`; full sets for `register` and `confidence`.

export const STATUS = [
  "draft",
  "evergreen",
  "abandoned",
];

export const KIND = [
  "essay",
  "fragment",
  "note",
  "review",
  "fiction",
];

// 3-letter code per kind. Used by the index/browse "kind" column AND as the
// post-ID prefix (see src/lib/id.js). One source of truth so they never drift.
export const KIND_SHORT = {
  essay:    "ess",
  fragment: "frg",
  note:     "not",
  review:   "rev",
  fiction:  "fic",
};

export const REGISTER = [
  "academic",
  "belletristic",
  "plainspoken",
  "hybrid",
  "performative",
  "polemical",
  "lyric",
];

// Gwern Branwen's vocabulary, full set. Hyphenated where multi-word.
export const CONFIDENCE = [
  "log",
  "unlikely",
  "possible",
  "likely",
  "highly-likely",
  "certain",
];

export const VISIBILITY = [
  "public",
  "unlisted",
  "private",
];

// Convenience map for validators: every enum field by name.
export const ENUMS = {
  status:     STATUS,
  kind:       KIND,
  register:   REGISTER,
  confidence: CONFIDENCE,
  visibility: VISIBILITY,
};
