// ── Paratext lint ────────────────────────────────────────────────────────────
// Advisory checks over a post's footnote/citation apparatus, run in the admin
// while authoring (see the toolbar readout in forms/post-form.js). Non-blocking
// — a piece with lint issues can still be saved; these just surface authoring
// slips early.
//
// Most warnings come straight from extractParatext (orphan references, undefined
// keys, duplicate labels/keys, unclosed blocks). This adds the one check the
// renderer intentionally tolerates: a cited source with no link. A citation is
// a pointer outward; without a url it is only half a citation.

import { extractParatext } from "../../markdown/paratext.js";

/**
 * Lint a post body's paratext. Returns a flat list of human-readable warnings,
 * empty when the apparatus is clean (or absent).
 *
 * @param {string} body  markdown body
 * @returns {string[]}
 */
export function lintParatext(body) {
  const { citations, warnings } = extractParatext(body);
  const out = [...warnings];
  for (const c of citations) {
    if (!c.url) out.push(`citation [@${c.key}] has no url — add a link`);
  }
  return out;
}
