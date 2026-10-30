/**
 * Daily Task Logger — Client Clock Synchronization Module
 * Synchronizes client UI time with server clock of record (Asia/Jakarta)
 * Implements PRD Section 2.5 Rule 2:
 * offset = serverNow + roundTrip / 2 - clientReceiveTime
 * Every "now" in UI = Date.now() + offset
 * Re-sync every 5 minutes and on tab focus
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ClockSync = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  var clockOffset = 0;
  var isSynced = false;
  var lastSyncTime = 0;
  var SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // Auto-sync is registered at most once per page lifetime.
  var autoSyncInitialized = false;
  var autoSyncTeardown = null;

  /**
   * Calculate clock offset using NTP-style round-trip time
   */
  function calculateOffset(clientSendTime, serverNowMs, clientReceiveTime) {
    var roundTrip = clientReceiveTime - clientSendTime;
    return Math.round(serverNowMs + (roundTrip / 2) - clientReceiveTime);
  }

  /**
   * Get current synchronized timestamp (epoch ms)
   */
  function now() {
    return Date.now() + clockOffset;
  }

  /**
   * Get current synchronized Date object
   */
  function nowDate() {
    return new Date(now());
  }

  /**
   * Perform clock sync with backend serverTime()
   * @param {Function} fetchServerTimeFn - Function returning promise or calling google.script.run
   * @returns {Promise<number>} Resolves with calculated offset
   */
  function sync(fetchServerTimeFn) {
    var sendTime = Date.now();

    return new Promise(function(resolve, reject) {
      if (!fetchServerTimeFn) {
        // Fallback to local clock if no sync function provided
        isSynced = true;
        resolve(clockOffset);
        return;
      }

      fetchServerTimeFn(function(serverData) {
        var receiveTime = Date.now();
        if (serverData && typeof serverData.serverNowMs === 'number') {
          clockOffset = calculateOffset(sendTime, serverData.serverNowMs, receiveTime);
          isSynced = true;
          lastSyncTime = receiveTime;
          resolve(clockOffset);
        } else {
          resolve(clockOffset);
        }
      }, function(err) {
        // Network fail — keep existing offset
        resolve(clockOffset);
      });
    });
  }

  /**
   * Sets up periodic re-sync every 5 minutes and on window focus/tab visibility.
   * Safe to call repeatedly: listeners/intervals are registered only once.
   * @returns {Function} teardown that removes listeners and stops the interval
   */
  function initAutoSync(fetchServerTimeFn) {
    // Already wired up — do not stack another set of listeners or intervals.
    if (autoSyncInitialized) {
      return autoSyncTeardown;
    }
    autoSyncInitialized = true;

    // Initial sync
    sync(fetchServerTimeFn);

    var intervalId = null;

    var focusHandler = function() {
      if (Date.now() - lastSyncTime > 30000) { // throttle to 30s
        sync(fetchServerTimeFn);
      }
    };

    var visibilityHandler = function() {
      if (!document.hidden && (Date.now() - lastSyncTime > 30000)) {
        sync(fetchServerTimeFn);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', focusHandler);

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', visibilityHandler);
      }

      // Interval sync every 5 minutes
      intervalId = setInterval(function() {
        sync(fetchServerTimeFn);
      }, SYNC_INTERVAL_MS);
    }

    autoSyncTeardown = function() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', focusHandler);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
      autoSyncInitialized = false;
      autoSyncTeardown = null;
    };

    return autoSyncTeardown;
  }

  return {
    calculateOffset: calculateOffset,
    sync: sync,
    now: now,
    nowDate: nowDate,
    getOffset: function() { return clockOffset; },
    setOffset: function(off) { clockOffset = off; isSynced = true; },
    isSynced: function() { return isSynced; },
    initAutoSync: initAutoSync
  };
}));
