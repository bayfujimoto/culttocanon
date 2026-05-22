// ── Admin state ──────────────────────────────────────────────────────────────
// Minimal pubsub store. Mirrors bayfujimoto.com's admin state pattern.
//
// Shape:
//   {
//     allPosts:       Post[],            // all posts (incl. private, abandoned)
//     view:           'dashboard'|'edit'|'new',
//     currentPostId:  string | null,     // post currently open in Manuscript
//     pendingChanges: PendingChange[],   // staged writes waiting for commit
//     status:         null|'saving'|'saved'|'error',
//     statusMessage:  string,
//   }
//
//   PendingChange = {
//     id:           'ESS-2026-001',
//     action:       'add' | 'edit',
//     filePath:     'src/content/posts/ESS-2026-001-…md',
//     content:      '---\n…',
//     // Version decision, chosen per-post at save time (post-form.js → the
//     // statusbar picker) and consumed at commit (dispatch.js):
//     bump:         'patch' | 'minor' | 'major' | null,  // edits only
//     startVersion: '0.1.0' | '1.0.0' | null,            // adds only
//     newVersion:   '0.2.0',  // computed result, for the Dispatch row label
//   }

const state = {
  allPosts:       [],
  view:           "dashboard",
  currentPostId:  null,
  pendingChanges: [],
  status:         null,
  statusMessage:  "",
};

const subscribers = [];

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of subscribers) fn(state);
}

export function subscribe(fn) {
  subscribers.push(fn);
  return () => {
    const i = subscribers.indexOf(fn);
    if (i !== -1) subscribers.splice(i, 1);
  };
}

/**
 * Stage a write — either a new post or an edit to an existing post. Replaces
 * any existing pending change for the same id.
 */
export function stageChange(change) {
  const existing = state.pendingChanges.findIndex(c => c.id === change.id);
  const next = state.pendingChanges.slice();
  if (existing >= 0) next[existing] = change;
  else next.push(change);
  setState({ pendingChanges: next });
}

export function clearPending() {
  setState({ pendingChanges: [] });
}

/**
 * Update the in-memory `allPosts` after a successful commit, so subsequent
 * reads (version bumps, picker projections, router lookups) see the new
 * version/revised/body instead of the boot-time snapshot.
 */
export function upsertPost(post) {
  const i = state.allPosts.findIndex(p => p.id === post.id);
  const next = state.allPosts.slice();
  if (i >= 0) next[i] = post;
  else        next.push(post);
  setState({ allPosts: next });
}
