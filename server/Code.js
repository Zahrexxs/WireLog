/**
 * Daily Task Logger — Google Apps Script Backend (V8)
 * Exposes web endpoints for google.script.run and HtmlService
 */

/* global HtmlService, SpreadsheetApp, LockService, CacheService, PropertiesService */
/* global TimeUtils, ColumnMapper, Validation, SheetOperations */

/**
 * Web app entry point — serves the single-page mobile-first interface
 */
function doGet(e) {
  var output = HtmlService.createHtmlOutputFromFile('client/index');
  return output
    .setTitle('Daily Task Logger')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Inlines partial files into Apps Script HTML templates
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Resolves active sheet or test copy via Script Properties
 */
function getTargetSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('TARGET_SHEET_ID');
  if (sheetId && sheetId.trim().length > 0) {
    return SpreadsheetApp.openById(sheetId);
  }
  // Default to active container-bound sheet
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Returns the primary Task Log sheet
 */
function getTaskLogSheet(ss) {
  ss = ss || getTargetSpreadsheet();
  var sheetName = PropertiesService.getScriptProperties().getProperty('TASK_LOG_SHEET_NAME') || 'Task Log';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    // If not found by name, use the first sheet
    sheet = ss.getSheets()[0];
  }
  return sheet;
}

/**
 * Returns server time (epoch ms and formatted string in configured timezone)
 * Used by client to calculate clock drift offset (PRD 2.5 Rule 2)
 */
function serverTime() {
  var userProps = PropertiesService.getUserProperties();
  var scriptProps = PropertiesService.getScriptProperties();
  var timeZone = userProps.getProperty('USER_TIMEZONE') || scriptProps.getProperty('DEFAULT_TIMEZONE') || 'Asia/Jakarta';

  var now = new Date();
  return {
    serverNowMs: now.getTime(),
    timeZone: timeZone,
    isoString: now.toISOString(),
    formattedTime: TimeUtils.formatTimeForInput(now, timeZone),
    formattedDate: TimeUtils.formatDateForInput(now, timeZone)
  };
}

/**
 * Fetches sheet configuration, data validation options, presets, and typical durations
 */
function getConfig() {
  var ss = getTargetSpreadsheet();
  var sheet = getTaskLogSheet(ss);
  var headerRow = parseInt(PropertiesService.getScriptProperties().getProperty('HEADER_ROW') || '1', 10);

  // Read header values to map columns
  var maxCols = sheet.getLastColumn();
  var headerRange = sheet.getRange(headerRow, 1, 1, maxCols);
  var colMapResult = ColumnMapper.mapHeaders(headerRange.getValues(), { allowPartial: true });
  var colMap = colMapResult.map;

  // 1. Extract dropdown options from data validation
  var dropdownOptions = extractDropdownOptions(sheet, colMap, headerRow);

  // 2. Extract presets from _Config tab (fallback or designated)
  var presets = extractPresets(ss);

  // 3. Extract device hostnames from Devices tab + existing rows
  var devices = extractDeviceHostnames(ss, sheet, colMap, headerRow);

  // 4. Calculate typical durations per Task & Action pair (median of last 10 in sheet)
  var typicalDurations = calculateTypicalDurations(sheet, colMap, headerRow);

  // 5. User settings
  var userProps = PropertiesService.getUserProperties();
  var settings = {
    engineer: userProps.getProperty('ENGINEER_NAME') || '',
    timeZone: userProps.getProperty('USER_TIMEZONE') || 'Asia/Jakarta',
    fallbackDuration: parseInt(userProps.getProperty('FALLBACK_DURATION') || '5', 10),
    disableUppercaseHostname: userProps.getProperty('DISABLE_UPPERCASE_HOSTNAME') === 'true'
  };

  return {
    success: true,
    colMap: colMap,
    dropdownOptions: dropdownOptions,
    presets: presets,
    devices: devices,
    typicalDurations: typicalDurations,
    settings: settings
  };
}

/**
 * Saves one row to the sheet with concurrency locking and idempotency guard
 */
function saveEntry(entry) {
  var lock = LockService.getScriptLock();
  var hasLock = false;

  try {
    // Wait up to 30 seconds for concurrent write lock
    hasLock = lock.waitLock(30000);
    if (!hasLock) {
      return { success: false, error: 'Could not obtain write lock. Please try again.' };
    }

    // Idempotency check with CacheService
    var cache = CacheService.getScriptCache();
    var uuid = entry.uuid;
    if (uuid && cache.get('uuid_' + uuid)) {
      var cachedRow = cache.get('uuid_row_' + uuid);
      return {
        success: true,
        alreadyProcessed: true,
        rowNumber: cachedRow ? parseInt(cachedRow, 10) : null,
        message: 'Entry already recorded (idempotent duplicate).'
      };
    }

    // Validate entry payload
    var validationResult = Validation.validateEntry(entry, { serverNowMs: new Date().getTime() });
    if (!validationResult.isValid) {
      return { success: false, error: validationResult.errors.join(' ') };
    }

    var ss = getTargetSpreadsheet();
    var sheet = getTaskLogSheet(ss);
    var headerRow = parseInt(PropertiesService.getScriptProperties().getProperty('HEADER_ROW') || '1', 10);
    var numCols = sheet.getLastColumn();

    // Dynamically resolve columns
    var headerRange = sheet.getRange(headerRow, 1, 1, numCols);
    var colMapResult = ColumnMapper.mapHeaders(headerRange.getValues());
    var colMap = colMapResult.map;

    // Locate target row (never appendRow)
    var targetRow = SheetOperations.findNextAvailableRow(sheet, colMap, headerRow);

    // Compute sequential No
    var computedNo = SheetOperations.calculateNextNo(sheet, colMap['no'] || 1, targetRow, headerRow);

    // Copy formatting and data validation from row above
    var prevRow = targetRow - 1;
    if (prevRow > headerRow) {
      SheetOperations.copyRowStyleAndValidation(sheet, prevRow, targetRow, numCols);
    }

    // Assemble row values
    var rowValues = SheetOperations.assembleRowValues(colMap, entry, computedNo, numCols);

    // Write row with setValues
    sheet.getRange(targetRow, 1, 1, numCols).setValues([rowValues]);

    // Mark UUID in cache for 6 hours
    if (uuid) {
      cache.put('uuid_' + uuid, 'true', 21600);
      cache.put('uuid_row_' + uuid, String(targetRow), 21600);
    }

    return {
      success: true,
      rowNumber: targetRow,
      no: computedNo,
      entry: entry
    };

  } catch (err) {
    return { success: false, error: err.message || String(err) };
  } finally {
    if (hasLock) {
      lock.releaseLock();
    }
  }
}

/**
 * Undo last save: clears row if still matching
 */
function undoLast(payload) {
  var lock = LockService.getScriptLock();
  var hasLock = false;

  try {
    hasLock = lock.waitLock(15000);
    if (!hasLock) return { success: false, error: 'Could not obtain lock for undo.' };

    var rowNumber = payload.rowNumber;
    var writtenEntry = payload.entry;
    if (!rowNumber || !writtenEntry) {
      return { success: false, error: 'Invalid undo payload.' };
    }

    var ss = getTargetSpreadsheet();
    var sheet = getTaskLogSheet(ss);
    var headerRow = parseInt(PropertiesService.getScriptProperties().getProperty('HEADER_ROW') || '1', 10);
    var numCols = sheet.getLastColumn();

    var headerRange = sheet.getRange(headerRow, 1, 1, numCols);
    var colMap = ColumnMapper.mapHeaders(headerRange.getValues()).map;

    var result = SheetOperations.undoLastRow(sheet, colMap, rowNumber, writtenEntry);
    return result;

  } catch (err) {
    return { success: false, error: err.message || String(err) };
  } finally {
    if (hasLock) lock.releaseLock();
  }
}

/**
 * Reads back today's logged entries and calculates total minutes
 */
function todayRows() {
  try {
    var ss = getTargetSpreadsheet();
    var sheet = getTaskLogSheet(ss);
    var headerRow = parseInt(PropertiesService.getScriptProperties().getProperty('HEADER_ROW') || '1', 10);
    var lastRow = sheet.getLastRow();
    var numCols = sheet.getLastColumn();

    if (lastRow <= headerRow) {
      return { success: true, count: 0, totalMinutes: 0, rows: [] };
    }

    var headerRange = sheet.getRange(headerRow, 1, 1, numCols);
    var colMap = ColumnMapper.mapHeaders(headerRange.getValues()).map;

    var todaySerial = TimeUtils.dateToSerial(new Date(), 'Asia/Jakarta');
    var allData = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, numCols).getValues();

    var dateColIdx = (colMap['tanggal'] || 2) - 1;
    var taskColIdx = (colMap['task'] || 3) - 1;
    var actionColIdx = (colMap['action'] || 4) - 1;
    var hostColIdx = (colMap['hostname'] || 8) - 1;
    var startColIdx = (colMap['timeStart'] || 11) - 1;
    var endColIdx = (colMap['timeEnd'] || 12) - 1;

    var matchingRows = [];
    var totalMinutes = 0;

    for (var i = 0; i < allData.length; i++) {
      var r = allData[i];
      var rDate = r[dateColIdx];

      // Match serial number or date
      var isToday = false;
      if (typeof rDate === 'number') {
        isToday = Math.round(rDate) === todaySerial;
      } else if (rDate instanceof Date) {
        isToday = TimeUtils.dateToSerial(rDate, 'Asia/Jakarta') === todaySerial;
      }

      if (isToday) {
        var startFrac = typeof r[startColIdx] === 'number' ? r[startColIdx] : null;
        var endFrac = typeof r[endColIdx] === 'number' ? r[endColIdx] : null;

        var durationMin = 0;
        if (startFrac !== null && endFrac !== null) {
          durationMin = Math.round((endFrac - startFrac) * 1440);
          if (durationMin < 0) durationMin += 1440; // overnight
          totalMinutes += durationMin;
        }

        matchingRows.push({
          rowNumber: headerRow + i + 1,
          task: String(r[taskColIdx] || ''),
          action: String(r[actionColIdx] || ''),
          hostname: String(r[hostColIdx] || ''),
          timeStart: TimeUtils.fractionToTimeStr(startFrac, true),
          timeEnd: TimeUtils.fractionToTimeStr(endFrac, true),
          durationMinutes: durationMin
        });
      }
    }

    return {
      success: true,
      count: matchingRows.length,
      totalMinutes: totalMinutes,
      rows: matchingRows
    };

  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Saves user settings (Engineer name, timezone, fallback duration)
 */
function saveSettings(settings) {
  var userProps = PropertiesService.getUserProperties();
  if (settings.engineer !== undefined) userProps.setProperty('ENGINEER_NAME', settings.engineer);
  if (settings.timeZone !== undefined) userProps.setProperty('USER_TIMEZONE', settings.timeZone);
  if (settings.fallbackDuration !== undefined) userProps.setProperty('FALLBACK_DURATION', String(settings.fallbackDuration));
  if (settings.disableUppercaseHostname !== undefined) userProps.setProperty('DISABLE_UPPERCASE_HOSTNAME', String(settings.disableUppercaseHostname));
  return { success: true };
}

/**
 * Imports CSV device list into the 'Devices' tab, deduplicating by uppercase hostname
 */
function importDevices(csvString) {
  try {
    var ss = getTargetSpreadsheet();
    var devSheet = ss.getSheetByName('Devices');
    if (!devSheet) {
      devSheet = ss.insertSheet('Devices');
      devSheet.appendRow(['Hostname', 'Site', 'Project Category']);
    }

    var lines = csvString.trim().split(/\r?\n/);
    if (lines.length <= 1) {
      return { success: false, error: 'CSV file is empty or only contains header.' };
    }

    // Read existing devices
    var lastRow = devSheet.getLastRow();
    var existingSet = {};
    if (lastRow > 1) {
      var existing = devSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < existing.length; i++) {
        var h = String(existing[i][0] || '').trim().toUpperCase();
        if (h) existingSet[h] = true;
      }
    }

    // Parse header to find Hostname column
    var headerParts = lines[0].split(',').map(function(s) { return s.trim().toLowerCase(); });
    var hostColIdx = 0;
    for (var h = 0; h < headerParts.length; h++) {
      if (/hostname|device|perangkat/i.test(headerParts[h])) {
        hostColIdx = h;
        break;
      }
    }

    var newRows = [];
    var addedCount = 0;
    var skippedCount = 0;

    for (var l = 1; l < lines.length; l++) {
      var line = lines[l].trim();
      if (!line) continue;
      var cols = line.split(',').map(function(s) { return s.trim(); });
      var hostname = (cols[hostColIdx] || '').toUpperCase();

      if (!hostname || existingSet[hostname]) {
        skippedCount++;
        continue;
      }

      existingSet[hostname] = true;
      newRows.push([
        Validation.escapeFormula(hostname),
        Validation.escapeFormula(cols[1] || ''),
        Validation.escapeFormula(cols[2] || '')
      ]);
      addedCount++;
    }

    if (newRows.length > 0) {
      devSheet.getRange(devSheet.getLastRow() + 1, 1, newRows.length, 3).setValues(newRows);
    }

    return {
      success: true,
      addedCount: addedCount,
      skippedCount: skippedCount,
      totalNew: newRows.length
    };

  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// --- Internal Helper Extractors ---

function extractDropdownOptions(sheet, colMap, headerRow) {
  var lastRow = sheet.getLastRow();
  var options = {
    category: ['SUPPORT', 'CR', 'INCIDENT'],
    projectCategory: ['KANTOR CABANG'],
    severity: ['Minor', 'Major', 'Critical'],
    status: ['CLOSED', 'IN PROGRESS', 'PENDING', 'OPEN'],
    requestBy: ['Desktop', 'IT REP', 'Network', 'User'],
    engineer: []
  };

  // Check last formatted row data validations
  var checkRow = lastRow > headerRow ? lastRow : headerRow + 1;
  var keys = ['category', 'projectCategory', 'severity', 'status', 'requestBy', 'engineer'];

  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var colIdx = colMap[key];
    if (colIdx && checkRow <= sheet.getMaxRows()) {
      var cell = sheet.getRange(checkRow, colIdx);
      var rule = cell.getDataValidation();
      if (rule) {
        var criteria = rule.getCriteriaType();
        var args = rule.getCriteriaValues();
        if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
          if (args[0] && Array.isArray(args[0]) && args[0].length > 0) {
            options[key] = args[0];
          }
        } else if (criteria === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
          var range = args[0];
          if (range && typeof range.getValues === 'function') {
            var vals = range.getValues();
            var list = [];
            for (var r = 0; r < vals.length; r++) {
              var v = String(vals[r][0] || '').trim();
              if (v) list.push(v);
            }
            if (list.length > 0) options[key] = list;
          }
        }
      }
    }
  }

  // Fallback to _Config sheet if available
  var ss = sheet.getParent();
  var configSheet = ss.getSheetByName('_Config');
  if (configSheet && configSheet.getLastRow() > 1) {
    // Read any column configs from _Config
    var configData = configSheet.getDataRange().getValues();
    var configHeaders = configData[0].map(function(h) { return String(h).trim().toLowerCase(); });
    for (var c = 0; c < configHeaders.length; c++) {
      var head = configHeaders[c];
      for (var f = 0; f < keys.length; f++) {
        if (head.indexOf(keys[f].toLowerCase()) > -1) {
          var list = [];
          for (var r = 1; r < configData.length; r++) {
            var item = String(configData[r][c] || '').trim();
            if (item) list.push(item);
          }
          if (list.length > 0) options[keys[f]] = list;
        }
      }
    }
  }

  return options;
}

function extractPresets(ss) {
  var presets = [
    {
      label: 'Cek Endpoint Cabang',
      task: 'Cek Endpoint Cabang',
      action: 'Cek disabled user dan learned MAC Address',
      category: 'SUPPORT',
      projectCategory: 'KANTOR CABANG',
      severity: 'Minor'
    }
  ];

  var configSheet = ss.getSheetByName('_Config');
  if (configSheet && configSheet.getLastRow() > 1) {
    var data = configSheet.getDataRange().getValues();
    var headers = data[0].map(function(h) { return String(h).trim().toLowerCase(); });

    var presetIdx = headers.indexOf('preset');
    var taskIdx = headers.indexOf('task');
    var actionIdx = headers.indexOf('action');

    if (presetIdx > -1 && taskIdx > -1) {
      presets = [];
      for (var i = 1; i < data.length; i++) {
        var label = String(data[i][presetIdx] || '').trim();
        var task = String(data[i][taskIdx] || '').trim();
        var action = actionIdx > -1 ? String(data[i][actionIdx] || '').trim() : '';

        if (label && task) {
          presets.push({
            label: label,
            task: task,
            action: action
          });
        }
      }
    }
  }

  return presets;
}

function extractDeviceHostnames(ss, sheet, colMap, headerRow) {
  var hostnames = {};

  // 1. Devices tab
  var devSheet = ss.getSheetByName('Devices');
  if (devSheet && devSheet.getLastRow() > 1) {
    var devVals = devSheet.getRange(2, 1, devSheet.getLastRow() - 1, 1).getValues();
    for (var d = 0; d < devVals.length; d++) {
      var name = String(devVals[d][0] || '').trim().toUpperCase();
      if (name) hostnames[name] = true;
    }
  }

  // 2. Distinct hostnames from task log sheet
  var hostCol = colMap['hostname'] || 8;
  var lastRow = sheet.getLastRow();
  if (lastRow > headerRow) {
    var logVals = sheet.getRange(headerRow + 1, hostCol, lastRow - headerRow, 1).getValues();
    for (var l = 0; l < logVals.length; l++) {
      var h = String(logVals[l][0] || '').trim().toUpperCase();
      if (h) hostnames[h] = true;
    }
  }

  return Object.keys(hostnames);
}

function calculateTypicalDurations(sheet, colMap, headerRow) {
  var lastRow = sheet.getLastRow();
  var durationMap = {};

  if (lastRow <= headerRow) {
    return durationMap;
  }

  var taskCol = (colMap['task'] || 3) - 1;
  var actionCol = (colMap['action'] || 4) - 1;
  var startCol = (colMap['timeStart'] || 11) - 1;
  var endCol = (colMap['timeEnd'] || 12) - 1;

  var allData = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, sheet.getLastColumn()).getValues();

  // Walk backwards from most recent row
  for (var i = allData.length - 1; i >= 0; i--) {
    var row = allData[i];
    var task = String(row[taskCol] || '').trim();
    var action = String(row[actionCol] || '').trim();
    var startVal = row[startCol];
    var endVal = row[endCol];

    if (!task) continue;

    var key = task.toLowerCase() + '|||' + action.toLowerCase();
    if (!durationMap[key]) {
      durationMap[key] = [];
    }

    if (durationMap[key].length < 10) {
      if (typeof startVal === 'number' && typeof endVal === 'number') {
        var durationMinutes = Math.round((endVal - startVal) * 1440);
        if (durationMinutes < 0) durationMinutes += 1440;
        if (durationMinutes > 0 && durationMinutes < 720) {
          durationMap[key].push(durationMinutes);
        }
      }
    }
  }

  // Calculate median for each pair
  var medians = {};
  for (var k in durationMap) {
    var list = durationMap[k];
    if (list.length > 0) {
      list.sort(function(a, b) { return a - b; });
      var mid = Math.floor(list.length / 2);
      medians[k] = list.length % 2 !== 0 ? list[mid] : Math.round((list[mid - 1] + list[mid]) / 2);
    }
  }

  return medians;
}
