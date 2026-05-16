// ── Listbox ──────────────────────────────────────────────────────────────────
// A dependency-free, keyboard-accessible single-select control that replaces
// the native <select> in the post form. The native open option list is
// OS-chrome we can't theme; this renders a phosphor panel instead.
//
// The form is uncontrolled (see post-form.js): values are read back by
// `#field-<name>` selectors and dirty-tracking listens for `change` on real
// inputs. So each listbox keeps a hidden <input id="field-<name>"> as its
// value carrier and dispatches a bubbling `change` on selection — the rest of
// the form stays oblivious to the swap.
//
// The first option is always the empty "—" (unset), matching the old
// `<option value="">—</option>` semantics.

let _seq = 0;

/**
 * Build a listbox. Returns `{ html, mount(container) }`:
 *   - `html` is dropped into the form template string.
 *   - `mount(container)` wires behavior once the markup is in the DOM.
 *
 * @param {object}   o
 * @param {string}   o.name      field name (also drives #field-<name>)
 * @param {string}   o.value     current value ("" when unset)
 * @param {string[]} o.values    enum options (the empty option is prepended)
 */
export function createListbox({ name, value = "", values = [] }) {
  const uid     = `lb-${name}-${++_seq}`;
  const panelId = `${uid}-panel`;
  const opts    = ["", ...values];
  const current = opts.includes(value) ? value : "";

  const optionHTML = opts
    .map((v, i) => {
      const label    = v === "" ? "—" : v;
      const selected = v === current;
      return `<li id="${uid}-opt-${i}" class="form-listbox-option${selected ? " is-selected" : ""}"
                  role="option" aria-selected="${selected}" data-value="${escapeAttr(v)}">
                <span class="form-listbox-marker" aria-hidden="true">▸</span>${escapeHTML(label)}
              </li>`;
    })
    .join("");

  const html = `
    <div class="form-listbox-wrap" data-listbox="${name}">
      <input type="hidden" id="field-${name}" name="${name}" value="${escapeAttr(current)}">
      <button type="button" class="form-listbox" id="${uid}-btn"
              role="combobox" aria-haspopup="listbox" aria-expanded="false"
              aria-controls="${panelId}">
        <span class="form-listbox-value">${escapeHTML(current === "" ? "—" : current)}</span>
        <span class="form-listbox-caret" aria-hidden="true"></span>
      </button>
      <ul class="form-listbox-panel" id="${panelId}" role="listbox"
          aria-label="${escapeAttr(name)}" tabindex="-1" hidden>
        ${optionHTML}
      </ul>
    </div>
  `;

  function mount(container) {
    const wrap   = container.querySelector(`[data-listbox="${name}"]`);
    if (!wrap) return;
    const input  = wrap.querySelector(`#field-${name}`);
    const btn    = wrap.querySelector(`#${uid}-btn`);
    const panel  = wrap.querySelector(`#${panelId}`);
    const valEl  = btn.querySelector(".form-listbox-value");
    const items  = Array.from(panel.querySelectorAll(".form-listbox-option"));
    let   active = Math.max(0, opts.indexOf(input.value));
    let   typeBuf = "";
    let   typeTimer = null;

    const isOpen = () => !panel.hidden;

    function open() {
      if (isOpen()) return;
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      positionPanel();
      setActive(Math.max(0, opts.indexOf(input.value)));
      panel.focus(); // route keydown to the panel handler
      document.addEventListener("pointerdown", onOutside, true);
      window.addEventListener("scroll", reposOrClose, true);
      window.addEventListener("resize", close);
    }

    function close({ focusBtn = false } = {}) {
      if (!isOpen()) return;
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onOutside, true);
      window.removeEventListener("scroll", reposOrClose, true);
      window.removeEventListener("resize", close);
      if (focusBtn) btn.focus();
    }

    // The form pane scrolls (overflow:auto); a fixed-position panel anchored
    // to the button rect avoids being clipped by the pane.
    function positionPanel() {
      const r = btn.getBoundingClientRect();
      panel.style.position = "fixed";
      panel.style.left  = `${r.left}px`;
      panel.style.top   = `${r.bottom + 2}px`;
      panel.style.width = `${r.width}px`;
      const below = window.innerHeight - r.bottom - 2;
      panel.style.maxHeight = `${Math.max(120, Math.min(280, below - 8))}px`;
    }

    function reposOrClose() { isOpen() && positionPanel(); }

    function setActive(i) {
      active = (i + items.length) % items.length;
      items.forEach((el, idx) => el.classList.toggle("is-active", idx === active));
      const el = items[active];
      panel.setAttribute("aria-activedescendant", el.id);
      el.scrollIntoView({ block: "nearest" });
    }

    function commit(i) {
      const v = opts[i];
      input.value = v;
      valEl.textContent = v === "" ? "—" : v;
      items.forEach((el, idx) => {
        const sel = idx === i;
        el.classList.toggle("is-selected", sel);
        el.setAttribute("aria-selected", String(sel));
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      close({ focusBtn: true });
    }

    function onOutside(e) {
      if (!wrap.contains(e.target)) close();
    }

    function typeahead(ch) {
      clearTimeout(typeTimer);
      typeBuf += ch.toLowerCase();
      typeTimer = setTimeout(() => { typeBuf = ""; }, 600);
      const from = active + (typeBuf.length === 1 ? 1 : 0);
      for (let n = 0; n < opts.length; n++) {
        const idx = (from + n) % opts.length;
        const label = opts[idx] === "" ? "—" : opts[idx];
        if (label.toLowerCase().startsWith(typeBuf)) { setActive(idx); break; }
      }
    }

    btn.addEventListener("click", () => (isOpen() ? close() : open()));

    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" ||
          e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    panel.addEventListener("keydown", (e) => {
      switch (e.key) {
        case "ArrowDown": e.preventDefault(); setActive(active + 1); break;
        case "ArrowUp":   e.preventDefault(); setActive(active - 1); break;
        case "Home":      e.preventDefault(); setActive(0); break;
        case "End":       e.preventDefault(); setActive(items.length - 1); break;
        case "Enter":
        case " ":         e.preventDefault(); commit(active); break;
        case "Escape":    e.preventDefault(); close({ focusBtn: true }); break;
        case "Tab":       close(); break;
        default:
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            typeahead(e.key);
          }
      }
    });

    items.forEach((el, idx) => {
      el.addEventListener("pointerenter", () => setActive(idx));
      el.addEventListener("click", () => commit(idx));
    });
  }

  return { html, mount };
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function escapeAttr(s) { return escapeHTML(s); }
