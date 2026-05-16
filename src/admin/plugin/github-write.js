// ── Vite dev plugin: /api/commit-all (local) ─────────────────────────────────
// During `vite dev` this plugin exposes a /api/commit-all middleware that
// writes each staged file directly to disk. The admin's commit flow uses the
// same endpoint in dev and in production; only the implementation differs.
//
// Production uses the Netlify Function at netlify/functions/commit-all.js,
// which calls the GitHub API instead of touching the local filesystem.
//
// Payload shape (matches the Netlify function):
//   {
//     files:   [{ filePath: "src/content/posts/...md", content: "---\n..." }],
//     message: "add ESS-2026-005",
//   }

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
          for (const { filePath, content } of files) {
            if (!filePath || typeof content !== "string") {
              throw new Error("Each file needs filePath and content");
            }
            const abs = resolve(process.cwd(), filePath);
            mkdirSync(dirname(abs), { recursive: true });
            writeFileSync(abs, content, "utf8");
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
