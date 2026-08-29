/* ==========================================================================
   FundSprout — Expenses Page
   Chosen behavior for overspending: the app WARNS (does not block) when an
   expense would push the balance negative, and asks the user to confirm.
   This mirrors how real bank balances can go negative and keeps the app
   usable for students who spend before recording an allowance.
   ========================================================================== */

const ExpensesPage = {
  search: '',
  sort: 'newest',
  filterCategory: 'all',
  editingId: null,
  sortDD: null,
  filterDD: null,
  modalCategoryDD: null,

  init() {
    document.getElementById('expenseSearchInput').addEventListener('input', Utils.debounce((e) => {
      this.search = e.target.value.trim().toLowerCase();
      this.toggleClearBtn();
      this.render();
    }, 200));
    document.querySelector('#page-expenses .clear-btn').addEventListener('click', () => {
      document.getElementById('expenseSearchInput').value = '';
      this.search = '';
      this.toggleClearBtn();
      this.render();
    });

    this.sortDD = Dropdown.create(document.getElementById('expenseSortDD'), {
      options: [
        { value: 'newest', label: 'Newest first', icon: 'fa-arrow-down-wide-short' },
        { value: 'oldest', label: 'Oldest first', icon: 'fa-arrow-up-wide-short' },
        { value: 'highest', label: 'Highest amount', icon: 'fa-arrow-up' },
        { value: 'lowest', label: 'Lowest amount', icon: 'fa-arrow-down' }
      ],
      value: 'newest',
      placeholder: 'Sort by',
      onChange: (v) => { this.sort = v; this.render(); }
    });

    const catOptions = [{ value: 'all', label: 'All Categories', icon: 'fa-layer-group' }]
      .concat(DEFAULT_CATEGORIES.map((c) => ({ value: c, label: c, icon: CATEGORY_ICONS[c] })));

    this.filterDD = Dropdown.create(document.getElementById('expenseFilterDD'), {
      options: catOptions,
      value: 'all',
      placeholder: 'Category',
      onChange: (v) => { this.filterCategory = v; this.render(); }
    });

    this.modalCategoryDD = Dropdown.create(document.getElementById('expenseCategoryDD'), {
      options: DEFAULT_CATEGORIES.map((c) => ({ value: c, label: c, icon: CATEGORY_ICONS[c] })),
      placeholder: 'Select category',
      onChange: () => setFieldError(document.getElementById('expenseCategoryDD'), null, '')
    });

    document.getElementById('addExpenseBtn').addEventListener('click', () => this.openCreateModal());
    document.getElementById('expenseForm').addEventListener('submit', (e) => this.handleSubmit(e));

    this.render();
  },

  toggleClearBtn() {
    document.querySelector('#page-expenses .clear-btn').classList.toggle('show', !!this.search);
  },

  getFiltered() {
    let items = DB.data.expenses.slice();
    if (this.filterCategory !== 'all') items = items.filter((e) => e.category === this.filterCategory);
    if (this.search) items = items.filter((e) => (e.name + ' ' + (e.notes || '')).toLowerCase().includes(this.search));
    const sorters = {
      newest: (a, b) => b.createdAt - a.createdAt,
      oldest: (a, b) => a.createdAt - b.createdAt,
      highest: (a, b) => b.amount - a.amount,
      lowest: (a, b) => a.amount - b.amount
    };
    items.sort(sorters[this.sort] || sorters.newest);
    return items;
  },

  render() {
    const items = this.getFiltered();
    const monthTotal = DB.data.expenses.filter((e) => Utils.inRange(e.date, 'monthly')).reduce((s, e) => s + e.amount, 0);
    document.getElementById('expenseTotalThisMonth').textContent = Utils.formatMoney(monthTotal);
    document.getElementById('expenseCount').textContent = `${DB.data.expenses.length} record${DB.data.expenses.length === 1 ? '' : 's'}`;

    const wrap = document.getElementById('expenseListWrap');
    if (!items.length) {
      wrap.innerHTML = emptyStateHTML({
        icon: 'fa-receipt',
        title: (this.search || this.filterCategory !== 'all') ? 'No matching expenses' : 'No expenses yet',
        message: (this.search || this.filterCategory !== 'all') ? 'Try a different search or filter.' : 'Record your first expense to start tracking your spending.',
        actionLabel: (this.search || this.filterCategory !== 'all') ? null : 'Add Expense',
        actionAttr: `onclick="ExpensesPage.openCreateModal()"`
      });
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Expense</th><th>Category</th><th>Date</th><th>Amount</th><th></th></tr></thead>
          <tbody>
            ${items.map((e) => `
              <tr>
                <td><strong>${Utils.escapeHtml(e.name)}</strong>${e.notes ? `<div class="text-tertiary text-sm">${Utils.escapeHtml(e.notes)}</div>` : ''}</td>
                <td><span class="chip badge-red"><i class="fa-solid ${CATEGORY_ICONS[e.category] || 'fa-ellipsis'}"></i> ${Utils.escapeHtml(e.category)}</span></td>
                <td class="text-secondary">${Utils.formatDateTime(e.date, e.time)}</td>
                <td><span class="activity-amount neg">-${Utils.formatMoney(e.amount)}</span></td>
                <td>
                  <div class="row-actions">
                    <button class="icon-btn btn-sm" style="width:34px;height:34px;" onclick="ExpensesPage.openEditModal('${e.id}')" aria-label="Edit"><i class="fa-solid fa-pen" style="font-size:12px;"></i></button>
                    <button class="icon-btn btn-sm" style="width:34px;height:34px;" onclick="ExpensesPage.remove('${e.id}')" aria-label="Delete"><i class="fa-solid fa-trash" style="font-size:12px;"></i></button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  },

  openCreateModal() {
    this.editingId = null;
    document.getElementById('expenseModalTitle').textContent = 'Add Expense';
    document.getElementById('expenseForm').reset();
    document.getElementById('expenseDate').value = Utils.todayISO();
    document.getElementById('expenseTime').value = Utils.nowTime();
    this.modalCategoryDD.setValue(null);
    this.clearErrors();
    ModalManager.open('expenseModal');
  },

  openEditModal(id) {
    const e = DB.data.expenses.find((x) => x.id === id);
    if (!e) return;
    this.editingId = id;
    document.getElementById('expenseModalTitle').textContent = 'Edit Expense';
    document.getElementById('expenseName').value = e.name;
    document.getElementById('expenseAmount').value = e.amount;
    document.getElementById('expenseNotes').value = e.notes;
    document.getElementById('expenseDate').value = e.date;
    document.getElementById('expenseTime').value = e.time;
    this.modalCategoryDD.setValue(e.category);
    this.clearErrors();
    ModalManager.open('expenseModal');
  },

  clearErrors() {
    setFieldError(document.getElementById('expenseName'), document.getElementById('expenseNameError'), '');
    setFieldError(document.getElementById('expenseAmount'), document.getElementById('expenseAmountError'), '');
    setFieldError(document.getElementById('expenseCategoryDD'), document.getElementById('expenseCategoryError'), '');
  },

  async handleSubmit(e) {
    e.preventDefault();
    const nameEl = document.getElementById('expenseName');
    const amountEl = document.getElementById('expenseAmount');
    const notes = document.getElementById('expenseNotes').value.trim();
    const date = document.getElementById('expenseDate').value;
    const time = document.getElementById('expenseTime').value;
    const category = this.modalCategoryDD.getValue();

    let valid = true;
    if (!nameEl.value.trim()) {
      setFieldError(nameEl, document.getElementById('expenseNameError'), 'Give this expense a name.');
      valid = false;
    } else setFieldError(nameEl, document.getElementById('expenseNameError'), '');

    if (!Utils.isValidAmount(amountEl.value)) {
      setFieldError(amountEl, document.getElementById('expenseAmountError'), 'Enter an amount greater than zero.');
      valid = false;
    } else setFieldError(amountEl, document.getElementById('expenseAmountError'), '');

    if (!category) {
      setFieldError(document.getElementById('expenseCategoryDD'), document.getElementById('expenseCategoryError'), 'Please select a category.');
      valid = false;
    } else setFieldError(document.getElementById('expenseCategoryDD'), document.getElementById('expenseCategoryError'), '');

    if (!valid) return;

    // Check overspend (only relevant when creating, or increasing an edit)
    const amount = Number(amountEl.value);
    const oldAmount = this.editingId ? DB.data.expenses.find((x) => x.id === this.editingId).amount : 0;
    const projectedBalance = DB.data.balance + oldAmount - amount;
    if (projectedBalance < 0) {
      const ok = await confirmDialog({
        title: 'This will exceed your balance',
        message: `Recording this expense will bring your balance to ${Utils.formatMoney(projectedBalance)}. Do you want to continue anyway?`,
        confirmText: 'Add Anyway',
        tone: 'danger'
      });
      if (!ok) return;
    }

    const payload = { name: nameEl.value.trim(), category, amount: amountEl.value, notes, date, time };
    if (this.editingId) {
      DB.updateExpense(this.editingId, payload);
      Toast.success('Expense updated', `${payload.name} · ${Utils.formatMoney(payload.amount)}`);
    } else {
      DB.addExpense(payload);
      Toast.success('Expense added', `${payload.name} · ${Utils.formatMoney(payload.amount)}`);
    }
    ModalManager.close('expenseModal');
  },

  async remove(id) {
    const e = DB.data.expenses.find((x) => x.id === id);
    if (!e) return;
    const ok = await confirmDialog({
      title: 'Delete this expense?',
      message: `This will restore ${Utils.formatMoney(e.amount)} to your balance. This can't be undone.`,
      confirmText: 'Delete'
    });
    if (!ok) return;
    DB.deleteExpense(id);
    Toast.success('Expense deleted', 'Your balance has been updated.');
  }
};
