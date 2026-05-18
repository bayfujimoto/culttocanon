// ── Public-site background ───────────────────────────────────────────────────
// A single image rendered behind the centered shell window, rotating once per
// calendar day. The reader can override the treatment via `:bg <name>`, which
// persists across sessions in localStorage. The default treatment is the
// untreated original — the lo-fi quality is conceptually load-bearing for
// Cult to Canon (see docs/cult-to-canon-report_250515.md and the 14-variant
// treatment test mocked at /bg-mockups/index.html).
//
//   :bg original    untreated source image (default)
//   :bg pixelated   the .pixelated.png variant, upscaled with image-rendering:pixelated
//   :bg duotone     source + SVG feColorMatrix collapse to base02 → base2
//   :bg off         no image; falls back to --bg-backdrop
//
// Adding a new background:
//   Drop an N+1.jpg into /public/backgrounds/ (the next sequential name).
//   That's it. The directory is the single source of truth: BACKGROUND_IMAGES
//   is auto-discovered at dev-server start and `vite build` by
//   build/vite-plugin-background-pixelate.js, which also generates the
//   .pixelated.png variant. Deleting a source removes it from rotation.
//   The build/bake-backgrounds.py script is kept as a manual fallback if you
//   want to bake outside the Vite pipeline.
//
// The rotation is deterministic across reloads — a date-seeded index into
// BACKGROUND_IMAGES means every visitor on the same day sees the same image.

import "./background.css";

// Ordered list of background bare-names, discovered from /public/backgrounds/
// at build time (sorted ascending). Each name N resolves to:
//   /backgrounds/N.jpg          full-size source (used by original + duotone)
//   /backgrounds/N.pixelated.png small variant (used by pixelated)
import { BACKGROUND_IMAGES } from "virtual:ctc-backgrounds";

const TREATMENTS = ["original", "pixelated", "duotone", "off"];
const DEFAULT_TREATMENT = "original";
const STORAGE_KEY = "ctc-bg-treatment";

// One-time SVG defs injected on init. The duotone filter mirrors mockup 04 —
// luminance collapse, then a two-stop ramp from base02 (#073642) to base2
// (#eee8d5).
const DUOTONE_SVG = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <filter id="ctc-bg-duotone" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="
        0.299 0.587 0.114 0 0
        0.299 0.587 0.114 0 0
        0.299 0.587 0.114 0 0
        0     0     0     1 0
      "/>
      <feComponentTransfer>
        <feFuncR type="table" tableValues="0.027 0.933"/>
        <feFuncG type="table" tableValues="0.212 0.910"/>
        <feFuncB type="table" tableValues="0.259 0.835"/>
      </feComponentTransfer>
    </filter>
  </defs>
</svg>`;

let bgEl = null;
let currentTreatment = null;
let currentImageName = null;

/**
 * Initialize the rotating background. Idempotent — calling twice is a no-op.
 * Must be called before initModes() so the user's `:bg` command can find the
 * .ctc-bg element to operate on.
 */
export function initBackground() {
  if (bgEl) return;

  // SVG filter defs go in once. They're keyed by id, so re-inserting is safe
  // but wasteful — guard with a sentinel.
  if (!document.getElementById("ctc-bg-duotone")) {
    document.body.insertAdjacentHTML("afterbegin", DUOTONE_SVG);
  }

  bgEl = document.createElement("div");
  bgEl.className = "ctc-bg";
  // Insert as the *first* body child so it sits underneath #app in source
  // order. The CSS also gives it position:fixed; z-index:0 to be sure.
  document.body.insertBefore(bgEl, document.body.firstChild);

  currentImageName = pickDailyImage(new Date());

  // Restore the saved treatment, or fall back to the default. Unknown saved
  // values (legacy or tampered) fall back too.
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) { /* private mode */ }
  const initial = TREATMENTS.includes(saved) ? saved : DEFAULT_TREATMENT;
  applyTreatment(initial);
}

/**
 * Public API used by the `:bg` command handler. Returns true if the treatment
 * name was valid (and applied), false otherwise so the caller can flash an
 * error in the statusbar. No-op if initBackground() hasn't run yet.
 */
export function setBackgroundTreatment(name) {
  if (!bgEl) return false;
  if (!TREATMENTS.includes(name)) return false;
  applyTreatment(name);
  try { localStorage.setItem(STORAGE_KEY, name); } catch (_) { /* private mode */ }
  return true;
}

/** Exposed for the help overlay / status display. */
export function getBackgroundTreatment() {
  return currentTreatment;
}

/** Exposed for tests / introspection. */
export function getBackgroundTreatments() {
  return TREATMENTS.slice();
}

// ── Internal ────────────────────────────────────────────────────────────────

function applyTreatment(name) {
  if (!bgEl) return;
  currentTreatment = name;

  // Reset all modifier classes, then set the active one. `is-off` hides the
  // element entirely via CSS (display:none) so the page backdrop shows through.
  bgEl.className = "ctc-bg is-" + name;

  // Per-treatment image source. Pixelated uses the pre-baked tiny variant;
  // everything else uses the full-size original (duotone is a CSS filter on
  // the same source).
  if (name === "off") {
    bgEl.style.backgroundImage = "";
  } else if (name === "pixelated") {
    bgEl.style.backgroundImage = `url("/backgrounds/${currentImageName}.pixelated.png")`;
  } else {
    bgEl.style.backgroundImage = `url("/backgrounds/${currentImageName}.jpg")`;
  }
}

/**
 * Pick today's image deterministically from BACKGROUND_IMAGES using the
 * day-of-year as a seed. Same date → same image across reloads and visitors.
 * Falls back to the first entry if the list is empty (shouldn't happen in
 * practice — at least one image must always be present).
 */
export function pickDailyImage(date) {
  if (!BACKGROUND_IMAGES.length) return null;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dayOfYear = Math.floor((today - start) / 86400000);
  return BACKGROUND_IMAGES[dayOfYear % BACKGROUND_IMAGES.length];
}
