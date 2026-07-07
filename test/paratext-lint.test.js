// Tests for src/admin/lib/paratext-lint.js — run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lintParatext } from "../src/admin/lib/paratext-lint.js";

test("clean apparatus lints without warnings", () => {
  const body = [
    "A claim.[^n] As argued.[@src1]",
    "",
    "[^n]: the note",
    "",
    "::: citations",
    "src1 | Author | Title | 2020 | https://example.com",
    ":::",
  ].join("\n");
  assert.deepEqual(lintParatext(body), []);
});

test("flags a cited source with no url", () => {
  const body = [
    "See.[@src1]",
    "",
    "::: citations",
    "src1 | Author | Title | 2020 |",
    ":::",
  ].join("\n");
  const issues = lintParatext(body);
  assert.ok(issues.some((w) => /\[@src1\] has no url/.test(w)));
});

test("passes through extractor warnings (undefined footnote, undefined citation)", () => {
  const body = "Dangling.[^ghost] And.[@nope]";
  const issues = lintParatext(body);
  assert.ok(issues.some((w) => /\[\^ghost\] is referenced but never defined/.test(w)));
  assert.ok(issues.some((w) => /\[@nope\] is referenced but never defined/.test(w)));
});

test("no paratext: no warnings", () => {
  assert.deepEqual(lintParatext("Just prose."), []);
});
