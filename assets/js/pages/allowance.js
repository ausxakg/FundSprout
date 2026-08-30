/* ==========================================================================
   FundSprout — Allowance Page
   ========================================================================== */

const AllowancePage = {
  search: '',
  sort: 'newest',
  filterSource: 'all',
  editingId: null,
  sortDD: null,
  filterDD: null,
  modalSourceDD: null,

  init() {
    document.getElementById('allowanceSearchInput').addEventListener('input', Utils.debounce((e) => {
      this.search = e.target.value.trim().toLowerCase();
      this.toggleClearBtn();
      this.render();
    }, 200));
    document.querySelector('#page-allowance .clear-btn').addEventListener('click', () => {
      document.getElementById('allowanceSearchInput').value = '';
      this.search = '';
      this.toggleClearBtn();
      this.render();
    });

    this.sortDD = Dropdown.create(document.getElementById('allowanceSortDD'), {
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

    document.getElementById('addAllowanceBtn').addEventListener('click', () => this.openCreateModal());
    document.getElementById('allowanceForm').addEventListener('submit', (e) => this.handleSubmit(e));

    this.modalSourceDD = Dropdown.create(document.getElementById('allowanceSourceDD'), {
      options: [
        { value: 'Weekly Allowance', label: 'Weekly Allowance', icon: 'fa-calendar-week' },
        { value: 'Monthly Allowance', label: 'Monthly Allowance', icon: 'fa-calendar' },
        { value: 'Parents', label: 'Parents', icon: 'fa-house' },
        { value: 'Part-time Job', label: 'Part-time Job', icon: 'fa-briefcase' },
        { value: 'Scholarship', label: 'Scholarship', icon: 'fa-graduation-cap' },
        { value: 'Gift', label: 'Gift', icon: 'fa-gift' },
        { value: 'Other', label: 'Other', icon: 'fa-ellipsis' }
      ],
      placeholder: 'Select source',
      onChange: () => setFieldError(document.getElementById('allowanceSourceDD'), null, '')
    });

    this.render();
  },

  toggleClearBtn() {
    document.querySelector('#page-allowance .clear-btn').classList.toggle('show', !!this.search);
  },

  getFiltered() {
    let items = DB.data.allowances.slice();
    if (this.search) {
      items = items.filter((a) => (a.source + ' ' + (a.notes || '')).toLowerCase().includes(this.search));
    }
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
    const totalEl = document.getElementById('allowanceTotalThisMonth');
    const monthTotal = DB.data.allowances.filter((a) => !a.planned && Utils.inRange(a.date, 'monthly')).reduce((s, a) => s + a.amount, 0);
    totalEl.textContent = Utils.formatMoney(monthTotal);
    document.getElementById('allowanceCount').textContent = `${DB.data.allowances.length} record${DB.data.allowances.length === 1 ? '' : 's'}`;

    const wrap = document.getElementById('allowanceListWrap');
    if (!items.length) {
      wrap.innerHTML = emptyStateHTML({
        icon: 'fa-sack-dollar',
        title: this.search ? 'No matching allowances' : 'No allowances yet',
        message: this.search ? 'Try a different search term.' : 'Record your first allowance to start tracking your income.',
        actionLabel: this.search ? null : 'Add Allowance',
        actionAttr: `onclick="AllowancePage.openCreateModal()"`
      });
      return;
    }

    wrap.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Source</th><th>Notes</th><th>Date</th><th>Amount</th><th></th></tr></thead>
          <tbody>
            ${items.map((a) => `
              <tr>
                <td><strong>${Utils.escapeHtml(a.source)}</strong>${a.planned ? ` <span class="chip badge-yellow" style="margin-left:6px;"><i class="fa-solid fa-clipboard-list"></i> Spend Limit</span>` : ''}</td>
                <td class="text-secondary">${Utils.escapeHtml(a.notes) || '—'}</td>
                <td class="text-secondary">${Utils.formatDateTime(a.date, a.time)}</td>
                <td><span class="activity-amount ${a.planned ? '' : 'pos'}">${Utils.formatMoney(a.amount)}</span></td>
                <td>
                  <div class="row-actions">
                    <button class="icon-btn btn-sm" style="width:34px;height:34px;" onclick="AllowancePage.openEditModal('${a.id}')" aria-label="Edit"><i class="fa-solid fa-pen" style="font-size:12px;"></i></button>
                    <button class="icon-btn btn-sm" style="width:34px;height:34px;" onclick="AllowancePage.remove('${a.id}')" aria-label="Delete"><i class="fa-solid fa-trash" style="font-size:12px;"></i></button>
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
    document.getElementById('allowanceModalTitle').textContent = 'Add Allowance';
    document.getElementById('allowanceForm').reset();
    document.getElementById('allowanceDate').value = Utils.todayISO();
    document.getElementById('allowanceTime').value = Utils.nowTime();
    this.modalSourceDD.setValue(null);
    document.getElementById('allowancePlannedSwitch').checked = false;
    this.clearErrors();
    ModalManager.open('allowanceModal');
  },

  openEditModal(id) {
    const a = DB.data.allowances.find((x) => x.id === id);
    if (!a) return;
    this.editingId = id;
    document.getElementById('allowanceModalTitle').textContent = 'Edit Allowance';
    document.getElementById('allowanceAmount').value = a.amount;
    document.getElementById('allowanceNotes').value = a.notes;
    document.getElementById('allowanceDate').value = a.date;
    document.getElementById('allowanceTime').value = a.time;
    this.modalSourceDD.setValue(a.source);
    document.getElementById('allowancePlannedSwitch').checked = !!a.planned;
    this.clearErrors();
    ModalManager.open('allowanceModal');
  },

  clearErrors() {
    ['allowanceAmount'].forEach((id) => {
      setFieldError(document.getElementById(id), document.getElementById(id + 'Error'), '');
    });
    setFieldError(document.getElementById('allowanceSourceDD'), document.getElementById('allowanceSourceError'), '');
  },

  handleSubmit(e) {
    e.preventDefault();
    const amountEl = document.getElementById('allowanceAmount');
    const notes = document.getElementById('allowanceNotes').value.trim();
    const date = document.getElementById('allowanceDate').value;
    const time = document.getElementById('allowanceTime').value;
    const source = this.modalSourceDD.getValue();
    const planned = document.getElementById('allowancePlannedSwitch').checked;

    let valid = true;
    if (!Utils.isValidAmount(amountEl.value)) {
      setFieldError(amountEl, document.getElementById('allowanceAmountError'), 'Enter an amount greater than zero.');
      valid = false;
    } else {
      setFieldError(amountEl, document.getElementById('allowanceAmountError'), '');
    }
    if (!source) {
      setFieldError(document.getElementById('allowanceSourceDD'), document.getElementById('allowanceSourceError'), 'Please select a source.');
      valid = false;
    } else {
      setFieldError(document.getElementById('allowanceSourceDD'), document.getElementById('allowanceSourceError'), '');
    }
    if (!date) valid = false;
    if (!valid) return;

    const payload = { amount: amountEl.value, source, notes, date, time, planned };

    if (this.editingId) {
      DB.updateAllowance(this.editingId, payload);
      Toast.success('Allowance updated', `${source} · ${Utils.formatMoney(payload.amount)}${planned ? ' · Spend Limit only' : ''}`);
    } else {
      DB.addAllowance(payload);
      Toast.success(planned ? 'Spend Limit saved' : 'Allowance added',
        planned ? `${source} · ${Utils.formatMoney(payload.amount)} · not added to balance` : `${source} · ${Utils.formatMoney(payload.amount)}`);
    }
    ModalManager.close('allowanceModal');
  },

  async remove(id) {
    const a = DB.data.allowances.find((x) => x.id === id);
    if (!a) return;
    const ok = await confirmDialog({
      title: 'Delete this allowance?',
      message: a.planned
        ? `This will remove this Spend Limit entry (${Utils.formatMoney(a.amount)} from ${a.source}). It never affected your balance. This can't be undone.`
        : `This will remove ${Utils.formatMoney(a.amount)} from ${a.source} and update your balance. This can't be undone.`,
      confirmText: 'Delete'
    });
    if (!ok) return;
    DB.deleteAllowance(id);
    Toast.success('Allowance deleted', a.planned ? 'This was a Spend Limit entry — your balance is unchanged.' : 'Your balance has been updated.');
  }
};
