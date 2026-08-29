/* ==========================================================================
   FundSprout — Garden Page
   ========================================================================== */

const GardenPage = {
  typeDD: null,
  activePlantId: null,
  editingWaterId: null,
  historySearch: '',

  init() {
    this.typeDD = Dropdown.create(document.getElementById('plantTypeDD'), {
      options: Object.keys(PLANT_TYPES).map((t) => ({ value: t, label: t, icon: PLANT_TYPES[t] })),
      value: 'Tree',
      placeholder: 'Select plant type',
      onChange: () => setFieldError(document.getElementById('plantTypeDD'), null, '')
    });

    document.getElementById('addPlantBtn').addEventListener('click', () => this.openCreateModal());
    document.getElementById('plantForm').addEventListener('submit', (e) => this.handleCreateSubmit(e));
    document.getElementById('waterForm').addEventListener('submit', (e) => this.handleWaterSubmit(e));
    document.getElementById('waterEditForm').addEventListener('submit', (e) => this.handleWaterEditSubmit(e));

    document.getElementById('plantDetailWaterBtn').addEventListener('click', () => {
      document.getElementById('waterModalPlantName').textContent = this.getActivePlant()?.name || '';
      document.getElementById('waterForm').reset();
      document.getElementById('waterAvailableBalance').textContent = Utils.formatMoney(DB.data.balance);
      ModalManager.open('waterModal');
    });

    document.getElementById('plantDetailDeleteBtn').addEventListener('click', () => this.deletePlant());

    document.getElementById('historySearchInput').addEventListener('input', Utils.debounce((e) => {
      this.historySearch = e.target.value.trim().toLowerCase();
      this.renderHistory();
    }, 200));

    this.render();
  },

  render() {
    const plants = DB.data.plants;
    const grid = document.getElementById('gardenGrid');
    if (!plants.length) {
      grid.innerHTML = emptyStateHTML({
        icon: 'fa-seedling',
        title: 'Your garden is empty',
        message: 'Create a plant tied to a savings goal, then water it whenever you set money aside.',
        actionLabel: 'Plant Something',
        actionAttr: `onclick="GardenPage.openCreateModal()"`
      });
      return;
    }
    grid.innerHTML = plants.map((p) => this.renderPlantCard(p)).join('');

    // If detail modal open for a plant, refresh it
    if (this.activePlantId) this.renderDetail(this.activePlantId);
  },

  renderPlantCard(p) {
    const pct = p.target > 0 ? Utils.clamp((p.saved / p.target) * 100, 0, 100) : 0;
    const stage = Plant.stageFromPercent(pct);
    return `
      <div class="card card-hover-lift plant-card" onclick="GardenPage.openDetail('${p.id}')">
        <div class="plant-type-icon"><i class="fa-solid ${PLANT_TYPES[p.type] || 'fa-seedling'}"></i></div>
        <div class="plant-svg-wrap">${Plant.render({ stage, type: p.type, health: 1, animate: DB.data.settings.animations })}</div>
        <div class="plant-name">${Utils.escapeHtml(p.name)}</div>
        <div class="plant-goal">${Utils.escapeHtml(p.goal) || 'Savings goal'}</div>
        <div class="plant-progress-track"><div class="plant-progress-fill" style="width:${pct}%"></div></div>
        <div class="plant-pct">${Utils.formatMoney(p.saved)} / ${Utils.formatMoney(p.target)} · ${Math.round(pct)}%</div>
      </div>
    `;
  },

  openCreateModal() {
    document.getElementById('plantForm').reset();
    this.typeDD.setValue('Tree');
    setFieldError(document.getElementById('plantName'), document.getElementById('plantNameError'), '');
    setFieldError(document.getElementById('plantTarget'), document.getElementById('plantTargetError'), '');
    ModalManager.open('plantModal');
  },

  handleCreateSubmit(e) {
    e.preventDefault();
    const nameEl = document.getElementById('plantName');
    const targetEl = document.getElementById('plantTarget');
    const goal = document.getElementById('plantGoal').value.trim();
    const type = this.typeDD.getValue() || 'Tree';

    let valid = true;
    if (!nameEl.value.trim()) {
      setFieldError(nameEl, document.getElementById('plantNameError'), 'Give your plant a name.');
      valid = false;
    } else setFieldError(nameEl, document.getElementById('plantNameError'), '');

    if (!Utils.isValidAmount(targetEl.value)) {
      setFieldError(targetEl, document.getElementById('plantTargetError'), 'Enter a target amount greater than zero.');
      valid = false;
    } else setFieldError(targetEl, document.getElementById('plantTargetError'), '');

    if (!valid) return;

    const plant = DB.addPlant({ name: nameEl.value.trim(), type, goal, target: targetEl.value });
    Toast.success('Plant added', `"${plant.name}" is ready to grow.`);
    ModalManager.close('plantModal');
  },

  getActivePlant() {
    return DB.data.plants.find((p) => p.id === this.activePlantId);
  },

  openDetail(id) {
    this.activePlantId = id;
    this.historySearch = '';
    document.getElementById('historySearchInput').value = '';
    this.renderDetail(id);
    ModalManager.open('plantDetailModal');
  },

  renderDetail(id) {
    const p = DB.data.plants.find((x) => x.id === id);
    if (!p) { ModalManager.close('plantDetailModal'); return; }
    const pct = p.target > 0 ? Utils.clamp((p.saved / p.target) * 100, 0, 100) : 0;
    const stage = Plant.stageFromPercent(pct);
    const info = Plant.stageInfo(stage);

    document.getElementById('plantDetailTitle').textContent = p.name;
    document.getElementById('plantDetailSvgWrap').innerHTML = Plant.render({ stage, type: p.type, health: 1, animate: DB.data.settings.animations });
    document.getElementById('plantDetailStageName').textContent = info.name;
    document.getElementById('plantDetailStageDesc').textContent = info.description;
    document.getElementById('plantDetailProgressFill').style.width = `${pct}%`;
    document.getElementById('plantDetailStats').textContent = `${Utils.formatMoney(p.saved)} saved of ${Utils.formatMoney(p.target)} goal (${Math.round(pct)}%)`;
    document.getElementById('plantDetailGoalText').textContent = p.goal || 'No description added.';
    document.getElementById('plantDetailType').innerHTML = `<i class="fa-solid ${PLANT_TYPES[p.type]}"></i> ${p.type}`;

    this.renderHistory();
  },

  renderHistory() {
    const p = this.getActivePlant();
    if (!p) return;
    let history = p.history.slice();
    if (this.historySearch) {
      history = history.filter((h) => (h.notes || '').toLowerCase().includes(this.historySearch));
    }
    const wrap = document.getElementById('waterHistoryList');
    if (!history.length) {
      wrap.innerHTML = `<div class="empty-state" style="padding:32px 12px;"><div class="empty-icon"><i class="fa-solid fa-droplet"></i></div><h4 style="font-size:14px;">No watering history</h4><p style="font-size:12.5px;">Water this plant to start building its history.</p></div>`;
      return;
    }
    wrap.innerHTML = history.map((h) => `
      <div class="activity-item">
        <div class="activity-icon badge-green"><i class="fa-solid fa-droplet"></i></div>
        <div class="activity-main">
          <div class="activity-title">${Utils.formatMoney(h.amount)}${h.notes ? ` — ${Utils.escapeHtml(h.notes)}` : ''}</div>
          <div class="activity-sub">${Utils.formatDateTime(h.date, h.time)}</div>
        </div>
        <div class="row-actions">
          <button class="icon-btn btn-sm" style="width:32px;height:32px;" onclick="GardenPage.openEditWater('${h.id}')" aria-label="Edit"><i class="fa-solid fa-pen" style="font-size:11px;"></i></button>
          <button class="icon-btn btn-sm" style="width:32px;height:32px;" onclick="GardenPage.deleteWater('${h.id}')" aria-label="Delete"><i class="fa-solid fa-trash" style="font-size:11px;"></i></button>
        </div>
      </div>
    `).join('');
  },

  async handleWaterSubmit(e) {
    e.preventDefault();
    const amountEl = document.getElementById('waterAmount');
    const notes = document.getElementById('waterNotes').value.trim();
    if (!Utils.isValidAmount(amountEl.value)) {
      setFieldError(amountEl, document.getElementById('waterAmountError'), 'Enter an amount greater than zero.');
      return;
    }
    setFieldError(amountEl, document.getElementById('waterAmountError'), '');

    const amount = Number(amountEl.value);
    if (amount > DB.data.balance) {
      const ok = await confirmDialog({
        title: 'Not enough balance',
        message: `Watering with ${Utils.formatMoney(amount)} will bring your balance to ${Utils.formatMoney(DB.data.balance - amount)}. Continue anyway?`,
        confirmText: 'Water Anyway'
      });
      if (!ok) return;
    }

    DB.waterPlant(this.activePlantId, amount, notes);
    Toast.success('Plant watered', `Added ${Utils.formatMoney(amount)} to savings.`);
    ModalManager.close('waterModal');
  },

  openEditWater(recordId) {
    const p = this.getActivePlant();
    const rec = p.history.find((h) => h.id === recordId);
    if (!rec) return;
    this.editingWaterId = recordId;
    document.getElementById('waterEditAmount').value = rec.amount;
    document.getElementById('waterEditNotes').value = rec.notes;
    setFieldError(document.getElementById('waterEditAmount'), document.getElementById('waterEditAmountError'), '');
    ModalManager.open('waterEditModal');
  },

  handleWaterEditSubmit(e) {
    e.preventDefault();
    const amountEl = document.getElementById('waterEditAmount');
    if (!Utils.isValidAmount(amountEl.value)) {
      setFieldError(amountEl, document.getElementById('waterEditAmountError'), 'Enter an amount greater than zero.');
      return;
    }
    setFieldError(amountEl, document.getElementById('waterEditAmountError'), '');
    const notes = document.getElementById('waterEditNotes').value.trim();
    DB.updateWaterRecord(this.activePlantId, this.editingWaterId, { amount: amountEl.value, notes });
    Toast.success('Watering updated', 'Plant savings recalculated.');
    ModalManager.close('waterEditModal');
  },

  async deleteWater(recordId) {
    const ok = await confirmDialog({
      title: 'Delete this watering record?',
      message: 'The amount will be returned to your balance. This can\'t be undone.',
      confirmText: 'Delete'
    });
    if (!ok) return;
    DB.deleteWaterRecord(this.activePlantId, recordId);
    Toast.success('Record deleted', 'Your balance has been updated.');
  },

  async deletePlant() {
    const p = this.getActivePlant();
    if (!p) return;
    const ok = await confirmDialog({
      title: `Delete "${p.name}"?`,
      message: `Any saved amount (${Utils.formatMoney(p.saved)}) will be returned to your balance. This can't be undone.`,
      confirmText: 'Delete Plant'
    });
    if (!ok) return;
    DB.deletePlant(p.id);
    ModalManager.close('plantDetailModal');
    Toast.success('Plant removed', 'Its savings were returned to your balance.');
  }
};
