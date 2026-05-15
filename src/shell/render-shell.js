// ── Shared TUI shell renderer ────────────────────────────────────────────────
// Both the public site and the admin use the same asymmetric three-pane shell.
// The structure, layout, gutters, statusbar, and mobile tabstrip are identical;
// only the pane labels, keys, and palette differ.
//
// Layout:
//   ┌───────────────┬────────────────────────────┐
//   │               │  [pane B]    (top right)   │
//   │   [pane A]    ├────────────────────────────┤
//   │   (left)      │  [pane C]    (bottom right)│
//   └───────────────┴────────────────────────────┘
//
// Config shape:
//   {
//     identity: { name: 'CULT_TO_CANON', version: 'v0.1.0' },
//     panes: [
//       { key: 'b', label: 'Browse',     placeholder: '…' },   // left
//       { key: 'r', label: 'Read',       placeholder: '…' },   // top right
//       { key: 'm', label: 'Marginalia', placeholder: '…' },   // bottom right
//     ],
//   }

export function renderShell(root, config) {
  const [paneA, paneB, paneC] = config.panes;
  root.innerHTML = `
    <header class="shell-topbar">
      <div class="shell-identity">
        <span class="shell-identity-name">${escapeHTML(config.identity.name)}</span>
        <span class="shell-identity-sub">${escapeHTML(config.identity.version)}&nbsp;<span class="shell-identity-cursor"></span></span>
      </div>
      <div class="shell-topbar-breadcrumb" id="shell-topbar-breadcrumb"></div>
    </header>

    <div class="shell-grid" id="shell-grid">
      <section class="shell-pane is-focused" data-pane="${escapeAttr(paneA.key)}" id="pane-${escapeAttr(paneA.key)}">
        <span class="shell-pane-label">
          <span class="shell-pane-letter">${escapeHTML(paneA.key)}</span>${escapeHTML(paneA.label)}
        </span>
        <div class="shell-pane-body">
          ${paneA.placeholder ? renderPlaceholder(paneA.placeholder) : ''}
        </div>
      </section>

      <div class="shell-gutter shell-gutter-v" role="separator" aria-orientation="vertical" aria-label="Resize ${escapeAttr(paneA.label)} pane" tabindex="0"></div>

      <div class="shell-grid-right">
        <section class="shell-pane" data-pane="${escapeAttr(paneB.key)}" id="pane-${escapeAttr(paneB.key)}">
          <span class="shell-pane-label">
            <span class="shell-pane-letter">${escapeHTML(paneB.key)}</span>${escapeHTML(paneB.label)}
          </span>
          <div class="shell-pane-body">
            ${paneB.placeholder ? renderPlaceholder(paneB.placeholder) : ''}
          </div>
        </section>

        <div class="shell-gutter shell-gutter-h" role="separator" aria-orientation="horizontal" aria-label="Resize ${escapeAttr(paneB.label)} pane" tabindex="0"></div>

        <section class="shell-pane" data-pane="${escapeAttr(paneC.key)}" id="pane-${escapeAttr(paneC.key)}">
          <span class="shell-pane-label">
            <span class="shell-pane-letter">${escapeHTML(paneC.key)}</span>${escapeHTML(paneC.label)}
          </span>
          <div class="shell-pane-body">
            ${paneC.placeholder ? renderPlaceholder(paneC.placeholder) : ''}
          </div>
        </section>
      </div>
    </div>

    <nav class="shell-mobile-tabs" aria-label="Pane switcher">
      ${config.panes.map(p => `
        <button class="shell-mobile-tab" data-tab="${escapeAttr(p.key)}" type="button">
          <span class="shell-mobile-tab-letter">${escapeHTML(p.key)}</span>
          <span class="shell-mobile-tab-label">${escapeHTML(p.label)}</span>
        </button>
      `).join('')}
    </nav>

    <footer class="shell-statusbar">
      <div class="shell-statusbar-row shell-statusbar-state">
        <span class="shell-status-state" id="shell-status-state">⏵ ready</span>
        <span class="shell-status-mode  shell-status-mode--normal" id="shell-status-mode">-- NORMAL --</span>
        <span class="shell-status-time"  id="shell-status-time"></span>
      </div>
      <div class="shell-statusbar-row shell-statusbar-keymap" id="shell-status-keymap"></div>
    </footer>
  `;

  initClock();
  initMobileTabs(config.panes[0].key);
  initPaneFocus();
  initKeymapLegend(config.panes);
}

// ── Clock in the statusbar — updates every second ─────────────────────────────
function initClock() {
  function tick() {
    const t = document.getElementById('shell-status-time');
    if (!t) return;
    const n = new Date();
    t.textContent =
      String(n.getHours()).padStart(2, '0')   + ':' +
      String(n.getMinutes()).padStart(2, '0') + ':' +
      String(n.getSeconds()).padStart(2, '0');
  }
  tick();
  setInterval(tick, 1000);
}

// ── Mobile pane switcher — one pane visible at a time on small screens ──────
function initMobileTabs(defaultKey) {
  document.querySelectorAll('.shell-mobile-tab').forEach((t) => {
    t.addEventListener('click', () => setMobileActivePane(t.dataset.tab));
  });
  setMobileActivePane(defaultKey);
}

function setMobileActivePane(key) {
  document.querySelectorAll('.shell-pane[data-pane]').forEach((p) => {
    p.classList.toggle('is-mobile-active', p.dataset.pane === key);
  });
  document.querySelectorAll('.shell-mobile-tab').forEach((t) => {
    t.classList.toggle('is-active', t.dataset.tab === key);
  });
}

// ── Pane focus — clicking a pane gives it the focus ring ─────────────────────
function initPaneFocus() {
  document.querySelectorAll('.shell-pane[data-pane]').forEach((pane) => {
    pane.addEventListener('mousedown', () => {
      const key = pane.dataset.pane;
      if (!key) return;
      document.querySelectorAll('.shell-pane').forEach((p) => {
        p.classList.toggle('is-focused', p === pane);
      });
    });
  });
}

// ── Keymap legend — placeholder hints for Phase 0; populated in later phases ─
function initKeymapLegend(panes) {
  const el = document.getElementById('shell-status-keymap');
  if (!el) return;
  // Each pane key shows a one-letter switch hint to the other two panes.
  const hints = panes.flatMap((p) => [
    [p.key, p.label.toLowerCase()],
  ]);
  hints.push([':', 'cmd']);
  el.innerHTML = hints
    .map(([k, lbl]) => `<span><kbd>${escapeHTML(k)}</kbd>${escapeHTML(lbl)}</span>`)
    .join('');
}

// ── Placeholder body content ─────────────────────────────────────────────────
function renderPlaceholder(text) {
  return `
    <div class="shell-placeholder">
      ${escapeHTML(text)}
      <span class="shell-placeholder-sub">— phase 0 scaffold</span>
    </div>
  `;
}

// ── HTML escaping ────────────────────────────────────────────────────────────
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function escapeAttr(s) {
  return escapeHTML(s);
}
