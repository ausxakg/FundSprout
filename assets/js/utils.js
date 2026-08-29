/* ==========================================================================
   FundSprout — Utilities
   ========================================================================== */

const Utils = {
  currency() { return DB.data.settings.currency || '₱'; },

  formatMoney(n, opts = {}) {
    const num = Number(n) || 0;
    const sign = opts.forceSign && num > 0 ? '+' : '';
    const abs = Math.abs(num);
    const formatted = abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const negSign = num < 0 ? '-' : '';
    return `${sign}${negSign}${this.currency()}${formatted}`;
  },

  formatCompact(n) {
    const num = Number(n) || 0;
    const abs = Math.abs(num);
    if (abs >= 1_000_000) return `${this.currency()}${(num / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${this.currency()}${(num / 1_000).toFixed(1)}K`;
    return this.formatMoney(num);
  },

  // FundSprout uses Philippine time consistently for all user-facing dates/times.
  // Keep timestamps stored as normal ISO/epoch values, but derive calendar values
  // from Asia/Manila so dates do not roll back to the previous day before 8 AM PHT.
  TIME_ZONE: 'Asia/Manila',

  _parts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  },

  todayISO() {
    const p = this._parts();
    return `${p.year}-${p.month}-${p.day}`;
  },

  nowTime() {
    const p = this._parts();
    return `${p.hour}:${p.minute}`;
  },

  _shiftISO(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return date.toISOString().slice(0, 10);
  },

  _dateFromISO(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return null;
    // Noon UTC keeps the calendar date stable regardless of the device timezone.
    return new Date(Date.UTC(y, m - 1, d, 12));
  },

  formatDate(iso) {
    if (!iso) return '';
    const d = this._dateFromISO(iso);
    if (!d || isNaN(d)) return iso;
    const today = this.todayISO();
    const yest = this._shiftISO(today, -1);
    if (iso === today) return 'Today';
    if (iso === yest) return 'Yesterday';
    return d.toLocaleDateString(undefined, {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  },

  formatTodayLong() {
    const d = this._dateFromISO(this.todayISO());
    return d.toLocaleDateString('en-PH', {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  },

  formatSyncDateTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    if (isNaN(d)) return '';
    return d.toLocaleString(undefined, {
      timeZone: this.TIME_ZONE,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  },

  formatTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  },

  formatDateTime(iso, time) {
    return `${this.formatDate(iso)} · ${this.formatTime(time)}`;
  },

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  },

  uid() { return Math.random().toString(36).slice(2, 10); },

  clamp(n, min, max) { return Math.min(Math.max(n, min), max); },

  isValidAmount(v) {
    const n = Number(v);
    return v !== '' && v !== null && v !== undefined && !isNaN(n) && n > 0;
  },

  animateCount(el, from, to, duration = 700, formatter = (v) => Utils.formatMoney(v)) {
    if (!el) return;
    if (!DB.data.settings.animations) {
      el.textContent = formatter(to);
      return;
    }
    const start = performance.now();
    const diff = to - from;
    function tick(now) {
      const progress = Utils.clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const val = from + diff * eased;
      el.textContent = formatter(val);
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = formatter(to);
    }
    requestAnimationFrame(tick);
  },

  startOfWeek(d = new Date()) {
    // Monday-start week based on the calendar date in the Philippines.
    const p = this._parts(d);
    const date = this._dateFromISO(`${p.year}-${p.month}-${p.day}`);
    const day = date.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setUTCDate(date.getUTCDate() + diff);
    return date;
  },

  inRange(iso, range) {
    if (!iso) return false;
    const today = this.todayISO();
    if (range === 'daily') return iso === today;

    const [year, month] = today.split('-');
    if (range === 'monthly') return iso.startsWith(`${year}-${month}-`);
    if (range === 'yearly') return iso.startsWith(`${year}-`);

    if (range === 'weekly') {
      const start = this.startOfWeek();
      const startISO = start.toISOString().slice(0, 10);
      const endISO = this._shiftISO(startISO, 6);
      return iso >= startISO && iso <= endISO;
    }
    return true;
  }
};
