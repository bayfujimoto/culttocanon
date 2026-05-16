import { defineConfig } from "vite";
import { githubWritePlugin } from "./src/admin/plugin/github-write.js";
import { thesisVersionPlugin } from "./vite-plugin-thesis-version.js";
import { imageDitherPlugin } from "./build/vite-plugin-image-dither.js";

// Two entry points share a single Vite build:
//   /          → index.html       (public site, [data-theme="public"])
//   /admin     → admin.html       (TUI admin,   [data-theme="admin"])
//
// The Netlify redirects in netlify.toml route /admin/* to admin.html and the
// rest to index.html; the SPA routers take over from there.
//
// The github-write plugin adds a /api/commit-all middleware in development
// that writes staged files directly to disk. In production the same path is
// handled by the Netlify Function at netlify/functions/commit-all.js.
//
// The image-dither plugin walks src/content/posts/*/images/ at build time,
// runs sharp over each source to produce the bit-depth layer PNGs and an
// optimized JPEG (see build/dither.js), and emits the derivatives under
// dist/content/posts/. In dev it also serves /content/posts/*/images/*
// from the source tree via a middleware.

export default defineConfig({
  root: ".",
  publicDir: "public",
  plugins: [githubWritePlugin(), thesisVersionPlugin(), imageDitherPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main:  "index.html",
        admin: "admin.html",
      },
    },
  },
  server: {
    port: 8080,
  },
});
