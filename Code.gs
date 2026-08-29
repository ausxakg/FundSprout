/**
 * FundSprout — Google Apps Script cloud-sync backend.
 *
 * Paste this whole file into the Apps Script editor (Extensions > Apps
 * Script) opened FROM your Google Sheet, replacing whatever is in Code.gs.
 * See the setup guide for full step-by-step instructions.
 *
 * Leave SPREADSHEET_ID empty to use the spreadsheet this script is bound to
 * (the normal case). Only set it if you deploy this as a standalone script
 * not attached to a specific sheet.
 */

const SPREADSHEET_ID = ''; // optional — leave '' if the script is bound to the sheet

const SHEETS = {
  allowances: {
    name: 'Allowances',
    headers: ['DeviceID', 'RecordID', 'Amount', 'Source', 'Notes', 'Date', 'Time', 'CreatedAt', 'UpdatedAt']
  },
  expenses: {
    name: 'Expenses',
    headers: ['DeviceID', 'RecordID', 'Name', 'Category', 'Amount', 'Notes', 'Date', 'Time', 'CreatedAt', 'UpdatedAt']
  },
  plants: {
    name: 'Garden',
    headers: ['DeviceID', 'RecordID', 'Name', 'Type', 'Goal', 'Target', 'Saved', 'CreatedAt', 'LastWatered', 'HistoryJSON', 'UpdatedAt']
  },
  settings: {
    name: 'Settings',
    headers: ['DeviceID', 'RecordID', 'Theme', 'Animations', 'SidebarCollapsed', 'Currency', 'Onboarded', 'UpdatedAt']
  },
  budget: {
    name: 'Budget',
    headers: ['DeviceID', 'RecordID', 'TotalBudget', 'Initialized', 'UpdatedAt', 'CurrentCash']
  },
  deviceLinks: {
    name: 'DeviceLinks',
    headers: ['Code', 'OwnerDeviceID', 'GuestDeviceID', 'CreatedAt', 'ExpiresAt', 'Status']
  }
};

/* ------------------------------------------------------------------ */
/* Entry points                                                        */
/* ------------------------------------------------------------------ */

function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = String(params.action || 'status').toLowerCase();
    const ss = getSpreadsheet();

    if (action === 'devices') {
      return jsonOutput({ success: true, devices: listDevices(ss) });
    }

    if (action === 'create_pair_code') {
      const deviceId = String(params.deviceId || '').trim();
      if (!deviceId) throw new Error('Missing deviceId.');
      return jsonOutput({ success: true, pairing: createPairCode(ss, deviceId) });
    }

    if (action === 'pair_status') {
      const deviceId = String(params.deviceId || '').trim();
      if (!deviceId) throw new Error('Missing deviceId.');
      return jsonOutput({ success: true, pairing: getPairStatus(ss, deviceId) });
    }

    if (action === 'claim_pair_code') {
      const code = String(params.code || '').trim().toUpperCase();
      const guestDeviceId = String(params.deviceId || '').trim();
      if (!code || !guestDeviceId) throw new Error('Missing pairing code or deviceId.');
      return jsonOutput({ success: true, pairing: claimPairCode(ss, code, guestDeviceId) });
    }

    if (action === 'data') {
      const deviceId = String(params.deviceId || '').trim();
      if (!deviceId) throw new Error('Missing deviceId.');
      const data = readDeviceData(ss, deviceId);
      return jsonOutput({ success: true, hasData: !!data, data: data || null });
    }

    return jsonOutput({ success: true, message: 'FundSprout sync endpoint is running.' });
  } catch (err) {
    return jsonOutput({ success: false, error: String(err) });
  }
}

function jsonOutput(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function listDevices(ss) {
  const map = {};
  Object.keys(SHEETS).forEach(function(entity) {
    if (entity === 'deviceLinks') return;
    const config = SHEETS[entity];
    const sheet = ss.getSheetByName(config.name);
    if (!sheet || sheet.getLastRow() < 2) return;
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, config.headers.length).getValues();
    values.forEach(function(row) {
      const deviceId = String(row[0] || '').trim();
      if (!deviceId) return;
      const updatedIndex = config.headers.indexOf('UpdatedAt');
      const updated = updatedIndex >= 0 ? toIsoValue(row[updatedIndex]) : '';
      if (!map[deviceId] || String(updated).localeCompare(String(map[deviceId].lastUpdated)) > 0) {
        map[deviceId] = { deviceId: deviceId, lastUpdated: updated || '' };
      }
    });
  });
  return Object.keys(map).map(function(k) { return map[k]; });
}

function readDeviceData(ss, deviceId) {
  const data = {
    version: 2, balance: 0, totalBudget: 0, startingCash: 0, currentCash: 0, totalBudgetSet: false,
    allowances: [], expenses: [], plants: [],
    settings: { theme: 'dark', animations: true, sidebarCollapsed: false, lastBackupAt: null, currency: '₱', onboarded: false }
  };
  let found = false;

  Object.keys(SHEETS).forEach(function(entity) {
    if (entity === 'deviceLinks') return;
    const config = SHEETS[entity];
    const sheet = ss.getSheetByName(config.name);
    if (!sheet || sheet.getLastRow() < 2) return;
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, config.headers.length).getValues();
    rows.forEach(function(row) {
      if (String(row[0] || '') !== String(deviceId)) return;
      found = true;
      const item = rowToObject(config.headers, row);
      if (entity === 'allowances') {
        data.allowances.push({
          id: String(item.RecordID), amount: Number(item.Amount) || 0, source: String(item.Source || ''),
          notes: String(item.Notes || ''), date: normalizeDateCell(item.Date), time: normalizeTimeCell(item.Time),
          createdAt: toEpoch(item.CreatedAt)
        });
      } else if (entity === 'expenses') {
        data.expenses.push({
          id: String(item.RecordID), name: String(item.Name || 'Expense'), category: String(item.Category || 'Others'),
          amount: Number(item.Amount) || 0, notes: String(item.Notes || ''), date: normalizeDateCell(item.Date),
          time: normalizeTimeCell(item.Time), createdAt: toEpoch(item.CreatedAt)
        });
      } else if (entity === 'plants') {
        let history = [];
        try { history = item.HistoryJSON ? JSON.parse(String(item.HistoryJSON)) : []; } catch (e) { history = []; }
        data.plants.push({
          id: String(item.RecordID), name: String(item.Name || 'My Plant'), type: String(item.Type || 'Tree'),
          goal: String(item.Goal || ''), target: Number(item.Target) || 0, saved: Number(item.Saved) || 0,
          createdAt: toEpoch(item.CreatedAt), lastWatered: toEpoch(item.LastWatered), history: Array.isArray(history) ? history : []
        });
      } else if (entity === 'settings' && String(item.RecordID) === 'settings') {
        data.settings = {
          ...data.settings, theme: String(item.Theme || 'dark'), animations: toBool(item.Animations, true),
          sidebarCollapsed: toBool(item.SidebarCollapsed, false), currency: String(item.Currency || '₱'),
          onboarded: toBool(item.Onboarded, false)
        };
      } else if (entity === 'budget' && (String(item.RecordID) === 'cash-on-hand' || String(item.RecordID) === 'total-budget')) {
        // cash-on-hand is the new canonical record. total-budget is retained
        // as a legacy fallback for existing spreadsheets.
        if (String(item.RecordID) === 'cash-on-hand' || !data.totalBudgetSet) {
          data.startingCash = Number(item.TotalBudget) || 0;
          data.totalBudget = data.startingCash;
          data.totalBudgetSet = toBool(item.Initialized, false);
          data.currentCash = Number(item.CurrentCash) || 0;
        }
      }
    });
  });

  if (!found) return null;
  // Legacy Budget rows stored the budget after expenses were subtracted.
  // If no canonical cash-on-hand row exists, recover the original starting
  // cash by adding the currently recorded expenses back to the legacy value.
  if (data.totalBudgetSet && !hasCanonicalCashRow(ss, deviceId)) {
    var legacyExpenses = data.expenses.reduce(function(sum, e) { return sum + Number(e.amount || 0); }, 0);
    data.startingCash = round2((Number(data.totalBudget) || 0) + legacyExpenses);
    data.totalBudget = data.startingCash;
  }
  data.balance = round2((Number(data.startingCash) || 0)
    + data.allowances.reduce(function(sum, a) { return sum + Number(a.amount || 0); }, 0)
    - data.expenses.reduce(function(sum, e) { return sum + Number(e.amount || 0); }, 0)
    - data.plants.reduce(function(sum, p) { return sum + Number(p.saved || 0); }, 0));
  data.currentCash = data.balance;
  data.remoteUpdatedAt = getDeviceLastUpdatedAt(ss, deviceId);
  return data;
}

function hasCanonicalCashRow(ss, deviceId) {
  const config = SHEETS.budget;
  const sheet = ss.getSheetByName(config.name);
  if (!sheet || sheet.getLastRow() < 2) return false;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(deviceId) && String(values[i][1]) === 'cash-on-hand') return true;
  }
  return false;
}

function getDeviceLastUpdatedAt(ss, deviceId) {
  let latest = 0;
  Object.keys(SHEETS).forEach(function(entity) {
    if (entity === 'deviceLinks') return;
    const config = SHEETS[entity];
    const sheet = ss.getSheetByName(config.name);
    if (!sheet || sheet.getLastRow() < 2) return;
    const updatedIndex = config.headers.indexOf('UpdatedAt');
    if (updatedIndex < 0) return;
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, config.headers.length).getValues();
    values.forEach(function(row) {
      if (String(row[0] || '') !== String(deviceId)) return;
      const t = toEpoch(row[updatedIndex]);
      if (t && t > latest) latest = t;
    });
  });
  return latest ? new Date(latest).toISOString() : null;
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach(function(h, i) { obj[h] = row[i]; });
  return obj;
}

function toIsoValue(value) {
  if (value instanceof Date && !isNaN(value)) return value.toISOString();
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d) ? String(value) : d.toISOString();
}

function toEpoch(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d) ? null : d.getTime();
}

function normalizeDateCell(value) {
  if (value instanceof Date && !isNaN(value)) {
    return Utilities.formatDate(value, 'Asia/Manila', 'yyyy-MM-dd');
  }
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? s : Utilities.formatDate(d, 'Asia/Manila', 'yyyy-MM-dd');
}

function normalizeTimeCell(value) {
  if (value instanceof Date && !isNaN(value)) return Utilities.formatDate(value, 'Asia/Manila', 'HH:mm');
  const s = String(value || '').trim();
  return s;
}

function toBool(value, fallback) {
  if (value === true || String(value).toLowerCase() === 'true' || String(value) === '1') return true;
  if (value === false || String(value).toLowerCase() === 'false' || String(value) === '0') return false;
  return fallback;
}

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

function doPost(e) {
  const result = { success: true, processed: [], failed: [] };

  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('Empty request body.');
    }
    const body = JSON.parse(e.postData.contents);
    const deviceId = String(body.deviceId || 'unknown');
    const operations = Array.isArray(body.operations) ? body.operations : [];

    const ss = getSpreadsheet();

    operations.forEach((op) => {
      try {
        applyOperation(ss, deviceId, op);
        result.processed.push(op.operationId);
      } catch (opErr) {
        result.failed.push({ operationId: op.operationId, error: String(opErr) });
      }
    });
  } catch (err) {
    result.success = false;
    result.error = String(err);
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}



/* ------------------------------------------------------------------ */
/* Device pairing                                                      */
/* ------------------------------------------------------------------ */

function getDeviceLinksSheet(ss) {
  return getOrCreateSheet(ss, SHEETS.deviceLinks.name, SHEETS.deviceLinks.headers);
}

function randomPairCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return code;
}

function createPairCode(ss, ownerDeviceId) {
  const sheet = getDeviceLinksSheet(ss);
  const now = Date.now();
  const expires = now + 10 * 60 * 1000;
  let code = randomPairCode();
  let attempts = 0;
  while (findPairCodeRow(sheet, code) !== -1 && attempts++ < 10) code = randomPairCode();
  sheet.appendRow([code, ownerDeviceId, '', new Date(now).toISOString(), new Date(expires).toISOString(), 'PENDING']);
  return { code: code, expiresAt: new Date(expires).toISOString() };
}

function findPairCodeRow(sheet, code) {
  if (sheet.getLastRow() < 2) return -1;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) if (String(values[i][0]).toUpperCase() === String(code).toUpperCase()) return i + 2;
  return -1;
}

function getPairStatus(ss, deviceId) {
  const sheet = getDeviceLinksSheet(ss);
  if (sheet.getLastRow() < 2) return { paired: false };
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SHEETS.deviceLinks.headers.length).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const owner = String(row[1] || '').trim();
    const guest = String(row[2] || '').trim();
    const status = String(row[5] || '').toUpperCase();
    if (status === 'PAIRED' && (owner === deviceId || guest === deviceId)) {
      return { paired: true, sharedDeviceId: owner, role: owner === deviceId ? 'owner' : 'guest', pairedAt: toIsoValue(row[3]) };
    }
  }
  return { paired: false };
}

function claimPairCode(ss, code, guestDeviceId) {
  const sheet = getDeviceLinksSheet(ss);
  const rowNum = findPairCodeRow(sheet, code);
  if (rowNum === -1) throw new Error('Pairing code not found. Generate a new code on the other device.');
  const row = sheet.getRange(rowNum, 1, 1, SHEETS.deviceLinks.headers.length).getValues()[0];
  const owner = String(row[1] || '').trim();
  const expiresAt = new Date(String(row[4] || '')).getTime();
  const status = String(row[5] || '').toUpperCase();
  if (!owner) throw new Error('Invalid pairing code.');
  if (status !== 'PENDING') throw new Error('This pairing code has already been used.');
  if (!expiresAt || expiresAt < Date.now()) throw new Error('This pairing code has expired.');
  if (owner === guestDeviceId) throw new Error('The same device cannot pair with itself.');
  sheet.getRange(rowNum, 3, 1, 4).setValues([[guestDeviceId, row[3], row[4], 'PAIRED']]);
  return { sharedDeviceId: owner, ownerDeviceId: owner, guestDeviceId: guestDeviceId, pairedAt: new Date().toISOString() };
}

/* ------------------------------------------------------------------ */
/* Operation routing                                                   */
/* ------------------------------------------------------------------ */

function applyOperation(ss, deviceId, op) {
  const config = SHEETS[op.entity];
  if (!config) throw new Error('Unknown entity: ' + op.entity);
  const sheet = getOrCreateSheet(ss, config.name, config.headers);

  if (op.action === 'CLEAR') {
    clearDeviceRows(sheet, deviceId);
    return;
  }
  if (op.action === 'DELETE') {
    deleteRow(sheet, deviceId, op.recordId);
    if (['allowances', 'expenses', 'plants'].includes(op.entity)) updateStoredCashBalance(ss, deviceId);
    return;
  }
  if (op.action === 'CREATE' || op.action === 'UPDATE') {
    // Normalize the old budget record ID so queued operations from older app
    // versions are migrated into the canonical cash-on-hand record.
    const recordId = op.entity === 'budget' && op.recordId === 'total-budget' ? 'cash-on-hand' : op.recordId;
    upsertRow(sheet, deviceId, recordId, buildRow(op.entity, deviceId, recordId, op.data));
    if (['allowances', 'expenses', 'plants', 'budget'].includes(op.entity)) updateStoredCashBalance(ss, deviceId);
    return;
  }
  throw new Error('Unknown action: ' + op.action);
}

function updateStoredCashBalance(ss, deviceId) {
  const config = SHEETS.budget;
  const sheet = getOrCreateSheet(ss, config.name, config.headers);
  const budgetRow = findRowNumber(sheet, deviceId, 'cash-on-hand');
  if (budgetRow === -1) return;
  const startingCash = Number(sheet.getRange(budgetRow, 3).getValue()) || 0;
  const allowances = sumEntityAmounts(ss, SHEETS.allowances, deviceId);
  const expenses = sumEntityAmounts(ss, SHEETS.expenses, deviceId);
  const saved = sumPlantSavings(ss, deviceId);
  const currentCash = round2(startingCash + allowances - expenses - saved);
  sheet.getRange(budgetRow, 6).setValue(currentCash);
  sheet.getRange(budgetRow, 5).setValue(new Date().toISOString());
}

function sumEntityAmounts(ss, config, deviceId) {
  const sheet = ss.getSheetByName(config.name);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const amountIndex = config.headers.indexOf('Amount') + 1;
  if (amountIndex < 1) return 0;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, config.headers.length).getValues();
  return values.reduce(function(sum, row) {
    return String(row[0] || '') === String(deviceId) ? sum + (Number(row[amountIndex - 1]) || 0) : sum;
  }, 0);
}

function sumPlantSavings(ss, deviceId) {
  const config = SHEETS.plants;
  const sheet = ss.getSheetByName(config.name);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  const savedIndex = config.headers.indexOf('Saved');
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, config.headers.length).getValues();
  return values.reduce(function(sum, row) {
    return String(row[0] || '') === String(deviceId) ? sum + (Number(row[savedIndex]) || 0) : sum;
  }, 0);
}

/* ------------------------------------------------------------------ */
/* Row building (adapt payload -> sheet columns per entity)            */
/* ------------------------------------------------------------------ */

function buildRow(entity, deviceId, recordId, data) {
  data = data || {};
  const now = new Date().toISOString();

  switch (entity) {
    case 'allowances':
      return [deviceId, recordId, data.amount, data.source, data.notes, data.date, data.time,
        isoOrNow(data.createdAt), now];
    case 'expenses':
      return [deviceId, recordId, data.name, data.category, data.amount, data.notes, data.date, data.time,
        isoOrNow(data.createdAt), now];
    case 'plants':
      return [deviceId, recordId, data.name, data.type, data.goal, data.target, data.saved,
        isoOrNow(data.createdAt), isoOrNow(data.lastWatered), JSON.stringify(data.history || []), now];
    case 'settings':
      return [deviceId, recordId, data.theme, data.animations, data.sidebarCollapsed, data.currency,
        data.onboarded, now];
    case 'budget':
      return [deviceId, recordId, Number(data.startingCash ?? data.amount) || 0, !!data.initialized, now, Number(data.currentCash) || 0];
    default:
      throw new Error('Unknown entity: ' + entity);
  }
}

function isoOrNow(ms) {
  if (!ms) return '';
  try { return new Date(Number(ms)).toISOString(); } catch (e) { return ''; }
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */

function getSpreadsheet() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < headers.length) {
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, headers.length - sheet.getLastColumn())
      .setValues([headers.slice(sheet.getLastColumn())]);
  }
  return sheet;
}

// Row layout is always [DeviceID, RecordID, ...] — find by that composite key
// so multiple devices can safely share one spreadsheet.
function findRowNumber(sheet, deviceId, recordId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues(); // DeviceID, RecordID columns
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(deviceId) && String(values[i][1]) === String(recordId)) {
      return i + 2; // account for header row + 1-index
    }
  }
  return -1;
}

function upsertRow(sheet, deviceId, recordId, rowValues) {
  const rowNum = findRowNumber(sheet, deviceId, recordId);
  if (rowNum === -1) {
    sheet.appendRow(rowValues);
  } else {
    sheet.getRange(rowNum, 1, 1, rowValues.length).setValues([rowValues]);
  }
}

function deleteRow(sheet, deviceId, recordId) {
  const rowNum = findRowNumber(sheet, deviceId, recordId);
  if (rowNum !== -1) sheet.deleteRow(rowNum);
}

function clearDeviceRows(sheet, deviceId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  // Delete from the bottom up so row numbers don't shift under us.
  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]) === String(deviceId)) {
      sheet.deleteRow(i + 2);
    }
  }
}
