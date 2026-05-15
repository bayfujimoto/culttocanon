// ── Admin API client ─────────────────────────────────────────────────────────
// Thin fetch wrapper around the two endpoints:
//
//   POST /api/commit-all   bundles pending changes into one commit
//
// Both endpoints are served by the Vite dev plugin in development (writing
// files directly to disk) and by Netlify Functions in production (committing
// via the GitHub API).

export async function commitAll(payload) {
  const res = await fetch("/api/commit-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}
