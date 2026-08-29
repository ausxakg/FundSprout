/* ==========================================================================
   FundSprout — Storage Layer
   Single source of truth for all persisted data. Wraps localStorage with
   safe parsing, schema defaults, and pub/sub so the UI can react to changes.
   ========================================================================== */

const STORAGE_KEY = 'fundsprout.v1';

const DEFAULT_CATEGORIES = ['Food', 'Transportation', 'School', 'Projects', 'Shopping', 'Entertainment', 'Health', 'Others'];

const CATEGORY_ICONS = {
  Food: 'fa-utensils',
  Transportation: 'fa-bus',
  School: 'fa-graduation-cap',
  Projects: 'fa-diagram-project',
  Shopping: 'fa-bag-shopping',
  Entertainment: 'fa-film',
  Health: 'fa-heart-pulse',
  Others: 'fa-ellipsis'
};

const PLANT_TYPES = {
  Tree: 'fa-tree',
  Flower: 'fa-fan',
  Bonsai: 'fa-leaf',
  Fern: 'fa-seedling',
  Succulent: 'fa-spa',
  Cactus: 'fa-mound',
  Bamboo: 'fa-grip-lines-vertical',
  Sunflower: 'fa-sun'
};

function defaultData() {
  return {
    version: 1,
    balance: 0,
    // Starting/current cash seed. Cash on hand is derived from this amount
    // plus allowances, minus expenses and money moved into garden savings.
    totalBudget: 0,
    startingCash: 0,
    totalBudgetSet: false,
    allowances: [],   // {id, amount, source, notes, date, time, createdAt}
    expenses: [],      // {id, name, category, amount, notes, date, time, createdAt}
    plants: [],        // {id, name, type, goal, target, saved, createdAt, lastWatered, history:[{id,amount,date,time,notes}]}
    settings: {
      theme: 'dark',
      animations: true,
      sidebarCollapsed: false,
      lastBackupAt: null,
      currency: '₱',
      onboarded: false
    }
  };
}

class StorageService {
  constructor() {
    this.listeners = new Set();
    this.available = this._checkAvailable();
    this.data = this._load();
  }

  _checkAvailable() {
    try {
      const t = '__fs_test__';
      window.localStorage.setItem(t, '1');
      window.localStorage.removeItem(t);
      return true;
    } catch (e) {
      return false;
    }
  }

  _load() {
    if (!this.available) return defaultData();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultData();
      const parsed = JSON.parse(raw);
      // Merge with defaults to protect against missing keys from older versions
      const base = defaultData();
      const merged = {
        ...base,
        ...parsed,
        settings: { ...base.settings, ...(parsed.settings || {}) }
      };
      // Migrate older versions where totalBudget was reduced by expenses.
      if (!Object.prototype.hasOwnProperty.call(parsed, 'startingCash')) {
        const legacyBudget = Number(parsed.totalBudget) || 0;
        const legacyExpenses = Array.isArray(parsed.expenses)
          ? parsed.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
          : 0;
        merged.startingCash = merged.totalBudgetSet ? Round2(legacyBudget + legacyExpenses) : 0;
        merged.totalBudget = merged.startingCash;
      } else {
        merged.startingCash = Number(merged.startingCash) || 0;
        merged.totalBudget = merged.startingCash;
      }
      // Keep the stored balance as a cache only; always derive it from the
      // starting cash and transaction records.
      this.data = merged;
      this._recalculateBalance();
      return this.data;
    } catch (e) {
      console.error('FundSprout: failed to parse stored data, resetting.', e);
      return defaultData();
    }
  }

  _persist() {
    if (!this.available) {
      this._notify('storage-unavailable');
      return false;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      return true;
    } catch (e) {
      console.error('FundSprout: failed to persist data.', e);
      this._notify('storage-error');
      return false;
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify(event, payload) {
    this.listeners.forEach((fn) => {
      try { fn(event, payload); } catch (e) { console.error(e); }
    });
  }

  save(event, payload) {
    this._persist();
    this._queueSync(event, payload);
    this._notify(event || 'change', payload);
  }

  // ---------------- Cloud sync hook ----------------
  // Translates a storage event into a sync-queue operation. This is the only
  // place that needs to know about SyncManager — every CRUD method above
  // stays untouched and just calls save() as before.
  _queueSync(event, payload) {
    if (typeof SyncManager === 'undefined') return;
    try {
      switch (event) {
        // Planned/tracking-only allowances are local-only and intentionally
        // never queued for sync, so the connected sheet never sees them.
        case 'allowance-added':
          if (!payload.planned) SyncManager.queueOperation('allowances', 'CREATE', payload.id, payload); break;
        case 'allowance-updated':
          if (!payload.planned) SyncManager.queueOperation('allowances', 'UPDATE', payload.id, payload); break;
        case 'allowance-deleted':
          if (!payload.planned) SyncManager.queueOperation('allowances', 'DELETE', payload.id, { id: payload.id }); break;

        case 'expense-added':
          SyncManager.queueOperation('expenses', 'CREATE', payload.id, payload); break;
        case 'expense-updated':
          SyncManager.queueOperation('expenses', 'UPDATE', payload.id, payload); break;
        case 'expense-deleted':
          SyncManager.queueOperation('expenses', 'DELETE', payload.id, { id: payload.id }); break;

        case 'plant-added':
          SyncManager.queueOperation('plants', 'CREATE', payload.id, payload); break;
        case 'plant-updated':
          SyncManager.queueOperation('plants', 'UPDATE', payload.id, payload); break;
        case 'plant-deleted':
          SyncManager.queueOperation('plants', 'DELETE', payload.id, { id: payload.id }); break;

        // Watering changes the plant's saved total + history, all nested
        // inside the plant record — sync the whole plant, not a separate entity.
        case 'plant-watered':
        case 'water-updated':
        case 'water-deleted':
          SyncManager.queueOperation('plants', 'UPDATE', payload.plant.id, payload.plant); break;

        case 'settings-updated':
          SyncManager.queueOperation('settings', 'UPDATE', 'settings', payload); break;

        case 'total-budget-updated':
          SyncManager.queueOperation('budget', 'UPDATE', 'cash-on-hand', {
            ...payload,
            amount: Number(this.data.startingCash) || 0,
            startingCash: Number(this.data.startingCash) || 0,
            currentCash: Number(this.data.balance) || 0
          }); break;

        case 'backup-imported':
          SyncManager.queueFullResync(this.data); break;

        case 'data-reset':
          SyncManager.queueClearAll(); break;
      }
    } catch (e) {
      console.error('FundSprout: sync queue update failed (local save is unaffected).', e);
    }
  }

  // ---------------- Generic ----------------
  genId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  _recalculateBalance() {
    const startingCash = Number(this.data.startingCash) || 0;
    // Planned allowances (a.planned === true) are tracking-only: the user is
    // just noting what they expect/plan to receive for a day. They must never
    // affect cash on hand, so they're excluded from every real-money total.
    const allowances = this.data.allowances.reduce((sum, a) => sum + (a.planned ? 0 : (Number(a.amount) || 0)), 0);
    const expenses = this.data.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const saved = this.data.plants.reduce((sum, p) => sum + (Number(p.saved) || 0), 0);
    this.data.balance = Round2(startingCash + allowances - expenses - saved);
    return this.data.balance;
  }

  getBalance() {
    return this._recalculateBalance();
  }

  // ---------------- Starting Cash / Budget ----------------
  // The value entered here is the starting cash on hand. Allowances increase
  // it and expenses decrease it automatically.
  getTotalBudget() { return Number(this.data.startingCash) || 0; }

  setTotalBudget(amount) {
    this.data.startingCash = Round2(Number(amount) || 0);
    this.data.totalBudget = this.data.startingCash;
    this.data.totalBudgetSet = true;
    this._recalculateBalance();
    this.save('total-budget-updated', {
      amount: this.data.startingCash,
      startingCash: this.data.startingCash,
      currentCash: this.data.balance,
      initialized: true,
      updatedAt: Date.now()
    });
    return this.data.startingCash;
  }

  // ---------------- Allowances ----------------
  // `planned: true` marks a tracking-only entry — e.g. "here's what I'm
  // setting as today's allowance" — that shows up in the Allowance list like
  // any other record but never touches balance and never syncs to the sheet.
  addAllowance({ amount, source, notes, date, time, planned }) {
    const entry = {
      id: this.genId('al'),
      amount: Number(amount),
      source: source || 'Other',
      notes: notes || '',
      date,
      time,
      planned: !!planned,
      createdAt: Date.now()
    };
    this.data.allowances.push(entry);
    this._recalculateBalance();
    this.save('allowance-added', entry);
    return entry;
  }

  updateAllowance(id, updates) {
    const idx = this.data.allowances.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    const old = this.data.allowances[idx];
    this.data.allowances[idx] = {
      ...old,
      ...updates,
      amount: Number(updates.amount),
      planned: updates.planned !== undefined ? !!updates.planned : !!old.planned
    };
    this._recalculateBalance();
    this.save('allowance-updated', this.data.allowances[idx]);
    return this.data.allowances[idx];
  }

  deleteAllowance(id) {
    const idx = this.data.allowances.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    const [removed] = this.data.allowances.splice(idx, 1);
    this._recalculateBalance();
    this.save('allowance-deleted', removed);
    return true;
  }

  // ---------------- Expenses ----------------
  addExpense({ name, category, amount, notes, date, time }) {
    const entry = {
      id: this.genId('ex'),
      name: name || 'Expense',
      category: category || 'Others',
      amount: Number(amount),
      notes: notes || '',
      date,
      time,
      createdAt: Date.now()
    };
    this.data.expenses.push(entry);
    this._recalculateBalance();
    this.save('expense-added', entry);
    return entry;
  }

  updateExpense(id, updates) {
    const idx = this.data.expenses.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    const old = this.data.expenses[idx];
    const diff = Number(updates.amount) - old.amount;
    this.data.expenses[idx] = { ...old, ...updates, amount: Number(updates.amount) };
    this._recalculateBalance();
    this.save('expense-updated', this.data.expenses[idx]);
    return this.data.expenses[idx];
  }

  deleteExpense(id) {
    const idx = this.data.expenses.findIndex((e) => e.id === id);
    if (idx === -1) return false;
    const [removed] = this.data.expenses.splice(idx, 1);
    this._recalculateBalance();
    this.save('expense-deleted', removed);
    return true;
  }

  // ---------------- Plants (Garden) ----------------
  addPlant({ name, type, goal, target }) {
    const entry = {
      id: this.genId('pl'),
      name: name || 'My Plant',
      type: type || 'Tree',
      goal: goal || '',
      target: Number(target),
      saved: 0,
      createdAt: Date.now(),
      lastWatered: null,
      history: []
    };
    this.data.plants.push(entry);
    this.save('plant-added', entry);
    return entry;
  }

  updatePlant(id, updates) {
    const idx = this.data.plants.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    this.data.plants[idx] = { ...this.data.plants[idx], ...updates };
    this.save('plant-updated', this.data.plants[idx]);
    return this.data.plants[idx];
  }

  deletePlant(id) {
    const idx = this.data.plants.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    const [removed] = this.data.plants.splice(idx, 1);
    // Return the removed savings to cash on hand.
    this._recalculateBalance();
    this.save('plant-deleted', removed);
    return true;
  }

  waterPlant(id, amount, notes) {
    const plant = this.data.plants.find((p) => p.id === id);
    if (!plant) return null;
    amount = Number(amount);
    const record = {
      id: this.genId('wt'),
      amount,
      date: Utils.todayISO(),
      time: Utils.nowTime(),
      notes: notes || '',
      createdAt: Date.now()
    };
    plant.history.unshift(record);
    plant.saved = Round2(plant.saved + amount);
    plant.lastWatered = Date.now();
    this._recalculateBalance();
    this.save('plant-watered', { plant, record });
    return record;
  }

  updateWaterRecord(plantId, recordId, updates) {
    const plant = this.data.plants.find((p) => p.id === plantId);
    if (!plant) return null;
    const rec = plant.history.find((h) => h.id === recordId);
    if (!rec) return null;
    const diff = Number(updates.amount) - rec.amount;
    Object.assign(rec, updates, { amount: Number(updates.amount) });
    plant.saved = Round2(plant.saved + diff);
    this._recalculateBalance();
    this.save('water-updated', { plant, record: rec });
    return rec;
  }

  deleteWaterRecord(plantId, recordId) {
    const plant = this.data.plants.find((p) => p.id === plantId);
    if (!plant) return false;
    const idx = plant.history.findIndex((h) => h.id === recordId);
    if (idx === -1) return false;
    const [removed] = plant.history.splice(idx, 1);
    plant.saved = Round2(plant.saved - removed.amount);
    this._recalculateBalance();
    this.save('water-deleted', { plant, record: removed });
    return true;
  }

  // ---------------- Settings ----------------
  updateSettings(updates) {
    this.data.settings = { ...this.data.settings, ...updates };
    this.save('settings-updated', this.data.settings);
  }

  // ---------------- Aggregate: unified transactions ----------------
  getAllTransactions() {
    const allowances = this.data.allowances.map((a) => ({
      id: a.id, kind: 'allowance', title: a.source, category: 'Allowance',
      amount: a.amount, notes: a.notes, date: a.date, time: a.time, createdAt: a.createdAt,
      planned: !!a.planned
    }));
    const expenses = this.data.expenses.map((e) => ({
      id: e.id, kind: 'expense', title: e.name, category: e.category,
      amount: -e.amount, notes: e.notes, date: e.date, time: e.time, createdAt: e.createdAt
    }));
    const waterings = [];
    this.data.plants.forEach((p) => {
      p.history.forEach((h) => {
        waterings.push({
          id: h.id, kind: 'water', title: `Watered "${p.name}"`, category: 'Garden',
          amount: -h.amount, notes: h.notes, date: h.date, time: h.time,
          createdAt: h.createdAt || new Date(`${h.date}T${h.time || '00:00'}`).getTime() || 0,
          plantId: p.id
        });
      });
    });
    return [...allowances, ...expenses, ...waterings].sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---------------- Backup / Restore ----------------
  exportBackup() {
    return JSON.stringify(this.data, null, 2);
  }

  importBackup(jsonString) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      throw new Error('Invalid JSON file. Please check the file and try again.');
    }
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.allowances) || !Array.isArray(parsed.expenses)) {
      throw new Error('This file does not look like a valid FundSprout backup.');
    }
    const base = defaultData();
    this.data = {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) }
    };
    this._recalculateBalance();
    this.save('backup-imported');
  }

  // Replace local state from a paired device without generating a new sync queue.
  // SyncManager calls this only after a confirmed remote snapshot is newer.
  replaceFromRemote(remoteData) {
    const base = defaultData();
    if (!remoteData || typeof remoteData !== 'object') throw new Error('Invalid remote FundSprout data.');
    this.data = {
      ...base,
      ...remoteData,
      allowances: Array.isArray(remoteData.allowances) ? remoteData.allowances : [],
      expenses: Array.isArray(remoteData.expenses) ? remoteData.expenses : [],
      plants: Array.isArray(remoteData.plants) ? remoteData.plants : [],
      settings: { ...base.settings, ...(remoteData.settings || {}) }
    };
    this._recalculateBalance();
    this._persist();
    this._notify('remote-sync-applied', this.data);
    return true;
  }

  resetAll() {
    this.data = defaultData();
    this._recalculateBalance();
    this.save('data-reset');
  }
}

function Round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const DB = new StorageService();