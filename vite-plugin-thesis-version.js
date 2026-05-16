// ── Vite plugin: thesis version → topbar ─────────────────────────────────────
// Binds the topbar's version string to the site thesis's `version` frontmatter
// field. Resolves the post in `src/content/posts/` whose frontmatter `id`
// matches THESIS_ID, parses its semver `version`, and exposes the result as
// the build-time global constant `__THESIS_VERSION__`.
//
// Build fails if the thesis post is missing or the version is malformed —
// the site's identity is the thesis's version, so a buildable site requires
// a present and well-formed one.
//
// Known limitation: the constant is resolved once at config time. Bumping
// the thesis version in dev requires restarting the dev server. For builds
// (the production case) the value is correct as of the build.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseFrontMatter } from "./src/lib/front-matter.js";

const POSTS_DIR = "src/content/posts";
const THESIS_ID = "ESS-2026-000";
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export function thesisVersionPlugin() {
  return {
    name: "thesis-version",
    config() {
      const dir = resolve(process.cwd(), POSTS_DIR);

      // As of the image-pipeline migration (260516), posts live in folders
      // rather than flat .md files: src/content/posts/<slug>/post.md. Walk
      // one level deep and read each folder's post.md.
      let postFiles;
      try {
        const entries = readdirSync(dir);
        postFiles = entries
          .map(name => join(dir, name, "post.md"))
          .filter(p => {
            try { return statSync(p).isFile(); } catch { return false; }
          });
      } catch (e) {
        throw new Error(`thesis-version: cannot read ${POSTS_DIR}: ${e.message}`);
      }

      let version = null;
      for (const p of postFiles) {
        const { data } = parseFrontMatter(readFileSync(p, "utf8"));
        if (data.id !== THESIS_ID) continue;

        if (!SEMVER_RE.test(String(data.version || ""))) {
          throw new Error(
            `thesis-version: ${THESIS_ID} has invalid version "${data.version}". ` +
            `Expected semver (e.g. "0.1.0").`
          );
        }
        version = data.version;
        break;
      }

      if (!version) {
        throw new Error(
          `thesis-version: post with id ${THESIS_ID} not found in ${POSTS_DIR}/. ` +
          `The site thesis is required at this id; create it before building.`
        );
      }

      return { define: { __THESIS_VERSION__: JSON.stringify(version) } };
    },
  };
}
