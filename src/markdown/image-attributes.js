// ── Image attribute extension for `marked` ──────────────────────────────────
// Pandoc-style attribute syntax for inline images:
//
//   ![alt](path/image.jpg)              → default: dither-and-reveal
//   ![alt](path/image.jpg){.no-dither}  → plain <img>, no enhancement
//   ![alt](path/image.jpg){.no-reveal}  → static dither, no click-to-reveal
//   ![alt](path/image.jpg){.full}       → plain, escapes the body column
//
// Multiple classes can be combined inside one `{...}` block, space-separated:
//   ![alt](image.jpg){.no-reveal .full}
//
// The extension parses the `{...}` trailing block and attaches the parsed
// class names to the image token. The post-renderer's custom `image` renderer
// (see image-renderer.js) reads those classes to decide which element tree
// to emit.

const TOKEN_TYPE = "imageWithAttrs";
const ATTR_RE    = /^\{([^}]*)\}/;

/**
 * A marked extension that wraps the built-in inline `image` token with one
 * that also captures a trailing Pandoc `{.class}` attribute block. Register
 * with `marked.use({ extensions: [imageAttributesExtension] })`.
 */
export const imageAttributesExtension = {
  name: TOKEN_TYPE,
  level: "inline",
  // Quick prefix check — only proceed if the source starts with `![`.
  start(src) { return src.indexOf("!["); },

  tokenizer(src) {
    // Match a standard inline image first. Pulled from CommonMark's grammar:
    // alt text may contain balanced brackets, and the URL may be a bare
    // path or a `<...>` form. We deliberately keep this simple — exotic
    // image syntax (titles, references) does not flow through this
    // extension and falls back to marked's built-in image handling.
    const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/.exec(src);
    if (!m) return undefined;

    const [whole, alt, href, title] = m;
    const tail = src.slice(whole.length);

    // The attribute block is OPTIONAL. When present, it must follow
    // immediately with no intervening space (Pandoc's spec; relaxing it
    // would conflict with prose that happens to start with `{`). When
    // absent, the class list is empty and the renderer applies the
    // default dither-and-reveal treatment.
    let classes = [];
    let attrRaw = "";
    const am = ATTR_RE.exec(tail);
    if (am) {
      classes = parseClasses(am[1]);
      attrRaw = am[0];
    }

    return {
      type: TOKEN_TYPE,
      raw: whole + attrRaw,
      href,
      title: title || null,
      text: alt,
      classes,
    };
  },

  // Renderer is bound in image-renderer.js so all the HTML-emitting logic
  // lives in one place. The fallback here is plain so the extension is
  // usable in isolation if someone wants to test parsing.
  renderer(token) {
    const classAttr = token.classes.length
      ? ` class="${token.classes.map(c => "attr-" + c).join(" ")}"`
      : "";
    const altAttr = ` alt="${escapeAttr(token.text)}"`;
    const srcAttr = ` src="${escapeAttr(token.href)}"`;
    return `<img${srcAttr}${altAttr}${classAttr}>`;
  },
};

/**
 * Parse a Pandoc attribute block body — the part inside `{...}`.
 * Currently we only support `.class-name` tokens; ids (`#name`) and key=value
 * pairs are out of scope for v1. Returns the list of class names without
 * their leading dot.
 */
function parseClasses(body) {
  const out = [];
  for (const tok of body.split(/\s+/)) {
    if (tok.startsWith(".") && tok.length > 1) out.push(tok.slice(1));
  }
  return out;
}

function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** Exposed for tests and for the custom renderer (so it knows the type name). */
export const IMAGE_TOKEN_TYPE = TOKEN_TYPE;
