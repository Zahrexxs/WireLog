/**
 * Daily Task Logger — Client Application Controller
 * Handles UI interactions, auto/manual time tracking, offline queue,
 * sticky defaults, undo window, and backend synchronization.
 */

(function(window, document) {
  'use strict';

  // --- State ---
  var state = {
    // Time tracking
    dateAuto: true,
    startAuto: true,
    endAuto: true,
    timerActive: false,
    timerStartTime: null,

    // Backend config & cache
    dropdownOptions: {},
    presets: [],
    devices: [],
    typicalDurations: {},
    settings: {
      engineer: '',
      timeZone: 'Asia/Jakarta',
      fallbackDuration: 5,
      disableUppercaseHostname: false,
      darkMode: false
    },

    // Offline & Undo
    offlineQueue: [],
    lastSavedEntry: null,
    undoTimeoutId: null,

    // Weekday counts
    weekdayCounts: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0 }
  };

  // --- DOM Elements ---
  var el = {};

  function initElements() {
    el.currentClock = document.getElementById('currentClock');
    el.statusBanner = document.getElementById('statusBanner');
    el.statusBannerText = document.getElementById('statusBannerText');
    el.presetsContainer = document.getElementById('presetsContainer');
    el.weekdayStrip = document.getElementById('weekdayStrip');

    // Form inputs
    el.inputTanggal = document.getElementById('inputTanggal');
    el.badgeTanggal = document.getElementById('badgeTanggal');
    el.btnResetTanggal = document.getElementById('btnResetTanggal');

    el.inputTask = document.getElementById('inputTask');
    el.inputAction = document.getElementById('inputAction');

    el.radioCategory = document.getElementsByName('category');
    el.selectProjectCategory = document.getElementById('selectProjectCategory');
    el.selectSeverity = document.getElementById('selectSeverity');

    el.inputHostname = document.getElementById('inputHostname');
    el.hostnameList = document.getElementById('hostnameList');
    el.newDeviceNotice = document.getElementById('newDeviceNotice');

    el.selectStatus = document.getElementById('selectStatus');
    el.selectRequestBy = document.getElementById('selectRequestBy');

    el.inputStart = document.getElementById('inputStart');
    el.badgeStart = document.getElementById('badgeStart');
    el.btnResetStart = document.getElementById('btnResetStart');

    el.inputEnd = document.getElementById('inputEnd');
    el.badgeEnd = document.getElementById('badgeEnd');
    el.btnResetEnd = document.getElementById('btnResetEnd');

    el.timerBtn = document.getElementById('timerBtn');
    el.chipsContainer = document.getElementById('chipsContainer');

    el.selectEngineer = document.getElementById('selectEngineer');
    el.inputRemark = document.getElementById('inputRemark');

    // Controls & Buttons
    el.btnMore = document.getElementById('btnMore');
    el.moreContent = document.getElementById('moreContent');
    el.btnSave = document.getElementById('btnSave');
    el.btnSettings = document.getElementById('btnSettings');
    el.btnHistory = document.getElementById('btnHistory');
    el.btnThemeToggle = document.getElementById('btnThemeToggle');

    // Toast & Modals
    el.toastContainer = document.getElementById('toastContainer');
    el.settingsModal = document.getElementById('settingsModal');
    el.historyModal = document.getElementById('historyModal');
    el.historyList = document.getElementById('historyList');
    el.historyTotal = document.getElementById('historyTotal');
    el.btnCloseSettings = document.getElementById('btnCloseSettings');
    el.btnCloseHistory = document.getElementById('btnCloseHistory');
    el.formSettings = document.getElementById('formSettings');
    el.csvFileInput = document.getElementById('csvFileInput');
    el.csvTextarea = document.getElementById('csvTextarea');
    el.btnImportCsv = document.getElementById('btnImportCsv');
    el.csvImportResult = document.getElementById('csvImportResult');
  }

  // --- UUID Generator ---
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // --- Backend Wrapper (Supports google.script.run and Local Mock) ---
  function callBackend(methodName, args, onSuccess, onFailure) {
    if (window.google && window.google.script && window.google.script.run) {
      var runner = window.google.script.run
        .withSuccessHandler(onSuccess)
        .withFailureHandler(onFailure || function(err) {
          showToast('Server error: ' + (err.message || err), 'error');
        });
      if (args !== undefined && args !== null) {
        runner[methodName](args);
      } else {
        runner[methodName]();
      }
    } else if (window.__MOCK_BACKEND__) {
      // Local development mock server
      window.__MOCK_BACKEND__[methodName](args)
        .then(onSuccess)
        .catch(onFailure || function(err) {
          showToast('Mock server error: ' + (err.message || err), 'error');
        });
    } else {
      // Offline fallback
      setTimeout(function() {
        if (onFailure) onFailure(new Error('Backend unavailable (Offline)'));
      }, 50);
    }
  }

  // --- Clock & Time Engine ---
  function updateClockDisplay() {
    var d = ClockSync.nowDate();
    var h = d.getHours();
    var m = d.getMinutes();
    var s = d.getSeconds();
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    var padM = m < 10 ? '0' + m : m;
    var padS = s < 10 ? '0' + s : s;
    el.currentClock.textContent = h12 + ':' + padM + ':' + padS + ' ' + ampm;

    // Track Auto fields
    if (state.dateAuto) {
      el.inputTanggal.value = TimeUtils.formatDateForInput(d, state.settings.timeZone);
    }

    if (state.endAuto) {
      el.inputEnd.value = TimeUtils.formatTimeForInput(d, state.settings.timeZone);
    }

    if (state.startAuto) {
      updateCalculatedStartTime();
    }
  }

  function getTypicalDuration() {
    var task = (el.inputTask.value || '').trim().toLowerCase();
    var action = (el.inputAction.value || '').trim().toLowerCase();
    var key = task + '|||' + action;

    if (state.typicalDurations && state.typicalDurations[key]) {
      return state.typicalDurations[key];
    }
    return state.settings.fallbackDuration || 5;
  }

  function updateCalculatedStartTime() {
    var endStr = el.inputEnd.value;
    if (!endStr) return;

    var parts = endStr.split(':');
    var endMin = (parseInt(parts[0], 10) * 60) + parseInt(parts[1], 10);
    var duration = getTypicalDuration();

    var startMin = endMin - duration;
    if (startMin < 0) startMin += 1440; // wrap around previous day

    var h = Math.floor(startMin / 60) % 24;
    var m = startMin % 60;
    var padH = h < 10 ? '0' + h : h;
    var padM = m < 10 ? '0' + m : m;

    el.inputStart.value = padH + ':' + padM;
  }

  function updateBadges() {
    // Date badge
    if (state.dateAuto) {
      el.badgeTanggal.textContent = 'Auto';
      el.badgeTanggal.className = 'badge badge-auto';
      el.btnResetTanggal.style.display = 'none';
    } else {
      el.badgeTanggal.textContent = 'Manual';
      el.badgeTanggal.className = 'badge badge-manual';
      el.btnResetTanggal.style.display = 'inline-flex';
    }

    // Start badge
    if (state.startAuto) {
      el.badgeStart.textContent = 'Auto';
      el.badgeStart.className = 'badge badge-auto';
      el.btnResetStart.style.display = 'none';
    } else {
      el.badgeStart.textContent = 'Manual';
      el.badgeStart.className = 'badge badge-manual';
      el.btnResetStart.style.display = 'inline-flex';
    }

    // End badge
    if (state.endAuto) {
      el.badgeEnd.textContent = 'Auto';
      el.badgeEnd.className = 'badge badge-auto';
      el.btnResetEnd.style.display = 'none';
    } else {
      el.badgeEnd.textContent = 'Manual';
      el.badgeEnd.className = 'badge badge-manual';
      el.btnResetEnd.style.display = 'inline-flex';
    }
  }

  // --- Duration Chips ---
  function applyDurationChip(minutes) {
    var endStr = el.inputEnd.value;
    if (!endStr) {
      endStr = TimeUtils.formatTimeForInput(ClockSync.nowDate(), state.settings.timeZone);
      el.inputEnd.value = endStr;
    }

    var parts = endStr.split(':');
    var endMin = (parseInt(parts[0], 10) * 60) + parseInt(parts[1], 10);
    var startMin = endMin - minutes;
    if (startMin < 0) startMin += 1440;

    var h = Math.floor(startMin / 60) % 24;
    var m = startMin % 60;
    el.inputStart.value = (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);

    // Switching start to manual per Rule 4
    state.startAuto = false;
    updateBadges();
  }

  // --- Timer Mode (Rule 5 & FR-05) ---
  function toggleTimer() {
    if (!state.timerActive) {
      // Start task timer
      state.timerActive = true;
      var nowD = ClockSync.nowDate();
      state.timerStartTime = TimeUtils.formatTimeForInput(nowD, state.settings.timeZone);
      el.inputStart.value = state.timerStartTime;
      state.startAuto = false;

      // Persist in localStorage so it survives page reload
      localStorage.setItem('task_timer_start', state.timerStartTime);

      el.timerBtn.classList.add('active');
      el.timerBtn.innerHTML = '&#9632; Finish';
      updateBadges();
      showToast('Task timer started at ' + state.timerStartTime, 'info');
    } else {
      // Finish task timer
      state.timerActive = false;
      localStorage.removeItem('task_timer_start');

      var nowD2 = ClockSync.nowDate();
      el.inputEnd.value = TimeUtils.formatTimeForInput(nowD2, state.settings.timeZone);
      state.endAuto = false;

      el.timerBtn.classList.remove('active');
      el.timerBtn.innerHTML = '&#9654; Timer';
      updateBadges();
      showToast('Task timer finished', 'info');
    }
  }

  function restoreTimerIfActive() {
    var savedStart = localStorage.getItem('task_timer_start');
    if (savedStart) {
      state.timerActive = true;
      state.timerStartTime = savedStart;
      el.inputStart.value = savedStart;
      state.startAuto = false;
      el.timerBtn.classList.add('active');
      el.timerBtn.innerHTML = '&#9632; Finish';
      updateBadges();
    }
  }

  // --- Autocomplete ---
  function initHostnameAutocomplete() {
    el.inputHostname.addEventListener('input', function() {
      var val = this.value;
      if (!val) {
        el.hostnameList.classList.remove('visible');
        el.newDeviceNotice.style.display = 'none';
        return;
      }

      var matches = Autocomplete.search(val, state.devices, 6);
      renderAutocompleteList(matches, val);
    });

    el.inputHostname.addEventListener('focus', function() {
      if (this.value) {
        var matches = Autocomplete.search(this.value, state.devices, 6);
        renderAutocompleteList(matches, this.value);
      }
    });

    document.addEventListener('click', function(e) {
      if (!el.inputHostname.contains(e.target) && !el.hostnameList.contains(e.target)) {
        el.hostnameList.classList.remove('visible');
      }
    });
  }

  function renderAutocompleteList(matches, query) {
    el.hostnameList.innerHTML = '';
    var isKnown = false;
    var queryUpper = query.trim().toUpperCase();

    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      if (m.hostname.toUpperCase() === queryUpper) isKnown = true;

      var item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = m.hostname;
      item.addEventListener('click', (function(host) {
        return function() {
          el.inputHostname.value = host;
          el.hostnameList.classList.remove('visible');
          el.newDeviceNotice.style.display = 'none';
        };
      })(m.hostname));

      el.hostnameList.appendChild(item);
    }

    if (matches.length > 0) {
      el.hostnameList.classList.add('visible');
    } else {
      el.hostnameList.classList.remove('visible');
    }

    // New device notice if not found
    if (!isKnown && query.length > 2) {
      el.newDeviceNotice.style.display = 'block';
    } else {
      el.newDeviceNotice.style.display = 'none';
    }
  }

  // --- Presets ---
  function renderPresets(presets) {
    el.presetsContainer.innerHTML = '';
    presets.forEach(function(p) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'preset-chip';
      chip.textContent = p.label;
      chip.addEventListener('click', function() {
        el.inputTask.value = p.task;
        el.inputAction.value = p.action;
        if (p.category) setCategoryRadio(p.category);
        if (p.projectCategory) el.selectProjectCategory.value = p.projectCategory;
        if (p.severity) el.selectSeverity.value = p.severity;

        if (state.startAuto) {
          updateCalculatedStartTime();
        }
      });
      el.presetsContainer.appendChild(chip);
    });
  }

  function setCategoryRadio(val) {
    for (var i = 0; i < el.radioCategory.length; i++) {
      if (el.radioCategory[i].value === val) {
        el.radioCategory[i].checked = true;
        break;
      }
    }
  }

  function getSelectedCategory() {
    for (var i = 0; i < el.radioCategory.length; i++) {
      if (el.radioCategory[i].checked) return el.radioCategory[i].value;
    }
    return 'SUPPORT';
  }

  // --- Populate Dropdown Options ---
  function populateSelects(options) {
    function fillSelect(selectEl, list, defaultVal) {
      if (!selectEl) return;
      var current = selectEl.value;
      selectEl.innerHTML = '';
      (list || []).forEach(function(item) {
        var opt = document.createElement('option');
        opt.value = item;
        opt.textContent = item;
        selectEl.appendChild(opt);
      });
      if (current && list.indexOf(current) > -1) {
        selectEl.value = current;
      } else if (defaultVal && list.indexOf(defaultVal) > -1) {
        selectEl.value = defaultVal;
      }
    }

    fillSelect(el.selectProjectCategory, options.projectCategory, 'KANTOR CABANG');
    fillSelect(el.selectSeverity, options.severity, 'Minor');
    fillSelect(el.selectStatus, options.status, 'CLOSED');
    fillSelect(el.selectRequestBy, options.requestBy, 'Desktop');
    fillSelect(el.selectEngineer, options.engineer, state.settings.engineer);
  }

  // --- Weekday Coverage Strip (FR-12 & S4-3) ---
  function updateWeekdayStrip(entries) {
    var counts = { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0 };
    var todayD = ClockSync.nowDate();
    var currentDayIdx = todayD.getDay(); // 0 is Sun, 1 is Mon...

    var daysMap = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', ''];
    var todayKey = daysMap[currentDayIdx] || '';

    // Count entries
    (entries || []).forEach(function(r) {
      var dParts = TimeUtils.parseDateParts(r.tanggal);
      if (dParts) {
        var d = new Date(dParts.year, dParts.month - 1, dParts.day);
        var dayName = daysMap[d.getDay()];
        if (dayName && counts[dayName] !== undefined) {
          counts[dayName]++;
        }
      }
    });

    var keys = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    var html = '';
    keys.forEach(function(k, idx) {
      var c = counts[k];
      var isToday = k === todayKey;
      var isPast = (idx + 1) < currentDayIdx;
      var countClass = 'weekday-count';

      if (c > 0) countClass += ' has-entries';
      if (isToday) countClass += ' today';
      if (isPast && c === 0) countClass += ' missed';

      html += '<div class="weekday-col">' +
        '<span class="weekday-name">' + k + '</span>' +
        '<div class="' + countClass + '">' + c + '</div>' +
        '</div>';
    });

    el.weekdayStrip.innerHTML = html;
  }

  // --- Save Workflow ---
  function handleSave() {
    // 1. Re-stamp any field still in AUTO at this instant (Rule 6)
    var currentNow = ClockSync.nowDate();

    if (state.dateAuto) {
      el.inputTanggal.value = TimeUtils.formatDateForInput(currentNow, state.settings.timeZone);
    }
    if (state.endAuto) {
      el.inputEnd.value = TimeUtils.formatTimeForInput(currentNow, state.settings.timeZone);
    }
    if (state.startAuto) {
      updateCalculatedStartTime();
    }

    // 2. Validate client-side
    var tanggal = el.inputTanggal.value;
    var task = (el.inputTask.value || '').trim();
    var action = (el.inputAction.value || '').trim();
    var category = getSelectedCategory();
    var projectCategory = el.selectProjectCategory.value;
    var severity = el.selectSeverity.value;
    var hostname = (el.inputHostname.value || '').trim();
    var status = el.selectStatus.value;
    var requestBy = el.selectRequestBy.value;
    var timeStart = el.inputStart.value;
    var timeEnd = el.inputEnd.value;
    var engineer = el.selectEngineer.value;
    var remark = (el.inputRemark.value || '').trim();

    if (!task || !action || !hostname || !timeStart || !timeEnd) {
      showToast('Please fill all required fields.', 'warning');
      return;
    }

    // Uppercase hostname
    if (!state.settings.disableUppercaseHostname) {
      hostname = hostname.toUpperCase();
    }

    // Check time logic (End >= Start or midnight crossing prompt)
    var startMin = parseTimeToMin(timeStart);
    var endMin = parseTimeToMin(timeEnd);
    var isNextDay = false;

    if (endMin < startMin) {
      var confirmNextDay = window.confirm('End time (' + timeEnd + ') is earlier than Start time (' + timeStart + '). Does this task end on the next day?');
      if (confirmNextDay) {
        isNextDay = true;
      } else {
        showToast('Please adjust Start or End time.', 'warning');
        return;
      }
    }

    var durationMin = endMin - startMin + (isNextDay ? 1440 : 0);
    var confirmLong = false;
    if (durationMin > 720) {
      confirmLong = window.confirm('Task duration is over 12 hours (' + Math.round(durationMin / 60) + 'h). Proceed?');
      if (!confirmLong) return;
    }

    var payload = {
      uuid: generateUUID(),
      tanggal: tanggal,
      task: task,
      action: action,
      category: category,
      projectCategory: projectCategory,
      severity: severity,
      hostname: hostname,
      status: status,
      requestBy: requestBy,
      timeStart: timeStart,
      timeEnd: timeEnd,
      engineer: engineer,
      remark: remark,
      isNextDay: isNextDay,
      confirmLongDuration: confirmLong,
      timeZone: state.settings.timeZone
    };

    // UI Feedback
    el.btnSave.disabled = true;
    el.btnSave.innerHTML = '<span class="pulse-dot"></span> Saving...';

    callBackend('saveEntry', payload, function(res) {
      el.btnSave.disabled = false;
      el.btnSave.innerHTML = 'Save Task';

      if (res && res.success) {
        showSaveSuccess(res.rowNumber, payload);
        applyStickyDefaults();
      } else {
        var errMsg = res ? res.error : 'Unknown save error';
        showToast(errMsg, 'error');
      }
    }, function(err) {
      // Offline / Network Failure: Queue locally (FR-11 & S4-2)
      el.btnSave.disabled = false;
      el.btnSave.innerHTML = 'Save Task';
      enqueueOfflineSave(payload);
      applyStickyDefaults();
      showToast('Saved offline to queue (Pending). Will sync automatically.', 'info');
    });
  }

  function parseTimeToMin(t) {
    var p = t.split(':');
    return (parseInt(p[0], 10) * 60) + parseInt(p[1], 10);
  }

  // --- Sticky Defaults & Next Entry (FR-06 & S3-1) ---
  function applyStickyDefaults() {
    // Keep Category, Project Category, Severity, Status, Request by, Engineer
    // Blank Hostname and Remark
    el.inputHostname.value = '';
    el.inputRemark.value = '';
    el.newDeviceNotice.style.display = 'none';

    // Reset times to Auto
    state.startAuto = true;
    state.endAuto = true;
    state.dateAuto = true;
    updateBadges();

    // Recalculate start time based on typical duration
    updateCalculatedStartTime();
  }

  // --- Offline Queue Engine (FR-11 & S4-2) ---
  function loadOfflineQueue() {
    try {
      var q = localStorage.getItem('offline_task_queue');
      state.offlineQueue = q ? JSON.parse(q) : [];
      updateOfflineStatusBanner();
    } catch (e) {
      state.offlineQueue = [];
    }
  }

  function enqueueOfflineSave(payload) {
    state.offlineQueue.push(payload);
    localStorage.setItem('offline_task_queue', JSON.stringify(state.offlineQueue));
    updateOfflineStatusBanner();
  }

  function updateOfflineStatusBanner() {
    var count = state.offlineQueue.length;
    if (count > 0) {
      el.statusBanner.classList.add('visible');
      el.statusBannerText.textContent = 'Pending (' + count + ') — Syncing automatically...';
    } else {
      el.statusBanner.classList.remove('visible');
    }
  }

  function flushOfflineQueue() {
    if (state.offlineQueue.length === 0) return;

    var queueCopy = state.offlineQueue.slice();
    var processNext = function(index) {
      if (index >= queueCopy.length) {
        state.offlineQueue = [];
        localStorage.removeItem('offline_task_queue');
        updateOfflineStatusBanner();
        showToast('All pending offline entries successfully synced to sheet!', 'info');
        return;
      }

      var item = queueCopy[index];
      callBackend('saveEntry', item, function(res) {
        processNext(index + 1);
      }, function(err) {
        // Still failing, pause queue
        state.offlineQueue = queueCopy.slice(index);
        localStorage.setItem('offline_task_queue', JSON.stringify(state.offlineQueue));
        updateOfflineStatusBanner();
      });
    };

    processNext(0);
  }

  // --- Undo (30s) Toast (FR-10 & S3-5) ---
  function showSaveSuccess(rowNumber, payload) {
    state.lastSavedEntry = { rowNumber: rowNumber, entry: payload };

    var msg = 'Saved to row ' + (rowNumber || '') + '!';
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = '<span>' + msg + '</span>' +
      '<button class="btn-undo" id="btnUndoToast">Undo (30s)</button>';

    el.toastContainer.innerHTML = '';
    el.toastContainer.appendChild(toast);

    var undoBtn = document.getElementById('btnUndoToast');
    var secondsLeft = 30;

    var timer = setInterval(function() {
      secondsLeft--;
      if (secondsLeft > 0) {
        undoBtn.textContent = 'Undo (' + secondsLeft + 's)';
      } else {
        clearInterval(timer);
        if (toast.parentNode) toast.parentNode.removeChild(toast);
        state.lastSavedEntry = null;
      }
    }, 1000);

    undoBtn.addEventListener('click', function() {
      clearInterval(timer);
      handleUndo(state.lastSavedEntry);
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    });
  }

  function handleUndo(savedInfo) {
    if (!savedInfo) return;
    showToast('Reversing last save...', 'info');

    callBackend('undoLast', savedInfo, function(res) {
      if (res && res.success) {
        showToast('Row ' + savedInfo.rowNumber + ' removed successfully.', 'info');
        // Restore entry details into form
        el.inputTask.value = savedInfo.entry.task;
        el.inputAction.value = savedInfo.entry.action;
        el.inputHostname.value = savedInfo.entry.hostname;
        el.inputRemark.value = savedInfo.entry.remark;
      } else {
        showToast(res ? res.reason || res.error : 'Undo failed.', 'error');
      }
    });
  }

  function showToast(message, type) {
    type = type || 'info';
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;

    el.toastContainer.innerHTML = '';
    el.toastContainer.appendChild(toast);

    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4500);
  }

  // --- History & Today's Feed Modal ---
  function openHistoryModal() {
    el.historyList.innerHTML = '<div style="text-align:center;padding:12px;">Loading today\'s entries...</div>';
    el.historyModal.classList.add('visible');

    callBackend('todayRows', null, function(res) {
      if (res && res.success) {
        el.historyTotal.textContent = res.count + ' tasks | ' + res.totalMinutes + ' mins';
        if (res.rows.length === 0) {
          el.historyList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:16px;">No entries logged today yet.</div>';
          return;
        }

        var html = '';
        res.rows.forEach(function(r) {
          html += '<div class="entry-card">' +
            '<div class="entry-card-header">' +
            '<span>Row #' + r.rowNumber + '</span>' +
            '<span>' + r.timeStart + ' - ' + r.timeEnd + ' (' + r.durationMinutes + 'm)</span>' +
            '</div>' +
            '<div class="entry-card-title">' + r.task + '</div>' +
            '<div class="entry-card-meta">' + r.action + ' &bull; <strong>' + r.hostname + '</strong></div>' +
            '</div>';
        });
        el.historyList.innerHTML = html;
      }
    });
  }

  // --- Settings & CSV Device Importer ---
  function openSettingsModal() {
    document.getElementById('settingEngineer').value = state.settings.engineer || '';
    document.getElementById('settingTimezone').value = state.settings.timeZone || 'Asia/Jakarta';
    document.getElementById('settingFallback').value = state.settings.fallbackDuration || 5;
    document.getElementById('settingUppercase').checked = !state.settings.disableUppercaseHostname;
    el.settingsModal.classList.add('visible');
  }

  function handleSaveSettings(e) {
    e.preventDefault();
    state.settings.engineer = document.getElementById('settingEngineer').value.trim();
    state.settings.timeZone = document.getElementById('settingTimezone').value.trim() || 'Asia/Jakarta';
    state.settings.fallbackDuration = parseInt(document.getElementById('settingFallback').value, 10) || 5;
    state.settings.disableUppercaseHostname = !document.getElementById('settingUppercase').checked;

    localStorage.setItem('task_logger_settings', JSON.stringify(state.settings));
    callBackend('saveSettings', state.settings, function() {
      showToast('Settings saved.', 'info');
      el.settingsModal.classList.remove('visible');
    });
  }

  function handleDeviceCsvImport() {
    var text = el.csvTextarea.value.trim();
    if (!text) {
      showToast('Please paste CSV content or select a file.', 'warning');
      return;
    }

    el.btnImportCsv.disabled = true;
    el.btnImportCsv.textContent = 'Importing...';

    callBackend('importDevices', text, function(res) {
      el.btnImportCsv.disabled = false;
      el.btnImportCsv.textContent = 'Import to Devices Tab';

      if (res && res.success) {
        el.csvImportResult.textContent = 'Added: ' + res.addedCount + ' new hostnames, Skipped duplicates: ' + res.skippedCount;
        el.csvImportResult.style.color = 'var(--success)';
        // Refresh devices list
        loadInitialConfig();
      } else {
        el.csvImportResult.textContent = 'Error: ' + (res ? res.error : 'Import failed');
        el.csvImportResult.style.color = 'var(--danger)';
      }
    });
  }

  // --- Initial Configuration Loader ---
  function loadInitialConfig() {
    // 1. Clock Sync
    ClockSync.initAutoSync(function(onSuccess, onFailure) {
      callBackend('serverTime', null, onSuccess, onFailure);
    });

    // 2. Fetch sheet metadata & validation
    callBackend('getConfig', null, function(res) {
      if (res && res.success) {
        if (res.dropdownOptions) {
          state.dropdownOptions = res.dropdownOptions;
          populateSelects(res.dropdownOptions);
        }
        if (res.presets) {
          state.presets = res.presets;
          renderPresets(res.presets);
        }
        if (res.devices) {
          state.devices = res.devices;
          localStorage.setItem('cached_devices', JSON.stringify(res.devices));
        }
        if (res.typicalDurations) {
          state.typicalDurations = res.typicalDurations;
        }
        if (res.settings) {
          Object.assign(state.settings, res.settings);
        }
      }
    });

    // 3. Update today rows & weekday strip
    callBackend('todayRows', null, function(res) {
      if (res && res.success) {
        updateWeekdayStrip(res.rows);
      }
    });
  }

  // --- App Initialization ---
  function init() {
    initElements();

    // Load offline queue & settings from localStorage
    loadOfflineQueue();
    var cachedSettings = localStorage.getItem('task_logger_settings');
    if (cachedSettings) {
      try { Object.assign(state.settings, JSON.parse(cachedSettings)); } catch(e) {}
    }
    var cachedDevs = localStorage.getItem('cached_devices');
    if (cachedDevs) {
      try { state.devices = JSON.parse(cachedDevs); } catch(e) {}
    }

    // Theme toggle
    if (state.settings.darkMode) {
      document.body.classList.add('dark-mode');
    }

    // Time ticker
    updateClockDisplay();
    setInterval(updateClockDisplay, 1000);

    // Hostname autocomplete
    initHostnameAutocomplete();

    // Check timer restore
    restoreTimerIfActive();

    // Input listeners for Auto/Manual state machine
    el.inputTanggal.addEventListener('input', function() {
      state.dateAuto = false;
      updateBadges();
    });
    el.inputStart.addEventListener('input', function() {
      state.startAuto = false;
      updateBadges();
    });
    el.inputEnd.addEventListener('input', function() {
      state.endAuto = false;
      updateBadges();
    });

    // Reset icons
    el.btnResetTanggal.addEventListener('click', function() {
      state.dateAuto = true;
      updateBadges();
      updateClockDisplay();
    });
    el.btnResetStart.addEventListener('click', function() {
      state.startAuto = true;
      updateBadges();
      updateCalculatedStartTime();
    });
    el.btnResetEnd.addEventListener('click', function() {
      state.endAuto = true;
      updateBadges();
      updateClockDisplay();
    });

    // Duration Chips
    el.chipsContainer.addEventListener('click', function(e) {
      var chip = e.target.closest('.chip-btn');
      if (chip && chip.dataset.min) {
        applyDurationChip(parseInt(chip.dataset.min, 10));
      }
    });

    // Timer Mode
    el.timerBtn.addEventListener('click', toggleTimer);

    // Collapsible "More" details
    el.btnMore.addEventListener('click', function() {
      var isExpanded = el.moreContent.classList.toggle('expanded');
      el.btnMore.innerHTML = isExpanded ? '&#9650; Less details' : '&#9660; More details';
    });

    // Save button
    el.btnSave.addEventListener('click', handleSave);

    // Keyboard shortcut: Ctrl+Enter or Cmd+Enter to Save (FR-01)
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    });

    // Header buttons
    el.btnHistory.addEventListener('click', openHistoryModal);
    el.btnSettings.addEventListener('click', openSettingsModal);
    el.btnThemeToggle.addEventListener('click', function() {
      var isDark = document.body.classList.toggle('dark-mode');
      state.settings.darkMode = isDark;
      localStorage.setItem('task_logger_settings', JSON.stringify(state.settings));
    });

    // Modal close buttons
    el.btnCloseSettings.addEventListener('click', function() { el.settingsModal.classList.remove('visible'); });
    el.btnCloseHistory.addEventListener('click', function() { el.historyModal.classList.remove('visible'); });
    el.formSettings.addEventListener('submit', handleSaveSettings);
    el.btnImportCsv.addEventListener('click', handleDeviceCsvImport);

    // CSV File Reader
    el.csvFileInput.addEventListener('change', function(e) {
      var file = e.target.files[0];
      if (file) {
        var reader = new FileReader();
        reader.onload = function(evt) {
          el.csvTextarea.value = evt.target.result;
        };
        reader.readAsText(file);
      }
    });

    // Connection restored -> auto-flush offline queue
    window.addEventListener('online', flushOfflineQueue);
    window.addEventListener('focus', flushOfflineQueue);

    // Initial backend config fetch
    loadInitialConfig();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
