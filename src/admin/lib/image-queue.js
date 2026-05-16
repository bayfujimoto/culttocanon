// ── Image upload queue (admin) ─────────────────────────────────────────────
// Holds image blobs pasted or dragged into the body editor until the author
// commits. On commit the queue is flattened into binary file entries that
// ride the same /api/commit-all payload as the post.md change (see
// dispatch.js).
//
// Session-scoped: a module-level Map. No persistence across page reloads
// in v1 — the author commits before navigating away or loses the queue.
// Phase 4 may add IndexedDB persistence if reload-loss becomes a real
// problem.
//
// API:
//   addImageToQueue(blob, postFolder, { fromFilename }?)  -> { name, filePath, markdownRef } | { error }
//   getQueueAsFiles()                                     -> [{ filePath, content, binary: true }]
//   getQueueForPost(postFolder)                           -> queue entries for that post
//   clearQueue()                                          -> empty (after successful commit)
//   queueSize()                                           -> number of pending images

const queue = new Map(); // key: filePath, value: { blob, base64, postFolder, name, mime, size }

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

// Supported MIME types and their canonical file extensions. PNG and JPEG
// are the everyday cases; WebP and GIF round out the modern web image set.
// Animated GIFs land here too — the build's dither plugin ignores them
// (out of scope for v1 per the plan §11), but they can still be uploaded
// and inserted with the {.no-dither} flag.
const MIME_TO_EXT = {
  "image/png":  "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif":  "gif",
};

function mimeToExt(mime) {
  return MIME_TO_EXT[mime] || null;
}

/**
 * Convert a Blob to a base64 string. Uses chunked String.fromCharCode to
 * avoid call-stack overflow on the conversion path for large blobs
 * (>500KB or so on some engines).
 */
async function blobToBase64(blob) {
  const buf   = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * Slugify a filename. Preserves the extension; folds the stem to lowercase
 * letters/digits/hyphens/underscores. Used for drag-dropped files whose
 * original name we want to preserve loosely.
 */
function slugifyFilename(name) {
  const dot  = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext  = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const slug = stem.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60); // hard cap so silly-long filenames don't sprawl
  const safeStem = slug || "image";
  return ext ? `${safeStem}.${ext}` : safeStem;
}

function pathFor(postFolder, name) {
  return `src/content/posts/${postFolder}/images/${name}`;
}

/**
 * Find a name that doesn't yet exist in the queue for this post folder.
 * On collision, append `-2`, `-3`, etc. before the extension.
 */
function uniqueName(postFolder, candidate) {
  if (!queue.has(pathFor(postFolder, candidate))) return candidate;

  const dot  = candidate.lastIndexOf(".");
  const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
  const ext  = dot > 0 ? candidate.slice(dot)    : "";

  for (let i = 2; i < 1000; i++) {
    const test = `${stem}-${i}${ext}`;
    if (!queue.has(pathFor(postFolder, test))) return test;
  }
  // Pathological — return something unique by appending a timestamp.
  return `${stem}-${Date.now()}${ext}`;
}

/**
 * Add an image blob to the queue. Returns either:
 *   { name, filePath, markdownRef }  — success; markdownRef is the path to
 *                                      splice into the markdown body
 *   { error: string }                 — validation failure (size/mime/etc.)
 */
export async function addImageToQueue(blob, postFolder, opts = {}) {
  if (!postFolder) {
    return { error: "no post folder" };
  }
  if (!blob || typeof blob !== "object") {
    return { error: "not a Blob" };
  }
  if (blob.size > MAX_SIZE) {
    return { error: `image too large (${(blob.size / 1024 / 1024).toFixed(1)}MB > 10MB)` };
  }

  const mime = blob.type || "application/octet-stream";
  const ext  = mimeToExt(mime);
  if (!ext) {
    return { error: `unsupported image type: ${mime}` };
  }

  // Choose a candidate name. Drag-dropped files use the (slugified) source
  // filename; pastes get a `paste-NNN.<ext>` sequence keyed off the count
  // of existing queued pastes for this post.
  let candidate;
  if (opts.fromFilename) {
    candidate = slugifyFilename(opts.fromFilename);
  } else {
    const pastesForPost = Array.from(queue.values()).filter(
      e => e.postFolder === postFolder && /^paste-\d+\./.test(e.name)
    ).length;
    candidate = `paste-${String(pastesForPost + 1).padStart(3, "0")}.${ext}`;
  }

  const name     = uniqueName(postFolder, candidate);
  const filePath = pathFor(postFolder, name);
  const base64   = await blobToBase64(blob);

  queue.set(filePath, { blob, base64, postFolder, name, mime, size: blob.size });

  // The markdown reference is the "images/<name>" form. The renderer
  // expands that against the post's folder when emitting HTML; see
  // src/markdown/image-renderer.js → resolveHref.
  return { name, filePath, markdownRef: `images/${name}` };
}

/**
 * Flatten the queue into commit-payload file entries. Each entry is marked
 * `binary: true` so the dev middleware base64-decodes before writing and
 * the Netlify function passes `encoding: "base64"` to GitHub.
 */
export function getQueueAsFiles() {
  return Array.from(queue.entries()).map(([filePath, entry]) => ({
    filePath,
    content: entry.base64,
    binary:  true,
  }));
}

/**
 * Return queue entries scoped to one post folder. Useful for the dispatch
 * pane's pending-images indicator (Phase 4 polish — not used in v1).
 */
export function getQueueForPost(postFolder) {
  return Array.from(queue.values()).filter(e => e.postFolder === postFolder);
}

export function clearQueue() {
  queue.clear();
}

export function queueSize() {
  return queue.size;
}
