/* ==========================================================================
   FundSprout — UI Kit
   Toasts, Modals, Custom Dropdowns, Ripple effect. No native <select> or
   <dialog> is used anywhere in the app.
   ========================================================================== */

/* -------------------- Toasts -------------------- */
const Toast = {
  stack: null,
  init() {
    this.stack = document.getElementById('toastStack');
  },
  show({ type = 'success', title, message, duration = 4000 }) {
    if (!this.stack) this.init();
    const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <i class="fa-solid ${icons[type] || icons.success} toast-icon"></i>
      <div class="toast-body">
        <strong>${Utils.escapeHtml(title)}</strong>
        ${message ? `<span>${Utils.escapeHtml(message)}</span>` : ''}
      </div>
      <button class="fs-modal-close" style="width:26px;height:26px;margin-left:auto;flex-shrink:0;" aria-label="Dismiss">
        <i class="fa-solid fa-xmark" style="font-size:11px;"></i>
      </button>
    `;
    const dismiss = () => {
      el.classList.add('closing');
      setTimeout(() => el.remove(), 200);
    };
    el.querySelector('.fs-modal-close').addEventListener('click', dismiss);
    this.stack.appendChild(el);
    if (duration) setTimeout(dismiss, duration);
  },
  success(title, message) { this.show({ type: 'success', title, message }); },
  error(title, message) { this.show({ type: 'error', title, message }); },
  warning(title, message) { this.show({ type: 'warning', title, message }); }
};

/* -------------------- Modals -------------------- */
const ModalManager = {
  openStack: [],
  open(id) {
    const backdrop = document.getElementById(id);
    if (!backdrop) return;
    backdrop.classList.add('show');
    backdrop.setAttribute('aria-hidden', 'false');
    this.openStack.push(id);
    document.body.style.overflow = 'hidden';
    const focusable = backdrop.querySelector('input, select, textarea, button, [tabindex]');
    if (focusable) setTimeout(() => focusable.focus(), 60);
  },
  close(id) {
    const backdrop = document.getElementById(id);
    if (!backdrop) return;
    backdrop.classList.remove('show');
    backdrop.setAttribute('aria-hidden', 'true');
    this.openStack = this.openStack.filter((x) => x !== id);
    if (this.openStack.length === 0) document.body.style.overflow = '';
  },
  closeTop() {
    if (this.openStack.length) this.close(this.openStack[this.openStack.length - 1]);
  },
  init() {
    document.addEventListener('click', (e) => {
      const backdrop = e.target.closest('.fs-modal-backdrop');
      if (backdrop && e.target === backdrop) this.close(backdrop.id);
      const closeBtn = e.target.closest('[data-fs-modal-close]');
      if (closeBtn) {
        const parent = closeBtn.closest('.fs-modal-backdrop');
        if (parent) this.close(parent.id);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeTop();
    });
  }
};

/* -------------------- Confirm dialog helper -------------------- */
function confirmDialog({ title, message, confirmText = 'Delete', tone = 'danger' }) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('confirmModal');
    backdrop.querySelector('.confirm-title').textContent = title;
    backdrop.querySelector('.confirm-message').textContent = message;
    const confirmBtn = backdrop.querySelector('.confirm-action-btn');
    confirmBtn.textContent = confirmText;
    confirmBtn.className = `btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'} confirm-action-btn`;
    const cleanup = () => {
      confirmBtn.replaceWith(confirmBtn.cloneNode(true));
      ModalManager.close('confirmModal');
    };
    const newBtn = backdrop.querySelector('.confirm-action-btn');
    newBtn.onclick = () => { cleanup(); resolve(true); };
    backdrop.querySelector('.confirm-cancel-btn').onclick = () => { ModalManager.close('confirmModal'); resolve(false); };
    ModalManager.open('confirmModal');
  });
}

/* -------------------- Ripple effect on .btn -------------------- */
function attachRipple() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn, .icon-btn, .nav-item, .bottom-nav-item, .pill-tab');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    const prevPos = getComputedStyle(btn).position;
    if (prevPos === 'static') btn.style.position = 'relative';
    btn.style.overflow = btn.style.overflow || 'hidden';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });
}

/* -------------------- Custom Dropdown -------------------- */
/**
 * Turns a container with [data-dropdown] into a fully custom, accessible,
 * keyboard-navigable dropdown that always opens directly below its trigger
 * and repositions on scroll/resize.
 *
 * Usage:
 * <div class="dropdown" data-dropdown data-name="category" data-searchable="true">
 *   <button type="button" class="dropdown-trigger"><span class="placeholder">Select...</span><i class="fa-solid fa-chevron-down dd-caret"></i></button>
 * </div>
 * Then call Dropdown.create(el, { options: [{value,label,icon}], onChange, value })
 */
const Dropdown = {
  registry: new Map(),
  activeId: null,

  create(container, { options, value, onChange, placeholder = 'Select…', searchable = false }) {
    const id = container.id || `dd_${Utils.uid()}`;
    container.id = id;
    container.innerHTML = `
      <button type="button" class="dropdown-trigger" aria-haspopup="listbox" aria-expanded="false">
        <span class="dd-label placeholder">${Utils.escapeHtml(placeholder)}</span>
        <i class="fa-solid fa-chevron-down dd-caret"></i>
      </button>
    `;
    const trigger = container.querySelector('.dropdown-trigger');
    const panel = document.createElement('div');
    panel.className = 'dropdown-panel';
    panel.setAttribute('role', 'listbox');
    document.body.appendChild(panel);

    const state = { options, value: value ?? null, onChange, searchable, filtered: options, highlighted: -1 };
    this.registry.set(id, { container, trigger, panel, state });

    this._renderOptions(id);
    this._syncTrigger(id);

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle(id);
    });

    trigger.addEventListener('keydown', (e) => this._onTriggerKeydown(id, e));

    return {
      setValue: (v) => { state.value = v; this._syncTrigger(id); this._renderOptions(id); },
      getValue: () => state.value,
      setOptions: (opts) => { state.options = opts; state.filtered = opts; this._renderOptions(id); this._syncTrigger(id); }
    };
  },

  _syncTrigger(id) {
    const { trigger, state } = this.registry.get(id);
    const label = trigger.querySelector('.dd-label');
    const opt = state.options.find((o) => o.value === state.value);
    if (opt) {
      label.classList.remove('placeholder');
      label.innerHTML = `${opt.icon ? `<i class="fa-solid ${opt.icon} dropdown-selected-icon"></i>` : ''}${Utils.escapeHtml(opt.label)}`;
    } else {
      label.classList.add('placeholder');
      label.textContent = trigger.dataset.placeholder || label.textContent;
    }
  },

  _renderOptions(id) {
    const { panel, state } = this.registry.get(id);
    let html = '';
    if (state.searchable) {
      html += `<input type="text" class="dropdown-search" placeholder="Search…" />`;
    }
    if (!state.filtered.length) {
      html += `<div class="dropdown-empty">No results found</div>`;
    } else {
      html += state.filtered.map((o, i) => `
        <div class="dropdown-option ${o.value === state.value ? 'selected' : ''}" data-value="${Utils.escapeHtml(o.value)}" role="option" tabindex="-1">
          ${o.icon ? `<i class="fa-solid ${o.icon}"></i>` : ''}
          <span>${Utils.escapeHtml(o.label)}</span>
          ${o.value === state.value ? '<i class="fa-solid fa-check check"></i>' : ''}
        </div>
      `).join('');
    }
    panel.innerHTML = html;

    panel.querySelectorAll('.dropdown-option').forEach((optEl) => {
      optEl.addEventListener('click', () => {
        state.value = optEl.dataset.value;
        this._syncTrigger(id);
        this._renderOptions(id);
        if (state.onChange) state.onChange(state.value);
        this.close(id);
      });
    });

    const search = panel.querySelector('.dropdown-search');
    if (search) {
      search.addEventListener('input', () => {
        const q = search.value.toLowerCase();
        state.filtered = state.options.filter((o) => o.label.toLowerCase().includes(q));
        this._renderOptions(id);
        panel.querySelector('.dropdown-search').focus();
      });
      search.addEventListener('click', (e) => e.stopPropagation());
    }
  },

  _position(id) {
    const { trigger, panel } = this.registry.get(id);
    const rect = trigger.getBoundingClientRect();
    const panelHeight = panel.offsetHeight || 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    let top = rect.bottom + 6;
    if (spaceBelow < panelHeight + 12 && rect.top > panelHeight) {
      top = rect.top - panelHeight - 6;
    }
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${Math.max(rect.width, 180)}px`;
  },

  toggle(id) {
    if (this.activeId === id) this.close(id);
    else {
      if (this.activeId) this.close(this.activeId);
      this.open(id);
    }
  },

  open(id) {
    const { trigger, panel, state } = this.registry.get(id);
    state.filtered = state.options;
    this._renderOptions(id);
    this._position(id);
    trigger.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    panel.classList.add('open');
    this.activeId = id;
    const search = panel.querySelector('.dropdown-search');
    if (search) setTimeout(() => search.focus(), 50);
    this._repositionHandler = () => this._position(id);
    window.addEventListener('scroll', this._repositionHandler, true);
    window.addEventListener('resize', this._repositionHandler);
  },

  close(id) {
    const entry = this.registry.get(id);
    if (!entry) return;
    entry.trigger.classList.remove('open');
    entry.trigger.setAttribute('aria-expanded', 'false');
    entry.panel.classList.remove('open');
    if (this.activeId === id) this.activeId = null;
    if (this._repositionHandler) {
      window.removeEventListener('scroll', this._repositionHandler, true);
      window.removeEventListener('resize', this._repositionHandler);
    }
  },

  _onTriggerKeydown(id, e) {
    const { state } = this.registry.get(id);
    if (['ArrowDown', 'Enter', ' '].includes(e.key) && this.activeId !== id) {
      e.preventDefault();
      this.open(id);
      return;
    }
    if (e.key === 'Escape') { this.close(id); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      state.highlighted = Utils.clamp((state.highlighted ?? -1) + dir, 0, state.filtered.length - 1);
      const { panel } = this.registry.get(id);
      panel.querySelectorAll('.dropdown-option').forEach((el, i) => {
        el.classList.toggle('highlighted', i === state.highlighted);
      });
    }
    if (e.key === 'Enter' && state.highlighted >= 0) {
      const opt = state.filtered[state.highlighted];
      if (opt) {
        state.value = opt.value;
        this._syncTrigger(id);
        if (state.onChange) state.onChange(state.value);
        this.close(id);
      }
    }
  },

  closeAll() {
    if (this.activeId) this.close(this.activeId);
  }
};

document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown-panel') && !e.target.closest('.dropdown-trigger')) {
    Dropdown.closeAll();
  }
});

/* -------------------- Field validation helper -------------------- */
function setFieldError(inputEl, errorEl, message) {
  if (message) {
    inputEl.classList.add('invalid');
    if (errorEl) { errorEl.textContent = message; errorEl.classList.add('show'); }
  } else {
    inputEl.classList.remove('invalid');
    if (errorEl) { errorEl.classList.remove('show'); }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  Toast.init();
  ModalManager.init();
  attachRipple();
});
