/**
 * Daily Task Logger — Time & Serial Conversion Utilities
 * Handles Google Sheets date serials and day fractions.
 * 
 * Google Sheets epoch starts on December 30, 1899.
 * 9/1/2026 gives 46266
 * 9:11:00 AM gives 551/1440 (0.3826388888888889)
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TimeUtils = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Base epoch for Google Sheets: Dec 30, 1899 UTC
  var GS_EPOCH_MS = Date.UTC(1899, 11, 30);
  var MS_PER_DAY = 86400000;
  var MIN_PER_DAY = 1440;

  /**
   * Parse a date string (YYYY-MM-DD or M/D/YYYY) into { year, month, day }
   */
  function parseDateParts(dateStr) {
    if (!dateStr) return null;
    var parts;
    if (dateStr.indexOf('-') > -1) {
      // YYYY-MM-DD
      parts = dateStr.split('-');
      return {
        year: parseInt(parts[0], 10),
        month: parseInt(parts[1], 10),
        day: parseInt(parts[2], 10)
      };
    } else if (dateStr.indexOf('/') > -1) {
      // M/D/YYYY
      parts = dateStr.split('/');
      return {
        month: parseInt(parts[0], 10),
        day: parseInt(parts[1], 10),
        year: parseInt(parts[2], 10)
      };
    }
    return null;
  }

  /**
   * Parse time string "HH:mm" or "HH:mm:ss" or "h:mm:ss AM/PM" into { hours, minutes, seconds }
   */
  function parseTimeParts(timeStr) {
    if (!timeStr) return null;
    var str = timeStr.trim();
    var isPM = /pm$/i.test(str);
    var isAM = /am$/i.test(str);
    var clean = str.replace(/\s*(am|pm)$/i, '');
    var parts = clean.split(':');
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    var seconds = parts.length > 2 ? parseInt(parts[2], 10) : 0;

    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;

    return {
      hours: hours,
      minutes: minutes,
      seconds: seconds
    };
  }

  /**
   * Convert date string or Date object to Google Sheets serial number.
   * e.g. "2026-09-01" or "9/1/2026" -> 46266
   */
  function dateToSerial(dateInput, timeZone) {
    if (!dateInput) return null;
    var year, month, day;

    if (typeof dateInput === 'string') {
      var parsed = parseDateParts(dateInput);
      if (parsed) {
        year = parsed.year;
        month = parsed.month;
        day = parsed.day;
      }
    } else if (dateInput instanceof Date) {
      if (timeZone) {
        // Use Intl to format in given timezone
        var formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timeZone,
          year: 'numeric',
          month: 'numeric',
          day: 'numeric'
        });
        var formatted = formatter.format(dateInput); // M/D/YYYY
        var p = parseDateParts(formatted);
        year = p.year;
        month = p.month;
        day = p.day;
      } else {
        year = dateInput.getFullYear();
        month = dateInput.getMonth() + 1;
        day = dateInput.getDate();
      }
    }

    if (year === undefined || month === undefined || day === undefined) {
      return null;
    }

    var targetUtc = Date.UTC(year, month - 1, day);
    var diffDays = Math.round((targetUtc - GS_EPOCH_MS) / MS_PER_DAY);
    return diffDays;
  }

  /**
   * Convert time string "HH:mm" / "HH:mm:ss" or Date object to day fraction.
   * e.g. "09:11:00" -> 551 / 1440 = 0.3826388888888889
   */
  function timeToFraction(timeInput, timeZone) {
    if (timeInput === null || timeInput === undefined || timeInput === '') return null;
    var hours, minutes, seconds;

    if (typeof timeInput === 'string') {
      var p = parseTimeParts(timeInput);
      if (!p) return null;
      hours = p.hours;
      minutes = p.minutes;
      seconds = p.seconds;
    } else if (timeInput instanceof Date) {
      if (timeZone) {
        var formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timeZone,
          hour: 'numeric',
          minute: 'numeric',
          second: 'numeric',
          hour12: false
        });
        var parts = formatter.formatToParts(timeInput);
        var map = {};
        for (var i = 0; i < parts.length; i++) {
          map[parts[i].type] = parts[i].value;
        }
        hours = parseInt(map.hour, 10);
        minutes = parseInt(map.minute, 10);
        seconds = parseInt(map.second || '0', 10);
      } else {
        hours = timeInput.getHours();
        minutes = timeInput.getMinutes();
        seconds = timeInput.getSeconds();
      }
    }

    if (hours === undefined || minutes === undefined) return null;

    // Per Rule 10: Seconds are written as :00 to match existing rows
    var totalSeconds = (hours * 3600) + (minutes * 60);
    return totalSeconds / 86400;
  }

  /**
   * Convert serial number to M/D/YYYY string
   */
  function serialToDateStr(serial) {
    if (typeof serial !== 'number' || isNaN(serial)) return '';
    var utcMs = GS_EPOCH_MS + (serial * MS_PER_DAY);
    var d = new Date(utcMs);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
  }

  /**
   * Convert fraction to h:mm:ss AM/PM or HH:mm string
   */
  function fractionToTimeStr(fraction, is12Hour) {
    if (typeof fraction !== 'number' || isNaN(fraction)) return '';
    var totalSeconds = Math.round(fraction * 86400);
    var hours = Math.floor(totalSeconds / 3600) % 24;
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;

    if (is12Hour) {
      var period = hours >= 12 ? 'PM' : 'AM';
      var h12 = hours % 12 || 12;
      var padM = minutes < 10 ? '0' + minutes : minutes;
      var padS = seconds < 10 ? '0' + seconds : seconds;
      return h12 + ':' + padM + ':' + padS + ' ' + period;
    } else {
      var padH = hours < 10 ? '0' + hours : hours;
      var padMin = minutes < 10 ? '0' + minutes : minutes;
      return padH + ':' + padMin;
    }
  }

  /**
   * Format a Date into YYYY-MM-DD for HTML input[type="date"]
   */
  function formatDateForInput(date, timeZone) {
    if (!date) return '';
    if (timeZone) {
      var formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return formatter.format(date); // en-CA gives YYYY-MM-DD
    }
    var y = date.getFullYear();
    var m = (date.getMonth() + 1).toString().padStart(2, '0');
    var d = date.getDate().toString().padStart(2, '0');
    return y + '-' + m + '-' + d;
  }

  /**
   * Format a Date into HH:mm for HTML input[type="time"]
   */
  function formatTimeForInput(date, timeZone) {
    if (!date) return '';
    if (timeZone) {
      var formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      return formatter.format(date); // en-GB gives HH:mm
    }
    var h = date.getHours().toString().padStart(2, '0');
    var m = date.getMinutes().toString().padStart(2, '0');
    return h + ':' + m;
  }

  /**
   * Day-of-week index for a Google Sheets serial (0 = Sunday ... 6 = Saturday).
   * Serial 0 is 1899-12-30 (Saturday); serial 2 is 1900-01-01 (Monday).
   */
  function weekdayIndexFromSerial(serial) {
    var n = Math.round(serial);
    return ((n % 7) + 6) % 7;
  }

  /**
   * Count entries per weekday (Mon..Sun) for the ISO week containing todaySerial.
   */
  function weekCountsFromSerials(serials, todaySerial) {
    var keysByIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var counts = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0 };
    var todayIdx = weekdayIndexFromSerial(todaySerial);
    // Monday of the current week (Sunday belongs to the week that started 6 days earlier)
    var mondaySerial = Math.round(todaySerial) - (todayIdx === 0 ? 6 : todayIdx - 1);
    var list = serials || [];

    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (typeof s !== 'number' || isNaN(s)) continue;
      var rounded = Math.round(s);
      if (rounded < mondaySerial || rounded > mondaySerial + 6) continue;
      counts[keysByIndex[weekdayIndexFromSerial(rounded)]]++;
    }

    return counts;
  }

  return {
    dateToSerial: dateToSerial,
    weekdayIndexFromSerial: weekdayIndexFromSerial,
    weekCountsFromSerials: weekCountsFromSerials,
    timeToFraction: timeToFraction,
    serialToDateStr: serialToDateStr,
    fractionToTimeStr: fractionToTimeStr,
    parseDateParts: parseDateParts,
    parseTimeParts: parseTimeParts,
    formatDateForInput: formatDateForInput,
    formatTimeForInput: formatTimeForInput,
    MS_PER_DAY: MS_PER_DAY,
    MIN_PER_DAY: MIN_PER_DAY
  };
}));
