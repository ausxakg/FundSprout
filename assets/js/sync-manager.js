/* ==========================================================================
   FundSprout — Sync Manager
   Offline-first background sync to a Google Apps Script + Google Sheets
   backend. localStorage (via StorageService/DB) remains the single source
   of truth; this module only mirrors changes to the cloud when possible.

   Nothing in here ever blocks or fails the local CRUD flow — every public
   method is safe to call even with no configured backend or no connection.
   ========================================================================== */

const SYNC_QUEUE_KEY = 'fundsprout.syncQueue.v1';
const SYNC_CONFIG_KEY = 'fundsprout.syncConfig.v1';
const SYNC_DEVICE_KEY = 'fundsprout.deviceId.v1';

const SYNC_PERIODIC_MS = 25000;      // background retry cadence while app is open
const SYNC_ONLINE_DELAY_MS = 1500;   // let the connection settle after "online" fires
const SYNC_FETCH_TIMEOUT_MS = 15000;
const SYNC_MAX_RETRY_BACKOFF = 5;
const SYNC_PULL_MS = 12000;
const SYNC_PAIRING_KEY = 'fundsprout.devicePairing.v1';    // stop growing backoff after this many retries

const SyncManager = {
  isSyncing: false,
  _periodicTimer: null,
  _onlineRetryTimer: null,
  _pullTimer: null,
  _statusEl: null,
  _statusTextEl: null,

  /* ---------------- Setup ---------------- */

  init() {
    this.config = this._loadConfig();
    this.pairing = this._loadPairing();
    this.deviceId = this._loadOrCreateDeviceId();
    this._mountStatusIndicator();
    this._renderStatus();

    window.addEventListener('online', () => {
      this._renderStatus();
      clearTimeout(this._onlineRetryTimer);
      this._onlineRetryTimer = setTimeout(async () => { await this.refreshPairing(); if (this._loadQueue().length) this.syncPendingChanges(); else if (this.isPaired()) this.pullRemoteData(false); }, SYNC_ONLINE_DELAY_MS);
    });
    window.addEventListener('offline', () => this._renderStatus());

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isOnline()) {
        if (this._loadQueue().length) this.syncPendingChanges();
        else if (this.isPaired()) this.pullRemoteData(false);
      }
    });

    if (this._periodicTimer) clearInterval(this._periodicTimer);
    this._periodicTimer = setInterval(() => {
      if (!this.isOnline()) return;
      this.refreshPairing();
      if (this._loadQueue().length > 0) this.syncPendingChanges();
      else if (this.isPaired()) this.pullRemoteData(false);
    }, SYNC_PERIODIC_MS);

    if (this._pullTimer) clearInterval(this._pullTimer);
    this._pullTimer = setInterval(() => {
      if (this.isOnline() && this.isPaired() && this._loadQueue().length === 0) this.pullRemoteData(false);
    }, SYNC_PULL_MS);

    // Initial attempt shortly after load (covers app cold-start with pending
    // changes from a previous offline session).
    if (this.isOnline()) {
      setTimeout(async () => {
        await this.refreshPairing();
        if (this.isPaired()) this.pullRemoteData(false);
        else this.syncPendingChanges();
      }, 800);
    }
  },

  isOnline() {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  },

  isConfigured() {
    return !!(this.config && this.config.url);
  },

  setEndpoint(url) {
    this.config.url = (url || '').trim();
    this._saveConfig();
    this._renderStatus();
    if (this.isConfigured()) {
      this.runInitialBackupIfNeeded();
      if (this.isOnline()) this.syncPendingChanges();
    }
  },

  getStatus() {
    const queue = this._loadQueue();
    const failed = queue.filter((op) => op.retryCount > 0).length;
    return {
      configured: this.isConfigured(),
      online: this.isOnline(),
      syncing: this.isSyncing,
      pending: queue.length,
      failed,
      lastSyncedAt: this.config.lastSyncedAt || null,
      paired: this.isPaired(),
      pairedAt: this.pairing.pairedAt || null,
      sharedDeviceId: this.getCloudDeviceId()
    };
  },

  /* ---------------- Device ID ---------------- */

  _loadOrCreateDeviceId() {
    try {
      let id = window.localStorage.getItem(SYNC_DEVICE_KEY);
      if (!id) {
        id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        window.localStorage.setItem(SYNC_DEVICE_KEY, id);
      }
      return id;
    } catch (e) {
      return 'dev_temp_' + Math.random().toString(36).slice(2, 10);
    }
  },

  /* ---------------- Config persistence ---------------- */

  _loadConfig() {
    try {
      const raw = window.localStorage.getItem(SYNC_CONFIG_KEY);
      if (!raw) return { url: '', initialBackupDone: false, lastSyncedAt: null, lastRemoteUpdatedAt: null };
      const parsed = JSON.parse(raw);
      return {
        url: parsed.url || '',
        initialBackupDone: !!parsed.initialBackupDone,
        lastSyncedAt: parsed.lastSyncedAt || null,
        lastRemoteUpdatedAt: parsed.lastRemoteUpdatedAt || null
      };
    } catch (e) {
      return { url: '', initialBackupDone: false, lastSyncedAt: null, lastRemoteUpdatedAt: null };
    }
  },

  _saveConfig() {
    try {
      window.localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(this.config));
    } catch (e) {
      console.error('FundSprout Sync: failed to save sync config.', e);
    }
  },

  /* ---------------- Device Sync / pairing ---------------- */

  _loadPairing() {
    try {
      const raw = window.localStorage.getItem(SYNC_PAIRING_KEY);
      const p = raw ? JSON.parse(raw) : {};
      return { sharedDeviceId: p.sharedDeviceId || '', pairedAt: p.pairedAt || null };
    } catch (e) { return { sharedDeviceId: '', pairedAt: null }; }
  },

  _savePairing() {
    try { window.localStorage.setItem(SYNC_PAIRING_KEY, JSON.stringify(this.pairing)); } catch (e) {}
  },

  isPaired() { return !!(this.pairing && this.pairing.sharedDeviceId); },
  getCloudDeviceId() { return this.isPaired() ? this.pairing.sharedDeviceId : this.deviceId; },

  async _get(params) {
    if (!this.isConfigured()) throw new Error('Cloud Sync is not configured.');
    const url = new URL(this.config.url);
    Object.keys(params || {}).forEach(k => url.searchParams.set(k, params[k]));
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), SYNC_FETCH_TIMEOUT_MS) : null;
    try {
      const r = await fetch(url.toString(), { method: 'GET', signal: controller ? controller.signal : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const json = await r.json();
      if (!json.success) throw new Error(json.error || 'Sync request failed.');
      return json;
    } finally { if (timeout) clearTimeout(timeout); }
  },

  async createPairingCode() {
    const result = await this._get({ action: 'create_pair_code', deviceId: this.deviceId });
    return result.pairing;
  },

  async claimPairingCode(code) {
    const clean = String(code || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(clean)) throw new Error('Enter the 8-character pairing code.');
    const result = await this._get({ action: 'claim_pair_code', code: clean, deviceId: this.deviceId });
    const sharedDeviceId = result.pairing.sharedDeviceId;
    if (!sharedDeviceId) throw new Error('The pairing server did not return a shared device.');
    this.pairing = { sharedDeviceId, pairedAt: result.pairing.pairedAt || new Date().toISOString() };
    this._savePairing();
    this.config.initialBackupDone = true;
    this.config.lastRemoteUpdatedAt = null;
    this._saveConfig();
    if (this.isOnline()) await this.pullRemoteData(true);
    return this.pairing;
  },

  async refreshPairing() {
    if (!this.isConfigured() || !this.isOnline()) return false;
    try {
      const result = await this._get({ action: 'pair_status', deviceId: this.deviceId });
      const p = result.pairing || {};
      if (p.paired && p.sharedDeviceId) {
        this.pairing = { sharedDeviceId: p.sharedDeviceId, pairedAt: p.pairedAt || new Date().toISOString() };
        this._savePairing();
      }
      this._renderStatus();
      return !!p.paired;
    } catch (err) {
      console.error('FundSprout Device Sync: pairing status failed.', err);
      return false;
    }
  },

  unpair() {
    this.pairing = { sharedDeviceId: '', pairedAt: null };
    this._savePairing();
    this.config.initialBackupDone = false;
    this.config.lastRemoteUpdatedAt = null;
    this._saveConfig();
    this._renderStatus();
  },

  async pullRemoteData(force) {
    if (!this.isConfigured() || !this.isPaired() || !this.isOnline()) return false;
    if (this.isSyncing) return false;
    if (this._loadQueue().length > 0) return false;
    try {
      const result = await this._get({ action: 'data', deviceId: this.getCloudDeviceId() });
      if (!result.hasData || !result.data) return false;
      const remoteAt = result.data.remoteUpdatedAt || null;
      if (!force && remoteAt && this.config.lastRemoteUpdatedAt && new Date(remoteAt).getTime() <= new Date(this.config.lastRemoteUpdatedAt).getTime()) return false;
      if (typeof DB !== 'undefined' && typeof DB.replaceFromRemote === 'function') {
        DB.replaceFromRemote(result.data);
      }
      this.config.lastRemoteUpdatedAt = remoteAt || new Date().toISOString();
      this.config.lastSyncedAt = new Date().toISOString();
      this._saveConfig();
      this._renderStatus();
      return true;
    } catch (err) {
      console.error('FundSprout Device Sync: pull failed.', err);
      return false;
    }
  },

  /* ---------------- Queue persistence ---------------- */

  _loadQueue() {
    try {
      const raw = window.localStorage.getItem(SYNC_QUEUE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('FundSprout Sync: failed to read sync queue, resetting it.', e);
      return [];
    }
  },

  _saveQueue(queue) {
    try {
      window.localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.error('FundSprout Sync: failed to persist sync queue.', e);
    }
  },

  _genOperationId() {
    return 'op_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  /* ---------------- Queueing (called from storage.js) ---------------- */

  // Adds/consolidates a single-record change. Safe to call with entity in
  // {allowances, expenses, plants, settings, budget}.
  queueOperation(entity, action, recordId, data) {
    if (!entity || !recordId) return;
    const queue = this._loadQueue();
    const idx = queue.findIndex((op) => op.entity === entity && op.recordId === recordId);

    if (idx !== -1) {
      const existing = queue[idx];
      if (existing.action === 'CREATE' && action === 'DELETE') {
        // Record was created and deleted before it ever reached the cloud —
        // nothing to send, drop the queued operation entirely.
        queue.splice(idx, 1);
      } else if (action === 'DELETE') {
        existing.action = 'DELETE';
        existing.data = { id: recordId };
        existing.timestamp = new Date().toISOString();
        existing.retryCount = 0;
      } else {
        // CREATE followed by UPDATE(s) collapses to a single CREATE (upsert);
        // UPDATE followed by UPDATE just refreshes the payload.
        existing.data = data;
        existing.timestamp = new Date().toISOString();
        existing.retryCount = 0;
      }
    } else {
      queue.push({
        operationId: this._genOperationId(),
        entity,
        action,
        recordId,
        data,
        timestamp: new Date().toISOString(),
        retryCount: 0
      });
    }

    this._saveQueue(queue);
    this._renderStatus();
    if (this.isOnline()) this.syncPendingChanges();
  },

  // Wipes every queued operation for an entity and queues a server-side
  // clear, then re-queues every current record as a fresh upsert. Used for
  // full-data operations (backup import) where per-record diffing isn't
  // meaningful.
  queueFullResync(data) {
    let queue = this._loadQueue().filter((op) => !['settings', 'budget'].includes(op.entity));
    // Drop any previously queued per-record ops for entities we're about to
    // fully replace, to avoid sending stale operations after a clear.
    queue = queue.filter((op) => !['allowances', 'expenses', 'plants'].includes(op.entity));

    ['allowances', 'expenses', 'plants', 'budget'].forEach((entity) => {
      queue.push({
        operationId: this._genOperationId(),
        entity,
        action: 'CLEAR',
        recordId: '*',
        data: null,
        timestamp: new Date().toISOString(),
        retryCount: 0
      });
    });

    (data.allowances || []).forEach((a) => queue.push(this._opFor('allowances', 'CREATE', a.id, tagNotesForSync(a))));
    (data.expenses || []).forEach((e) => queue.push(this._opFor('expenses', 'CREATE', e.id, e)));
    (data.plants || []).forEach((p) => queue.push(this._opFor('plants', 'CREATE', p.id, p)));
    queue.push(this._opFor('settings', 'UPDATE', 'settings', data.settings));
    queue.push(this._opFor('budget', 'UPDATE', 'cash-on-hand', {
      amount: Number(data.startingCash ?? data.totalBudget) || 0,
      startingCash: Number(data.startingCash ?? data.totalBudget) || 0,
      currentCash: Number(data.balance) || 0,
      initialized: !!data.totalBudgetSet
    }));

    this._saveQueue(queue);
    this._renderStatus();
    if (this.isOnline()) this.syncPendingChanges();
  },

  // Used after "Reset All Data" — tells the backend to remove every record
  // for this device across all entities.
  queueClearAll() {
    let queue = this._loadQueue().filter((op) => !['allowances', 'expenses', 'plants', 'budget'].includes(op.entity));
    ['allowances', 'expenses', 'plants', 'budget'].forEach((entity) => {
      queue.push({
        operationId: this._genOperationId(),
        entity,
        action: 'CLEAR',
        recordId: '*',
        data: null,
        timestamp: new Date().toISOString(),
        retryCount: 0
      });
    });
    this._saveQueue(queue);
    this._renderStatus();
    if (this.isOnline()) this.syncPendingChanges();
  },

  _opFor(entity, action, recordId, data) {
    return {
      operationId: this._genOperationId(),
      entity,
      action,
      recordId,
      data,
      timestamp: new Date().toISOString(),
      retryCount: 0
    };
  },

  /* ---------------- Initial backup (existing local data, first setup) ---------------- */

  runInitialBackupIfNeeded() {
    if (!this.isConfigured() || this.config.initialBackupDone) return;
    if (typeof DB === 'undefined') return;
    this.queueFullResync(DB.data);
    this.config.initialBackupDone = true;
    this._saveConfig();
  },

  /* ---------------- Sync ---------------- */

  async syncPendingChanges() {
    if (this.isSyncing) return;
    if (!this.isConfigured()) { this._renderStatus(); return; }
    if (!this.isOnline()) { this._renderStatus(); return; }

    const queue = this._loadQueue();
    if (queue.length === 0) { this._renderStatus(); return; }

    this.isSyncing = true;
    this._renderStatus();

    // Send a bounded batch at a time so one sync cycle can't run forever.
    const batch = queue.slice(0, 25);

    try {
      const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), SYNC_FETCH_TIMEOUT_MS) : null;

      const response = await fetch(this.config.url, {
        method: 'POST',
        // Deliberately a plain string body (not application/json) so the
        // request stays a CORS "simple request" and Google Apps Script
        // (which doesn't answer CORS preflight OPTIONS requests) can accept it.
        body: JSON.stringify({
          deviceId: this.getCloudDeviceId(),
          operations: batch.map((op) => ({
            operationId: op.operationId,
            entity: op.entity,
            action: op.action,
            recordId: op.recordId,
            data: op.data
          }))
        }),
        signal: controller ? controller.signal : undefined
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) throw new Error('HTTP ' + response.status);

      const result = await response.json();
      const processed = new Set(result && Array.isArray(result.processed) ? result.processed : []);

      let remaining = this._loadQueue();
      remaining = remaining.filter((op) => {
        if (!batch.find((b) => b.operationId === op.operationId)) return true; // untouched by this batch
        if (processed.has(op.operationId)) return false; // confirmed synced -> drop
        // Not confirmed: keep it pending and bump retry count for backoff.
        op.retryCount = Math.min((op.retryCount || 0) + 1, SYNC_MAX_RETRY_BACKOFF);
        return true;
      });

      this._saveQueue(remaining);
      this.config.lastSyncedAt = new Date().toISOString();
      this._saveConfig();
    } catch (err) {
      console.error('FundSprout Sync: sync attempt failed, will retry.', err);
      // Leave the queue untouched — nothing was confirmed, so nothing is lost
      // and nothing will be duplicated on the next attempt.
      const remaining = this._loadQueue().map((op) => {
        if (batch.find((b) => b.operationId === op.operationId)) {
          op.retryCount = Math.min((op.retryCount || 0) + 1, SYNC_MAX_RETRY_BACKOFF);
        }
        return op;
      });
      this._saveQueue(remaining);
    } finally {
      this.isSyncing = false;
      this._renderStatus();
      // If there's more queued than this batch covered, keep going shortly.
      if (this._loadQueue().length > 0 && this.isOnline()) {
        setTimeout(() => this.syncPendingChanges(), 2000);
      } else if (this.isPaired() && this.isOnline()) {
        setTimeout(() => this.pullRemoteData(false), 600);
      }
    }
  },

  retryPendingChanges() {
    if (this.isOnline()) this.syncPendingChanges();
  },

  /* ---------------- Status indicator (small, unobtrusive) ---------------- */

  _mountStatusIndicator() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    const spacer = topbar.querySelector('.topbar-spacer');

    const el = document.createElement('div');
    el.className = 'sync-indicator';
    el.id = 'syncIndicator';
    el.innerHTML = '<i class="fa-solid fa-cloud"></i><span id="syncIndicatorText">—</span>';
    el.title = 'Cloud sync status';

    if (spacer && spacer.parentNode) {
      spacer.parentNode.insertBefore(el, spacer.nextSibling);
    } else {
      topbar.appendChild(el);
    }

    this._statusEl = el;
    this._statusTextEl = el.querySelector('#syncIndicatorText');
  },

  _renderStatus() {
    if (typeof SettingsPage !== 'undefined' && SettingsPage.renderSyncStatus) {
      SettingsPage.renderSyncStatus();
    }
    if (!this._statusEl || !this._statusTextEl) return;
    const s = this.getStatus();
    const icon = this._statusEl.querySelector('i');

    this._statusEl.classList.remove('sync-ok', 'sync-warn', 'sync-off', 'sync-busy');

    if (!s.configured) {
      this._statusEl.style.display = 'none';
      return;
    }
    this._statusEl.style.display = 'flex';

    if (!s.online) {
      icon.className = 'fa-solid fa-cloud-slash';
      this._statusTextEl.textContent = s.pending > 0 ? `Offline · ${s.pending} pending` : 'Offline';
      this._statusEl.classList.add('sync-off');
    } else if (s.syncing) {
      icon.className = 'fa-solid fa-cloud-arrow-up';
      this._statusTextEl.textContent = 'Syncing…';
      this._statusEl.classList.add('sync-busy');
    } else if (s.pending > 0) {
      icon.className = 'fa-solid fa-cloud-arrow-up';
      this._statusTextEl.textContent = s.failed > 0
        ? `${s.pending} pending · retrying`
        : `${s.pending} pending`;
      this._statusEl.classList.add('sync-warn');
    } else {
      icon.className = 'fa-solid fa-cloud';
      this._statusTextEl.textContent = 'Synced';
      this._statusEl.classList.add('sync-ok');
    }
  }
};
