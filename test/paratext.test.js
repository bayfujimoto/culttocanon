// Tests for src/markdown/paratext.js — run with `npm test` (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Marked } from "marked";
import {
  extractParatext,
  formatLocator,
  makeParatextExtensions,
} from "../src/markdown/paratext.js";

// Render a body through the paratext marked extensions, numbering from the
// extractor — the same path parseBodyFor uses.
function render(body) {
  const { footnotes, citations } = extractParatext(body);
  const m = new Marked({ gfm: true, breaks: false, pedantic: false });
  m.use({ extensions: makeParatextExtensions({ footnotes, citations }) });
  return m.parse(body);
}

// ── extractParatext ──────────────────────────────────────────────────────────

test("footnotes: numbered by first reference, not by label", () => {
  const body = [
    "First claim.[^b] Then a second.[^a]",
    "",
    "[^a]: Note A.",
    "[^b]: Note B with *emphasis*.",
  ].join("\n");
  const { footnotes, warnings } = extractParatext(body);
  assert.equal(warnings.length, 0);
  assert.deepEqual(footnotes, [
    { label: "b", num: 1, text: "Note B with *emphasis*." },
    { label: "a", num: 2, text: "Note A." },
  ]);
});

test("footnotes: numeric and named labels both resolve", () => {
  const body = "X[^1] Y[^origin]\n[^1]: one\n[^origin]: two";
  const { footnotes } = extractParatext(body);
  assert.deepEqual(footnotes.map((f) => [f.label, f.num, f.text]), [
    ["1", 1, "one"],
    ["origin", 2, "two"],
  ]);
});

test("footnotes: a note referenced twice keeps one entry / one number", () => {
  const body = "A[^n] then again[^n].\n[^n]: once";
  const { footnotes } = extractParatext(body);
  assert.equal(footnotes.length, 1);
  assert.equal(footnotes[0].num, 1);
});

test("citations: structured parse incl. empty year/url, ordered by first ref", () => {
  const body = [
    "A[@k1] B[@k2, 42] C[@k3, §3]",
    "",
    "::: citations",
    "k1 | Auth One | Title One | 2020 | https://one",
    "k2 | Auth Two | Title Two | 1975 |",
    "k3 | Auth Three | Title Three |  |",
    ":::",
  ].join("\n");
  const { citations, warnings } = extractParatext(body);
  assert.equal(warnings.length, 0);
  assert.deepEqual(citations, [
    { key: "k1", num: 1, author: "Auth One", title: "Title One", year: "2020", url: "https://one", locator: "" },
    { key: "k2", num: 2, author: "Auth Two", title: "Title Two", year: "1975", url: "", locator: "p. 42" },
    { key: "k3", num: 3, author: "Auth Three", title: "Title Three", year: "", url: "", locator: "§3" },
  ]);
});

test("code-safety: markers in inline code and fenced blocks are ignored", () => {
  const body = [
    "Real[^r] but not `[^x]` inline.",
    "",
    "```",
    "[^y] and [@z] here",
    "```",
    "",
    "[^r]: real note",
  ].join("\n");
  const { footnotes, citations, warnings } = extractParatext(body);
  assert.deepEqual(footnotes.map((f) => f.label), ["r"]);
  assert.equal(citations.length, 0);
  assert.equal(warnings.length, 0); // x / y / z never seen, so no orphan warnings
});

test("orphan reference and orphan definition both warn; only valid notes number", () => {
  const body = [
    "A[^missing] B[^ok]",
    "",
    "[^ok]: defined and referenced",
    "[^unused]: defined but not referenced",
  ].join("\n");
  const { footnotes, warnings } = extractParatext(body);
  assert.deepEqual(footnotes.map((f) => f.label), ["ok"]);
  assert.ok(warnings.some((w) => /\[\^missing\] is referenced but never defined/.test(w)));
  assert.ok(warnings.some((w) => /\[\^unused\] is defined but never referenced/.test(w)));
});

test("citations: undefined key and duplicate key both warn; last definition wins", () => {
  const body = [
    "A[@dup] B[@ghost] C[@dup]",
    "",
    "::: citations",
    "dup | First Def | T1 | 2001 | https://a",
    "dup | Second Def | T2 | 2002 | https://b",
    ":::",
  ].join("\n");
  const { citations, warnings } = extractParatext(body);
  assert.equal(citations.length, 1);
  assert.equal(citations[0].author, "Second Def");
  assert.equal(citations[0].num, 1);
  assert.ok(warnings.some((w) => /"dup" defined more than once/.test(w)));
  assert.ok(warnings.some((w) => /\[@ghost\] is referenced but never defined/.test(w)));
});

test("no paratext: empty arrays, no warnings", () => {
  const { footnotes, citations, warnings } = extractParatext("Just prose here.");
  assert.deepEqual(footnotes, []);
  assert.deepEqual(citations, []);
  assert.deepEqual(warnings, []);
});

// ── formatLocator ────────────────────────────────────────────────────────────

test("formatLocator: pages, ranges, and verbatim non-numeric", () => {
  assert.equal(formatLocator("42"), "p. 42");
  assert.equal(formatLocator("42-45"), "pp. 42–45");
  assert.equal(formatLocator("42–45"), "pp. 42–45");
  assert.equal(formatLocator("§3"), "§3");
  assert.equal(formatLocator("ch. 2"), "ch. 2");
  assert.equal(formatLocator(""), "");
});

// ── render extensions ────────────────────────────────────────────────────────

test("render: emits markers and strips definitions + citation block", () => {
  const body = [
    "The origin is empty.[^origin] As Kermode argues.[@kermode1975]",
    "",
    "[^origin]: Kermode runs the other way; see *The Classic*.",
    "",
    "::: citations",
    "kermode1975 | Frank Kermode | The Classic | 1975 | https://example.com",
    ":::",
  ].join("\n");
  const html = render(body);

  // Inline markers present, with anchor ids + hrefs into the Marginalia entries.
  assert.match(html, /<sup class="fn-ref"><a id="fnref-1" href="#fn-1"/);
  assert.match(html, /<sup class="cite-ref"><a id="citeref-1" href="#cite-1"/);

  // Definitions and the citations block are stripped from the rendered body.
  assert.ok(!html.includes("Kermode runs the other way"));
  assert.ok(!html.includes("::: citations"));
  assert.ok(!html.includes("Frank Kermode"));
});

test("render: unknown label/key falls through to plain text", () => {
  const html = render("A dangling ref[^nope] and [@ghost].");
  assert.ok(!html.includes("fn-ref"));
  assert.ok(!html.includes("cite-ref"));
  assert.ok(html.includes("[^nope]"));
  assert.ok(html.includes("[@ghost]"));
});
