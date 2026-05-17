// ── Dev-only filesystem Blobs sandbox ────────────────────────────────────────
// @netlify/blobs has no local mode for an unlinked site, so `netlify dev`
// without `netlify link` throws MissingBlobsEnvironmentError. This is a tiny
// stand-in implementing only the surface store.js uses — get(key,{type:json}),
// setJSON(key,value), delete(key) — backed by JSON files under
// .netlify-blobs-dev/<store>/. Never used in production (see store.js): real
// Netlify Blobs is used whenever ambient or explicit credentials exist.

import { mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { resolve, join } from "path";

const ROOT = resolve(process.cwd(), ".netlify-blobs-dev");

function keyPath(name, key) {
  return join(ROOT, name, `${encodeURIComponent(key)}.json`);
}

export function fsStore(name) {
  mkdirSync(join(ROOT, name), { recursive: true });
  return {
    async get(key, _opts) {
      try {
        return JSON.parse(readFileSync(keyPath(name, key), "utf8"));
      } catch {
        return null;
      }
    },
    async setJSON(key, value) {
      writeFileSync(keyPath(name, key), JSON.stringify(value), "utf8");
    },
    async delete(key) {
      try {
        rmSync(keyPath(name, key));
      } catch {
        /* already gone */
      }
    },
  };
}
