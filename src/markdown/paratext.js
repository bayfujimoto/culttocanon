// ── Paratext: footnotes & citations ─────────────────────────────────────────
// The apparatus of a piece — authorial footnotes and a works-cited list — lives
// inside the post body markdown (see docs/citations-footnotes-plan_260706.md
// for why: history snapshots and diffs are body-only, so in-body paratext is
// versioned and diffed for free).
//
// Authoring syntax
// ────────────────
//   Footnotes (Pandoc-style):
//     …a claim.[^origin]                     ← inline reference
//     [^origin]: The note, with *markdown*.   ← definition, its own line
//
//   Citations:
//     …as Kermode argues.[@kermode1975]       ← inline reference
//     …see the image.[@kermode1975, 42]       ← reference with a locator
//     ::: citations                           ← definition block (stripped
//     kermode1975 | Frank Kermode | The Classic | 1975 | https://…   from render)
//     :::
//
//   Citation columns are positional, pipe-delimited:
//     key | author | title | year | url        (year, url optional)
//
// Two surfaces consume this module:
//   1. extractParatext(body) — pure. Returns the ordered footnote and citation
//      entries plus lint warnings. Numbering is by *first reference* in the
//      text. This is the single source of truth for numbers; the Marginalia
//      view renders from it, and the render extensions below only *look up*
//      numbers here, never assign their own.
//   2. makeParatextExtensions(post) — marked extensions that render the inline
//      markers (consulting the numbers from #1) and strip the definitions and
//      the ::: citations block from the rendered Read output.
//
// Code-safety: markers inside inline code or fenced code blocks must not be
// treated as references. The extractor strips fenced blocks and blanks inline
// code spans before scanning; on the render side, marked's own code tokenizers
// claim those spans before our inline tokenizers ever see them.

// ── Shared patterns ──────────────────────────────────────────────────────────
// A single-key charset for citation keys and footnote labels: word chars plus
// a few separators. No whitespace, no closing bracket.
const FN_REF_G    = /\[\^([^\]\s]+)\]/g;
const CITE_REF_G  = /\[@([A-Za-z0-9_.:-]+)(?:,[ \t]*([^\]]+))?\]/g;
// Anchored single-line forms, for the marked tokenizers.
const FN_REF_A    = /^\[\^([^\]\s]+)\]/;
const CITE_REF_A  = /^\[@([A-Za-z0-9_.:-]+)(?:,[ \t]*([^\]]+))?\]/;
// A footnote definition line: `[^label]: text…` (single line; continuation
// lines are a documented v1 limitation).
const FN_DEF_LINE = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
// Citation block fences.
const CITE_OPEN   = /^:::[ \t]*citations[ \t]*$/;
const CITE_CLOSE  = /^:::[ \t]*$/;
// Code-fence open/close (``` or ~~~), any indent.
const FENCE       = /^[ \t]*(`{3,}|~{3,})/;

/**
 * Parse a post body into its paratext apparatus.
 *
 * @param {string} body  markdown body
 * @returns {{
 *   footnotes: Array<{ label:string, num:number, text:string }>,
 *   citations: Array<{ key:string, num:number, author:string, title:string,
 *                      year:string, url:string, locator:string }>,
 *   warnings: string[]
 * }}
 * Footnotes and citations are each ordered by first reference and numbered
 * 1..n independently. Only *referenced* entries appear; unreferenced or
 * undefined ones are dropped and surface as warnings.
 */
export function extractParatext(body) {
  const src = String(body ?? "");
  const warnings = [];

  // ── Pass 1: collect definitions, and build a code-free scan text ──────────
  const fnDefs   = new Map();   // label → text
  const citeDefs = new Map();   // key   → { key, author, title, year, url }
  const scanLines = [];         // lines eligible for reference scanning

  const lines = src.split(/\r?\n/);
  let inFence = false;
  let inCiteBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code: toggle, and never scan or parse inside.
    if (FENCE.test(line)) {
      inFence = !inFence;
      scanLines.push("");         // keep line count stable, contribute nothing
      continue;
    }
    if (inFence) { scanLines.push(""); continue; }

    // Citation block body.
    if (inCiteBlock) {
      if (CITE_CLOSE.test(line)) { inCiteBlock = false; scanLines.push(""); continue; }
      const row = line.trim();
      if (row) {
        const parsed = parseCitationRow(row);
        if (!parsed) {
          warnings.push(`citation row could not be parsed (need at least \`key | author | title\`): ${row}`);
        } else {
          if (citeDefs.has(parsed.key)) {
            warnings.push(`citation key "${parsed.key}" defined more than once — last wins`);
          }
          citeDefs.set(parsed.key, parsed);
        }
      }
      scanLines.push("");
      continue;
    }
    if (CITE_OPEN.test(line)) { inCiteBlock = true; scanLines.push(""); continue; }

    // Footnote definition line.
    const dm = FN_DEF_LINE.exec(line);
    if (dm) {
      const label = dm[1];
      if (fnDefs.has(label)) {
        warnings.push(`footnote [^${label}] defined more than once — last wins`);
      }
      fnDefs.set(label, dm[2].trim());
      scanLines.push("");
      continue;
    }

    // Ordinary prose — eligible for reference scanning.
    scanLines.push(line);
  }
  if (inCiteBlock) warnings.push("::: citations block was not closed with :::");

  // Blank out inline code spans so a marker inside backticks isn't scanned.
  const scanText = scanLines.join("\n").replace(/`[^`\n]*`/g, " ");

  // ── Pass 2: reference order (document order across both systems) ──────────
  const fnOrder   = [];         // labels, first-reference order, deduped
  const fnSeen    = new Set();
  const citeOrder = [];         // { key, locator }, first-reference order
  const citeSeen  = new Set();

  const combined = new RegExp(`${FN_REF_G.source}|${CITE_REF_G.source}`, "g");
  let m;
  while ((m = combined.exec(scanText)) !== null) {
    if (m[1] != null) {
      // footnote reference: m[1] = label
      const label = m[1];
      if (!fnSeen.has(label)) { fnSeen.add(label); fnOrder.push(label); }
    } else if (m[2] != null) {
      // citation reference: m[2] = key, m[3] = locator
      const key = m[2];
      if (!citeSeen.has(key)) {
        citeSeen.add(key);
        citeOrder.push({ key, locator: m[3] ? m[3].trim() : "" });
      }
    }
  }

  // ── Build footnotes (referenced-with-definition only) ─────────────────────
  const footnotes = [];
  let fnNum = 0;
  for (const label of fnOrder) {
    if (fnDefs.has(label)) {
      footnotes.push({ label, num: ++fnNum, text: fnDefs.get(label) });
    } else {
      warnings.push(`footnote [^${label}] is referenced but never defined`);
    }
  }
  for (const label of fnDefs.keys()) {
    if (!fnSeen.has(label)) warnings.push(`footnote [^${label}] is defined but never referenced`);
  }

  // ── Build citations (referenced-with-definition only) ─────────────────────
  const citations = [];
  let citeNum = 0;
  for (const { key, locator } of citeOrder) {
    if (citeDefs.has(key)) {
      const d = citeDefs.get(key);
      citations.push({ ...d, num: ++citeNum, locator: formatLocator(locator) });
    } else {
      warnings.push(`citation [@${key}] is referenced but never defined`);
    }
  }
  for (const key of citeDefs.keys()) {
    if (!citeSeen.has(key)) warnings.push(`citation "${key}" is defined but never cited`);
  }

  return { footnotes, citations, warnings };
}

/**
 * Parse one pipe-delimited citation row into a structured entry, or null if it
 * lacks the required key/author/title. Columns: key | author | title | year | url
 */
function parseCitationRow(row) {
  const parts = row.split("|").map((s) => s.trim());
  const [key, author, title, year, url] = parts;
  if (!key || !author || !title) return null;
  return { key, author, title, year: year || "", url: url || "" };
}

/**
 * Render a raw locator into display form. Bare numbers/ranges get a page
 * prefix; anything else (§3, ch. 2, fig. 4) passes through verbatim. Free
 * text by design — not a controlled vocabulary.
 */
export function formatLocator(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return `p. ${s}`;
  if (/^\d+\s*[-–—]\s*\d+$/.test(s)) return `pp. ${s.replace(/\s*[-–—]\s*/, "–")}`;
  return s;
}

// ── marked extensions ────────────────────────────────────────────────────────

/**
 * Build the marked extensions for a given post. Inline extensions render the
 * footnote/citation markers using the numbers already computed by
 * extractParatext (carried on post.footnotes / post.citations); block
 * extensions strip the definitions and the ::: citations block from the
 * rendered body. An unknown label/key falls through to plain text (its
 * warning was already recorded at extraction time).
 *
 * A marker is emitted with an anchor id only on its *first* occurrence, so ids
 * stay unique when a note or source is cited more than once. Every marker
 * carries data-fn / data-cite for the (Phase 2) cross-pane click wiring.
 */
export function makeParatextExtensions(post) {
  const fnIndex   = new Map((post?.footnotes || []).map((f) => [f.label, f.num]));
  const citeIndex = new Map((post?.citations || []).map((c) => [c.key, c.num]));
  const seenFn    = new Set();
  const seenCite  = new Set();

  const footnoteRef = {
    name: "footnoteRef",
    level: "inline",
    start(src) { const i = src.indexOf("[^"); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = FN_REF_A.exec(src);
      if (!m) return undefined;
      const num = fnIndex.get(m[1]);
      if (num == null) return undefined;      // undefined footnote → plain text
      return { type: "footnoteRef", raw: m[0], label: m[1], num };
    },
    renderer(token) {
      const first = !seenFn.has(token.num);
      seenFn.add(token.num);
      const idAttr = first ? ` id="fnref-${token.num}"` : "";
      return `<sup class="fn-ref"><a${idAttr} href="#fn-${token.num}" ` +
             `data-fn="${token.num}" role="doc-noteref">${token.num}</a></sup>`;
    },
  };

  const citationRef = {
    name: "citationRef",
    level: "inline",
    start(src) { const i = src.indexOf("[@"); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = CITE_REF_A.exec(src);
      if (!m) return undefined;
      const num = citeIndex.get(m[1]);
      if (num == null) return undefined;      // undefined citation → plain text
      return { type: "citationRef", raw: m[0], key: m[1], num };
    },
    renderer(token) {
      const first = !seenCite.has(token.num);
      seenCite.add(token.num);
      const idAttr = first ? ` id="citeref-${token.num}"` : "";
      return `<sup class="cite-ref"><a${idAttr} href="#cite-${token.num}" ` +
             `data-cite="${token.num}" role="doc-biblioref">[${token.num}]</a></sup>`;
    },
  };

  const footnoteDef = {
    name: "footnoteDef",
    level: "block",
    start(src) { const i = src.search(/\n\[\^[^\]\s]+\]:/); return i < 0 ? undefined : i + 1; },
    tokenizer(src) {
      const m = /^\[\^[^\]\s]+\]:[^\n]*(?:\r?\n|$)/.exec(src);
      if (!m) return undefined;
      return { type: "footnoteDef", raw: m[0] };
    },
    renderer() { return ""; },                 // stripped from the rendered body
  };

  const citationsBlock = {
    name: "citationsBlock",
    level: "block",
    start(src) { const i = src.search(/\n:::[ \t]*citations[ \t]*(?:\r?\n|$)/); return i < 0 ? undefined : i + 1; },
    tokenizer(src) {
      const m = /^:::[ \t]*citations[ \t]*\r?\n[\s\S]*?\r?\n:::[ \t]*(?:\r?\n|$)/.exec(src);
      if (!m) return undefined;
      return { type: "citationsBlock", raw: m[0] };
    },
    renderer() { return ""; },                 // stripped from the rendered body
  };

  return [footnoteRef, citationRef, footnoteDef, citationsBlock];
}
