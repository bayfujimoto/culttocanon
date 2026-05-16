// ── Shared TUI shell renderer ────────────────────────────────────────────────
// Both the public site and the admin use the same asymmetric three-pane shell.
// The structure, layout, gutters, statusbar, and mobile tabstrip are identical;
// only the pane labels, keys, and palette differ.
//
// Layout:
//   ┌───────────────┬──────────────┬─────────────┐
//   │               │              │             │
//   │   [pane A]    │   [pane B]   │  [pane C]   │
//   │   (left)      │   (middle)   │  (right)    │
//   └───────────────┴──────────────┴─────────────┘
//
// Config shape:
//   {
//     identity: { name: 'CULT_TO_CANON', version: 'v0.1.0' },
//     panes: [
//       { key: 'b', label: 'Browse',     placeholder: '…' },   // left
//       { key: 'r', label: 'Read',       placeholder: '…' },   // top right
//       { key: 'm', label: 'Marginalia', placeholder: '…' },   // bottom right
//     ],
//     keymap: {                              // optional; static fallback if absent
//       groups:        { b: [[key,label],…], r: […], m: […] },
//       getFocusedPane: () => 'b',           // injected from the site's modes.js
//     },
//     help: {                                // optional; the `?` overlay model
//       title:    'CULT_TO_CANON — keys',
//       sections: [{ heading: 'Panes', rows: [['b','focus Browse'], …] }, …],
//     },
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

      <section class="shell-pane" data-pane="${escapeAttr(paneB.key)}" id="pane-${escapeAttr(paneB.key)}">
        <span class="shell-pane-label">
          <span class="shell-pane-letter">${escapeHTML(paneB.key)}</span>${escapeHTML(paneB.label)}
        </span>
        <div class="shell-pane-body">
          ${paneB.placeholder ? renderPlaceholder(paneB.placeholder) : ''}
        </div>
      </section>

      <div class="shell-gutter shell-gutter-v" role="separator" aria-orientation="vertical" aria-label="Resize ${escapeAttr(paneB.label)} pane" tabindex="0"></div>

      <section class="shell-pane" data-pane="${escapeAttr(paneC.key)}" id="pane-${escapeAttr(paneC.key)}">
        <span class="shell-pane-label">
          <span class="shell-pane-letter">${escapeHTML(paneC.key)}</span>${escapeHTML(paneC.label)}
        </span>
        <button class="shell-pane-collapse" type="button"
                aria-label="Collapse ${escapeAttr(paneC.label)}" aria-expanded="true"
                data-collapse-target="${escapeAttr(paneC.key)}">&#8722;</button>
        <div class="shell-pane-body">
          ${paneC.placeholder ? renderPlaceholder(paneC.placeholder) : ''}
        </div>
      </section>
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

    ${renderHelpOverlay(config.help)}
  `;

  initClock();
  initMobileTabs(config.panes[0].key);
  initPaneFocus();
  initMarginaliaCollapse();
  initResize();
  initKeymapLegend(config);
  initHelpOverlay();
}

// ── Pane resizing — drag (or arrow-key) the gutters between panes ────────────
// The grid tracks are CSS custom properties (see shell.css): `--pane-a-w` is
// the left pane's width; `--pane-b-w` is the middle pane's width. We write
// percentages so the layout stays fluid when the window resizes. Session-only.
function initResize() {
  const MIN = 10, MAX = 80, STEP = 2; // percent

  const clamp = (n) => Math.min(MAX, Math.max(MIN, n));

  // Per-gutter config: the first vertical gutter controls pane A's width
  // (its position as % of total grid = pane A width). The second controls
  // pane B's width — measured from pane B's element directly so pane A's
  // width doesn't pollute the value.
  const grid = document.getElementById('shell-grid');
  const gutters = Array.from(document.querySelectorAll('.shell-gutter'));

  const configs = [
    {
      prop: '--pane-a-w',
      disabled: () => false,
      // Pointer: gutter left edge relative to grid = pane A width.
      pctFromPointer: (e) => {
        const rect = grid.getBoundingClientRect();
        return clamp(((e.clientX - rect.left) / rect.width) * 100);
      },
      // Keyboard: pane A's rendered width as % of grid.
      currentPct: () => {
        const paneA = gutters[0].previousElementSibling;
        const rect = grid.getBoundingClientRect();
        return ((paneA?.getBoundingClientRect().width ?? 0) / rect.width) * 100;
      },
    },
    {
      prop: '--pane-b-w',
      disabled: () => grid?.classList.contains('is-collapsed'),
      // Pointer: distance from pane B's left edge to cursor = pane B width.
      pctFromPointer: (e) => {
        const paneB = gutters[1].previousElementSibling;
        const pBRect = paneB?.getBoundingClientRect();
        const gRect  = grid.getBoundingClientRect();
        if (!pBRect) return MIN;
        return clamp(((e.clientX - pBRect.left) / gRect.width) * 100);
      },
      // Keyboard: pane B's rendered width as % of grid.
      currentPct: () => {
        const paneB = gutters[1].previousElementSibling;
        const rect = grid.getBoundingClientRect();
        return ((paneB?.getBoundingClientRect().width ?? 0) / rect.width) * 100;
      },
    },
  ];

  gutters.forEach((gutter, index) => {
    const cfg = configs[index];
    if (!cfg || !grid) return;

    gutter.addEventListener('pointerdown', (e) => {
      if (cfg.disabled()) return;
      e.preventDefault();
      gutter.setPointerCapture(e.pointerId);
      grid.classList.add('is-resizing', 'is-resizing-v');
    });

    gutter.addEventListener('pointermove', (e) => {
      if (!gutter.hasPointerCapture(e.pointerId)) return;
      grid.style.setProperty(cfg.prop, cfg.pctFromPointer(e) + '%');
    });

    function endDrag(e) {
      if (gutter.hasPointerCapture(e.pointerId)) {
        gutter.releasePointerCapture(e.pointerId);
      }
      grid.classList.remove('is-resizing', 'is-resizing-v');
    }
    gutter.addEventListener('pointerup', endDrag);
    gutter.addEventListener('pointercancel', endDrag);

    // Keyboard: Left/Right arrow keys nudge the size.
    gutter.addEventListener('keydown', (e) => {
      if (cfg.disabled()) return;
      let delta = 0;
      if (e.key === 'ArrowLeft') delta = -STEP;
      else if (e.key === 'ArrowRight') delta = STEP;
      else return;
      e.preventDefault();
      grid.style.setProperty(cfg.prop, clamp(cfg.currentPct() + delta) + '%');
    });
  });
}

// ── Marginalia collapse — [-] button shrinks pane C to a right strip ─────────
// Session-only (no persistence); the `is-collapsed` class on shell-grid switches
// the third column track to a fixed strip width (see shell.css).
function initMarginaliaCollapse() {
  const btn  = document.querySelector('.shell-pane-collapse');
  const grid = document.getElementById('shell-grid');
  if (!btn || !grid) return;
  const key  = btn.dataset.collapseTarget;
  const pane = document.getElementById(`pane-${key}`);
  if (!pane) return;
  // The visible label minus the leading single-letter pane key (e.g. "Marginalia").
  const name = pane.querySelector('.shell-pane-label')?.textContent.trim().slice(1) || 'pane';

  function toggle() {
    const collapsed = grid.classList.toggle('is-collapsed');
    pane.classList.toggle('is-collapsed', collapsed);
    btn.innerHTML = collapsed ? '&#43;' : '&#8722;';
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${name}`);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
  // Clicking anywhere on the collapsed strip re-expands it.
  pane.addEventListener('click', () => {
    if (pane.classList.contains('is-collapsed')) toggle();
  });
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

// ── Keymap legend — config-driven, dynamic per focused pane ──────────────────
// Each site passes `config.keymap = { groups, getFocusedPane }`. The legend
// shows the group for whichever pane is focused; `rerenderKeymap()` (exported)
// is called by the site's modes engine whenever the focused pane changes, so
// the shell never has to monkey-patch the modes' onFocusChange handler.
//
// If `config.keymap` is absent we fall back to the original static behavior
// (one switch hint per pane + `:` cmd) — defensive, zero-risk.
let keymapState = null;

function initKeymapLegend(config) {
  const el = document.getElementById('shell-status-keymap');
  if (!el) return;

  if (!config.keymap) {
    const hints = config.panes.map((p) => [p.key, p.label.toLowerCase()]);
    hints.push([':', 'cmd']);
    el.innerHTML = renderLegendList(hints);
    return;
  }

  keymapState = {
    el,
    groups:         config.keymap.groups || {},
    getFocusedPane: config.keymap.getFocusedPane || (() => null),
  };
  rerenderKeymap();
}

function renderLegendList(list) {
  return list
    .map(([k, lbl]) => `<span><kbd>${escapeHTML(k)}</kbd>${escapeHTML(lbl)}</span>`)
    .join('');
}

// Re-render the legend for the currently-focused pane. Called by each site's
// internal setFocusedPane (imported from render-shell.js). No-op until the
// keymap has been initialized.
export function rerenderKeymap() {
  if (!keymapState) return;
  const { el, groups, getFocusedPane } = keymapState;
  const list = groups[getFocusedPane()] || Object.values(groups)[0] || [];
  el.innerHTML = renderLegendList(list);
}

// ── Help overlay (`?`) — full per-site command reference ─────────────────────
// Rendered once inside #app (which is position:relative; overflow:hidden), so
// the overlay stays clipped to the centered TUI window. Hidden until toggled.
// The shell owns open/close and the overlay's own dismissal keys; each modes
// engine only ever triggers toggleHelp().
function renderHelpOverlay(help) {
  if (!help) return '';
  const sections = (help.sections || []).map((s) => `
    <div class="shell-help-section">
      <h3>${escapeHTML(s.heading)}</h3>
      ${(s.rows || []).map(([k, l]) => `
        <div class="shell-help-row">
          <kbd>${escapeHTML(k)}</kbd><span>${escapeHTML(l)}</span>
        </div>`).join('')}
    </div>`).join('');

  return `
    <div class="shell-help" id="shell-help" hidden>
      <div class="shell-help-backdrop" data-help-close></div>
      <section class="shell-help-window" role="dialog" aria-modal="true"
               aria-label="Keyboard reference" tabindex="-1">
        <header class="shell-help-head">
          <span class="shell-help-title">${escapeHTML(help.title || 'keys')}</span>
          <span class="shell-help-dismiss">? / Esc to close</span>
        </header>
        <div class="shell-help-body">${sections}</div>
      </section>
    </div>
  `;
}

function initHelpOverlay() {
  const el = document.getElementById('shell-help');
  if (!el) return;
  el.querySelectorAll('[data-help-close]').forEach((node) => {
    node.addEventListener('click', closeHelp);
  });
  // Own the dismissal keys while open and stop them propagating to the
  // capture-phase modes keydown handler, so `?`/Esc don't double-fire.
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === '?') {
      e.preventDefault();
      e.stopPropagation();
      closeHelp();
    }
  });
}

export function isHelpOpen() {
  const el = document.getElementById('shell-help');
  return !!el && !el.hidden;
}

export function toggleHelp() {
  isHelpOpen() ? closeHelp() : openHelp();
}

function openHelp() {
  const el = document.getElementById('shell-help');
  if (!el) return;
  el.hidden = false;
  el.querySelector('.shell-help-window')?.focus();
}

export function closeHelp() {
  const el = document.getElementById('shell-help');
  if (!el || el.hidden) return;
  el.hidden = true;
  // No persistent focusable control in the shell; hand focus back to body.
  document.body.focus?.();
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
