/**
 * Daily Task Logger — Sheet Operations Module
 * Manages row searching, formatting/validation copying, reading entries, and undo logic.
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./timeUtils.js'),
      require('./columnMapper.js'),
      require('./validation.js')
    );
  } else {
    root.SheetOperations = factory(root.TimeUtils, root.ColumnMapper, root.Validation);
  }
}(typeof self !== 'undefined' ? self : this, function(TimeUtils, ColumnMapper, Validation) {
  'use strict';

  /**
   * Find the first empty row below the last row where 'No' or 'Task' is filled.
   * Avoids Sheet.appendRow() to respect sheet templates and trailing blank formats.
   * 
   * @param {Object} sheet - Google Apps Script Sheet object (or mock)
   * @param {Object} colMap - Field key to 1-based column index
   * @param {number} headerRowIndex - Header row index (1-based, default 1)
   * @returns {number} 1-based row index of the first available row
   */
  function findNextAvailableRow(sheet, colMap, headerRowIndex) {
    headerRowIndex = headerRowIndex || 1;
    var maxRows = sheet.getMaxRows();
    var lastRow = sheet.getLastRow();

    if (lastRow <= headerRowIndex) {
      return headerRowIndex + 1;
    }

    var noCol = colMap['no'] || 1;
    var taskCol = colMap['task'] || 3;

    var numRowsToCheck = lastRow - headerRowIndex;
    if (numRowsToCheck <= 0) return headerRowIndex + 1;

    // Read No and Task column values in bulk
    var rangeNo = sheet.getRange(headerRowIndex + 1, noCol, numRowsToCheck, 1).getValues();
    var rangeTask = sheet.getRange(headerRowIndex + 1, taskCol, numRowsToCheck, 1).getValues();

    var lastFilledRowRelative = 0;
    for (var i = 0; i < numRowsToCheck; i++) {
      var noVal = rangeNo[i][0];
      var taskVal = rangeTask[i][0];
      var hasNo = noVal !== null && noVal !== undefined && String(noVal).trim() !== '';
      var hasTask = taskVal !== null && taskVal !== undefined && String(taskVal).trim() !== '';

      if (hasNo || hasTask) {
        lastFilledRowRelative = i + 1;
      }
    }

    var targetRow = headerRowIndex + lastFilledRowRelative + 1;

    // Expand sheet if needed
    if (targetRow > maxRows) {
      sheet.insertRowAfter(maxRows);
    }

    return targetRow;
  }

  /**
   * Determine the next 'No' value based on previous row.
   * If previous cell contains a formula, returns null (do not overwrite formula).
   */
  function calculateNextNo(sheet, noCol, targetRow, headerRowIndex) {
    if (targetRow <= headerRowIndex + 1) {
      return 1;
    }
    var prevRow = targetRow - 1;
    var prevCell = sheet.getRange(prevRow, noCol);
    var prevFormula = prevCell.getFormula();

    if (prevFormula && prevFormula.trim().length > 0) {
      // Cell holds a formula, leave it untouched
      return null;
    }

    var prevVal = prevCell.getValue();
    var num = parseInt(prevVal, 10);
    if (!isNaN(num) && num >= 0) {
      return num + 1;
    }
    return 1;
  }

  /**
   * Copy cell formatting and data validations from source row to target row
   */
  function copyRowStyleAndValidation(sheet, sourceRow, targetRow, numCols) {
    if (sourceRow < 1 || targetRow < 1 || sourceRow === targetRow) return;

    var sourceRange = sheet.getRange(sourceRow, 1, 1, numCols);
    var targetRange = sheet.getRange(targetRow, 1, 1, numCols);

    // Copy formats (number format, font, borders, background)
    if (typeof sourceRange.copyFormatToRange === 'function') {
      sourceRange.copyFormatToRange(sheet, 1, numCols, targetRow, targetRow);
    } else if (typeof sourceRange.copyTo === 'function') {
      sourceRange.copyTo(targetRange, { formatOnly: true });
    }

    // Copy data validations if present
    if (typeof sourceRange.getDataValidations === 'function' && typeof targetRange.setDataValidations === 'function') {
      var validations = sourceRange.getDataValidations();
      if (validations && validations.length > 0) {
        targetRange.setDataValidations(validations);
      }
    }
  }

  /**
   * Build row array matching the sheet's column order
   */
  function assembleRowValues(colMap, entryData, computedNo, numCols) {
    var rowValues = new Array(numCols);
    for (var i = 0; i < numCols; i++) {
      rowValues[i] = '';
    }

    // Map each field
    if (colMap['no'] && computedNo !== null) {
      rowValues[colMap['no'] - 1] = computedNo;
    }

    if (colMap['tanggal']) {
      // Date serial number
      var dateSerial = TimeUtils.dateToSerial(entryData.tanggal, entryData.timeZone || 'Asia/Jakarta');
      rowValues[colMap['tanggal'] - 1] = dateSerial;
    }

    if (colMap['task']) {
      rowValues[colMap['task'] - 1] = Validation.escapeFormula(entryData.task);
    }

    if (colMap['action']) {
      rowValues[colMap['action'] - 1] = Validation.escapeFormula(entryData.action);
    }

    if (colMap['category']) {
      rowValues[colMap['category'] - 1] = Validation.escapeFormula(entryData.category);
    }

    if (colMap['projectCategory']) {
      rowValues[colMap['projectCategory'] - 1] = Validation.escapeFormula(entryData.projectCategory);
    }

    if (colMap['severity']) {
      rowValues[colMap['severity'] - 1] = Validation.escapeFormula(entryData.severity);
    }

    if (colMap['hostname']) {
      // Uppercase hostname unless setting disables it
      var hName = entryData.hostname || '';
      if (!entryData.disableUppercaseHostname) {
        hName = hName.toUpperCase();
      }
      rowValues[colMap['hostname'] - 1] = Validation.escapeFormula(hName);
    }

    if (colMap['status']) {
      rowValues[colMap['status'] - 1] = Validation.escapeFormula(entryData.status);
    }

    if (colMap['requestBy']) {
      rowValues[colMap['requestBy'] - 1] = Validation.escapeFormula(entryData.requestBy);
    }

    if (colMap['timeStart']) {
      var startFrac = TimeUtils.timeToFraction(entryData.timeStart, entryData.timeZone || 'Asia/Jakarta');
      rowValues[colMap['timeStart'] - 1] = startFrac;
    }

    if (colMap['timeEnd']) {
      var endFrac = TimeUtils.timeToFraction(entryData.timeEnd, entryData.timeZone || 'Asia/Jakarta');
      rowValues[colMap['timeEnd'] - 1] = endFrac;
    }

    if (colMap['engineer'] && entryData.engineer) {
      rowValues[colMap['engineer'] - 1] = Validation.escapeFormula(entryData.engineer);
    }

    if (colMap['remark'] && entryData.remark) {
      rowValues[colMap['remark'] - 1] = Validation.escapeFormula(entryData.remark);
    }

    return rowValues;
  }

  /**
   * Undo last written row: clears content only if row still matches written data
   */
  function undoLastRow(sheet, colMap, rowNumber, writtenEntry) {
    var maxCols = sheet.getLastColumn();
    var range = sheet.getRange(rowNumber, 1, 1, maxCols);
    var currentValues = range.getValues()[0];

    // Verify key fields match
    var taskIdx = (colMap['task'] || 3) - 1;
    var hostIdx = (colMap['hostname'] || 8) - 1;

    var curTask = String(currentValues[taskIdx] || '').trim();
    var writtenTask = String(writtenEntry.task || '').trim();

    var curHost = String(currentValues[hostIdx] || '').trim();
    var writtenHost = String(writtenEntry.hostname || '').trim();

    if (curTask.toLowerCase() !== writtenTask.toLowerCase()) {
      return { success: false, reason: 'Row content has been modified manually in sheet. Undo refused.' };
    }

    if (writtenHost && curHost.toUpperCase() !== writtenHost.toUpperCase()) {
      return { success: false, reason: 'Impacted device has been modified manually in sheet. Undo refused.' };
    }

    // Clear content while preserving cell formats and validations
    range.clearContent();
    return { success: true, rowNumber: rowNumber };
  }

  return {
    findNextAvailableRow: findNextAvailableRow,
    calculateNextNo: calculateNextNo,
    copyRowStyleAndValidation: copyRowStyleAndValidation,
    assembleRowValues: assembleRowValues,
    undoLastRow: undoLastRow
  };
}));
