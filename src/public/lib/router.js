// ── Public router ────────────────────────────────────────────────────────────
// Maps URL paths to posts and back.
//
//   /                         no piece open (Read shows empty hint)
//   /<slug>                   piece with that slug open in Read
//   /unknown-slug             treated as "not found" — Read shows hint, URL kept
//
// Uses the History API so URLs are clean (no `#` prefix). The netlify.toml
// catch-all redirects any unknown path back to index.html, so SPA routing
// works on the production deploy.
//
// Reserved top-level paths (must not be used as slugs):
//   /admin  /admin.html  /api

const RESERVED = new Set(["admin", "admin.html", "api", "fonts", "assets"]);

let handler = null;

/**
 * Initialize the router with a path handler. The handler receives the current
 * path on init and on every popstate event. Caller is responsible for
 * resolving the path to a post (or empty state).
 */
export function initRouter(onPathChange) {
  handler = onPathChange;
  window.addEventListener("popstate", () => emit());
  emit();
}

/**
 * Navigate to a new path. Triggers a pushState and emits a change to the
 * handler. No-op if the path matches the current URL.
 */
export function navigate(path) {
  if (currentPath() === path) return;
  history.pushState(null, "", path);
  emit();
}

/**
 * Return the slug component of the current path, or null for the root.
 *   /                       → null
 *   /on-the-backrooms       → "on-the-backrooms"
 *   /admin                  → null (reserved)
 */
export function currentSlug() {
  const path = currentPath();
  if (!path || path === "/") return null;
  const seg = path.replace(/^\//, "").replace(/\/$/, "").split("/")[0];
  if (!seg || RESERVED.has(seg)) return null;
  return seg;
}

function currentPath() {
  return window.location.pathname;
}

function emit() {
  if (handler) handler(currentSlug(), currentPath());
}
