/**
 * Daily Spent — write proxy for the Personal Finance Manager app.
 *
 * What it does:
 *   - append : adds a new transaction row (columns A–E only) to "Form Responses 1"
 *   - update : edits columns A–E of an existing row
 *   - setMeta: stores verified/reconciliation flags in a separate "AppMeta" tab
 *   - getMeta: returns all AppMeta rows
 *
 * What it NEVER does: touch the Google Form, reorder rows, or write outside
 * columns A–E of Form Responses 1. Your iPhone Shortcut → Form flow is unaffected.
 *
 * SETUP — see SETUP.md in the project root. Short version:
 *   1. Open the Daily Spent sheet → Extensions → Apps Script
 *   2. Paste this file, change TOKEN below to something random
 *   3. Deploy → New deployment → Web app → Execute as: Me → Access: Anyone
 *   4. Copy the web app URL into .env.local (APPS_SCRIPT_URL) along with the token
 */

var TOKEN = 'change-me-to-something-random'; // must match APPS_SCRIPT_TOKEN in .env.local
var DATA_TAB = 'Form Responses 1';
var META_TAB = 'AppMeta';

function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token !== TOKEN) throw new Error('Bad token');
    switch (body.action) {
      case 'ping':    out = { ok: true, pong: true }; break;
      case 'append':  out = doAppend(body); break;
      case 'update':  out = doUpdate(body); break;
      case 'setMeta': out = doSetMeta(body); break;
      case 'getMeta': out = doGetMeta(); break;
      default: throw new Error('Unknown action: ' + body.action);
    }
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function dataSheet_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DATA_TAB);
  if (!sh) throw new Error('Tab not found: ' + DATA_TAB);
  return sh;
}

function metaSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(META_TAB);
  if (!sh) {
    sh = ss.insertSheet(META_TAB);
    sh.appendRow(['txId', 'row', 'verified', 'verifiedAt', 'note']);
  }
  return sh;
}

/** Append a transaction. Writes ONLY columns A–E, after the last row with data in A–E. */
function doAppend(b) {
  var sh = dataSheet_();
  var lastRow = findLastDataRow_(sh);
  var row = lastRow + 1;
  sh.getRange(row, 1, 1, 5).setValues([[
    String(b.timestamp || ''),
    b.amount === null || b.amount === undefined || b.amount === '' ? '' : Number(b.amount),
    String(b.method || ''),
    String(b.category || ''),
    String(b.remarks || ''),
  ]]);
  return { ok: true, row: row };
}

/** Update columns A–E of one row (1-based, header = row 1). */
function doUpdate(b) {
  var row = Number(b.row);
  if (!row || row < 2) throw new Error('Invalid row: ' + b.row);
  var sh = dataSheet_();
  if (row > sh.getLastRow()) throw new Error('Row out of range: ' + row);
  var current = sh.getRange(row, 1, 1, 5).getValues()[0];
  sh.getRange(row, 1, 1, 5).setValues([[
    b.timestamp !== undefined && b.timestamp !== null ? String(b.timestamp) : current[0],
    b.amount !== undefined ? (b.amount === null || b.amount === '' ? '' : Number(b.amount)) : current[1],
    b.method !== undefined ? String(b.method) : current[2],
    b.category !== undefined ? String(b.category) : current[3],
    b.remarks !== undefined ? String(b.remarks) : current[4],
  ]]);
  return { ok: true, row: row };
}

/** Upsert a verified flag into AppMeta keyed by txId. */
function doSetMeta(b) {
  if (!b.txId) throw new Error('txId required');
  var sh = metaSheet_();
  var data = sh.getDataRange().getValues();
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(b.txId)) { rowIdx = i + 1; break; }
  }
  var values = [[String(b.txId), b.row || '', b.verified ? 'TRUE' : 'FALSE', new Date().toISOString(), String(b.note || '')]];
  if (rowIdx === -1) sh.appendRow(values[0]);
  else sh.getRange(rowIdx, 1, 1, 5).setValues(values);
  return { ok: true };
}

function doGetMeta() {
  var sh = metaSheet_();
  var data = sh.getDataRange().getValues();
  var meta = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    meta.push({
      txId: String(data[i][0]),
      row: data[i][1] ? Number(data[i][1]) : null,
      verified: String(data[i][2]).toUpperCase() === 'TRUE',
      verifiedAt: data[i][3] ? String(data[i][3]) : null,
      note: data[i][4] ? String(data[i][4]) : null,
    });
  }
  return { ok: true, meta: meta };
}

/** Last row that has any content in columns A–E (ignores checkbox columns F+). */
function findLastDataRow_(sh) {
  var values = sh.getRange(1, 1, sh.getLastRow(), 5).getValues();
  for (var i = values.length - 1; i >= 0; i--) {
    for (var j = 0; j < 5; j++) {
      if (values[i][j] !== '' && values[i][j] !== null) return i + 1;
    }
  }
  return 1;
}
