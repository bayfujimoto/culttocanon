// ── Front-matter parser ──────────────────────────────────────────────────────
// Cult to Canon posts are markdown files prefixed with a YAML front-matter
// block delimited by `---` lines:
//
//   ---
//   id: POST-2026-001
//   title: On the Backrooms as Canon
//   created: 2026-05-15
//   ---
//
//   Body markdown begins here.
//
// This module splits the raw file content into `data` (parsed YAML object)
// and `body` (markdown string). Uses js-yaml for the YAML parse so we don't
// have to hand-roll one.

import yaml from "js-yaml";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontMatter(raw) {
  const m = FM_RE.exec(raw);
  if (!m) {
    // No front-matter — treat the whole file as body
    return { data: {}, body: raw };
  }
  const yamlText = m[1];
  const body     = m[2] ?? "";

  let data;
  try {
    data = yaml.load(yamlText) ?? {};
  } catch (err) {
    console.warn("[front-matter] YAML parse error:", err.message);
    data = {};
  }

  return { data, body };
}
