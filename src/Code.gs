/**
 * MARGIN ENTRY — Equity + Commodity  (Google Apps Script web app)
 * Files in this Apps Script project:
 *   Code.gs      (this file)
 *   Index.html   (the UI file)
 *
 * Required sheet tabs (names must match EXACTLY):
 *   LOGIN PAGE            -> NAME | ID | PASSWORD | EMAIL | ... | EQUITY ENTRY | COMODDITY ENTRY | MASTER EQUITY | MASTER COMODDITY | RESPONSES 2 EQUITY | RESPONSES EQUITY | RESPONSES COMODDITY | RESPONSES 2 COMODDITY | MASTER EQUITY ADD ENTRY | MASTER COMODDITY ADD ENTRY | REPORT | IT DETAILED
 *     Row 1 holds each project's Sheet URL, row 2 the header labels, row 3+ users.
 *     Columns are matched BY LABEL, never by position — the permission block can
 *     sit at D.. or G..R and nothing needs changing. Blank spacer columns are ignored.
 *   MASTER EQUITY         -> CODE | USER ID | SOFTWARE | NAME | GROUP NAME | BRANCH NAME | TIMESTAMP | LOGIN ID
 *   MASTER COMODDITY      -> CODE | USER ID | SOFTWARE | NAME | GROUP NAME | BRANCH NAME | TIMESTAMP | LOGIN ID
 *
 * NOTE: "MASTER EQUITY ADD ENTRY" / "MASTER COMODDITY ADD ENTRY" are new permission
 * columns on LOGIN PAGE. Mark YES for a user to show them the "+ Add" button on the
 * corresponding Master Data page (lets them add a new master row via a popup form).
 * The code also tolerates the "MATER ..." (missing S) spelling in case that's what
 * already exists in your sheet — either header name works.
 *   RESPONSES EQUITY      -> TIMESTAMP | SELECT DATE | CODE | USER ID | SOFTWARE | NAME | GROUP NAME | MARGIN AS PER RMS | MARGIN ALLOCATED ON ID | BRANCH NAME | LOGIN NAME
 *   RESPONSES COMODDITY   -> (same columns as RESPONSES EQUITY)
 *   RESPONSES 2 EQUITY    -> TIMESTAMP | SELECT DATE | GROUP NAME | GROUP MARGIN | LOGIN NAME
 *   RESPONSES 2 COMODDITY -> (same columns as RESPONSES 2 EQUITY)
 *
 * NOTE: Branch Name is now read from the MASTER sheets (per CODE), same as
 * User ID / Software / Name / Group Name — NOT from a separate DROPDOWN sheet.
 *
 * Deploy: Deploy > New deployment > type "Web app" > Execute as "Me" > Who has access "Anyone" > Deploy.
 */

/* ---- Sheet name constants ---- */
var SHEETS = {
  login: 'LOGIN PAGE',
  masterEquity: 'MASTER EQUITY',
  masterComm: 'MASTER COMODDITY',
  respEquity: 'RESPONSES EQUITY',
  respComm: 'RESPONSES COMODDITY',
  resp2Equity: 'RESPONSES 2 EQUITY',
  resp2Comm: 'RESPONSES 2 COMODDITY',
  itResponses: 'RESPONSES-NEW',
  itApproved: 'RESPONSES-APPRVOED',
  itDatabase: 'DATABASE',
  itBranchAddress: 'Branch Address Formula',
  marginEntry: 'RESPONSES-MARGIN-ENTRY',
  intradayYes: 'INTRADAY YES',
};

/* ---- Backoffice-code approval: who receives the approval email ----
   Add one address, or several comma-separated. Everyone here gets the
   "approve this backoffice-code change" email. */
var EMAIL_LIST_FOR_APPROVAL = 'ankur@mis.work';

function doGet(e) {
  // Approval link from the email opens a small standalone approval page.
  if (e && e.parameter && e.parameter.page === 'approve') {
    var t = HtmlService.createTemplateFromFile('Approval');
    t.token = e.parameter.t || '';
    // Pre-compute the details server-side and inject them, so the page renders
    // instantly with no second round trip.
    var preload;
    try {
      preload = getApprovalDetails(t.token);
    } catch (err) {
      preload = { ok: false, message: err.message };
    }
    t.preload = JSON.stringify(preload || { ok: false });
    return t
      .evaluate()
      .setTitle('Approve Backoffice Code')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  // Margin-change approval link.
  if (e && e.parameter && e.parameter.page === 'approve-margin') {
    var mt = HtmlService.createTemplateFromFile('MarginApproval');
    mt.token = e.parameter.t || '';
    var mp;
    try {
      mp = getMarginApprovalDetails(mt.token);
    } catch (err) {
      mp = { ok: false, message: err.message };
    }
    mt.preload = JSON.stringify(mp || { ok: false });
    return mt
      .evaluate()
      .setTitle('Approve Margin Change')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  var idx = HtmlService.createTemplateFromFile('Index');
  idx.appearance = JSON.stringify(getAppearance());
  return idx
    .evaluate()
    .setTitle('Margin Entry Form')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ─────────────── App settings (theme + layout) ───────────────
   One JSON blob in Script Properties holds every persistent, app-wide UI
   setting — display mode, accent scheme, and the layout font size (zoom). It
   survives reloads, applies to every visitor (incl. the pre-login page), and is
   injected into the page so there's no flash. To add a new setting later, just
   add a key here in cleanAppearance_ + read it on the client — nothing else
   changes. Reused as-is if this project is cloned into a new one. */
var APPEARANCE_PROP_ = 'APP_APPEARANCE';
var APPEARANCE_MODES_ = ['dark', 'light', 'system'];

// Normalize/validate a raw settings object into the canonical shape + defaults.
function cleanAppearance_(p) {
  p = p || {};
  var fs = parseInt(p.fontSize, 10);
  return {
    mode: APPEARANCE_MODES_.indexOf(p.mode) > -1 ? p.mode : 'light', // default: Light
    accent: p.accent && String(p.accent).trim() ? String(p.accent).trim() : 'orange', // default: Orange
    fontSize: fs >= 70 && fs <= 130 ? fs : 100, // layout zoom %, default 100
  };
}

function getAppearance() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(APPEARANCE_PROP_);
    return cleanAppearance_(raw ? JSON.parse(raw) : {});
  } catch (e) {
    return cleanAppearance_({});
  }
}

function saveAppearance(pref) {
  try {
    var clean = cleanAppearance_(pref);
    PropertiesService.getScriptProperties().setProperty(APPEARANCE_PROP_, JSON.stringify(clean));
    return { status: 'ok', appearance: clean };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

/* ─────────────── Per-user DataTable preferences ───────────────
   Each user's column widths + hidden columns (per table) persist across logins
   in Script Properties, keyed by user id. Shape:
     { <tableKey>: { widths: { <colKey>: <px> }, hidden: [<colKey>, …] }, … } */
var TABLE_PREF_PREFIX_ = 'TBLPREF::';

function getUserTablePrefs(userId) {
  try {
    var id = String(userId || '').trim().toLowerCase();
    if (!id) return {};
    var raw = PropertiesService.getScriptProperties().getProperty(TABLE_PREF_PREFIX_ + id);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveUserTablePrefs(userId, prefs) {
  try {
    var id = String(userId || '').trim().toLowerCase();
    if (!id) return { status: 'error', message: 'No user.' };
    PropertiesService.getScriptProperties().setProperty(
      TABLE_PREF_PREFIX_ + id,
      JSON.stringify(prefs && typeof prefs === 'object' ? prefs : {})
    );
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Reads tab `name` from a specific Spreadsheet, header row = row 1.
function sheetToObjectsIn_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];
  // Normalize header text: collapse any internal whitespace (including newlines from
  // wrapped cells) into single spaces so that "MATER\nEQUITY\nADD ENTRY" matches
  // the expected key "MATER EQUITY ADD ENTRY".
  var headers = data[0].map(function (h) {
    return String(h).replace(/\s+/g, ' ').trim();
  });
  return data
    .slice(1)
    .filter(function (row) {
      return row.some(function (c) {
        return c !== '';
      });
    })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) {
        obj[h] = row[i];
      });
      return obj;
    });
}
function sheetToObjects_(name) {
  return sheetToObjectsIn_(SpreadsheetApp.getActiveSpreadsheet(), name);
}
// Raw header row (row 1) of a tab, whitespace-normalized. Used when a sheet
// has no data rows yet but we still need column names for an empty table.
// Normalize a raw header row so column INDEXES are never lost:
//  • each cell is trimmed;
//  • an INTERIOR blank header (a spacer column that sits between the first and
//    the last real header — e.g. a blank AX between MARGIN TIMESTAMP and
//    SURRENDER TIMESTAMP) is given a synthetic name blank_1, blank_2, …;
//  • TRAILING blank headers (after the last real one) are dropped.
// Previously blanks were removed with .filter(Boolean), which shifted every
// later column left by one — so on copy/append AY landed in AX, AZ in AY, etc.
function normalizeHeaderRow_(raw) {
  var trimmed = (raw || []).map(function (h) {
    return String(h == null ? '' : h)
      .replace(/\s+/g, ' ')
      .trim();
  });
  var last = -1;
  for (var i = 0; i < trimmed.length; i++) if (trimmed[i] !== '') last = i;
  if (last < 0) return [];
  var out = [],
    blankN = 0;
  for (var j = 0; j <= last; j++) {
    out.push(trimmed[j] !== '' ? trimmed[j] : 'blank_' + ++blankN);
  }
  return out;
}
function readHeaderRow_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return [];
  return normalizeHeaderRow_(sh.getRange(1, 1, 1, lastCol).getValues()[0]);
}

/**
 * LOGIN PAGE layout:
 *   row 1  -> per-column project Sheet URL (aligned under each project column)
 *   row 2  -> header labels (NAME | ID | PASSWORD | EMAIL | ... | IT DETAILED)
 *   row 3+ -> user data
 *
 * NOTE: everything here is resolved by HEADER NAME, never by column position,
 * so inserting/removing columns (e.g. the permission block moving from D.. to
 * G..R) needs no code change — a label just has to keep its spelling.
 * Blank header columns (spacers) are skipped entirely.
 */
var LOGIN_META_CACHE_ = null; // memoized for the lifetime of one server call
function getLoginMeta_() {
  if (LOGIN_META_CACHE_) return LOGIN_META_CACHE_;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEETS.login);
  if (!sh) return { headers: [], urlRow: [], rows: [] };
  var data = sh.getDataRange().getValues();
  if (data.length < 3) return { headers: [], urlRow: [], rows: [] };
  var urlRow = data[0];
  var headers = data[1].map(function (h) {
    return String(h).replace(/\s+/g, ' ').trim();
  });
  var rows = data
    .slice(2)
    .filter(function (row) {
      return row.some(function (c) {
        return c !== '';
      });
    })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) {
        if (h) obj[h] = row[i]; // skip blank/spacer columns
      });
      return obj;
    });
  LOGIN_META_CACHE_ = { headers: headers, urlRow: urlRow, rows: rows };
  return LOGIN_META_CACHE_;
}

// Looks up the project Sheet URL for a LOGIN PAGE column by its header label
// (e.g. 'IT DETAILED'), tolerating case/whitespace differences like pick_.
function getProjectUrl_(label) {
  var meta = getLoginMeta_();
  var target = String(label).replace(/\s+/g, ' ').trim().toUpperCase();
  for (var i = 0; i < meta.headers.length; i++) {
    if (meta.headers[i].toUpperCase() === target) {
      return String(meta.urlRow[i] || '').trim();
    }
  }
  return '';
}

var PROJECT_SHEET_CACHE_ = {};
// Opens a project's Sheet by URL (falls back to the active/bound spreadsheet
// if url is blank, so a project can optionally live in the current sheet).
function openProjectSpreadsheet_(url) {
  if (!url) return SpreadsheetApp.getActiveSpreadsheet();
  if (PROJECT_SHEET_CACHE_[url]) return PROJECT_SHEET_CACHE_[url];
  try {
    var ss = SpreadsheetApp.openByUrl(url);
    PROJECT_SHEET_CACHE_[url] = ss;
    return ss;
  } catch (err) {
    throw new Error('Cannot open project sheet (' + url + '): ' + err.message);
  }
}

function fmtTimestamp_(v) {
  if (v instanceof Date)
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd-MMM-yyyy HH:mm:ss');
  return v === undefined || v === null ? '' : v;
}
function fmtDateOnly_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd-MMM-yyyy');
  return v === undefined || v === null ? '' : v;
}
function fmtValue_(v) {
  return v === undefined || v === null ? '' : v;
}
// Coerce one raw sheet cell to a serialization-safe primitive: Date -> string,
// null/undefined -> '', everything else (string/number/boolean) passes through.
// Used for dynamically-columned data (IT Details) where we can't map fields by
// name, so we must sanitize generically before returning to the client.
function fmtCell_(v) {
  if (v instanceof Date) {
    // Date-only cells (e.g. DATE OF ISSUE) sit at midnight — show just the date;
    // real datetimes (e.g. TIMESTAMP) keep the time.
    var hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
    var fmt = hasTime ? 'dd-MMM-yyyy HH:mm:ss' : 'dd-MMM-yyyy';
    return Utilities.formatDate(v, Session.getScriptTimeZone(), fmt);
  }
  return v === undefined || v === null ? '' : v;
}
function isYes_(v) {
  return (
    String(v || '')
      .trim()
      .toUpperCase() === 'YES'
  );
}

/* ---- Fast single-pass sheet readers ----------------------------------------
   Old path was mapX_(sheetToObjects_(name)): read the grid, build one object per
   row keyed by EVERY header, then iterate again to pick fields. These readers
   do it in ONE pass — read a bounded range once, resolve each needed column to
   an index up front, then build the final typed object directly. No intermediate
   object array, no per-cell header lookup. Big win on large Response sheets. */

// Builds a fast header->index lookup (whitespace-normalized, case-insensitive).
function headerIndexer_(headerRow) {
  var map = {};
  for (var i = 0; i < headerRow.length; i++) {
    map[String(headerRow[i]).replace(/\s+/g, ' ').trim().toUpperCase()] = i;
  }
  return function (names) {
    for (var k = 0; k < names.length; k++) {
      var v = map[names[k].replace(/\s+/g, ' ').trim().toUpperCase()];
      if (v !== undefined) return v;
    }
    return -1;
  };
}
// Reads a tab's used range (bounded by lastRow/lastCol — not getDataRange, which
// can balloon). Returns { header, body } or null when the sheet/tab is empty.
function readGrid_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return null;
  var lastRow = sh.getLastRow(),
    lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return { header: [], body: [] };
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  return { header: values[0], body: values.slice(1) };
}
function rowHasData_(row) {
  for (var c = 0; c < row.length; c++) if (row[c] !== '') return true;
  return false;
}

function readMaster_(ss, name) {
  var g = readGrid_(ss, name);
  if (!g || !g.body.length) return [];
  var ix = headerIndexer_(g.header);
  var cCode = ix(['CODE']),
    cUser = ix(['USER ID']),
    cSw = ix(['SOFTWARE']),
    cName = ix(['NAME']),
    cGrp = ix(['GROUP NAME']),
    cBr = ix(['BRANCH NAME']),
    cTs = ix(['TIMESTAMP']),
    cLog = ix(['LOGIN ID']);
  var at = function (row, i) {
    return i > -1 && row[i] != null ? row[i] : '';
  };
  var out = [];
  for (var r = 0; r < g.body.length; r++) {
    var row = g.body[r];
    if (!rowHasData_(row)) continue;
    out.push({
      code: at(row, cCode) || '',
      userId: at(row, cUser) || '',
      software: at(row, cSw) || '',
      name: at(row, cName) || '',
      group: at(row, cGrp) || '',
      branchName: at(row, cBr) || '',
      timestamp: fmtTimestamp_(at(row, cTs)),
      loginId: at(row, cLog) || '',
    });
  }
  return out;
}
function readResp1_(ss, name) {
  var g = readGrid_(ss, name);
  if (!g || !g.body.length) return [];
  var ix = headerIndexer_(g.header);
  var cTs = ix(['TIMESTAMP']),
    cDate = ix(['SELECT DATE']),
    cCode = ix(['CODE']),
    cUser = ix(['USER ID']),
    cSw = ix(['SOFTWARE']),
    cName = ix(['NAME']),
    cGrp = ix(['GROUP NAME']),
    cRms = ix(['MARGIN AS PER RMS']),
    cAlloc = ix(['MARGIN ALLOCATED ON ID']),
    cBr = ix(['BRANCH NAME']),
    cLog = ix(['LOGIN NAME']);
  var at = function (row, i) {
    return i > -1 && row[i] != null ? row[i] : '';
  };
  var out = [];
  for (var r = 0; r < g.body.length; r++) {
    var row = g.body[r];
    if (!rowHasData_(row)) continue;
    out.push({
      timestamp: fmtTimestamp_(at(row, cTs)),
      date: fmtDateOnly_(at(row, cDate)),
      code: at(row, cCode) || '',
      userId: at(row, cUser) || '',
      software: at(row, cSw) || '',
      name: at(row, cName) || '',
      group: at(row, cGrp) || '',
      marginRMS: fmtValue_(at(row, cRms)),
      marginAllocated: fmtValue_(at(row, cAlloc)),
      branchName: at(row, cBr) || '',
      loginName: at(row, cLog) || '',
    });
  }
  return out;
}
function readResp2_(ss, name) {
  var g = readGrid_(ss, name);
  if (!g || !g.body.length) return [];
  var ix = headerIndexer_(g.header);
  var cTs = ix(['TIMESTAMP']),
    cDate = ix(['SELECT DATE']),
    cGrp = ix(['GROUP NAME']),
    cMar = ix(['GROUP MARGIN']),
    cLog = ix(['LOGIN NAME']);
  var at = function (row, i) {
    return i > -1 && row[i] != null ? row[i] : '';
  };
  var out = [];
  for (var r = 0; r < g.body.length; r++) {
    var row = g.body[r];
    if (!rowHasData_(row)) continue;
    out.push({
      timestamp: fmtTimestamp_(at(row, cTs)),
      date: fmtDateOnly_(at(row, cDate)),
      group: at(row, cGrp) || '',
      margin: fmtValue_(at(row, cMar)),
      loginName: at(row, cLog) || '',
    });
  }
  return out;
}

/* ---- Legacy object-array mappers (kept for any external callers) ---- */
function mapMaster_(rows) {
  return rows.map(function (r) {
    return {
      code: r['CODE'] || '',
      userId: r['USER ID'] || '',
      software: r['SOFTWARE'] || '',
      name: r['NAME'] || '',
      group: r['GROUP NAME'] || '',
      branchName: r['BRANCH NAME'] || '',
      timestamp: fmtTimestamp_(r['TIMESTAMP']),
      loginId: r['LOGIN ID'] || '',
    };
  });
}
function mapResp1_(rows) {
  return rows.map(function (r) {
    return {
      timestamp: fmtTimestamp_(r['TIMESTAMP']),
      date: fmtDateOnly_(r['SELECT DATE']),
      code: r['CODE'] || '',
      userId: r['USER ID'] || '',
      software: r['SOFTWARE'] || '',
      name: r['NAME'] || '',
      group: r['GROUP NAME'] || '',
      marginRMS: fmtValue_(r['MARGIN AS PER RMS']),
      marginAllocated: fmtValue_(r['MARGIN ALLOCATED ON ID']),
      branchName: r['BRANCH NAME'] || '',
      loginName: r['LOGIN NAME'] || '',
    };
  });
}
function mapResp2_(rows) {
  return rows.map(function (r) {
    return {
      timestamp: fmtTimestamp_(r['TIMESTAMP']),
      date: fmtDateOnly_(r['SELECT DATE']),
      group: r['GROUP NAME'] || '',
      margin: fmtValue_(r['GROUP MARGIN']),
      loginName: r['LOGIN NAME'] || '',
    };
  });
}
// Reads a header value tolerating alternate spellings. The comparison is case-insensitive
// and whitespace-normalized so minor differences (extra space, different case) are handled.
function pick_(r, names) {
  // First: try exact match (fastest path)
  for (var i = 0; i < names.length; i++) {
    if (Object.prototype.hasOwnProperty.call(r, names[i])) return r[names[i]];
  }
  // Fallback: case-insensitive + whitespace-normalized fuzzy match against all keys in r
  var keys = Object.keys(r);
  for (var i = 0; i < names.length; i++) {
    var target = names[i].replace(/\s+/g, ' ').trim().toUpperCase();
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].replace(/\s+/g, ' ').trim().toUpperCase() === target) return r[keys[j]];
    }
  }
  return '';
}

function mapUser_(r) {
  return {
    name: r['NAME'] || '',
    id: String(r['ID'] || '').trim(),
    password: String(r['PASSWORD'] || '').trim(),
    email: String(pick_(r, ['EMAIL', 'E-MAIL', 'EMAIL ID']) || '').trim(),
    equityEntry: isYes_(pick_(r, ['EQUITY ENTRY'])),
    commodityEntry: isYes_(pick_(r, ['COMODDITY ENTRY', 'COMMODITY ENTRY'])),
    masterEquity: isYes_(pick_(r, ['MASTER EQUITY'])),
    masterCommodity: isYes_(pick_(r, ['MASTER COMODDITY', 'MASTER COMMODITY'])),
    resp1Equity: isYes_(pick_(r, ['RESPONSES EQUITY'])),
    resp1Commodity: isYes_(pick_(r, ['RESPONSES COMODDITY', 'RESPONSES COMMODITY'])),
    resp2Equity: isYes_(pick_(r, ['RESPONSES 2 EQUITY'])),
    resp2Commodity: isYes_(pick_(r, ['RESPONSES 2 COMODDITY', 'RESPONSES 2 COMMODITY'])),
    masterEquityAdd: isYes_(pick_(r, ['MASTER EQUITY ADD ENTRY', 'MATER EQUITY ADD ENTRY'])),
    masterCommodityAdd: isYes_(
      pick_(r, [
        'MASTER COMODDITY ADD ENTRY',
        'MATER COMODDITY ADD ENTRY',
        'MASTER COMMODITY ADD ENTRY',
        'MATER COMMODITY ADD ENTRY',
      ])
    ),
    report: isYes_(pick_(r, ['REPORT'])),
    itDetails: isYes_(pick_(r, ['IT DETAILED'])),
  };
}

// Re-check one user's permissions (used when switching pages, so a revoked YES takes effect fast)
function getUserPermissions(id) {
  var usersRaw = getLoginMeta_().rows;
  var match = usersRaw.find(function (r) {
    return (
      String(r['ID'] || '')
        .trim()
        .toLowerCase() ===
      String(id || '')
        .trim()
        .toLowerCase()
    );
  });
  if (!match) return null;
  var u = mapUser_(match);
  delete u.password;
  return u;
}

/**
 * Lightweight login-only data: reads only the LOGIN PAGE sheet (fast, <1s).
 * Called on initial page load so the login screen appears instantly while heavy
 * data (Master/Responses) loads later after successful login.
 */
function getLoginData() {
  // Passwords are NEVER sent to the browser — authenticate() checks them
  // server-side against the live sheet.
  return {
    users: getLoginMeta_().rows.map(function (r) {
      var u = mapUser_(r);
      delete u.password;
      return u;
    }),
  };
}

/* ============================= AUTH / ACCOUNT ============================= */

/**
 * Locates a user's actual ROW on LOGIN PAGE (needed to write a new password
 * back). Works off the raw grid — not getLoginMeta_'s filtered rows — so the
 * row number is always the true sheet row. Columns are found by header label.
 * `needle` matches either the ID or the EMAIL column.
 */
function findLoginRecord_(needle) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.login);
  if (!sh) return null;
  var data = sh.getDataRange().getValues();
  if (data.length < 3) return null;
  var headers = data[1].map(function (h) {
    return String(h).replace(/\s+/g, ' ').trim().toUpperCase();
  });
  var idx = function (names) {
    for (var n = 0; n < names.length; n++) {
      var i = headers.indexOf(names[n]);
      if (i > -1) return i;
    }
    return -1;
  };
  var idCol = idx(['ID']);
  var pwCol = idx(['PASSWORD']);
  var emailCol = idx(['EMAIL', 'E-MAIL', 'EMAIL ID']);
  var nameCol = idx(['NAME']);
  if (idCol < 0) return null;

  var target = String(needle || '')
    .trim()
    .toLowerCase();
  if (!target) return null;
  for (var r = 2; r < data.length; r++) {
    var rowId = String(data[r][idCol] || '')
      .trim()
      .toLowerCase();
    var rowEmail =
      emailCol > -1
        ? String(data[r][emailCol] || '')
            .trim()
            .toLowerCase()
        : '';
    if (rowId && (rowId === target || (rowEmail && rowEmail === target))) {
      return {
        sheet: sh,
        rowNum: r + 1, // 1-based sheet row
        pwCol: pwCol + 1, // 1-based, 0 when absent
        name: nameCol > -1 ? String(data[r][nameCol] || '') : '',
        id: String(data[r][idCol] || '').trim(),
        password: pwCol > -1 ? String(data[r][pwCol] || '').trim() : '',
        email: emailCol > -1 ? String(data[r][emailCol] || '').trim() : '',
      };
    }
  }
  return null;
}

// d***@gmail.com — never echo a full address back to an unauthenticated caller.
function maskEmail_(email) {
  var parts = String(email || '').split('@');
  if (parts.length !== 2) return '';
  var u = parts[0];
  var shown = u.substring(0, 1);
  return shown + (u.length > 1 ? '***' : '') + '@' + parts[1];
}

function buildResetEmailHtml_(rec, tempPassword) {
  return (
    '' +
    '<div style="margin:0;padding:24px;background:#faf6f0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">' +
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #ece2d5;border-radius:16px;overflow:hidden;">' +
    '<div style="background:linear-gradient(135deg,#7b4019,#ff7d29);padding:26px 28px;color:#fff4e8;">' +
    '<div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Pageformat System</div>' +
    '<div style="font-size:22px;font-weight:700;margin-top:6px;">Your temporary password</div>' +
    '</div>' +
    '<div style="padding:26px 28px;color:#241a12;">' +
    '<p style="margin:0 0 14px;font-size:15px;">Hi ' +
    escHtml_(rec.name || rec.id) +
    ',</p>' +
    '<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#5a4a3b;">' +
    'We reset the password on your Pageformat System account. Sign in with the temporary password below:</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">' +
    '<tr><td style="padding:9px 12px;background:#fff8ea;border:1px solid #ece2d5;width:150px;color:#5a4a3b;">User ID</td>' +
    '<td style="padding:9px 12px;border:1px solid #ece2d5;font-weight:700;">' +
    escHtml_(rec.id) +
    '</td></tr>' +
    '<tr><td style="padding:9px 12px;background:#fff8ea;border:1px solid #ece2d5;color:#5a4a3b;">Temporary password</td>' +
    '<td style="padding:9px 12px;border:1px solid #ece2d5;font-weight:700;font-size:17px;letter-spacing:.12em;font-family:Consolas,monospace;">' +
    escHtml_(tempPassword) +
    '</td></tr>' +
    '</table>' +
    '<p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#5a4a3b;">' +
    'Your old password no longer works. Please sign in and set a new one from <b>Profile &rsaquo; Change Password</b> right away.</p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#9c8a76;">' +
    'If you did not request this, contact your administrator — your password has been changed.</p>' +
    '</div>' +
    '<div style="padding:14px 28px;background:#fff8ea;border-top:1px solid #ece2d5;font-size:11px;color:#9c8a76;">' +
    'Automated message from Pageformat System — please do not reply.</div>' +
    '</div></div>'
  );
}

// Readable temp password — no easily-confused characters (I/O/0/1).
function genTempPassword_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  for (var i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

/* --- "this password is temporary" flag -------------------------------------
   Kept in Script Properties so the LOGIN PAGE sheet needs no extra column.
   Set when a reset is emailed, cleared the moment the user sets a real one. */
var TEMP_PW_KEY_ = 'TEMP_PW_IDS';
function tempPwSet_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(TEMP_PW_KEY_);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
function saveTempPwSet_(set) {
  PropertiesService.getScriptProperties().setProperty(TEMP_PW_KEY_, JSON.stringify(set));
}
function markTempPassword_(id) {
  var set = tempPwSet_();
  set[
    String(id || '')
      .trim()
      .toLowerCase()
  ] = true;
  saveTempPwSet_(set);
}
function clearTempPassword_(id) {
  var set = tempPwSet_();
  delete set[
    String(id || '')
      .trim()
      .toLowerCase()
  ];
  saveTempPwSet_(set);
}
function isTempPassword_(id) {
  return !!tempPwSet_()[
    String(id || '')
      .trim()
      .toLowerCase()
  ];
}

/**
 * Server-side login. Credentials are checked against the LIVE sheet, so a
 * password changed elsewhere (e.g. a temp password just emailed out) takes
 * effect immediately. Passwords never leave the server.
 */
function authenticate(id, password) {
  try {
    var rec = findLoginRecord_(id);
    var bad = { success: false, message: 'Invalid user ID or password.' };
    if (!rec) return bad;
    if (String(rec.password) !== String(password || '').trim()) return bad;
    var target = String(rec.id).trim().toLowerCase();
    var match = getLoginMeta_().rows.find(function (r) {
      return (
        String(r['ID'] || '')
          .trim()
          .toLowerCase() === target
      );
    });
    if (!match) return bad;
    var u = mapUser_(match);
    delete u.password;
    // Signed in with an emailed temp password -> app forces a change.
    u.mustChangePassword = isTempPassword_(rec.id);
    return { success: true, user: u };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/** Run this once from the Apps Script editor to grant the new mail scope. */
function authorizeScopes() {
  SpreadsheetApp.getActiveSpreadsheet().getName();
  MailApp.getRemainingDailyQuota();
  return 'Authorized.';
}
function escHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Forgot password: look the account up by User ID or email, generate a NEW
 * temporary password, write it to the sheet, and mail it to the address in the
 * EMAIL column. The real password is never emailed. Returns a masked address so
 * the caller can confirm where it went without exposing the full email.
 */
function requestPasswordReset(needle) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var who = String(needle || '').trim();
    if (!who) return { success: false, message: 'Please enter your User ID or email.' };
    var rec = findLoginRecord_(who);
    if (!rec) return { success: false, message: 'No account found for "' + who + '".' };
    if (!rec.email) {
      return {
        success: false,
        message:
          'No email address is set for this account. Please ask your administrator to add one on the LOGIN PAGE sheet.',
      };
    }
    if (rec.pwCol < 1)
      return { success: false, message: 'PASSWORD column not found on LOGIN PAGE.' };

    var temp = genTempPassword_();
    rec.sheet.getRange(rec.rowNum, rec.pwCol).setValue(temp); // old password is replaced
    markTempPassword_(rec.id); // user must set a real one after signing in
    MailApp.sendEmail({
      to: rec.email,
      subject: 'Your Pageformat System temporary password',
      htmlBody: buildResetEmailHtml_(rec, temp),
      name: 'Pageformat System',
    });
    return {
      success: true,
      message:
        'A temporary password was sent to ' +
        maskEmail_(rec.email) +
        '. Your old password no longer works.',
    };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Change password: verifies the current one, then writes the new value back to
 * the PASSWORD column of that user's row on LOGIN PAGE.
 * payload = { id, currentPassword, newPassword }
 */
function changePassword(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!payload || !payload.id) return { success: false, message: 'Not signed in.' };
    var rec = findLoginRecord_(payload.id);
    if (!rec) return { success: false, message: 'Account not found.' };
    if (rec.pwCol < 1)
      return { success: false, message: 'PASSWORD column not found on LOGIN PAGE.' };
    if (String(rec.password) !== String(payload.currentPassword || '').trim()) {
      return { success: false, message: 'Current password is incorrect.' };
    }
    var np = String(payload.newPassword || '').trim();
    if (np.length < 3)
      return { success: false, message: 'New password must be at least 3 characters.' };
    if (np === rec.password)
      return { success: false, message: 'New password must be different from the current one.' };
    rec.sheet.getRange(rec.rowNum, rec.pwCol).setValue(np);
    clearTempPassword_(rec.id); // no longer a temporary password
    return { success: true, message: 'Password changed successfully.' };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    lock.releaseLock();
  }
}

function getBootstrapData(perms) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // perms object tells us which sheets this user actually needs.
  // If no perms passed (e.g. from Refresh), load everything.
  var loadAll = !perms;
  var needMasterEq = loadAll || perms.equityEntry || perms.masterEquity || perms.masterEquityAdd;
  var needMasterComm =
    loadAll || perms.commodityEntry || perms.masterCommodity || perms.masterCommodityAdd;
  var needRespEq = loadAll || perms.resp1Equity || perms.report;
  var needRespComm = loadAll || perms.resp1Commodity || perms.report;
  var needResp2Eq = loadAll || perms.resp2Equity || perms.report;
  var needResp2Comm = loadAll || perms.resp2Commodity || perms.report;
  var needItDetails = loadAll || perms.itDetails;

  // Only sheets the user has YES for are read at all — everything else stays [].
  // Each read is a single bounded pass straight to typed objects (readX_).
  var result = {
    masterEquity: needMasterEq ? readMaster_(ss, SHEETS.masterEquity) : [],
    masterCommodity: needMasterComm ? readMaster_(ss, SHEETS.masterComm) : [],
    respEquity: needRespEq ? readResp1_(ss, SHEETS.respEquity) : [],
    respCommodity: needRespComm ? readResp1_(ss, SHEETS.respComm) : [],
    resp2Equity: needResp2Eq ? readResp2_(ss, SHEETS.resp2Equity) : [],
    resp2Commodity: needResp2Comm ? readResp2_(ss, SHEETS.resp2Comm) : [],
    // Perms only — passwords are never re-sent after login (smaller payload and
    // they're already held client-side from getLoginData).
    users: getLoginMeta_().rows.map(function (r) {
      var u = mapUser_(r);
      delete u.password;
      return u;
    }),
    missingSheets: [],
  };

  // IT Details lives in a separate project Sheet (URL from LOGIN PAGE row 1).
  // Preload it here in the same batch so navigating to the IT Details page is
  // instant. Its own try/catch: a bad/blank project URL must not break the
  // whole bootstrap — the page can still lazy-retry on its own.
  if (needItDetails) {
    try {
      result.itDetails = readItDetails_();
    } catch (err) {
      result.itDetails = { success: false, message: err.message };
    }
  }

  // Missing-tab warning (debug aid). Only worth the extra getSheets() call when
  // something we actually asked for came back empty — otherwise skip it so the
  // happy path stays as fast as possible.
  var suspect =
    (needMasterEq && !result.masterEquity.length) ||
    (needMasterComm && !result.masterCommodity.length) ||
    (needRespEq && !result.respEquity.length) ||
    (needRespComm && !result.respCommodity.length) ||
    (needResp2Eq && !result.resp2Equity.length) ||
    (needResp2Comm && !result.resp2Commodity.length);
  if (suspect) {
    var have = {};
    ss.getSheets().forEach(function (s) {
      have[s.getName().trim().toUpperCase()] = true;
    });
    Object.keys(SHEETS).forEach(function (k) {
      // itResponses/itDatabase/itBranchAddress live in the separate project
      // Sheet (opened by URL), not this bound spreadsheet — skip them.
      if (k === 'itResponses' || k === 'itDatabase' || k === 'itBranchAddress') return;
      if (!have[SHEETS[k].toUpperCase()]) result.missingSheets.push(SHEETS[k]);
    });
  }

  return result;
}

/**
 * Add one new row to a MASTER sheet (Equity or Commodity).
 * payload = { segment:'equity'|'commodity', code, userId, software, name, group, branchName, loginId }
 * Appends CODE|USER ID|SOFTWARE|NAME|GROUP NAME|BRANCH NAME|TIMESTAMP|LOGIN ID.
 * Server-side re-checks the "...ADD ENTRY" permission before writing, so this can't be
 * called by a user who doesn't have the button shown to them.
 */
function addMasterEntry(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!payload) return { status: 'error', message: 'No data received.' };
    var seg = payload.segment === 'commodity' ? 'commodity' : 'equity';

    // Permission check (server-side, cannot be bypassed from the client)
    var perms = getUserPermissions(payload.loginId);
    var allowed = perms && (seg === 'commodity' ? perms.masterCommodityAdd : perms.masterEquityAdd);
    if (!allowed)
      return { status: 'error', message: 'You do not have permission to add master entries.' };

    var code = String(payload.code || '').trim();
    var userId = String(payload.userId || '').trim();
    var software = String(payload.software || '').trim();
    var name = String(payload.name || '').trim();
    var group = String(payload.group || '').trim();
    var branchName = String(payload.branchName || '').trim();
    if (!code || !userId || !software || !name || !group || !branchName) {
      return { status: 'error', message: 'All 6 fields are required.' };
    }

    var sheetName = seg === 'commodity' ? SHEETS.masterComm : SHEETS.masterEquity;
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sh) return { status: 'error', message: 'Sheet not found: ' + sheetName };

    var now = new Date();
    sh.getRange(sh.getLastRow() + 1, 1, 1, 8).setValues([
      [code, userId, software, name, group, branchName, now, payload.loginId || ''],
    ]);

    return {
      status: 'ok',
      segment: seg,
      row: {
        code: code,
        userId: userId,
        software: software,
        name: name,
        group: group,
        branchName: branchName,
        timestamp: fmtTimestamp_(now),
        loginId: payload.loginId || '',
      },
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Save entries for one segment.
 * payload = { segment:'equity'|'commodity', responses1:[...], responses2:[...] }
 */
function saveEntries(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var seg = (payload && payload.segment) === 'commodity' ? 'commodity' : 'equity';
    var s1Name = seg === 'commodity' ? SHEETS.respComm : SHEETS.respEquity;
    var s2Name = seg === 'commodity' ? SHEETS.resp2Comm : SHEETS.resp2Equity;
    var savedA = 0,
      savedB = 0;

    if (payload.responses1 && payload.responses1.length) {
      var sheet1 = ss.getSheetByName(s1Name);
      if (!sheet1) return { status: 'error', message: 'Sheet not found: ' + s1Name };
      var rowsA = payload.responses1.map(function (r) {
        // TIMESTAMP | SELECT DATE | CODE | USER ID | SOFTWARE | NAME | GROUP NAME | MARGIN AS PER RMS | MARGIN ALLOCATED ON ID | BRANCH NAME | LOGIN NAME
        return [
          r.timestamp,
          r.date,
          r.code,
          r.userId,
          r.software,
          r.name,
          r.group,
          r.marginRMS,
          r.marginAllocated,
          r.branchName || '',
          r.loginName || '',
        ];
      });
      sheet1.getRange(sheet1.getLastRow() + 1, 1, rowsA.length, 11).setValues(rowsA);
      savedA = rowsA.length;
    }

    if (payload.responses2 && payload.responses2.length) {
      var sheet2 = ss.getSheetByName(s2Name);
      if (!sheet2) return { status: 'error', message: 'Sheet not found: ' + s2Name };
      var rowsB = payload.responses2.map(function (r) {
        // TIMESTAMP | SELECT DATE | GROUP NAME | GROUP MARGIN | LOGIN NAME
        return [r.timestamp, r.date, r.group, r.margin, r.loginName || ''];
      });
      sheet2.getRange(sheet2.getLastRow() + 1, 1, rowsB.length, 5).setValues(rowsB);
      savedB = rowsB.length;
    }

    return { status: 'ok', savedA: savedA, savedB: savedB, segment: seg };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Dropdown source lists for the IT Details form, read from the DATABASE tab
 * (same spreadsheet as RESPONSES-NEW): A=Group Name, B=Segment, C=Software,
 * D=Exchange codes, E=Strategy, F=Client/Pro codes, H=Exchange (for the IP
 * lookup table), I=Server IP, J=CTCL CM, K=CTCL F&O. Column G is an unused
 * reference column in that sheet, skipped here.
 * ctclLookup replicates the sheet's own formula:
 *   =ArrayFormula(IFERROR(VLOOKUP(<ip>&"<EXCHANGE>",{DATABASE!I:I&DATABASE!H:H,DATABASE!J:K},2/3,0)))
 * i.e. one row per (exchange, ip) pair with its CTCL CM/F&O values.
 */
function readItDatabaseOptions_(ss) {
  var sh = ss.getSheetByName(SHEETS.itDatabase);
  var empty = {
    groupName: [],
    segment: [],
    software: [],
    exchange: [],
    strategy: [],
    clientPro: [],
    serverIp: [],
    ctclLookup: [],
  };
  if (!sh) return empty;
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return empty;
  var data = sh.getRange(2, 1, lastRow - 1, 11).getValues(); // A:K
  function col(i) {
    var seen = {};
    var out = [];
    data.forEach(function (r) {
      var v = String(r[i] || '').trim();
      if (v && !seen[v]) {
        seen[v] = true;
        out.push(v);
      }
    });
    return out.sort();
  }
  var ctclLookup = [];
  data.forEach(function (r) {
    var exchange = String(r[7] || '').trim(); // H
    var ip = String(r[8] || '').trim(); // I
    if (!exchange || !ip) return;
    ctclLookup.push({
      ip: ip,
      exchange: exchange,
      ctclCm: String(r[9] || '').trim(),
      ctclFo: String(r[10] || '').trim(),
    }); // J, K
  });
  return {
    groupName: col(0),
    segment: col(1),
    software: col(2),
    exchange: col(3),
    strategy: col(4),
    clientPro: col(5),
    serverIp: col(8),
    ctclLookup: ctclLookup,
  };
}

/**
 * Branch address lookup (mirrors the sheet's own formulas):
 *   BRANCH SHORT ADDRESS = VLOOKUP($C$6, 'Branch Address Formula'!A:B, 2, 0)
 *   IF YES ADDRESS        = VLOOKUP($C$6, 'Branch Address Formula'!A:C, 3, 0)
 * Both keyed on the same value ($C$6 == GROUP NAME in the new form) —
 * A = key, B = short address, C = full address.
 */
function readBranchAddressFormula_(ss) {
  var sh = ss.getSheetByName(SHEETS.itBranchAddress);
  if (!sh) return [];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var data = sh.getRange(2, 1, lastRow - 1, 3).getValues();
  return data
    .filter(function (r) {
      return String(r[0] || '').trim();
    })
    .map(function (r) {
      return {
        key: String(r[0] || '').trim(),
        shortAddress: String(r[1] || '').trim(),
        fullAddress: String(r[2] || '').trim(),
      };
    });
}

/**
 * IT Details project. Its data lives in whatever Sheet URL is set in the
 * LOGIN PAGE row above the "IT DETAILED" column header — opened generically
 * via openProjectSpreadsheet_ rather than the sheet this script is bound to.
 * Headers are returned explicitly so the client can build table columns
 * without hardcoding field names, even if the tab has 0 data rows.
 */
// Core IT Details fetch, shared by getBootstrapData (batch preload) and
// getItDetailsData (standalone refresh). Returns the same shape either way.
function readItDetails_() {
  var url = getProjectUrl_('IT DETAILED');
  var ss = openProjectSpreadsheet_(url);
  // Single bounded read -> build serialization-safe objects in one pass.
  // Coerce every cell with fmtCell_ (Date -> string, etc.) because
  // google.script.run silently returns null for the WHOLE bootstrap payload if
  // any value can't be serialized.
  var g = readGrid_(ss, SHEETS.itResponses);
  // Normalize (fill interior blank headers with blank_N) so row objects keep
  // every column at its true index — a blank spacer column must not collapse
  // and shift later fields (e.g. surrender AY/AZ) onto the wrong keys.
  var headers =
    g && g.header.length
      ? normalizeHeaderRow_(g.header)
      : readHeaderRow_(ss, SHEETS.itResponses);
  var rows = [];
  if (g && g.body.length) {
    for (var r = 0; r < g.body.length; r++) {
      var row = g.body[r];
      if (!rowHasData_(row)) continue;
      var o = {};
      for (var c = 0; c < headers.length; c++) o[headers[c]] = fmtCell_(row[c]);
      rows.push(o);
    }
  }
  var dbOptions = readItDatabaseOptions_(ss);
  dbOptions.branchAddress = readBranchAddressFormula_(ss);
  return { success: true, headers: headers, data: rows, dbOptions: dbOptions };
}
function getItDetailsData() {
  try {
    return readItDetails_();
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Header aliases the server insists on before saving, tolerating the same
// spelling drift the sheet itself has (e.g. "SHADIW" vs "SHADOW", "SEGEMNT"
// vs "SEGMENT") — mirrors mapUser_'s alt-spelling handling.
var IT_MANDATORY_FIELD_ALIASES_ = [
  ['USER ID'],
  ['USER NAME'],
  ['GROUP NAME'],
  ['USER PAN'],
  ['IS PERSON SITTING ON HIS BRANCH'],
  [
    'IS ID ALLOCATD TO SHADOW USER',
    'IS ID ALLOCATD TO SHADIW USER',
    'IS ID ALLOCATED TO SHADOW USER',
    'IS ID ALLOCATED TO SHADIW USER',
  ],
  ['BRANCH SHORT ADDRESS'],
  ['SEGMENT', 'SEGEMNT'],
  ['SOFTWARE'],
  ['EXCHANGE ALLOWED IN ID'],
  ['STRATEGY'],
  ['EXCEL LICENSE'],
  ['CLIENT/PRO', 'CLIENT PRO'],
  ['SERVER IP'],
  ['DATE OF ISSUE'],
];

// Next UNI-N number for a new IT Details record, based on the highest
// existing "UNI-<n>" value already in the UNIQUE NO. column.
function getNextItUniqueNo_(ss) {
  var rows = sheetToObjectsIn_(ss, SHEETS.itResponses);
  var max = 0;
  rows.forEach(function (r) {
    var v = String(pick_(r, ['UNIQUE NO.', 'UNIQUE NO']) || '').trim();
    var m = v.match(/^UNI-(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'UNI-' + (max + 1);
}

/**
 * Save (add or versioned-edit) one IT Details record.
 * payload = { mode: 'add'|'edit', uniqueNo, fields: { <live header text>: value, ... } }
 * Column order/count is read live from RESPONSES-NEW — nothing is hard-coded
 * to a fixed position, so this survives header reordering/renaming as long
 * as the alias lists above stay in sync with the sheet.
 * Edit mode mirrors the legacy sheet script: the previous ACTIVE row(s) for
 * this Unique No. flip to CANCEL, a new ACTIVE row is appended — full audit
 * trail, nothing overwritten in place.
 */
function saveItDetailsEntry(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!payload || !payload.fields) return { status: 'error', message: 'No data received.' };
    var mode = payload.mode === 'edit' ? 'edit' : 'add';

    var missing = IT_MANDATORY_FIELD_ALIASES_.filter(function (aliases) {
      return !String(pick_(payload.fields, aliases) || '').trim();
    });
    if (missing.length) {
      return {
        status: 'error',
        message:
          'Required fields missing: ' +
          missing
            .map(function (a) {
              return a[0];
            })
            .join(', '),
      };
    }

    var url = getProjectUrl_('IT DETAILED');
    var ss = openProjectSpreadsheet_(url);
    var sh = ss.getSheetByName(SHEETS.itResponses);
    if (!sh) return { status: 'error', message: 'Sheet not found: ' + SHEETS.itResponses };

    var headers = readHeaderRow_(ss, SHEETS.itResponses);
    if (!headers.length) return { status: 'error', message: 'RESPONSES-NEW has no header row.' };

    var idxTimestamp = -1,
      idxStatus = -1,
      idxUniqueNo = -1;
    headers.forEach(function (h, i) {
      var u = h.toUpperCase();
      if (u === 'TIMESTAMP') idxTimestamp = i;
      else if (u === 'STATUS') idxStatus = i;
      else if (u === 'UNIQUE NO.' || u === 'UNIQUE NO') idxUniqueNo = i;
    });

    var uniqueNo = mode === 'add' ? getNextItUniqueNo_(ss) : String(payload.uniqueNo || '').trim();
    if (mode === 'edit' && !uniqueNo)
      return { status: 'error', message: 'Missing Unique No. for edit.' };
    var surrender = mode === 'edit' && String(payload.surrender || '').toUpperCase() === 'YES';
    var now = new Date();

    // Edit: locate the currently-ACTIVE row(s) for this Unique No. (the first is
    // the source row we copy/stamp).
    var all = null,
      srcRow = null,
      activeSheetRows = [];
    if (mode === 'edit' && idxUniqueNo > -1 && idxStatus > -1) {
      all = sh.getDataRange().getValues();
      for (var r = 1; r < all.length; r++) {
        if (
          String(all[r][idxUniqueNo] || '').trim() === uniqueNo &&
          String(all[r][idxStatus] || '').trim().toUpperCase() === 'ACTIVE'
        ) {
          if (!srcRow) srcRow = all[r];
          activeSheetRows.push(r + 1); // 1-based
        }
      }
      if (!srcRow)
        return { status: 'error', message: 'No ACTIVE record found for ' + uniqueNo + '.' };
    }

    // ── SURRENDER: cancel THIS record in place + stamp AY (timestamp) & AZ (YES).
    //    No new version is created. ──
    if (surrender) {
      activeSheetRows.forEach(function (rowNum) {
        sh.getRange(rowNum, idxStatus + 1).setValue('CANCEL');
        sh.getRange(rowNum, IT_SURR_TS_COL_, 1, 2).setValues([[now, 'YES']]);
      });
      // Coerce every cell (Date -> string, etc.) — a raw Date breaks
      // google.script.run serialization, which returns null to the client.
      var srObj = {};
      headers.forEach(function (h, i) {
        srObj[h] = fmtCell_(srcRow[i]);
      });
      srObj[headers[idxStatus]] = 'CANCEL';
      if (headers[IT_SURR_TS_IDX_]) srObj[headers[IT_SURR_TS_IDX_]] = fmtTimestamp_(now);
      if (headers[IT_SURR_STATUS_IDX_]) srObj[headers[IT_SURR_STATUS_IDX_]] = 'YES';
      return { status: 'ok', surrendered: true, uniqueNo: uniqueNo, row: srObj };
    }

    // ── NORMAL SAVE ──
    var newRow;
    if (mode === 'edit') {
      // Copy the ENTIRE existing row (preserves margin/backoffice columns AM..AZ),
      // then overwrite only the IT-detail form fields + timestamp/status/unique.
      newRow = srcRow.slice();
      while (newRow.length < headers.length) newRow.push('');
      headers.forEach(function (h, i) {
        if (Object.prototype.hasOwnProperty.call(payload.fields, h)) newRow[i] = payload.fields[h];
      });
      newRow[idxTimestamp] = now;
      newRow[idxStatus] = 'ACTIVE';
      newRow[idxUniqueNo] = uniqueNo;
      // A fresh version is not surrendered — clear AY/AZ on it.
      if (newRow.length > IT_SURR_TS_IDX_) newRow[IT_SURR_TS_IDX_] = '';
      if (newRow.length > IT_SURR_STATUS_IDX_) newRow[IT_SURR_STATUS_IDX_] = '';
      // Cancel the old ACTIVE row(s).
      activeSheetRows.forEach(function (rowNum) {
        sh.getRange(rowNum, idxStatus + 1).setValue('CANCEL');
      });
    } else {
      // ADD: only the IT-detail form fields (plus timestamp/status/unique no.).
      newRow = headers.map(function (h, i) {
        if (i === idxTimestamp) return now;
        if (i === idxStatus) return 'ACTIVE';
        if (i === idxUniqueNo) return uniqueNo;
        return pick_(payload.fields, [h]) || '';
      });
    }

    // Find the real last DATA row by scanning a key column (UNIQUE NO., which is
    // always populated for a saved record) rather than sh.getLastRow() — that
    // can point past the data if any column has filled-down formulas/formatting,
    // which would append into a gap. reduce -> 1-based row of the last non-empty
    // cell; +1 is where the new row goes.
    var keyCol = (idxUniqueNo > -1 ? idxUniqueNo : 0) + 1; // 1-based; default col A
    var keyVals = sh.getRange(1, keyCol, sh.getMaxRows(), 1).getValues();
    var lastDataRow = keyVals.reduce(function (acc, row, i) {
      return String(row[0]).trim() !== '' ? i + 1 : acc;
    }, 0);
    var appendRow = Math.max(lastDataRow + 1, 2); // never overwrite the header row
    sh.getRange(appendRow, 1, 1, newRow.length).setValues([newRow]);

    // Coerce every cell (a raw Date from the copied source row would otherwise
    // break google.script.run serialization and return null to the client).
    var rowObj = {};
    headers.forEach(function (h, i) {
      rowObj[h] = i === idxTimestamp ? fmtTimestamp_(now) : fmtCell_(newRow[i]);
    });

    return { status: 'ok', row: rowObj };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

/* ---- Backoffice column aliases (resolved by header, never position) ---- */
var BO_TS_ALIASES_ = ['BACKUP OFFICE TIMESTAMP', 'BACK OFFICE TIMESTAMP', 'BACKOFFICE TIMESTAMP'];
var BO_CODE_ALIASES_ = ['BACK OFFICE CODE', 'BACKOFFICE CODE'];
var BO_REMARK_ALIASES_ = ['REMARKS', 'REMARK'];
var BO_NEWCODE_ALIASES_ = ['NEW BACKUP OFFICE CODE', 'NEW BACK OFFICE CODE', 'NEW BACKOFFICE CODE'];
var BO_NEWREMARK_ALIASES_ = ['NEW REMARKS', 'NEW REMARK'];
var BO_APPROVED_ALIASES_ = ['APPROVED'];
var BO_APPRTS_ALIASES_ = ['APPROVED TIMME', 'APPROVED TIME', 'APPROVED TIMESTAMP'];

// ── Fixed column positions (both RESPONSES-NEW and RESPONSES-APPRVOED share
//    the A..AO layout; the approval tab adds AP..AS). Using positions makes the
//    save/approve robust regardless of header text. ──
// RESPONSES-NEW / shared:
var BO_UNIQUE_IDX_ = 2; // col C  = UNIQUE NO. (the unique key)
var BO_UNIQUE_COL_ = 3; // 1-based
var BO_USERID_IDX_ = 3; // col D  = USER ID
var BO_USERNAME_IDX_ = 4; // col E = USER NAME
var BO_AM_COL_ = 39; // AM (1-based) = backup office timestamp
var BO_AM_IDX_ = 38; // AM (0-based)
var BO_AN_IDX_ = 39; // AN = BACK OFFICE CODE (old)
var BO_AO_IDX_ = 40; // AO = REMARKS (old)
// IT Details surrender columns in RESPONSES-NEW: AY=51 timestamp, AZ=52 status.
var IT_SURR_TS_COL_ = 51; // AY (1-based)
var IT_SURR_TS_IDX_ = 50; // AY (0-based)
var IT_SURR_STATUS_COL_ = 52; // AZ (1-based)
var IT_SURR_STATUS_IDX_ = 51; // AZ (0-based)
// RESPONSES-APPRVOED extra columns:
var APPR_AP_IDX_ = 41; // AP = NEW BACKUP OFFICE CODE
var APPR_AQ_IDX_ = 42; // AQ = NEW REMARKS
var APPR_AR_IDX_ = 43; // AR = APPROVED
var APPR_AR_COL_ = 44; // 1-based
var APPR_AS_IDX_ = 44; // AS = APPROVED TIMME
var APPR_AS_COL_ = 45; // 1-based

// header (normalized upper) -> index resolver
function colFinder_(headerRow) {
  var H = headerRow.map(function (h) {
    return String(h).replace(/\s+/g, ' ').trim().toUpperCase();
  });
  return function (names) {
    for (var k = 0; k < names.length; k++) {
      var i = H.indexOf(names[k]);
      if (i > -1) return i;
    }
    return -1;
  };
}

/**
 * Backoffice code entry. Decides one of three actions from the CURRENT state of
 * the ACTIVE RESPONSES-NEW row:
 *   1. AN (code) is BLANK           -> first entry: write timestamp/code/remark
 *                                      into RESPONSES-NEW in place.
 *   2. AN filled, code UNCHANGED    -> only the remark changed: update the
 *                                      remark (and timestamp) in RESPONSES-NEW.
 *   3. AN filled, code CHANGED      -> needs approval: copy the whole row into
 *                                      RESPONSES-APPRVOED with NEW code/remark,
 *                                      and email the approvers a link.
 * payload = { uniqueNo, code, remark, loginId }
 */
function saveBackofficeCode(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!payload || !String(payload.uniqueNo || '').trim())
      return { status: 'error', message: 'No Unique No. selected.' };

    var url = getProjectUrl_('IT DETAILED');
    var ss = openProjectSpreadsheet_(url);
    var sh = ss.getSheetByName(SHEETS.itResponses);
    if (!sh) return { status: 'error', message: 'Sheet not found: ' + SHEETS.itResponses };

    var g = readGrid_(ss, SHEETS.itResponses);
    if (!g || !g.header.length)
      return { status: 'error', message: 'RESPONSES-NEW has no header row.' };
    var col = colFinder_(g.header);
    var idxUnique = col(['UNIQUE NO.', 'UNIQUE NO']);
    var idxStatus = col(['STATUS']);
    if (idxUnique < 0) return { status: 'error', message: 'UNIQUE NO. column not found.' };

    var target = String(payload.uniqueNo).trim();
    var foundRow = -1;
    for (var r = 0; r < g.body.length; r++) {
      var ru = String(g.body[r][idxUnique] || '').trim();
      var rs =
        idxStatus > -1
          ? String(g.body[r][idxStatus] || '')
              .trim()
              .toUpperCase()
          : 'ACTIVE';
      if (ru === target && rs === 'ACTIVE') {
        foundRow = r;
        break;
      }
    }
    if (foundRow < 0)
      return { status: 'error', message: 'No ACTIVE record found for ' + target + '.' };
    var srcRow = g.body[foundRow];
    var sheetRow = foundRow + 2; // +1 header, +1 for 1-based

    var now = new Date();
    var code = String(payload.code || '').trim();
    var remark = String(payload.remark || '').trim();
    // Read the existing code from the FIXED AN column, so a blank/missing AO
    // header can never change how this is detected.
    var existingCode = String(srcRow[BO_AN_IDX_] || '').trim();
    var existingRemark = String(srcRow[BO_AO_IDX_] || '').trim();

    // ── 1 & 2: RESPONSES-NEW in place (first entry, or same code / remark-only) ──
    if (!existingCode || existingCode === code) {
      // Nothing changed (same code AND same remark) -> don't touch the sheet.
      if (existingCode === code && existingRemark === remark) {
        return {
          status: 'nochange',
          uniqueNo: target,
          message: 'Nothing to update — the Back Office Code and Remark are unchanged.',
        };
      }
      // One batched write to AM, AN, AO (timestamp, code, remark) by fixed
      // column number — no dependence on header text existing.
      sh.getRange(sheetRow, BO_AM_COL_, 1, 3).setValues([[now, code, remark]]);
      return {
        status: 'ok',
        mode: !existingCode ? 'new' : 'remark',
        uniqueNo: target,
        timestamp: fmtTimestamp_(now),
        code: code,
        remark: remark,
        // header names at the fixed positions (for optional local sync); blank
        // if that header cell is empty.
        tsHeader: String(g.header[BO_AM_IDX_] || '').trim(),
        codeHeader: String(g.header[BO_AN_IDX_] || '').trim(),
        remarkHeader: String(g.header[BO_AO_IDX_] || '').trim(),
      };
    }

    // ── 3: code CHANGED -> append to RESPONSES-APPRVOED, email for approval ──
    // Guard against duplicates: a still-pending approval row for this Unique No.
    // with the same new code already exists.
    var apprSh = ss.getSheetByName(SHEETS.itApproved);
    if (!apprSh) return { status: 'error', message: 'Sheet not found: ' + SHEETS.itApproved };
    if (findPendingApproval_(apprSh, target, code) > -1) {
      return {
        status: 'duplicate',
        mode: 'approval',
        uniqueNo: target,
        message: 'A change to "' + code + '" for ' + target + ' is already pending approval.',
      };
    }

    var appr = appendApprovalRow_(apprSh, srcRow, code, remark, existingCode, existingRemark, g);
    try {
      sendApprovalEmail_(appr, srcRow, g);
    } catch (mailErr) {
      // The approval row is already written; surface the mail failure but don't
      // roll back the sheet write.
      return { status: 'ok', mode: 'approval', emailWarning: mailErr.message, uniqueNo: target };
    }
    return { status: 'ok', mode: 'approval', uniqueNo: target };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// The true last data row on the approval sheet, by col C (Unique No.).
function apprLastDataRow_(sh) {
  var keyVals = sh.getRange(1, BO_UNIQUE_COL_, sh.getMaxRows(), 1).getValues();
  return keyVals.reduce(function (acc, row, i) {
    return String(row[0]).trim() !== '' ? i + 1 : acc;
  }, 0);
}

// 0-based body index of a still-PENDING approval row (col C == unique AND
// AP == newCode AND AR blank), or -1. Used to block duplicate submissions.
function findPendingApproval_(sh, unique, newCode) {
  var last = apprLastDataRow_(sh);
  if (last < 2) return -1;
  var vals = sh.getRange(2, 1, last - 1, APPR_AS_COL_).getValues();
  var u = String(unique).trim(),
    nc = String(newCode).trim();
  for (var i = 0; i < vals.length; i++) {
    if (
      String(vals[i][BO_UNIQUE_IDX_] || '').trim() === u &&
      String(vals[i][APPR_AP_IDX_] || '').trim() === nc &&
      !String(vals[i][APPR_AR_IDX_] || '').trim()
    ) {
      return i; // 0-based within body
    }
  }
  return -1;
}

/**
 * Append a change to RESPONSES-APPRVOED. A..AO are copied POSITIONALLY from the
 * RESPONSES-NEW row (so AN=old code, AO=old remark come across as-is); then AM
 * gets a fresh submission timestamp, AP/AQ get the NEW code/remark, and AR/AS
 * (approved / approved time) are left blank. Appends below the last data row
 * found via col C (Unique No.). Returns the identity used for the email link.
 */
function appendApprovalRow_(sh, srcRow, newCode, newRemark, oldCode, oldRemark, srcGrid) {
  var stamp = new Date();

  // Positional copy A..AO, then extend to AS.
  var row = srcRow.slice(0, BO_AO_IDX_ + 1);
  while (row.length <= APPR_AS_IDX_) row.push('');
  row[BO_AM_IDX_] = stamp; // AM = fresh submission timestamp
  row[BO_AN_IDX_] = oldCode !== undefined ? oldCode : row[BO_AN_IDX_]; // AN = old code
  row[BO_AO_IDX_] = oldRemark !== undefined ? oldRemark : row[BO_AO_IDX_]; // AO = old remark
  row[APPR_AP_IDX_] = newCode; // AP = new code
  row[APPR_AQ_IDX_] = newRemark; // AQ = new remark
  row[APPR_AR_IDX_] = ''; // AR = approved (pending)
  row[APPR_AS_IDX_] = ''; // AS = approved time

  var appendRow = Math.max(apprLastDataRow_(sh) + 1, 2);
  sh.getRange(appendRow, 1, 1, row.length).setValues([row]);

  var col = srcGrid ? colFinder_(srcGrid.header) : null;
  var uIdx = col ? col(['USER ID']) : -1;
  var nIdx = col ? col(['USER NAME']) : -1;
  return {
    rowNum: appendRow,
    uniqueNo: String(srcRow[BO_UNIQUE_IDX_] || '').trim(),
    userId: String(srcRow[uIdx > -1 ? uIdx : BO_USERID_IDX_] || '').trim(),
    userName: String(srcRow[nIdx > -1 ? nIdx : BO_USERNAME_IDX_] || '').trim(),
    tsStr: fmtTimestamp_(stamp),
    newCode: newCode,
    newRemark: newRemark,
    oldCode: String(oldCode !== undefined ? oldCode : '').trim(),
    oldRemark: String(oldRemark !== undefined ? oldRemark : '').trim(),
  };
}

// token = uniqueNo | oldCode | newCode  (base64 web-safe) — matches the exact
// approval row by col C + AN + AP.
function makeApprovalToken_(appr) {
  var raw = [appr.uniqueNo, appr.oldCode, appr.newCode].join('||');
  return Utilities.base64EncodeWebSafe(raw);
}
function parseApprovalToken_(token) {
  try {
    var raw = Utilities.newBlob(Utilities.base64DecodeWebSafe(token)).getDataAsString();
    var p = raw.split('||');
    return { uniqueNo: p[0] || '', oldCode: p[1] || '', newCode: p[2] || '' };
  } catch (e) {
    return null;
  }
}

// Find the approval row (0-based body index) by col C + AN + AP. Prefers a
// still-pending row; falls back to any match. Returns { r, row } or null.
function findApprovalRow_(vals, id) {
  var u = String(id.uniqueNo).trim(),
    oc = String(id.oldCode).trim(),
    nc = String(id.newCode).trim();
  var any = null;
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    if (
      String(row[BO_UNIQUE_IDX_] || '').trim() === u &&
      String(row[BO_AN_IDX_] || '').trim() === oc &&
      String(row[APPR_AP_IDX_] || '').trim() === nc
    ) {
      if (!String(row[APPR_AR_IDX_] || '').trim()) return { r: i, row: row }; // pending
      if (!any) any = { r: i, row: row };
    }
  }
  return any;
}

function sendApprovalEmail_(appr, srcRow, srcGrid) {
  var to = String(EMAIL_LIST_FOR_APPROVAL || '').trim();
  if (!to) throw new Error('EMAIL_LIST_FOR_APPROVAL is empty.');
  var url = ScriptApp.getService().getUrl();
  var link =
    url + (url.indexOf('?') > -1 ? '&' : '?') + 'page=approve&t=' + makeApprovalToken_(appr);
  var html = buildApprovalEmailHtml_(appr, srcRow, srcGrid, link);
  MailApp.sendEmail({
    to: to,
    subject:
      'Approval needed · Backoffice code change · ' + appr.uniqueNo + ' (' + appr.userId + ')',
    htmlBody: html,
    name: 'Pageformat System',
  });
}

/**
 * Approve one RESPONSES-APPRVOED row (from the emailed link). The row is found
 * by col C (Unique No.) + AN (old code) + AP (new code). Re-approval is blocked
 * with the original approval time. On success: AR = APPROVED, AS = now.
 */
function approveBackofficeCode(token) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var id = parseApprovalToken_(token);
    if (!id || !id.uniqueNo)
      return { status: 'error', message: 'Invalid or expired approval link.' };

    var url = getProjectUrl_('IT DETAILED');
    var ss = openProjectSpreadsheet_(url);
    var sh = ss.getSheetByName(SHEETS.itApproved);
    if (!sh) return { status: 'error', message: 'Sheet not found: ' + SHEETS.itApproved };

    var last = apprLastDataRow_(sh);
    if (last < 2) return { status: 'error', message: 'No approval records found.' };
    var vals = sh.getRange(2, 1, last - 1, APPR_AS_COL_).getValues();

    var hit = findApprovalRow_(vals, id);
    if (!hit) return { status: 'error', message: 'Record not found (it may have been changed).' };

    var already = String(hit.row[APPR_AR_IDX_] || '').trim();
    if (already) {
      return {
        status: 'already',
        message:
          'This data was already approved at ' +
          (fmtTimestamp_(hit.row[APPR_AS_IDX_]) || 'an earlier time') +
          '.',
        uniqueNo: id.uniqueNo,
        newCode: id.newCode,
      };
    }

    var now = new Date();
    var sheetRow = hit.r + 2;
    sh.getRange(sheetRow, APPR_AR_COL_, 1, 2).setValues([['APPROVED', now]]);

    return {
      status: 'ok',
      message: 'Approved.',
      uniqueNo: id.uniqueNo,
      userId: String(hit.row[BO_USERID_IDX_] || '').trim(),
      approvedAt: fmtTimestamp_(now),
      newCode: id.newCode,
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// Data for the standalone approval page (called by Approval.html on load).
function getApprovalDetails(token) {
  try {
    var id = parseApprovalToken_(token);
    if (!id || !id.uniqueNo) return { ok: false, message: 'Invalid approval link.' };
    var url = getProjectUrl_('IT DETAILED');
    var ss = openProjectSpreadsheet_(url);
    var sh = ss.getSheetByName(SHEETS.itApproved);
    if (!sh) return { ok: false, message: 'Sheet not found: ' + SHEETS.itApproved };

    var last = apprLastDataRow_(sh);
    if (last < 2) return { ok: false, message: 'No data.' };
    var vals = sh.getRange(2, 1, last - 1, APPR_AS_COL_).getValues();

    var hit = findApprovalRow_(vals, id);
    if (!hit) return { ok: false, message: 'Record not found.' };
    var row = hit.row;
    var aHeader = readHeaderRow_(ss, SHEETS.itApproved);
    return {
      ok: true,
      uniqueNo: id.uniqueNo,
      userId: String(row[BO_USERID_IDX_] || '').trim(),
      userName: String(row[BO_USERNAME_IDX_] || '').trim(),
      submittedAt: fmtTimestamp_(row[BO_AM_IDX_]),
      oldCode: String(row[BO_AN_IDX_] || '').trim(),
      oldRemark: String(row[BO_AO_IDX_] || '').trim(),
      newCode: String(row[APPR_AP_IDX_] || '').trim(),
      newRemark: String(row[APPR_AQ_IDX_] || '').trim(),
      approved: !!String(row[APPR_AR_IDX_] || '').trim(),
      approvedAt: fmtTimestamp_(row[APPR_AS_IDX_]),
      fields: aHeader.length ? boRecordFields_(aHeader, row) : [],
    };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

// Record fields A.."BSE COMMODITY 12 DIGIT FO" as [{label, value}] pairs.
// Shared by the approval email and the approval web page.
function boRecordFields_(header, row) {
  var norm = function (s) {
    return String(s).replace(/\s+/g, ' ').trim().toUpperCase().replace(/&/g, '');
  };
  var end = header.length;
  for (var i = 0; i < header.length; i++) {
    if (norm(header[i]) === norm('BSE COMMODITY 12 DIGIT FO')) {
      end = i + 1;
      break;
    }
  }
  var out = [];
  for (var j = 0; j < end; j++) {
    var label = String(header[j]).replace(/\s+/g, ' ').trim();
    if (!label || /^blank_\d+$/i.test(label)) continue; // skip spacer columns
    out.push({ label: label, value: fmtCell_(row[j]) });
  }
  return out;
}

// Pretty HTML approval email: record fields (A..BSE COMMODITY 12 DIGIT FO) in a
// compact TWO-column layout, then an old-vs-new table, then the Approve button.
function buildApprovalEmailHtml_(appr, srcRow, srcGrid, link) {
  var pairs = boRecordFields_(srcGrid.header, srcRow);
  var fields = '';
  for (var k = 0; k < pairs.length; k += 2) {
    var a = pairs[k],
      b = pairs[k + 1];
    fields +=
      '<tr><td class="l">' + escHtml_(a.label) + '</td><td class="v">' + escHtml_(a.value) + '</td>' +
      (b
        ? '<td class="l">' + escHtml_(b.label) + '</td><td class="v">' + escHtml_(b.value) + '</td>'
        : '<td class="l"></td><td class="v"></td>') +
      '</tr>';
  }
  var compare =
    '<table class="t"><tbody>' +
    '<tr><td class="l">Submitted at</td><td class="v" colspan="3">' + escHtml_(appr.tsStr) + '</td></tr>' +
    '<tr><td class="l">Old Back Office Code</td><td class="v" colspan="3">' + escHtml_(appr.oldCode) + '</td></tr>' +
    '<tr><td class="l">Old Remark</td><td class="v" colspan="3">' + escHtml_(appr.oldRemark) + '</td></tr>' +
    '<tr class="new"><td class="l">New Back Office Code</td><td class="v" colspan="3">' + escHtml_(appr.newCode) + '</td></tr>' +
    '<tr class="new"><td class="l">New Remark</td><td class="v" colspan="3">' + escHtml_(appr.newRemark) + '</td></tr>' +
    '</tbody></table>';

  // Internal <style> (shared classes) instead of repeated inline styles — Gmail
  // and most clients honour a <style> block in <head>. Compact rows, bold
  // labels, tight line-height.
  var css =
    'body{margin:0;padding:0;background:#faf6f0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;}' +
    '.wrap{padding:16px;}' +
    '.card{max-width:660px;margin:0 auto;background:#fff;border:1px solid #ece2d5;border-radius:14px;overflow:hidden;}' +
    '.head{background:linear-gradient(135deg,#7b4019,#ff7d29);padding:11px 22px;color:#fff4e8;}' +
    '.head .ey{font-size:10px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;}' +
    '.head h1{font-size:17px;font-weight:700;margin:2px 0 0;}' +
    '.body{padding:14px 22px;color:#241a12;}' +
    '.intro{margin:0 0 10px;font-size:12.5px;line-height:1.4;color:#5a4a3b;}' +
    '.sec{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#9c8a76;margin:13px 0 5px;}' +
    'table.t{width:100%;border-collapse:collapse;}' +
    'table.t td{padding:3px 9px;border:1px solid #ece2d5;font-size:11.5px;line-height:1.2;color:#241a12;vertical-align:top;}' +
    'table.t td.l{background:#fff8ea;color:#5a4a3b;font-weight:700;width:20%;}' +
    'table.t td.v{width:30%;}' +
    'table.t tr.new td.l{background:#fff8d6;color:#7a5a10;border-color:#e8cf6a;}' +
    'table.t tr.new td.v{background:#fffdf0;border-color:#e8cf6a;font-weight:700;}' +
    '.cta{text-align:center;margin:20px 0 4px;}' +
    '.btn{display:inline-block;background:#ff7d29;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 30px;border-radius:9px;}' +
    '.foot{padding:9px 22px;background:#fff8ea;border-top:1px solid #ece2d5;font-size:10px;color:#9c8a76;}';

  return (
    '<html><head><meta charset="utf-8"><style>' + css + '</style></head><body><div class="wrap"><div class="card">' +
    '<div class="head"><div class="ey">Pageformat System</div><h1>Backoffice code change — approval needed</h1></div>' +
    '<div class="body">' +
    '<p class="intro">A back office code change was submitted for <b>' + escHtml_(appr.uniqueNo) + '</b> (' + escHtml_(appr.userId) + '). Please review and approve.</p>' +
    '<div class="sec">Record</div><table class="t"><tbody>' + fields + '</tbody></table>' +
    '<div class="sec">Change</div>' + compare +
    '<div class="cta"><a href="' + link + '" class="btn" style="display:inline-block;background:#ff7d29;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 30px;border-radius:9px;">Review &amp; Approve</a></div>' +
    '</div>' +
    '<div class="foot">Automated message from Pageformat System — please do not reply.</div>' +
    '</div></div></body></html>'
  );
}

/* ═════════════════════════════ MARGIN ENTRY START ═════════════════════════════
   Margin Entry module (IT DETAILS section). Mirrors the Backoffice-Code flow but
   works on the margin columns. Three outcomes from an ACTIVE RESPONSES-NEW row:
     1. AP (margin) BLANK  -> first entry: write margin block AP..AW in place;
        INTRADAY is forced NO and not stored.
     2. AP filled + INTRADAY=NO + values changed -> append to RESPONSES-MARGIN-ENTRY
        (A..AW copied, new values AX..BE) and email approvers; on approval BF/BG.
     3. AP filled + INTRADAY=YES -> append to the INTRADAY YES tab. A same-day
        ACTIVE row for that Unique No. is first set to CANCEL; different-day rows
        are kept. No email for the YES path.
   All reads/writes use fixed column positions + batched setValues.            */

// Approvers for margin changes (comma-separated; falls back to the backoffice list).
var MARGIN_EMAIL_LIST_FOR_APPROVAL = '';

// RESPONSES-NEW margin columns — AP=42 (write start) … AW=49 (timestamp).
var MG_AP_COL_ = 42;
var MG_MARGIN_IDX_ = 41; // AP
var MG_SOVEQ_IDX_ = 42; // AQ
var MG_SOVFO_IDX_ = 43; // AR
var MG_PREM_IDX_ = 44; // AS
var MG_MTM_IDX_ = 45; // AT
var MG_SLICE_IDX_ = 46; // AU
var MG_RMS_IDX_ = 47; // AV
var MG_TS_IDX_ = 48; // AW (margin timestamp)

// RESPONSES-MARGIN-ENTRY: A..AW (0..48) copied from RESPONSES-NEW, then:
var MGE_AX_IDX_ = 49; // AX new MARGIN
var MGE_AY_IDX_ = 50; // AY new SOV EQUITY
var MGE_AZ_IDX_ = 51; // AZ new SOV F&O
var MGE_BA_IDX_ = 52; // BA new TOTAL PREM
var MGE_BB_IDX_ = 53; // BB new MTM
var MGE_BC_IDX_ = 54; // BC new SLICE
var MGE_BD_IDX_ = 55; // BD new RMS REMARK
var MGE_BE_IDX_ = 56; // BE new MARGIN TIMESTAMP (fresh submission stamp = row key)
var MGE_BF_IDX_ = 57; // BF APPROVED
var MGE_BF_COL_ = 58;
var MGE_BG_IDX_ = 58; // BG APPROVED TIMESTAMP
var MGE_BG_COL_ = 59;

// INTRADAY YES columns (its own layout, A..S = 19 columns).
var IY_COLS_ = 19;

var MG_FIELD_DEFS_ = [
  { key: 'margin', label: 'Margin (Lakhs)' },
  { key: 'sovEq', label: 'Single Order Value Equity' },
  { key: 'sovFo', label: 'Single Order Value F&O' },
  { key: 'prem', label: 'Total Prem Buy' },
  { key: 'mtm', label: 'MTM' },
  { key: 'slice', label: 'Slice Allowed' },
  { key: 'rms', label: 'RMS Remark' },
];

// Numeric strings -> Number (so margins compute in the sheet); text stays text.
function mgNum_(v) {
  var s = String(v == null ? '' : v).trim();
  if (s === '') return '';
  var t = s.replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : s;
}
// The seven editable margin values, in AP..AV order. Slice Allowed is a YES/NO
// choice; the rest are numeric.
function marginValues_(p) {
  return [
    mgNum_(p.margin),
    mgNum_(p.sovEquity),
    mgNum_(p.sovFno),
    mgNum_(p.totalPrem),
    mgNum_(p.mtm),
    String(p.slice || '').trim().toUpperCase(),
    String(p.rms || '').trim(),
  ];
}
// Current margin values on a RESPONSES-NEW row (as trimmed strings).
function marginFieldObj_(row) {
  return {
    margin: String(row[MG_MARGIN_IDX_] || '').trim(),
    sovEq: String(row[MG_SOVEQ_IDX_] || '').trim(),
    sovFo: String(row[MG_SOVFO_IDX_] || '').trim(),
    prem: String(row[MG_PREM_IDX_] || '').trim(),
    mtm: String(row[MG_MTM_IDX_] || '').trim(),
    slice: String(row[MG_SLICE_IDX_] || '').trim(),
    rms: String(row[MG_RMS_IDX_] || '').trim(),
  };
}
function mgDateKey_(v) {
  var d = v instanceof Date ? v : v ? new Date(v) : null;
  if (!d || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/**
 * Margin entry save. payload = { uniqueNo, intraday, margin, sovEquity, sovFno,
 * totalPrem, mtm, slice, rms, loginId }.
 */
function saveMarginEntry(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!payload || !String(payload.uniqueNo || '').trim())
      return { status: 'error', message: 'No Unique No. selected.' };
    var sliceChoice = String(payload.slice || '').trim().toUpperCase();
    if (sliceChoice !== 'YES' && sliceChoice !== 'NO')
      return { status: 'error', message: 'Slice Allowed must be Yes or No.' };

    var url = getProjectUrl_('IT DETAILED');
    var ss = openProjectSpreadsheet_(url);
    var sh = ss.getSheetByName(SHEETS.itResponses);
    if (!sh) return { status: 'error', message: 'Sheet not found: ' + SHEETS.itResponses };
    var g = readGrid_(ss, SHEETS.itResponses);
    if (!g || !g.header.length)
      return { status: 'error', message: 'RESPONSES-NEW has no header row.' };

    var col = colFinder_(g.header);
    var idxUnique = col(['UNIQUE NO.', 'UNIQUE NO']);
    var idxStatus = col(['STATUS']);
    if (idxUnique < 0) return { status: 'error', message: 'UNIQUE NO. column not found.' };

    var target = String(payload.uniqueNo).trim();
    var foundRow = -1;
    for (var r = 0; r < g.body.length; r++) {
      var ru = String(g.body[r][idxUnique] || '').trim();
      var rs = idxStatus > -1 ? String(g.body[r][idxStatus] || '').trim().toUpperCase() : 'ACTIVE';
      if (ru === target && rs === 'ACTIVE') {
        foundRow = r;
        break;
      }
    }
    if (foundRow < 0)
      return { status: 'error', message: 'No ACTIVE record found for ' + target + '.' };
    var srcRow = g.body[foundRow];
    var sheetRow = foundRow + 2;

    if (!String(srcRow[BO_AN_IDX_] || '').trim())
      return { status: 'error', message: 'Add the Back Office Code first before a margin entry.' };

    var now = new Date();
    var vals = marginValues_(payload);
    var existingMargin = String(srcRow[MG_MARGIN_IDX_] || '').trim();
    var intraday = String(payload.intraday || 'NO').trim().toUpperCase();

    // ── Mode 1: first entry (AP blank) -> RESPONSES-NEW AP..AW in place ──
    if (!existingMargin) {
      sh.getRange(sheetRow, MG_AP_COL_, 1, 8).setValues([vals.concat([now])]);
      return {
        status: 'ok',
        mode: 'new',
        uniqueNo: target,
        timestamp: fmtTimestamp_(now),
        values: vals,
      };
    }

    // ── Mode 3: INTRADAY YES -> INTRADAY YES tab (cancel same-day active) ──
    if (intraday === 'YES') return saveIntradayYes_(ss, g, srcRow, vals, now);

    // ── Mode 2: INTRADAY NO -> RESPONSES-MARGIN-ENTRY (approval) ──
    var oldObj = marginFieldObj_(srcRow);
    var unchanged =
      oldObj.margin === String(vals[0]).trim() &&
      oldObj.sovEq === String(vals[1]).trim() &&
      oldObj.sovFo === String(vals[2]).trim() &&
      oldObj.prem === String(vals[3]).trim() &&
      oldObj.mtm === String(vals[4]).trim() &&
      oldObj.slice === String(vals[5]).trim() &&
      oldObj.rms === String(vals[6]).trim();
    if (unchanged)
      return {
        status: 'nochange',
        uniqueNo: target,
        message: 'This record is already saved in RESPONSES-NEW with these exact values — nothing to update.',
      };

    var mgSh = ss.getSheetByName(SHEETS.marginEntry);
    if (!mgSh) return { status: 'error', message: 'Sheet not found: ' + SHEETS.marginEntry };
    if (findPendingMarginApproval_(mgSh, target, vals[0]) > -1) {
      return {
        status: 'duplicate',
        mode: 'approval',
        uniqueNo: target,
        message: 'This margin change for ' + target + ' is already in RESPONSES-MARGIN-ENTRY pending approval.',
      };
    }
    var appr = appendMarginApprovalRow_(mgSh, srcRow, vals, now, g);
    try {
      sendMarginApprovalEmail_(appr, srcRow, g);
    } catch (mailErr) {
      return { status: 'ok', mode: 'approval', emailWarning: mailErr.message, uniqueNo: target };
    }
    return { status: 'ok', mode: 'approval', uniqueNo: target };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// INTRADAY YES: cancel a same-day ACTIVE row for this Unique No., then append the
// new ACTIVE row. Different-day rows are left intact.
function saveIntradayYes_(ss, srcGrid, srcRow, vals, now) {
  var sh = ss.getSheetByName(SHEETS.intradayYes);
  if (!sh) return { status: 'error', message: 'Sheet not found: ' + SHEETS.intradayYes };
  var col = colFinder_(srcGrid.header);
  var pick = function (aliases, fb) {
    var i = col(aliases);
    return String(srcRow[i > -1 ? i : fb] || '').trim();
  };
  // Identity + margin columns use FIXED subarray indices; only the few context
  // fields whose position isn't fixed fall back to a header lookup.
  var uniqueNo = String(srcRow[BO_UNIQUE_IDX_] || '').trim();
  var newRow = [
    now,
    'ACTIVE',
    uniqueNo,
    String(srcRow[BO_USERID_IDX_] || '').trim(), // D = USER ID
    'YES',
    String(srcRow[BO_USERNAME_IDX_] || '').trim(), // E = USER NAME
    String(srcRow[BO_AN_IDX_] || '').trim(), // AN = back office code
    pick(['GROUP NAME'], -1),
    pick(['SEGMENT', 'SEGEMNT'], -1),
    pick(['SOFTWARE'], -1),
    pick(['CLIENT/PRO', 'CLIENT PRO', 'CLIENTPRO'], -1),
    pick(['EXCHANGE ALLOWED IN ID', 'EXCHANGE'], -1),
    vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6],
  ];

  // Same-day ACTIVE rows for this Unique No.: if one is IDENTICAL (same margin
  // values) we skip entirely; otherwise those rows are cancelled and the new one
  // is added. Different-day rows are always kept.
  var last = iyLastDataRow_(sh);
  var toCancel = [];
  if (last >= 2) {
    var data = sh.getRange(2, 1, last - 1, IY_COLS_).getValues();
    var todayKey = mgDateKey_(now);
    for (var i = 0; i < data.length; i++) {
      if (
        String(data[i][2] || '').trim() === uniqueNo &&
        String(data[i][1] || '').trim().toUpperCase() === 'ACTIVE' &&
        mgDateKey_(data[i][0]) === todayKey
      ) {
        if (iySameValues_(data[i], newRow)) {
          return {
            status: 'nochange',
            mode: 'intraday',
            uniqueNo: uniqueNo,
            message: 'This intraday record for ' + uniqueNo + ' (same values) is already present in INTRADAY YES for today.',
          };
        }
        toCancel.push(i + 2);
      }
    }
  }
  toCancel.forEach(function (rowNum) {
    sh.getRange(rowNum, 2).setValue('CANCEL'); // col B = STATUS
  });
  var appendRow = Math.max(iyLastDataRow_(sh) + 1, 2);
  sh.getRange(appendRow, 1, 1, newRow.length).setValues([newRow]);

  // Notify approvers: the first-ever intraday row for this Unique No. is a "new
  // entry"; later ones show a first / previous / latest comparison of the margin
  // form values. A mail failure never blocks the save — it's returned as a warning.
  var emailWarning = '';
  try {
    sendIntradayEmail_(sh, {
      uniqueNo: uniqueNo,
      userId: String(srcRow[BO_USERID_IDX_] || '').trim(),
      userName: String(srcRow[BO_USERNAME_IDX_] || '').trim(),
    });
  } catch (mailErr) {
    emailWarning = mailErr.message;
  }
  return {
    status: 'ok',
    mode: 'intraday',
    uniqueNo: uniqueNo,
    cancelled: toCancel.length,
    emailWarning: emailWarning || undefined,
  };
}

// ── INTRADAY YES notification email ──────────────────────────────────────
function mgStr_(v) {
  return String(v == null ? '' : v).trim();
}
// Margin form values from an INTRADAY YES row (cols M..S = indices 12..18).
function iyValuesObj_(row) {
  return {
    margin: mgStr_(row[12]),
    sovEq: mgStr_(row[13]),
    sovFo: mgStr_(row[14]),
    prem: mgStr_(row[15]),
    mtm: mgStr_(row[16]),
    slice: mgStr_(row[17]),
    rms: mgStr_(row[18]),
  };
}
function iyRowTime_(v) {
  var d = v instanceof Date ? v : v ? new Date(v) : null;
  return d && !isNaN(d.getTime()) ? d.getTime() : 0;
}
// Every INTRADAY YES row for a Unique No., oldest -> newest (by timestamp, col A).
function intradayRowsFor_(sh, uniqueNo) {
  var last = iyLastDataRow_(sh);
  if (last < 2) return [];
  var data = sh.getRange(2, 1, last - 1, IY_COLS_).getValues();
  var out = [];
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][2] || '').trim() === uniqueNo) out.push(data[i]);
  }
  out.sort(function (a, b) {
    return iyRowTime_(a[0]) - iyRowTime_(b[0]);
  });
  return out;
}
function sendIntradayEmail_(sh, identity) {
  var to = String(MARGIN_EMAIL_LIST_FOR_APPROVAL || EMAIL_LIST_FOR_APPROVAL || '').trim();
  if (!to) throw new Error('No approval email address configured.');
  var rows = intradayRowsFor_(sh, identity.uniqueNo);
  if (!rows.length) return;
  var latest = rows[rows.length - 1];
  var isFirst = rows.length === 1;

  // First-ever -> a single "New entry" column; 2 rows -> First + Latest;
  // 3+ rows -> First, Previous (2nd last) and Latest.
  var cols = [];
  if (isFirst) {
    cols.push({ label: 'New entry', ts: fmtTimestamp_(latest[0]), v: iyValuesObj_(latest) });
  } else {
    cols.push({ label: 'First', ts: fmtTimestamp_(rows[0][0]), v: iyValuesObj_(rows[0]) });
    if (rows.length >= 3) {
      var prev = rows[rows.length - 2];
      cols.push({ label: 'Previous', ts: fmtTimestamp_(prev[0]), v: iyValuesObj_(prev) });
    }
    cols.push({ label: 'Latest', ts: fmtTimestamp_(latest[0]), v: iyValuesObj_(latest) });
  }

  MailApp.sendEmail({
    to: to,
    subject: 'Intraday margin ' + (isFirst ? 'entry' : 'update') + ' · ' + identity.uniqueNo + ' (' + identity.userId + ')',
    htmlBody: buildIntradayEmailHtml_(identity, cols, isFirst),
    name: 'Pageformat System',
  });
}
// Self-contained HTML body (no approve button — intraday is informational only).
function buildIntradayEmailHtml_(identity, cols, isFirst) {
  var headCells = cols
    .map(function (c) {
      return '<th>' + escHtml_(c.label) + '<div class="ts">' + escHtml_(c.ts) + '</div></th>';
    })
    .join('');
  var bodyRows = MG_FIELD_DEFS_.map(function (f) {
    var cells = cols
      .map(function (c, ci) {
        var isLast = cols.length > 1 && ci === cols.length - 1;
        var changed = isLast && mgStr_(cols[ci - 1].v[f.key]) !== mgStr_(c.v[f.key]);
        return (
          '<td class="v' + (isLast ? ' nv' : '') + (changed ? ' chg' : '') + '">' +
          (escHtml_(c.v[f.key]) || '—') +
          '</td>'
        );
      })
      .join('');
    return '<tr><td class="l">' + escHtml_(f.label) + '</td>' + cells + '</tr>';
  }).join('');
  var who = escHtml_(identity.uniqueNo) + ' (' + escHtml_(identity.userId) + ')';
  var intro = isFirst
    ? 'A new intraday margin entry was added for <b>' + who + '</b>.'
    : 'An intraday margin entry was updated for <b>' +
      who +
      '</b>. The first, previous and latest values are shown below.';
  return [
    '<html><head><meta charset="utf-8"><style>',
    'body{margin:0;padding:0;background:#faf6f0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;}',
    '.wrap{padding:16px;}.card{max-width:640px;margin:0 auto;background:#fff;border:1px solid #ece2d5;border-radius:14px;overflow:hidden;}',
    '.head{background:linear-gradient(135deg,#7b4019,#ff7d29);padding:11px 22px;color:#fff4e8;}',
    '.head .ey{font-size:10px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;}',
    '.head h1{font-size:17px;font-weight:700;margin:2px 0 0;}',
    '.body{padding:14px 22px;color:#241a12;}.intro{margin:0 0 12px;font-size:12.5px;line-height:1.45;color:#5a4a3b;}',
    'table{width:100%;border-collapse:collapse;}',
    'td,th{padding:4px 9px;border:1px solid #ece2d5;font-size:11.5px;line-height:1.2;color:#241a12;vertical-align:top;text-align:left;}',
    'th{background:#fbefe0;color:#7a5a10;font-weight:700;text-transform:uppercase;font-size:10px;}',
    'th .ts{font-weight:400;font-size:9px;opacity:.75;text-transform:none;margin-top:1px;}',
    'td.l{background:#fff8ea;color:#5a4a3b;font-weight:700;width:26%;}td.nv{font-weight:700;}',
    'td.chg{background:#fff8d6;color:#7a5a10;border-color:#e8cf6a;}',
    '.foot{padding:9px 22px;background:#fff8ea;border-top:1px solid #ece2d5;font-size:10px;color:#9c8a76;}',
    '</style></head><body><div class="wrap"><div class="card">',
    '<div class="head"><div class="ey">Pageformat System</div><h1>Intraday margin ',
    isFirst ? 'entry' : 'update',
    '</h1></div>',
    '<div class="body"><p class="intro">',
    intro,
    '</p><table><thead><tr><th>Field</th>',
    headCells,
    '</tr></thead><tbody>',
    bodyRows,
    '</tbody></table></div>',
    '<div class="foot">Automated notification from Pageformat System — please do not reply.</div>',
    '</div></div></body></html>',
  ].join('');
}

// Two INTRADAY YES rows are "the same record" when their margin values (cols
// M..S = indices 12..18) match.
function iySameValues_(a, b) {
  for (var i = 12; i <= 18; i++) {
    if (String(a[i] == null ? '' : a[i]).trim() !== String(b[i] == null ? '' : b[i]).trim()) {
      return false;
    }
  }
  return true;
}

function iyLastDataRow_(sh) {
  var keyVals = sh.getRange(1, 3, sh.getMaxRows(), 1).getValues(); // col C = UNIQUE ID
  return keyVals.reduce(function (acc, row, i) {
    return String(row[0]).trim() !== '' ? i + 1 : acc;
  }, 0);
}
function mgeLastDataRow_(sh) {
  var keyVals = sh.getRange(1, BO_UNIQUE_COL_, sh.getMaxRows(), 1).getValues();
  return keyVals.reduce(function (acc, row, i) {
    return String(row[0]).trim() !== '' ? i + 1 : acc;
  }, 0);
}

// 0-based body index of a still-PENDING margin approval (col C == unique AND
// AX == newMargin AND BF blank), else -1.
function findPendingMarginApproval_(sh, unique, newMargin) {
  var last = mgeLastDataRow_(sh);
  if (last < 2) return -1;
  var vals = sh.getRange(2, 1, last - 1, MGE_BG_COL_).getValues();
  var u = String(unique).trim(),
    nm = String(newMargin).trim();
  for (var i = 0; i < vals.length; i++) {
    if (
      String(vals[i][BO_UNIQUE_IDX_] || '').trim() === u &&
      String(vals[i][MGE_AX_IDX_] || '').trim() === nm &&
      !String(vals[i][MGE_BF_IDX_] || '').trim()
    ) {
      return i;
    }
  }
  return -1;
}

// Append a margin change to RESPONSES-MARGIN-ENTRY. A..AW copied positionally
// (old margin stays in AP..AW), new values in AX..BD, BE = fresh submission
// timestamp (row key), BF/BG blank. Returns identity for the email link.
function appendMarginApprovalRow_(sh, srcRow, newVals, stampArg, srcGrid) {
  var stamp = stampArg || new Date();
  var row = srcRow.slice(0, MG_TS_IDX_ + 1); // A..AW
  while (row.length <= MGE_BG_IDX_) row.push('');
  row[MGE_AX_IDX_] = newVals[0];
  row[MGE_AY_IDX_] = newVals[1];
  row[MGE_AZ_IDX_] = newVals[2];
  row[MGE_BA_IDX_] = newVals[3];
  row[MGE_BB_IDX_] = newVals[4];
  row[MGE_BC_IDX_] = newVals[5];
  row[MGE_BD_IDX_] = newVals[6];
  row[MGE_BE_IDX_] = stamp;
  row[MGE_BF_IDX_] = '';
  row[MGE_BG_IDX_] = '';

  var appendRow = Math.max(mgeLastDataRow_(sh) + 1, 2);
  sh.getRange(appendRow, 1, 1, row.length).setValues([row]);

  var col = srcGrid ? colFinder_(srcGrid.header) : null;
  var uIdx = col ? col(['USER ID']) : -1,
    nIdx = col ? col(['USER NAME']) : -1;
  return {
    rowNum: appendRow,
    uniqueNo: String(srcRow[BO_UNIQUE_IDX_] || '').trim(),
    userId: String(srcRow[uIdx > -1 ? uIdx : BO_USERID_IDX_] || '').trim(),
    userName: String(srcRow[nIdx > -1 ? nIdx : BO_USERNAME_IDX_] || '').trim(),
    tsStr: fmtTimestamp_(stamp),
    oldMargin: String(srcRow[MG_MARGIN_IDX_] || '').trim(),
    newMargin: String(newVals[0]).trim(),
    old: marginFieldObj_(srcRow),
    neu: {
      margin: String(newVals[0]).trim(),
      sovEq: String(newVals[1]).trim(),
      sovFo: String(newVals[2]).trim(),
      prem: String(newVals[3]).trim(),
      mtm: String(newVals[4]).trim(),
      slice: String(newVals[5]).trim(),
      rms: String(newVals[6]).trim(),
    },
  };
}

// token = uniqueNo | oldMargin | newMargin  (matches col C + AP + AX)
function makeMarginToken_(appr) {
  return Utilities.base64EncodeWebSafe([appr.uniqueNo, appr.oldMargin, appr.newMargin].join('||'));
}
function parseMarginToken_(token) {
  try {
    var p = Utilities.newBlob(Utilities.base64DecodeWebSafe(token)).getDataAsString().split('||');
    return { uniqueNo: p[0] || '', oldMargin: p[1] || '', newMargin: p[2] || '' };
  } catch (e) {
    return null;
  }
}
// Find the margin approval row by col C + AP(old) + AX(new). Prefers pending.
function findMarginRow_(vals, id) {
  var u = String(id.uniqueNo).trim(),
    om = String(id.oldMargin).trim(),
    nm = String(id.newMargin).trim();
  var any = null;
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    if (
      String(row[BO_UNIQUE_IDX_] || '').trim() === u &&
      String(row[MG_MARGIN_IDX_] || '').trim() === om &&
      String(row[MGE_AX_IDX_] || '').trim() === nm
    ) {
      if (!String(row[MGE_BF_IDX_] || '').trim()) return { r: i, row: row };
      if (!any) any = { r: i, row: row };
    }
  }
  return any;
}

function sendMarginApprovalEmail_(appr, srcRow, srcGrid) {
  var to = String(MARGIN_EMAIL_LIST_FOR_APPROVAL || EMAIL_LIST_FOR_APPROVAL || '').trim();
  if (!to) throw new Error('No approval email address configured.');
  var url = ScriptApp.getService().getUrl();
  var link = url + (url.indexOf('?') > -1 ? '&' : '?') + 'page=approve-margin&t=' + makeMarginToken_(appr);

  var pairs = boRecordFields_(srcGrid.header, srcRow);
  var t = HtmlService.createTemplateFromFile('MarginApprovalEmail');
  t.uniqueNo = appr.uniqueNo;
  t.userId = appr.userId;
  t.fieldsHtml = marginRecordFieldsHtml_(pairs);
  t.compareHtml = marginCompareHtml_(appr);
  t.link = link;
  MailApp.sendEmail({
    to: to,
    subject: 'Approval needed · Margin change · ' + appr.uniqueNo + ' (' + appr.userId + ')',
    htmlBody: t.evaluate().getContent(),
    name: 'Pageformat System',
  });
}

// Record fields as a 2-column (4-cell) table body — reused by email + page.
function marginRecordFieldsHtml_(pairs) {
  var out = '';
  for (var k = 0; k < pairs.length; k += 2) {
    var a = pairs[k],
      b = pairs[k + 1];
    out +=
      '<tr><td class="l">' + escHtml_(a.label) + '</td><td class="v">' + escHtml_(a.value) + '</td>' +
      (b
        ? '<td class="l">' + escHtml_(b.label) + '</td><td class="v">' + escHtml_(b.value) + '</td>'
        : '<td class="l"></td><td class="v"></td>') +
      '</tr>';
  }
  return out;
}
// Old-vs-new margin values table body.
function marginCompareHtml_(appr) {
  return MG_FIELD_DEFS_.map(function (f) {
    var oldV = appr.old ? appr.old[f.key] : '';
    var newV = appr.neu ? appr.neu[f.key] : '';
    var changed = String(oldV).trim() !== String(newV).trim();
    return (
      '<tr class="' + (changed ? 'chg' : '') + '"><td class="l">' + escHtml_(f.label) + '</td>' +
      '<td class="v">' + (escHtml_(oldV) || '—') + '</td>' +
      '<td class="v nv">' + (escHtml_(newV) || '—') + '</td></tr>'
    );
  }).join('');
}

/**
 * Record a decision on one RESPONSES-MARGIN-ENTRY row from the emailed link.
 * decision = 'APPROVED' (default) or 'NOT APPROVED'. Both stamp BF (verdict) and
 * BG (timestamp). A row can only be decided once.
 */
function approveMarginEntry(token, decision) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var verdict = String(decision || '').trim().toUpperCase() === 'NOT APPROVED' ? 'NOT APPROVED' : 'APPROVED';
    var id = parseMarginToken_(token);
    if (!id || !id.uniqueNo)
      return { status: 'error', message: 'Invalid or expired approval link.' };
    var url = getProjectUrl_('IT DETAILED');
    var ss = openProjectSpreadsheet_(url);
    var sh = ss.getSheetByName(SHEETS.marginEntry);
    if (!sh) return { status: 'error', message: 'Sheet not found: ' + SHEETS.marginEntry };
    var last = mgeLastDataRow_(sh);
    if (last < 2) return { status: 'error', message: 'No margin records found.' };
    var vals = sh.getRange(2, 1, last - 1, MGE_BG_COL_).getValues();
    var hit = findMarginRow_(vals, id);
    if (!hit) return { status: 'error', message: 'Record not found (it may have been changed).' };
    var already = String(hit.row[MGE_BF_IDX_] || '').trim();
    if (already) {
      return {
        status: 'already',
        decision: already.toUpperCase(),
        message: 'This request was already marked ' + already.toUpperCase() + ' at ' + (fmtTimestamp_(hit.row[MGE_BG_IDX_]) || 'an earlier time') + '.',
        uniqueNo: id.uniqueNo,
        newMargin: id.newMargin,
      };
    }
    var now = new Date();
    sh.getRange(hit.r + 2, MGE_BF_COL_, 1, 2).setValues([[verdict, now]]);
    return {
      status: 'ok',
      decision: verdict,
      message: verdict === 'APPROVED' ? 'Approved.' : 'Marked not approved.',
      uniqueNo: id.uniqueNo,
      userId: String(hit.row[BO_USERID_IDX_] || '').trim(),
      approvedAt: fmtTimestamp_(now),
      newMargin: id.newMargin,
    };
  } catch (err) {
    return { status: 'error', message: err.message };
  } finally {
    lock.releaseLock();
  }
}

// Data for the standalone margin approval page.
function getMarginApprovalDetails(token) {
  try {
    var id = parseMarginToken_(token);
    if (!id || !id.uniqueNo) return { ok: false, message: 'Invalid approval link.' };
    var url = getProjectUrl_('IT DETAILED');
    var ss = openProjectSpreadsheet_(url);
    var sh = ss.getSheetByName(SHEETS.marginEntry);
    if (!sh) return { ok: false, message: 'Sheet not found: ' + SHEETS.marginEntry };
    var last = mgeLastDataRow_(sh);
    if (last < 2) return { ok: false, message: 'No data.' };
    var vals = sh.getRange(2, 1, last - 1, MGE_BG_COL_).getValues();
    var hit = findMarginRow_(vals, id);
    if (!hit) return { ok: false, message: 'Record not found.' };
    var row = hit.row;
    var aHeader = readHeaderRow_(ss, SHEETS.marginEntry);
    var fields = aHeader.length ? boRecordFields_(aHeader, row) : [];
    var mkOld = {
      margin: String(row[MG_MARGIN_IDX_] || '').trim(),
      sovEq: String(row[MG_SOVEQ_IDX_] || '').trim(),
      sovFo: String(row[MG_SOVFO_IDX_] || '').trim(),
      prem: String(row[MG_PREM_IDX_] || '').trim(),
      mtm: String(row[MG_MTM_IDX_] || '').trim(),
      slice: String(row[MG_SLICE_IDX_] || '').trim(),
      rms: String(row[MG_RMS_IDX_] || '').trim(),
    };
    var mkNew = {
      margin: String(row[MGE_AX_IDX_] || '').trim(),
      sovEq: String(row[MGE_AY_IDX_] || '').trim(),
      sovFo: String(row[MGE_AZ_IDX_] || '').trim(),
      prem: String(row[MGE_BA_IDX_] || '').trim(),
      mtm: String(row[MGE_BB_IDX_] || '').trim(),
      slice: String(row[MGE_BC_IDX_] || '').trim(),
      rms: String(row[MGE_BD_IDX_] || '').trim(),
    };
    return {
      ok: true,
      uniqueNo: id.uniqueNo,
      userId: String(row[BO_USERID_IDX_] || '').trim(),
      userName: String(row[BO_USERNAME_IDX_] || '').trim(),
      submittedAt: fmtTimestamp_(row[MGE_BE_IDX_]),
      compareHtml: marginCompareHtml_({ old: mkOld, neu: mkNew }),
      recordHtml: marginRecordFieldsHtml_(fields),
      decided: !!String(row[MGE_BF_IDX_] || '').trim(),
      decision: String(row[MGE_BF_IDX_] || '').trim().toUpperCase(),
      approvedAt: fmtTimestamp_(row[MGE_BG_IDX_]),
    };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
/* ═════════════════════════════ MARGIN ENTRY END ═════════════════════════════ */
