// ── Vite dev plugin: /api/commit-all (local) ─────────────────────────────────
// During `vite dev` this plugin exposes a /api/commit-all middleware that
// writes each staged file directly to disk. The admin's commit flow uses the
// same endpoint in dev and in production; only the implementation differs.
//
// Production uses the Netlify Function at netlify/functions/commit-all.js,
// which calls the GitHub API instead of touching the local filesystem.
//
// Auth: the production function is gated by the passkey session cookie. This
// dev middleware is intentionally left open — it only runs under local `vite
// dev`, is never deployed, and writes to the local working tree. The passkey
// gate lives entirely at the Netlify (Edge + Function) layer.
//
// Payload shape (matches the Netlify function):
//   {
//     files: [
//       { filePath: "src/content/posts/.../post.md",  content: "---\n..." },                // text
//       { filePath: "src/content/posts/.../foo.jpg",  content: "<base64>", binary: true }   // binary
//     ],
//     message: "add ESS-2026-005",
//   }
//
// Binary file entries (typically image uploads from the body editor's paste
// or drag handlers; see src/admin/lib/image-queue.js) carry the file's bytes
// as a base64 string under `content` with `binary: true`. The middleware
// decodes them to a Buffer before writing.

import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";

function readBody(req) {
  return new Promise((ok, fail) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end",  () => {
      try { ok(JSON.parse(data)); } catch (e) { fail(e); }
    });
    req.on("error", fail);
  });
}

export function githubWritePlugin() {
  return {
    name: "github-write",
    configureServer(server) {
      server.middlewares.use("/api/commit-all", async (req, res) => {
        res.setHeader("Content-Type", "application/json");

        if (req.method !== "POST") {
          res.writeHead(405);
          res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
          return;
        }

        let payload;
        try {
          payload = await readBody(req);
        } catch {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
          return;
        }

        const { files } = payload;

        if (!files?.length) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: "No files in payload" }));
          return;
        }

        try {
          const written = [];
          for (const { filePath, content, binary } of files) {
            if (!filePath || typeof content !== "string") {
              throw new Error("Each file needs filePath and a string content");
            }
            const abs = resolve(process.cwd(), filePath);
            mkdirSync(dirname(abs), { recursive: true });
            if (binary) {
              // Base64-decoded bytes — used for image uploads from the
              // body editor; see src/admin/lib/image-queue.js.
              const buf = Buffer.from(content, "base64");
              writeFileSync(abs, buf);
            } else {
              writeFileSync(abs, content, "utf8");
            }
            written.push(filePath);
          }
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, mode: "local", written }));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    },
  };
}
