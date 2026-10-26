/**
 * Daily Task Logger — Input Validation, Security & Formula Guard
 * Handles formula injection escaping, UUID idempotency validation, and time range checks.
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Validation = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var FORMULA_PREFIXES = ['=', '+', '-', '@'];

  /**
   * Escape potential formula strings so Google Sheets stores them as literal text.
   */
  function escapeFormula(value) {
    if (typeof value !== 'string') return value;
    var trimmed = value.trim();
    if (trimmed.length > 0) {
      var firstChar = trimmed.charAt(0);
      for (var i = 0; i < FORMULA_PREFIXES.length; i++) {
        if (firstChar === FORMULA_PREFIXES[i]) {
          return "'" + value;
        }
      }
    }
    return value;
  }

  /**
   * Validate entry payload from client
   * @param {Object} entry 
   * @param {Object} options - { serverNowMs: number, maxFutureDays: number }
   * @returns {Object} { isValid: boolean, errors: Array<string>, warnings: Array<string> }
   */
  function validateEntry(entry, options) {
    options = options || {};
    var errors = [];
    var warnings = [];

    if (!entry) {
      return { isValid: false, errors: ['Entry payload is empty'], warnings: [] };
    }

    // Required fields check
    var requiredFields = [
      { key: 'tanggal', name: 'Tanggal (Date)' },
      { key: 'task', name: 'Task' },
      { key: 'action', name: 'Action' },
      { key: 'category', name: 'Category' },
      { key: 'projectCategory', name: 'Project Category' },
      { key: 'severity', name: 'Severity' },
      { key: 'hostname', name: 'Impacted Device [Hostname]' },
      { key: 'status', name: 'Status' },
      { key: 'requestBy', name: 'Request by' },
      { key: 'timeStart', name: 'Start Time' },
      { key: 'timeEnd', name: 'End Time' }
    ];

    for (var i = 0; i < requiredFields.length; i++) {
      var field = requiredFields[i];
      var val = entry[field.key];
      if (val === undefined || val === null || String(val).trim() === '') {
        errors.push(field.name + ' is required.');
      }
    }

    // UUID check
    if (!entry.uuid || String(entry.uuid).trim() === '') {
      errors.push('Client entry UUID is required for idempotency.');
    }

    // Time validation (Rules 6, 7 in PRD)
    if (entry.timeStart && entry.timeEnd) {
      var startParts = parseTimeToMinutes(entry.timeStart);
      var endParts = parseTimeToMinutes(entry.timeEnd);

      if (startParts !== null && endParts !== null) {
        var durationMinutes = endParts - startParts;

        if (durationMinutes < 0) {
          // End is earlier than Start
          if (entry.isNextDay) {
            // Crossed midnight into the next day (e.g. 23:30 to 01:15 = 105 mins)
            durationMinutes += 1440;
          } else {
            errors.push('End time cannot be earlier than Start time without confirming next-day midnight crossing.');
          }
        }

        if (durationMinutes > 720 && !entry.confirmLongDuration) {
          errors.push('Task duration exceeds 12 hours (' + Math.round(durationMinutes / 60) + 'h). Please confirm.');
        }
      }
    }

    // Date validation: reject dates more than 1 day ahead (Rule 6)
    if (entry.tanggal) {
      var serverNow = options.serverNowMs ? new Date(options.serverNowMs) : new Date();
      // Truncate to start of day UTC
      var entryDateParts = parseDateToParts(entry.tanggal);
      if (entryDateParts) {
        var entryUtc = Date.UTC(entryDateParts.year, entryDateParts.month - 1, entryDateParts.day);
        var serverUtc = Date.UTC(serverNow.getUTCFullYear(), serverNow.getUTCMonth(), serverNow.getUTCDate());
        var diffDays = (entryUtc - serverUtc) / 86400000;

        if (diffDays > 1.05) { // allow small timezone jitter
          errors.push('Date cannot be more than 1 day in the future.');
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors,
      warnings: warnings
    };
  }

  function parseTimeToMinutes(t) {
    if (typeof t !== 'string') return null;
    var parts = t.trim().split(':');
    if (parts.length < 2) return null;
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return null;
    return (h * 60) + m;
  }

  function parseDateToParts(d) {
    if (!d || typeof d !== 'string') return null;
    var p;
    if (d.indexOf('-') > -1) {
      p = d.split('-');
      return { year: parseInt(p[0], 10), month: parseInt(p[1], 10), day: parseInt(p[2], 10) };
    } else if (d.indexOf('/') > -1) {
      p = d.split('/');
      return { month: parseInt(p[0], 10), day: parseInt(p[1], 10), year: parseInt(p[2], 10) };
    }
    return null;
  }

  return {
    escapeFormula: escapeFormula,
    validateEntry: validateEntry,
    parseTimeToMinutes: parseTimeToMinutes
  };
}));
