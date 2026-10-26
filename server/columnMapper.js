/**
 * Daily Task Logger — Dynamic Column Mapper
 * Resolves sheet column indexes by fuzzy/exact header text matching.
 * Handles merged "Time Duration" (Start, End) columns and arbitrary column ordering.
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ColumnMapper = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Standard logical field definitions with match patterns
  var FIELD_DEFINITIONS = [
    { key: 'no', label: 'No', patterns: [/^no\.?$/i, /^number$/i], required: true },
    { key: 'tanggal', label: 'Tanggal', patterns: [/^tanggal$/i, /^date$/i], required: true },
    { key: 'task', label: 'Task', patterns: [/^task$/i, /^nama task$/i], required: true },
    { key: 'action', label: 'Action', patterns: [/^action$/i, /^tindakan$/i], required: true },
    { key: 'category', label: 'Category [CR, INCIDENT, SUPPORT]', patterns: [/^category\s*(\[.*\])?$/i, /^kategori$/i], required: true },
    { key: 'projectCategory', label: 'Project Category', patterns: [/^project\s*category$/i, /^kategori\s*project$/i], required: true },
    { key: 'severity', label: 'Severity', patterns: [/^severity$/i, /^tingkat\s*urgensi$/i], required: true },
    { key: 'hostname', label: 'Impacted Device [Hostname]', patterns: [/impacted\s*device/i, /hostname/i, /perangkat/i], required: true },
    { key: 'status', label: 'Status', patterns: [/^status$/i], required: true },
    { key: 'requestBy', label: 'Request by', patterns: [/^request\s*by$/i, /^requested\s*by$/i, /^permintaan/i], required: true },
    // Time Duration handled specially for merged header
    { key: 'timeStart', label: 'Time Duration (Start)', patterns: [/^time\s*duration\s*:\s*start$/i, /^start\s*time$/i, /^start$/i, /^jam\s*mulai$/i], required: true },
    { key: 'timeEnd', label: 'Time Duration (End)', patterns: [/^time\s*duration\s*:\s*end$/i, /^end\s*time$/i, /^end$/i, /^jam\s*selesai$/i], required: true },
    { key: 'engineer', label: 'Engineer', patterns: [/^engineer$/i, /^pic$/i, /^pelaksana$/i], required: false },
    { key: 'remark', label: 'Remark/Note', patterns: [/^remark/i, /^note/i, /^catatan$/i, /^keterangan$/i], required: false }
  ];

  /**
   * Normalize string for header comparison
   */
  function cleanHeader(val) {
    if (val === null || val === undefined) return '';
    return String(val).trim().replace(/\s+/g, ' ');
  }

  /**
   * Map header rows into a dictionary of fieldKey -> 1-based column index.
   * 
   * @param {Array<Array<any>>|Array<any>} headerValues - One or two rows of headers
   * @param {Object} options - { allowPartial: boolean }
   * @returns {Object} { map: { fieldKey: columnIndex }, missing: Array<string> }
   */
  function mapHeaders(headerValues, options) {
    options = options || {};
    var rows = Array.isArray(headerValues[0]) ? headerValues : [headerValues];
    var primaryRow = rows[0] || [];
    var secondaryRow = rows.length > 1 ? rows[1] : [];
    var numCols = Math.max(primaryRow.length, secondaryRow.length);

    var colMap = {};
    var matchedCols = {};

    // 1. First handle "Time Duration" (single merged header or separate Start/End headers)
    for (var c = 0; c < primaryRow.length; c++) {
      if (matchedCols[c]) continue;

      var pText = cleanHeader(primaryRow[c]);
      var sText = cleanHeader(secondaryRow[c]);
      var combined = (pText + ' ' + sText).trim();

      if (/^time\s*duration/i.test(pText) || /^time\s*duration/i.test(combined)) {
        if (/end/i.test(pText) || /end/i.test(sText)) {
          colMap['timeEnd'] = c + 1;
          matchedCols[c] = true;
        } else if (/start/i.test(pText) || /start/i.test(sText)) {
          colMap['timeStart'] = c + 1;
          matchedCols[c] = true;
        } else {
          // Merged single "Time Duration" header spanning this cell and the next
          colMap['timeStart'] = c + 1;
          matchedCols[c] = true;

          // Next column is End (unless already matched or out of bounds)
          if (c + 1 < numCols && !matchedCols[c + 1]) {
            colMap['timeEnd'] = c + 2;
            matchedCols[c + 1] = true;
          }
        }
      }
    }

    // 2. Match all other columns against patterns
    for (var colIdx = 0; colIdx < numCols; colIdx++) {
      if (matchedCols[colIdx]) continue;

      var pText = cleanHeader(primaryRow[colIdx]);
      var sText = cleanHeader(secondaryRow[colIdx]);
      var combined = (pText + ' ' + sText).trim();

      for (var f = 0; f < FIELD_DEFINITIONS.length; f++) {
        var def = FIELD_DEFINITIONS[f];
        if (colMap[def.key]) continue; // already found

        var isMatch = false;
        for (var p = 0; p < def.patterns.length; p++) {
          var pat = def.patterns[p];
          if (pat.test(pText) || (sText && pat.test(sText)) || (combined && pat.test(combined))) {
            isMatch = true;
            break;
          }
        }

        if (isMatch) {
          colMap[def.key] = colIdx + 1; // 1-based column index
          matchedCols[colIdx] = true;
          break;
        }
      }
    }

    // 3. Fallback: If timeStart was found under "Time Duration" and timeEnd not yet matched,
    // default timeEnd to colMap.timeStart + 1 if available
    if (colMap['timeStart'] && !colMap['timeEnd']) {
      colMap['timeEnd'] = colMap['timeStart'] + 1;
    }

    // 4. Check for missing required columns
    var missing = [];
    for (var i = 0; i < FIELD_DEFINITIONS.length; i++) {
      var d = FIELD_DEFINITIONS[i];
      if (d.required && !colMap[d.key]) {
        missing.push(d.label);
      }
    }

    if (missing.length > 0 && !options.allowPartial) {
      throw new Error('Sheet header mismatch. Missing required columns: ' + missing.join(', '));
    }

    return {
      map: colMap,
      missing: missing
    };
  }

  return {
    FIELD_DEFINITIONS: FIELD_DEFINITIONS,
    mapHeaders: mapHeaders,
    cleanHeader: cleanHeader
  };
}));
