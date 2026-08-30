/* ==========================================================================
   FundSprout — Activity Log Page
   ========================================================================== */

const ActivityPage = {
  search: '',
  sort: 'newest',
  filterCategory: 'all',
  categoryDD: null,
  sortDD: null,

  init() {
    document.getElementById('activitySearchInput').addEventListener('input', Utils.debounce((e) => {
      this.search = e.target.value.trim().toLowerCase();
      this.toggleClearBtn();
      this.render();
    }, 200));
    document.querySelector('#page-activity .clear-btn').addEventListener('click', () => {
      document.getElementById('activitySearchInput').value = '';
      this.search = '';
      this.toggleClearBtn();
      this.render();
    });

    const catOptions = [{ value: 'all', label: 'All Categories', icon: 'fa-layer-group' }]
      .concat(['Allowance', 'Garden', ...DEFAULT_CATEGORIES].map((c) => ({ value: c, label: c, icon: c === 'Allowance' ? 'fa-sack-dollar' : (c === 'Garden' ? 'fa-droplet' : CATEGORY_ICONS[c]) })));

    this.categoryDD = Dropdown.create(document.getElementById('activityFilterDD'), {
      options: catOptions,
      value: 'all',
      placeholder: 'Category',
      onChange: (v) => { this.filterCategory = v; this.render(); }
    });

    this.sortDD = Dropdown.create(document.getElementById('activitySortDD'), {
      options: [
        { value: 'newest', label: 'Newest first', icon: 'fa-arrow-down-wide-short' },
        { value: 'oldest', label: 'Oldest first', icon: 'fa-arrow-up-wide-short' },
        { value: 'highest', label: 'Highest amount', icon: 'fa-arrow-up' },
        { value: 'lowest', label: 'Lowest amount', icon: 'fa-arrow-down' },
        { value: 'az', label: 'A → Z', icon: 'fa-arrow-down-a-z' },
        { value: 'za', label: 'Z → A', icon: 'fa-arrow-down-z-a' }
      ],
      value: 'newest',
      placeholder: 'Sort by',
      onChange: (v) => { this.sort = v; this.render(); }
    });

    this.render();
  },

  toggleClearBtn() {
    document.querySelector('#page-activity .clear-btn').classList.toggle('show', !!this.search);
  },

  getFiltered() {
    let items = DB.getAllTransactions();
    if (this.filterCategory !== 'all') items = items.filter((t) => t.category === this.filterCategory);
    if (this.search) items = items.filter((t) => (t.title + ' ' + (t.notes || '')).toLowerCase().includes(this.search));
    const sorters = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      highest: (a, b) => Math.abs(b.amount) - Math.abs(a.amount),
      lowest: (a, b) => Math.abs(a.amount) - Math.abs(b.amount),
      az: (a, b) => a.title.localeCompare(b.title),
      za: (a, b) => b.title.localeCompare(a.title)
    };
    items.sort(sorters[this.sort] || sorters.newest);
    return items;
  },

  render() {
    const items = this.getFiltered();
    document.getElementById('activityCount').textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;
    const wrap = document.getElementById('activityListWrap');
    if (!items.length) {
      wrap.innerHTML = emptyStateHTML({
        icon: 'fa-clock-rotate-left',
        title: 'No activity found',
        message: 'Transactions you record will show up here automatically.',
        actionLabel: null
      });
      return;
    }
    wrap.innerHTML = items.map((t) => this.renderRow(t)).join('');
  },

  renderRow(t) {
    const icons = { allowance: 'fa-sack-dollar', expense: CATEGORY_ICONS[t.category] || 'fa-receipt', water: 'fa-droplet' };
    const badges = { allowance: 'badge-blue', expense: 'badge-red', water: 'badge-green' };
    const isPos = t.amount >= 0;
    return `
      <div class="activity-item">
        <div class="activity-icon ${badges[t.kind]}"><i class="fa-solid ${icons[t.kind]}"></i></div>
        <div class="activity-main">
          <div class="activity-title">${Utils.escapeHtml(t.title)}${t.planned ? ' <span class="chip badge-yellow" style="margin-left:4px;">Spend Limit</span>' : ''}</div>
          <div class="activity-sub">${Utils.formatDateTime(t.date, t.time)} · ${Utils.escapeHtml(t.category)}${t.notes ? ` · ${Utils.escapeHtml(t.notes)}` : ''}</div>
        </div>
        <div class="activity-amount ${t.planned ? '' : (isPos ? 'pos' : 'neg')}">${Utils.formatMoney(t.amount, { forceSign: true })}</div>
        <div class="row-actions">
          <button class="icon-btn btn-sm" style="width:32px;height:32px;" onclick="ActivityPage.editTx('${t.kind}','${t.id}','${t.plantId || ''}')" aria-label="Edit"><i class="fa-solid fa-pen" style="font-size:11px;"></i></button>
          <button class="icon-btn btn-sm" style="width:32px;height:32px;" onclick="ActivityPage.deleteTx('${t.kind}','${t.id}','${t.plantId || ''}')" aria-label="Delete"><i class="fa-solid fa-trash" style="font-size:11px;"></i></button>
        </div>
      </div>
    `;
  },

  editTx(kind, id, plantId) {
    if (kind === 'allowance') { App.goTo('allowance'); setTimeout(() => AllowancePage.openEditModal(id), 260); }
    if (kind === 'expense') { App.goTo('expenses'); setTimeout(() => ExpensesPage.openEditModal(id), 260); }
    if (kind === 'water') {
      GardenPage.activePlantId = plantId;
      GardenPage.openEditWater(id);
    }
  },

  deleteTx(kind, id, plantId) {
    if (kind === 'allowance') AllowancePage.remove(id);
    if (kind === 'expense') ExpensesPage.remove(id);
    if (kind === 'water') { GardenPage.activePlantId = plantId; GardenPage.deleteWater(id); }
  }
};
