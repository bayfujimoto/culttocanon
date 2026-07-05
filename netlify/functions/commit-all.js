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
//     files: [
//       { filePath: "src/content/posts/.../post.md",  content: "---\n..." },                // text
//       { filePath: "src/content/posts/.../foo.jpg",  content: "<base64>", binary: true },  // binary
//       { filePath: "src/content/posts/ID-slug",      deleted: true, isDir: true },         // delete folder
//       { filePath: "src/content/history/ID.json",    deleted: true }                       // delete file
//     ],
//     message: "add POST-2026-005",
//   }
//
// Deletion entries carry `deleted: true` and no content. `isDir: true` removes
// every blob under the folder prefix (post markdown + images); a plain file
// delete nulls just that path if it exists.
//
// Binary file entries (image uploads — see src/admin/lib/image-queue.js)
// carry their bytes as base64 in `content` with `binary: true`. The Git Data
// API supports binary blobs natively via `encoding: "base64"`; we pass that
// through for binary entries and `encoding: "utf-8"` for text entries.
//
// Response: { ok: true, mode: "github", sha } | { ok: false, error }
//
// Access: gated by the same passkey session cookie as /admin. Without a valid
// session this returns 401 before any GitHub work — the Edge gate protects the
// admin document, this protects the only privileged action.

import { readCookie, verifySession } from "../lib/session.js";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return resp(405, { ok: false, error: "Method not allowed" });
  }

  const session = await verifySession(
    readCookie(event.headers?.cookie || event.headers?.Cookie)
  );
  if (!session) {
    return resp(401, { ok: false, error: "unauthorized" });
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

  // 2b. If any entry is a deletion, fetch the recursive base tree once so we
  //     can resolve a folder prefix (isDir) to the individual blobs it holds —
  //     the Git Data API deletes blobs, not folders. A file delete just needs
  //     to confirm the path exists before nulling it.
  const hasDeletes = files.some(f => f.deleted);
  let baseTree = [];
  if (hasDeletes) {
    const treeRes = await fetch(`${base}/git/trees/${baseTreeSha}?recursive=1`, { headers });
    if (!treeRes.ok) throw new Error(`Get base tree: ${treeRes.status}`);
    baseTree = (await treeRes.json()).tree || [];
  }

  // 3. Build tree entries. Deletions become `sha: null` items; writes create a
  //    blob first. Binary entries pass `encoding: "base64"`; text entries pass
  //    `"utf-8"` and the bytes are sent as the JS string verbatim.
  const treeItems = [];
  for (const { filePath, content, binary, deleted, isDir } of files) {
    if (deleted) {
      if (isDir) {
        const prefix = filePath.replace(/\/+$/, "") + "/";
        for (const t of baseTree) {
          if (t.type === "blob" && t.path.startsWith(prefix)) {
            treeItems.push({ path: t.path, mode: t.mode, type: "blob", sha: null });
          }
        }
      } else {
        const found = baseTree.find(t => t.type === "blob" && t.path === filePath);
        if (found) treeItems.push({ path: filePath, mode: found.mode, type: "blob", sha: null });
      }
      continue;
    }
    const encoding = binary ? "base64" : "utf-8";
    const blobRes = await fetch(`${base}/git/blobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content, encoding }),
    });
    if (!blobRes.ok) throw new Error(`Create blob for ${filePath}: ${blobRes.status}`);
    const { sha } = await blobRes.json();
    treeItems.push({ path: filePath, mode: "100644", type: "blob", sha });
  }

  // Nothing resolved to an actual change (e.g. deleting already-absent paths).
  if (treeItems.length === 0) throw new Error("No tree changes to commit");

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
