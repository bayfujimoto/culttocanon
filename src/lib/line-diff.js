// ── Line / word diff ─────────────────────────────────────────────────────────
// A minimal unified diff via longest-common-subsequence. No dependency:
// the project ships two runtime deps (js-yaml, marked) and we keep it that way.
//
//   diffLines(oldText, newText) → [{ type, text }]   tokens = lines
//   diffWords(oldText, newText) → [{ type, text }]   tokens = words + spaces
//     type: "ctx" (unchanged) | "del" (only in old) | "add" (only in new)
//
// Both run the same LCS over a token array; only the tokenizer differs.
// Tokens common to both appear once as "ctx"; the deletions/insertions around
// them fall out of the LCS backtrace. Good enough for prose-length pieces.

/**
 * Generic LCS diff over two token arrays. Equality is `===` on tokens, so the
 * caller controls granularity by choosing the tokenizer (lines vs. words).
 * @param {string[]} a  old tokens
 * @param {string[]} b  new tokens
 * @returns {{ type: "ctx"|"del"|"add", text: string }[]}
 */
function lcsDiff(a, b) {
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = LCS length of a[i:] and b[j:]
  const lcs = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "ctx", text: a[i] });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) { out.push({ type: "del", text: a[i] }); i++; }
  while (j < m) { out.push({ type: "add", text: b[j] }); j++; }

  return out;
}

/**
 * Line-granularity diff.
 * @param {string} oldText
 * @param {string} newText
 * @returns {{ type: "ctx"|"del"|"add", text: string }[]}
 */
export function diffLines(oldText, newText) {
  const a = String(oldText ?? "").split("\n");
  const b = String(newText ?? "").split("\n");
  return lcsDiff(a, b);
}

/**
 * Word-granularity diff. Tokens are alternating word / whitespace runs, so the
 * segments re-join losslessly (`out.map(r => r.text).join("")` reconstructs
 * each side exactly). Unchanged whitespace stays "ctx", keeping word
 * boundaries intact when rendered.
 * @param {string} oldText
 * @param {string} newText
 * @returns {{ type: "ctx"|"del"|"add", text: string }[]}
 */
export function diffWords(oldText, newText) {
  const a = tokenizeWords(String(oldText ?? ""));
  const b = tokenizeWords(String(newText ?? ""));
  return lcsDiff(a, b);
}

// Split into alternating non-space / space runs, dropping empties. Splitting on
// a captured `(\s+)` keeps the separators as their own tokens so nothing is
// lost on re-join.
function tokenizeWords(s) {
  return s.split(/(\s+)/).filter(t => t.length > 0);
}
