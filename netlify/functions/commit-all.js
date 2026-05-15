// ── Netlify Function: /api/commit-all (production) ───────────────────────────
// Bundles staged file writes from the admin into a single GitHub commit on
// the configured branch. Mirror of the Vite dev plugin's /api/commit-all
// endpoint — same payload, different backend.
//
// Required environment variables (set in Netlify site settings):
//   GITHUB_TOKEN    — fine-grained PAT with "Contents: read & write" on this repo
//   GITHUB_OWNER    — e.g. "bayfujimoto"
//   GITHUB_REPO     — e.g. "culttocanon"
//   GITHUB_BRANCH   — optional, defaults to "main"
//
// Payload:
//   {
//     files:   [{ filePath: "src/content/posts/...md", content: "---\n..." }],
//     message: "add POST-2026-005",
//   }
//
// Response: { ok: true, mode: "github", sha } | { ok: false, error }

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return resp(405, { ok: false, error: "Method not allowed" });
  }

  const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER  = process.env.GITHUB_OWNER;
  const GITHUB_REPO   = process.env.GITHUB_REPO;
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

  if (!GITHUB_TOKEN) {
    return resp(200, { ok: false, error: "No GitHub token configured" });
  }
  if (!GITHUB_OWNER || !GITHUB_REPO) {
    return resp(500, { ok: false, error: "GITHUB_OWNER and GITHUB_REPO must be set" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return resp(400, { ok: false, error: "Invalid JSON body" });
  }

  const { files, message } = payload;

  if (!files?.length || !message) {
    return resp(400, { ok: false, error: "Missing files or message" });
  }

  try {
    const sha = await githubCommitAll(
      files, message, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH
    );
    return resp(200, { ok: true, mode: "github", sha });
  } catch (e) {
    return resp(500, { ok: false, error: e.message });
  }
}

function resp(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function githubCommitAll(files, message, token, owner, repo, branch) {
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = {
    Authorization:           `Bearer ${token}`,
    Accept:                  "application/vnd.github+json",
    "Content-Type":          "application/json",
    "X-GitHub-Api-Version":  "2022-11-28",
  };

  // 1. Get the current branch ref
  const refRes = await fetch(`${base}/git/refs/heads/${branch}`, { headers });
  if (!refRes.ok) throw new Error(`Get branch ref: ${refRes.status}`);
  const baseSha = (await refRes.json()).object.sha;

  // 2. Get base commit to find its tree SHA
  const commitRes = await fetch(`${base}/git/commits/${baseSha}`, { headers });
  if (!commitRes.ok) throw new Error(`Get base commit: ${commitRes.status}`);
  const baseTreeSha = (await commitRes.json()).tree.sha;

  // 3. Build tree entries — each file as a blob
  const treeItems = await Promise.all(files.map(async ({ filePath, content }) => {
    const blobRes = await fetch(`${base}/git/blobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content, encoding: "utf-8" }),
    });
    if (!blobRes.ok) throw new Error(`Create blob for ${filePath}: ${blobRes.status}`);
    const { sha } = await blobRes.json();
    return { path: filePath, mode: "100644", type: "blob", sha };
  }));

  // 4. Create the tree
  const treeRes = await fetch(`${base}/git/trees`, {
    method: "POST",
    headers,
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });
  if (!treeRes.ok) throw new Error(`Create tree: ${treeRes.status}`);
  const treeSha = (await treeRes.json()).sha;

  // 5. Create the commit
  const newCommitRes = await fetch(`${base}/git/commits`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message, tree: treeSha, parents: [baseSha] }),
  });
  if (!newCommitRes.ok) throw new Error(`Create commit: ${newCommitRes.status}`);
  const newSha = (await newCommitRes.json()).sha;

  // 6. Advance the branch ref
  const updateRes = await fetch(`${base}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ sha: newSha }),
  });
  if (!updateRes.ok) throw new Error(`Update ref: ${updateRes.status}`);

  return newSha;
}
