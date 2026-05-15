// ── Admin router ─────────────────────────────────────────────────────────────
// Hash-based routing — works the same in `vite dev` and on the Netlify deploy
// without any additional server config beyond /admin → /admin.html.
//
//   #/                          → dashboard (empty Manuscript)
//   #/edit/POST-2026-001        → edit that post
//   #/new                       → new post form

let handler = null;

export function initRouter(onRouteChange) {
  handler = onRouteChange;
  window.addEventListener("hashchange", () => emit());
  emit();
}

export function navigate(path) {
  // Path is the hash content without the leading `#`. We accept both forms.
  const next = path.startsWith("#") ? path : `#${path}`;
  if (window.location.hash === next) {
    // Same route — manually re-emit so callers can force a re-render.
    emit();
    return;
  }
  window.location.hash = next;
}

export function currentRoute() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 0)                       return { view: "dashboard" };
  if (parts[0] === "new")                       return { view: "new" };
  if (parts[0] === "edit" && parts[1])          return { view: "edit", id: parts[1] };
  return { view: "dashboard" };
}

function emit() {
  if (handler) handler(currentRoute());
}
