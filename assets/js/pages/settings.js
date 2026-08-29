/* ==========================================================================
   FundSprout — Settings Page
   ========================================================================== */

const SettingsPage = {
  init() {
    const darkSwitch = document.getElementById('darkModeSwitch');
    const animSwitch = document.getElementById('animationsSwitch');

    darkSwitch.checked = DB.data.settings.theme === 'dark';
    animSwitch.checked = DB.data.settings.animations;

    darkSwitch.addEventListener('change', () => {
      const theme = darkSwitch.checked ? 'dark' : 'light';
      DB.updateSettings({ theme });
      App.applyTheme(theme);
      Toast.success('Theme updated', `Switched to ${theme} mode.`);
    });

    animSwitch.addEventListener('change', () => {
      DB.updateSettings({ animations: animSwitch.checked });
      App.applyAnimations(animSwitch.checked);
      Toast.success('Animations ' + (animSwitch.checked ? 'enabled' : 'disabled'));
    });

    document.getElementById('exportBackupBtn').addEventListener('click', () => this.exportBackup());
    document.getElementById('importBackupInput').addEventListener('change', (e) => this.importBackup(e));
    document.getElementById('resetDataBtn').addEventListener('click', () => this.resetData());

    if (typeof SyncManager !== 'undefined') {
      const urlInput = document.getElementById('syncUrlInput');
      urlInput.value = SyncManager.config.url || '';

      document.getElementById('saveSyncUrlBtn').addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (url && !/^https:\/\//i.test(url)) {
          Toast.error('Invalid URL', 'Please paste the full https:// Apps Script Web App URL.');
          return;
        }
        SyncManager.setEndpoint(url);
        Toast.success(url ? 'Cloud sync connected' : 'Cloud sync disconnected',
          url ? 'FundSprout will sync changes automatically when online.' : 'Sync endpoint cleared.');
      });

      document.getElementById('syncNowBtn').addEventListener('click', () => {
        if (!SyncManager.isConfigured()) {
          Toast.warning('Not connected', 'Save a Google Apps Script URL first.');
          return;
        }
        if (!SyncManager.isOnline()) {
          Toast.warning('Offline', 'Connect to the internet to sync.');
          return;
        }
        SyncManager.retryPendingChanges();
        Toast.success('Sync started', 'Syncing pending changes in the background.');
      });

      this.renderSyncStatus();

      const generateBtn = document.getElementById('generateDeviceCodeBtn');
      const claimBtn = document.getElementById('claimDeviceCodeBtn');
      const refreshBtn = document.getElementById('refreshDeviceSyncBtn');
      const unpairBtn = document.getElementById('unpairDeviceBtn');
      const codeInput = document.getElementById('deviceSyncCodeInput');
      const codeWrap = document.getElementById('deviceSyncCodeWrap');
      const codeEl = document.getElementById('deviceSyncCode');
      const expiryEl = document.getElementById('deviceSyncCodeExpiry');
      let codeExpiryTimer = null;

      const updateDeviceSyncUI = () => {
        const paired = SyncManager.isPaired();
        const title = document.getElementById('deviceSyncStatusTitle');
        const text = document.getElementById('deviceSyncStatusText');
        if (title) title.textContent = paired ? 'Device paired' : 'Not paired';
        if (text) text.textContent = paired
          ? 'This device shares the same FundSprout data with the paired device. Changes sync automatically when online.'
          : 'Pair this device with your phone or another FundSprout device to share the same data.';
        if (unpairBtn) unpairBtn.hidden = !paired;
      };

      generateBtn.addEventListener('click', async () => {
        if (!SyncManager.isConfigured()) { Toast.warning('Cloud Sync required', 'Connect your Google Apps Script URL first.'); return; }
        if (!SyncManager.isOnline()) { Toast.warning('Offline', 'Connect to the internet to create a pairing code.'); return; }
        generateBtn.disabled = true;
        try {
          const pairing = await SyncManager.createPairingCode();
          codeEl.textContent = pairing.code;
          codeWrap.hidden = false;
          clearInterval(codeExpiryTimer);
          const expires = new Date(pairing.expiresAt).getTime();
          const tick = () => {
            const left = Math.max(0, expires - Date.now());
            const mins = Math.floor(left / 60000);
            const secs = Math.floor((left % 60000) / 1000);
            expiryEl.textContent = left ? `Expires in ${mins}:${String(secs).padStart(2, '0')}` : 'Code expired · generate a new code';
            if (!left) clearInterval(codeExpiryTimer);
          };
          tick(); codeExpiryTimer = setInterval(tick, 1000);
          Toast.success('Pairing code created', 'Enter this code on the device you want to connect.');
        } catch (err) { Toast.error('Could not create code', err.message || 'Please try again.'); }
        finally { generateBtn.disabled = false; }
      });

      claimBtn.addEventListener('click', async () => {
        if (!SyncManager.isConfigured()) { Toast.warning('Cloud Sync required', 'Connect your Google Apps Script URL first.'); return; }
        if (!SyncManager.isOnline()) { Toast.warning('Offline', 'Connect to the internet to pair this device.'); return; }
        const code = codeInput.value.trim();
        if (!code) { Toast.warning('Pairing code required', 'Enter the code shown on your other device.'); return; }
        const ok = await confirmDialog({ title: 'Connect this device?', message: 'The current device data will be replaced with the paired device data after connection.', confirmText: 'Connect', tone: 'primary' });
        if (!ok) return;
        claimBtn.disabled = true;
        try {
          await SyncManager.claimPairingCode(code);
          updateDeviceSyncUI();
          codeInput.value = '';
          Toast.success('Device connected', 'Your data is now shared with the paired device.');
          App.goTo('dashboard');
        } catch (err) { Toast.error('Pairing failed', err.message || 'Please check the code and try again.'); }
        finally { claimBtn.disabled = false; }
      });

      refreshBtn.addEventListener('click', async () => {
        if (!SyncManager.isPaired()) { Toast.warning('Not paired', 'Connect this device to another FundSprout device first.'); return; }
        if (!SyncManager.isOnline()) { Toast.warning('Offline', 'Connect to the internet to refresh shared data.'); return; }
        refreshBtn.disabled = true;
        try {
          const changed = await SyncManager.pullRemoteData(true);
          Toast.success(changed ? 'Shared data refreshed' : 'Already up to date', changed ? 'The latest paired-device data is now on this device.' : 'No newer cloud data was found.');
        } finally { refreshBtn.disabled = false; }
      });

      unpairBtn.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Unpair device?', message: 'This stops automatic Device Sync. Your current local data will remain on this device.', confirmText: 'Unpair', tone: 'danger' });
        if (!ok) return;
        SyncManager.unpair();
        updateDeviceSyncUI();
        Toast.success('Device unpaired', 'Your local data was kept.');
      });

      updateDeviceSyncUI();
    }

    this.render();
  },

  render() {
    document.getElementById('settingsRecordCount').textContent =
      `${DB.data.allowances.length + DB.data.expenses.length} transactions · ${DB.data.plants.length} plants`;
    const backupEl = document.getElementById('lastBackupStatus');
    if (backupEl) {
      backupEl.textContent = DB.data.settings.lastBackupAt
        ? `Last backup · ${Utils.formatSyncDateTime(DB.data.settings.lastBackupAt)}`
        : 'No backup exported yet';
    }
  },

  renderSyncStatus() {
    const el = document.getElementById('syncSettingsStatus');
    if (!el || typeof SyncManager === 'undefined') return;
    const s = SyncManager.getStatus();
    if (!s.configured) {
      el.textContent = 'Not connected';
      return;
    }
    if (!s.online) {
      el.textContent = s.pending > 0 ? `Offline · ${s.pending} change(s) waiting` : 'Offline';
    } else if (s.syncing) {
      el.textContent = 'Syncing…';
    } else if (s.pending > 0) {
      el.textContent = `${s.pending} change(s) waiting to sync`;
    } else {
      el.textContent = s.lastSyncedAt
        ? `Synced · last sync ${Utils.formatSyncDateTime(s.lastSyncedAt)}`
        : 'Synced';
    }
  },

  exportBackup() {
    const json = DB.exportBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = Utils.todayISO();
    a.href = url;
    a.download = `fundsprout-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    DB.updateSettings({ lastBackupAt: Date.now() });
    Toast.success('Backup exported', 'Your data was saved as a .json file.');
  },

  importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const ok = await confirmDialog({
          title: 'Import backup?',
          message: 'This will replace all current data in FundSprout with the contents of this backup file.',
          confirmText: 'Import',
          tone: 'danger'
        });
        if (!ok) { e.target.value = ''; return; }
        DB.importBackup(reader.result);
        Toast.success('Backup imported', 'Your data has been restored.');
      } catch (err) {
        Toast.error('Import failed', err.message || 'This file could not be read.');
      }
      e.target.value = '';
    };
    reader.onerror = () => {
      Toast.error('Import failed', 'The file could not be read. Please try again.');
      e.target.value = '';
    };
    reader.readAsText(file);
  },

  async resetData() {
    const ok = await confirmDialog({
      title: 'Reset all data?',
      message: 'This will permanently delete every allowance, expense, plant, and setting. This cannot be undone.',
      confirmText: 'Reset Everything',
      tone: 'danger'
    });
    if (!ok) return;
    DB.resetAll();
    App.applyTheme(DB.data.settings.theme);
    App.applyAnimations(DB.data.settings.animations);
    document.getElementById('darkModeSwitch').checked = DB.data.settings.theme === 'dark';
    document.getElementById('animationsSwitch').checked = DB.data.settings.animations;
    Toast.success('All data reset', 'FundSprout has been restored to a fresh start.');
    App.goTo('dashboard');
  }
};
