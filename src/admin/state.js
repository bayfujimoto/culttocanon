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
//     id:        'POST-2026-001',
//     action:    'add' | 'edit',
//     filePath:  'src/content/posts/POST-2026-001-…md',
//     content:   '---\n…',
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
