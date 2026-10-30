/**
 * Daily Task Logger — Client Application Controller
 * Handles UI interactions, auto/manual time tracking, offline queue,
 * sticky defaults, undo window, and backend synchronization.
 */

(function(window, document) {
  'use strict';

  // --- Default Network Engineering Task & Action Seeds ---
  var DEFAULT_TASKS = [
    'Cek Endpoint Cabang',
    'Backup Configuration',
    'Troubleshooting Network Interface',
    'VLAN & Port Security Audit',
    'Firmware Upgrade & Maintenance',
    'Routing BGP/OSPF Check',
    'Hardware Replacement (RMA)',
    'Monitoring & Bandwidth Check'
  ];

  var DEFAULT_ACTIONS = [
    'Cek disabled user dan learned MAC Address',
    'Show running-config dan export backup ke TFTP/FTP',
    'Investigasi link flap, CRC errors, dan input drops',
    'Konfigurasi access port, trunking, dan port-security',
    'Verifikasi BGP neighbor status dan routing table',
    'Inspeksi utilisasi CPU, memory, dan bandwidth uplink',
    'Reboot dan health-check perangkat setelah maintenance',
    'Ganti patch cord dan verifikasi link operational up'
  ];

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
    tasks: [],
    actions: [],
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
    saving: false,
    undo: { toast: null, timerId: null, entry: null, rowNumber: null },
    lastFocused: null,

    // Weekday counts
    weekdayCounts: { Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0 }
  };

  // --- DOM Elements ---
  var el = {};

  // Original Save button markup, captured once in init() so the icon and the
  // "(Ctrl+Enter)" hint survive every save attempt.
  var SAVE_LABEL_HTML = '';

  // Save watchdog: never leave the form stuck in the "Saving..." state.
  var SAVE_WATCHDOG_MS = 20000;

  // Undo toast lifetime
  var UNDO_SECONDS = 30;

  var FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  // HTML sanitization helper to prevent Stored XSS (CWE-79)
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function initElements() {
    el.currentClock = document.getElementById('currentClock');
    el.statusBanner = document.getElementById('statusBanner');
    el.statusBannerText = document.getElementById('statusBannerText');
    el.presetsContainer = document.getElementById('presetsContainer');
    el.weekdayStrip = document.getElementById('weekdayStrip');

    // Form inputs with Combobox Autocomplete
    el.inputTanggal = document.getElementById('inputTanggal');
    el.badgeTanggal = document.getElementById('badgeTanggal');
    el.btnResetTanggal = document.getElementById('btnResetTanggal');

    el.inputTask = document.getElementById('inputTask');
    el.taskList = document.getElementById('taskList');
    el.btnToggleTask = document.getElementById('btnToggleTask');

    el.inputAction = document.getElementById('inputAction');
    el.actionList = document.getElementById('actionList');
    el.btnToggleAction = document.getElementById('btnToggleAction');

    el.radioCategory = document.getElementsByName('category');
    el.selectProjectCategory = document.getElementById('selectProjectCategory');
    el.selectSeverity = document.getElementById('selectSeverity');

    el.inputHostname = document.getElementById('inputHostname');
    el.hostnameList = document.getElementById('hostnameList');
    el.btnToggleHostname = document.getElementById('btnToggleHostname');
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

    // Sidebar Live Feed (Desktop / Laptop First)
    el.desktopFeedList = document.getElementById('desktopFeedList');
    el.statTodayBadge = document.getElementById('statTodayBadge');
    el.statTodayCount = document.getElementById('statTodayCount');
    el.statTodayMinutes = document.getElementById('statTodayMinutes');
    el.btnRefreshFeed = document.getElementById('btnRefreshFeed');
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
    // Never throw out of a backend call: route every error through onFailure.
    function failureHandler(prefix) {
      return function(err) {
        if (typeof onFailure === 'function') {
          onFailure(err);
          return;
        }
        showToast(prefix + ': ' + ((err && err.message) || err), 'error');
      };
    }

    try {
      if (window.google && window.google.script && window.google.script.run) {
        var runner = window.google.script.run
          .withSuccessHandler(onSuccess)
          .withFailureHandler(failureHandler('Server error'));
        if (args !== undefined && args !== null) {
          runner[methodName](args);
        } else {
          runner[methodName]();
        }
      } else if (window.__MOCK_BACKEND__) {
        // Local development mock server
        window.__MOCK_BACKEND__[methodName](args)
          .then(onSuccess)
          .catch(failureHandler('Mock server error'));
      } else {
        // Offline fallback
        setTimeout(function() {
          if (onFailure) onFailure(new Error('Backend unavailable (Offline)'));
        }, 50);
      }
    } catch (err) {
      failureHandler('Backend error')(err);
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

  // --- Autocomplete & Combobox Helpers ---
  function addUniqueOption(list, val, prepend) {
    if (!val) return false;
    var trimmed = String(val).trim();
    if (!trimmed) return false;
    for (var i = 0; i < list.length; i++) {
      if (list[i].toLowerCase() === trimmed.toLowerCase()) {
        return false;
      }
    }
    if (prepend) {
      list.unshift(trimmed);
    } else {
      list.push(trimmed);
    }
    return true;
  }

  var openComboboxCloseFn = null;

  function setupCombobox(options) {
    var input = options.input;
    var list = options.list;
    var toggleBtn = options.toggleBtn;
    var getItems = options.getItems;
    var onSelect = options.onSelect;
    var maxResults = options.maxResults || 10;
    var activeIdx = -1;

    if (!input || !list) return null;

    function close() {
      list.classList.remove('visible');
      if (toggleBtn) toggleBtn.classList.remove('open');
      activeIdx = -1;
      if (openComboboxCloseFn === close) openComboboxCloseFn = null;
    }

    function renderItems(matches, query) {
      list.innerHTML = '';
      activeIdx = -1;

      if (!matches || matches.length === 0) {
        if (query && query.trim()) {
          var emptyItem = document.createElement('div');
          emptyItem.className = 'autocomplete-empty';
          emptyItem.textContent = 'Custom entry: "' + query.trim() + '" (will be remembered)';
          list.appendChild(emptyItem);
          list.classList.add('visible');
          if (toggleBtn) toggleBtn.classList.add('open');
        } else {
          close();
        }
        return;
      }

      for (var i = 0; i < matches.length; i++) {
        var m = matches[i];
        var itemVal = m.value || m.hostname || m.text;

        var item = document.createElement('div');
        item.className = 'autocomplete-item';
        item.setAttribute('role', 'option');

        var textSpan = document.createElement('span');
        textSpan.className = 'match-text';
        textSpan.textContent = itemVal;
        item.appendChild(textSpan);

        if (m.isExact) {
          var tagSpan = document.createElement('span');
          tagSpan.className = 'match-tag';
          tagSpan.textContent = 'Exact';
          item.appendChild(tagSpan);
        }

        item.addEventListener('click', (function(val) {
          return function(e) {
            e.stopPropagation();
            input.value = val;
            close();
            if (typeof onSelect === 'function') onSelect(val);
            input.focus();
          };
        })(itemVal));

        list.appendChild(item);
      }

      list.classList.add('visible');
      if (toggleBtn) toggleBtn.classList.add('open');
      if (openComboboxCloseFn && openComboboxCloseFn !== close) {
        openComboboxCloseFn();
      }
      openComboboxCloseFn = close;
    }

    function showSuggestions(query) {
      var allItems = (typeof getItems === 'function') ? getItems() : [];
      var matches = Autocomplete.search(query || '', allItems, maxResults);
      renderItems(matches, query);
    }

    input.addEventListener('input', function() {
      activeIdx = -1;
      showSuggestions(this.value);
    });

    input.addEventListener('focus', function() {
      showSuggestions(this.value);
    });

    if (toggleBtn) {
      toggleBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (list.classList.contains('visible')) {
          close();
        } else {
          input.focus();
          showSuggestions(input.value);
        }
      });
    }

    input.addEventListener('keydown', function(e) {
      var items = list.querySelectorAll('.autocomplete-item');
      if (!items || items.length === 0 || !list.classList.contains('visible')) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          showSuggestions(input.value);
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = (activeIdx + 1) % items.length;
        updateActiveItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = (activeIdx - 1 + items.length) % items.length;
        updateActiveItem(items);
      } else if (e.key === 'Enter') {
        if (activeIdx > -1 && items[activeIdx]) {
          e.preventDefault();
          items[activeIdx].click();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    function updateActiveItem(items) {
      for (var i = 0; i < items.length; i++) {
        if (i === activeIdx) {
          items[i].classList.add('active');
          items[i].scrollIntoView({ block: 'nearest' });
        } else {
          items[i].classList.remove('active');
        }
      }
    }

    document.addEventListener('click', function(e) {
      if (!input.contains(e.target) && !list.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
        close();
      }
    });

    return {
      close: close,
      show: showSuggestions
    };
  }

  function initComboboxes() {
    // 1. Task combobox dropdown
    setupCombobox({
      input: el.inputTask,
      list: el.taskList,
      toggleBtn: el.btnToggleTask,
      getItems: function() { return state.tasks; },
      maxResults: 10,
      onSelect: function(taskVal) {
        if (!el.inputAction.value && state.presets) {
          var matchedPreset = state.presets.find(function(p) { return p.task === taskVal; });
          if (matchedPreset && matchedPreset.action) {
            el.inputAction.value = matchedPreset.action;
          }
        }
        if (state.startAuto) {
          updateCalculatedStartTime();
        }
      }
    });

    // 2. Action combobox dropdown
    setupCombobox({
      input: el.inputAction,
      list: el.actionList,
      toggleBtn: el.btnToggleAction,
      getItems: function() { return state.actions; },
      maxResults: 10,
      onSelect: function(actionVal) {
        if (state.startAuto) {
          updateCalculatedStartTime();
        }
      }
    });

    // 3. Hostname combobox dropdown
    setupCombobox({
      input: el.inputHostname,
      list: el.hostnameList,
      toggleBtn: el.btnToggleHostname,
      getItems: function() { return state.devices; },
      maxResults: 10,
      onSelect: function(hostVal) {
        if (el.newDeviceNotice) el.newDeviceNotice.style.display = 'none';
      }
    });

    // Hostname new-device indicator check
    el.inputHostname.addEventListener('input', function() {
      var val = (this.value || '').trim().toUpperCase();
      var isKnown = state.devices.some(function(d) {
        return d.toUpperCase() === val;
      });
      if (!isKnown && val.length > 2) {
        el.newDeviceNotice.style.display = 'block';
      } else {
        el.newDeviceNotice.style.display = 'none';
      }
    });
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
  // weekCounts is the Mon..Sun map the backend computes for the current week in
  // the configured timezone. Counting today's rows here made every earlier
  // weekday look "missed", so the counts must come from the backend.
  function updateWeekdayStrip(weekCounts) {
    var counts = weekCounts || {};
    var keys = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

    var todayKey = '';
    try {
      todayKey = new Intl.DateTimeFormat('en-US', {
        timeZone: state.settings.timeZone || 'Asia/Jakarta',
        weekday: 'short'
      }).format(ClockSync.nowDate());
    } catch (e) {
      todayKey = '';
    }

    var todayIdx = keys.indexOf(todayKey);
    var isWeekend = todayKey === 'Sat' || todayKey === 'Sun';

    var html = '';
    keys.forEach(function(k, idx) {
      var c = Number(counts[k] || 0);
      var isToday = k === todayKey;
      // Weekend days do not belong to the Mon-Fri coverage window.
      var isPast = !isWeekend && todayIdx > -1 && idx < todayIdx;
      var countClass = 'weekday-count';

      if (c > 0) countClass += ' has-entries';
      if (isToday) countClass += ' today';
      if (isPast && c === 0) countClass += ' missed';

      html += '<div class="weekday-col" role="listitem" aria-label="' +
        k + ', ' + c + (c === 1 ? ' entry' : ' entries') + '">' +
        '<span class="weekday-name" aria-hidden="true">' + k + '</span>' +
        '<div class="' + countClass + '">' + c + '</div>' +
        '</div>';
    });

    el.weekdayStrip.innerHTML = html;
  }

  // --- Save Workflow ---
  function restoreSaveButton() {
    if (!el.btnSave) return;
    el.btnSave.disabled = false;
    el.btnSave.removeAttribute('aria-busy');
    el.btnSave.innerHTML = SAVE_LABEL_HTML;
  }

  function handleSave() {
    if (state.saving) return;
    state.saving = true;

    // Drop any undo timer left over from a previous save so it can never clear
    // the state of the save we are about to register.
    clearUndoToast();

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
      state.saving = false;
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
        state.saving = false;
        showToast('Please adjust Start or End time.', 'warning');
        return;
      }
    }

    var durationMin = endMin - startMin + (isNextDay ? 1440 : 0);
    var confirmLong = false;
    if (durationMin > 720) {
      confirmLong = window.confirm('Task duration is over 12 hours (' + Math.round(durationMin / 60) + 'h). Proceed?');
      if (!confirmLong) {
        state.saving = false;
        return;
      }
    }

    // Automatically register and persist any new Task or Action option for dropdown autocomplete
    var isNewTask = addUniqueOption(state.tasks, task, true);
    if (isNewTask) {
      try { localStorage.setItem('task_logger_tasks', JSON.stringify(state.tasks)); } catch(e) {}
    }

    var isNewAction = addUniqueOption(state.actions, action, true);
    if (isNewAction) {
      try { localStorage.setItem('task_logger_actions', JSON.stringify(state.actions)); } catch(e) {}
    }

    var isNewDevice = addUniqueOption(state.devices, hostname, true);
    if (isNewDevice) {
      try { localStorage.setItem('cached_devices', JSON.stringify(state.devices)); } catch(e) {}
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
    el.btnSave.setAttribute('aria-busy', 'true');
    el.btnSave.innerHTML = '<span class="pulse-dot"></span> Saving...';

    // Watchdog: a pending save must never lock the form forever.
    var watchdogId = setTimeout(function() {
      if (!state.saving) return;
      state.saving = false;
      restoreSaveButton();
      showToast('Still saving — check the sheet before retrying.', 'warning');
    }, SAVE_WATCHDOG_MS);

    callBackend('saveEntry', payload, function(res) {
      clearTimeout(watchdogId);
      state.saving = false;
      restoreSaveButton();

      if (res && res.success) {
        showSaveSuccess(res.rowNumber, payload);
        applyStickyDefaults();
        refreshTodayFeed();
      } else {
        var errMsg = res ? res.error : 'Unknown save error';
        showToast(errMsg, 'error');
      }
    }, function(err) {
      clearTimeout(watchdogId);
      state.saving = false;
      restoreSaveButton();

      // Only queue when this really looks like a network/offline failure;
      // a real backend error keeps the form populated for a retry.
      var offline = (navigator.onLine === false) ||
        !err ||
        /network|offline|failed to fetch|timeout/i.test(String((err && err.message) || err));

      if (offline) {
        enqueueOfflineSave(payload);
        applyStickyDefaults();
        showToast('Saved offline to queue (Pending). Will sync automatically.', 'info');
      } else {
        showToast('Save failed: ' + String((err && err.message) || err), 'error');
      }
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

  function updateOfflineStatusBanner(syncFailed) {
    var count = state.offlineQueue.length;
    if (count > 0) {
      el.statusBanner.classList.add('visible');
      el.statusBannerText.textContent = syncFailed
        ? 'Pending (' + count + ') — Sync failed, will retry...'
        : 'Pending (' + count + ') — Syncing automatically...';
    } else {
      el.statusBanner.classList.remove('visible');
    }
  }

  function flushOfflineQueue() {
    if (state.offlineQueue.length === 0) return;

    var queueCopy = state.offlineQueue.slice();

    // Persist everything from fromIndex onwards (the failed item included).
    var persistPending = function(fromIndex, syncFailed) {
      state.offlineQueue = queueCopy.slice(fromIndex);
      try {
        localStorage.setItem('offline_task_queue', JSON.stringify(state.offlineQueue));
      } catch (e) {}
      updateOfflineStatusBanner(syncFailed);
    };

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
        if (res && res.success === false) {
          // The backend rejected this entry: keep it (and everything after it)
          // queued instead of silently dropping the batch.
          persistPending(index, true);
          showToast('Offline sync failed: ' + ((res && res.error) || 'Unknown error'), 'error');
          return;
        }
        processNext(index + 1);
      }, function(err) {
        // Still failing, pause queue
        persistPending(index, true);
      });
    };

    processNext(0);
  }

  // --- Undo (30s) Toast (FR-10 & S3-5) ---
  function clearUndoToast() {
    if (state.undo.timerId) {
      clearInterval(state.undo.timerId);
      state.undo.timerId = null;
    }
    if (state.undo.toast && state.undo.toast.parentNode) {
      state.undo.toast.parentNode.removeChild(state.undo.toast);
    }
    state.undo.toast = null;
    state.undo.entry = null;
    state.undo.rowNumber = null;
  }

  // Removes the short-lived toasts but never the actionable Undo toast.
  function clearTransientToasts() {
    if (!el.toastContainer) return;
    var nodes = el.toastContainer.querySelectorAll('.toast:not(.toast-undo)');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
  }

  function showSaveSuccess(rowNumber, payload) {
    // A newer save replaces any older undo window.
    clearUndoToast();

    var msg = 'Saved to row ' + (rowNumber || '') + '!';
    var toast = document.createElement('div');
    toast.className = 'toast toast-undo';
    toast.innerHTML = '<span>' + msg + '</span>' +
      '<button type="button" class="btn-undo" aria-label="Undo last save">Undo <span aria-hidden="true">(' + UNDO_SECONDS + 's)</span></button>';

    clearTransientToasts();
    el.toastContainer.appendChild(toast);

    var undoBtn = toast.querySelector('.btn-undo');
    var secondsLabel = toast.querySelector('.btn-undo span');
    var secondsLeft = UNDO_SECONDS;

    state.undo.toast = toast;
    state.undo.entry = payload;
    state.undo.rowNumber = rowNumber;

    state.undo.timerId = setInterval(function() {
      secondsLeft--;
      if (secondsLeft > 0) {
        if (secondsLabel) secondsLabel.textContent = '(' + secondsLeft + 's)';
      } else {
        clearUndoToast();
      }
    }, 1000);

    if (undoBtn) {
      undoBtn.addEventListener('click', function() {
        var savedInfo = { rowNumber: state.undo.rowNumber, entry: state.undo.entry };
        clearUndoToast();
        handleUndo(savedInfo);
      });
    }
  }

  function handleUndo(savedInfo) {
    if (!savedInfo) return;
    showToast('Reversing last save...', 'info');

    callBackend('undoLast', savedInfo, function(res) {
      if (res && res.success) {
        showToast('Row ' + savedInfo.rowNumber + ' removed successfully.', 'info');
        refreshTodayFeed();
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

    // Only replace transient toasts — the Undo toast has its own slot.
    clearTransientToasts();
    el.toastContainer.appendChild(toast);

    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4500);
  }

  // --- History & Live Feed Rendering ---
  var EMPTY_FEED_MESSAGE = 'No entries yet today — log your first task above.';

  function renderFeedCards(rows) {
    if (!rows || rows.length === 0) {
      var emptyHtml = '<div class="feed-empty">' + EMPTY_FEED_MESSAGE + '</div>';
      if (el.desktopFeedList) el.desktopFeedList.innerHTML = emptyHtml;
      if (el.historyList) el.historyList.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:16px;">' + EMPTY_FEED_MESSAGE + '</div>';
      return;
    }

    var html = '';
    rows.forEach(function(r) {
      var catClass = (r.category || 'SUPPORT').toLowerCase();
      html += '<div class="entry-card">' +
        '<div class="entry-card-header">' +
        '<span>' + escapeHtml(r.timeStart) + ' &ndash; ' + escapeHtml(r.timeEnd) + ' (' + (r.durationMinutes || 0) + 'm)</span>' +
        '<span class="category-chip ' + catClass + '">' + escapeHtml(r.category || 'SUPPORT') + '</span>' +
        '</div>' +
        '<div class="entry-card-title">' + escapeHtml(r.task) + '</div>' +
        '<div class="entry-card-meta">' + escapeHtml(r.action) + ' &bull; <strong>' + escapeHtml(r.hostname) + '</strong></div>' +
        '</div>';
    });

    if (el.desktopFeedList) el.desktopFeedList.innerHTML = html;
    if (el.historyList) el.historyList.innerHTML = html;
  }

  function refreshTodayFeed(callback) {
    callBackend('todayRows', null, function(res) {
      if (res && res.success) {
        var count = res.count || (res.rows ? res.rows.length : 0);
        var mins = res.totalMinutes || 0;
        var summary = count + ' tasks | ' + mins + ' mins';

        if (el.historyTotal) el.historyTotal.textContent = summary;
        if (el.statTodayBadge) el.statTodayBadge.textContent = count + (count === 1 ? ' task' : ' tasks');
        if (el.statTodayCount) el.statTodayCount.textContent = count;
        if (el.statTodayMinutes) {
          if (mins >= 60) {
            var hrs = (mins / 60).toFixed(1);
            el.statTodayMinutes.textContent = mins + 'm (' + hrs + 'h)';
          } else {
            el.statTodayMinutes.textContent = mins + 'm';
          }
        }

        // Merge today's tasks and actions into combobox lists
        if (res.rows && Array.isArray(res.rows)) {
          var updatedTasks = false;
          var updatedActions = false;
          var updatedDevices = false;
          res.rows.forEach(function(r) {
            if (r.task && addUniqueOption(state.tasks, r.task, false)) updatedTasks = true;
            if (r.action && addUniqueOption(state.actions, r.action, false)) updatedActions = true;
            if (r.hostname && addUniqueOption(state.devices, r.hostname, false)) updatedDevices = true;
          });
          try {
            if (updatedTasks) localStorage.setItem('task_logger_tasks', JSON.stringify(state.tasks));
            if (updatedActions) localStorage.setItem('task_logger_actions', JSON.stringify(state.actions));
            if (updatedDevices) localStorage.setItem('cached_devices', JSON.stringify(state.devices));
          } catch(e) {}
        }

        renderFeedCards(res.rows);
        updateWeekdayStrip(res.weekCounts);
      }
      if (typeof callback === 'function') callback(res);
    });
  }

  // --- Modal Dialog Semantics & Focus Management ---
  function getModalBox(modalEl) {
    return modalEl ? modalEl.querySelector('.modal-box') : null;
  }

  function getFocusable(container) {
    var list = [];
    if (!container) return list;
    var nodes = container.querySelectorAll(FOCUSABLE_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      // Skip elements hidden by CSS (offsetParent is null for display:none).
      if (nodes[i].offsetParent === null) continue;
      list.push(nodes[i]);
    }
    return list;
  }

  function getVisibleModal() {
    return document.querySelector('.modal-overlay.visible');
  }

  // The modals live inside .app-container, so inert only its other children.
  function setBackgroundInert(activeModal, isInert) {
    var container = document.querySelector('.app-container');
    if (!container) return;
    var children = container.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (!child || child === activeModal || child.contains(activeModal)) continue;
      // Keep the toast layer active so live-region announcements and the Undo
      // button still work while a dialog is open.
      if (child.classList && child.classList.contains('toast-container')) continue;
      if ('inert' in child) {
        child.inert = isInert;
      } else if (isInert) {
        child.setAttribute('inert', '');
      } else {
        child.removeAttribute('inert');
      }
    }
  }

  function openModal(modalEl) {
    if (!modalEl) return;
    state.lastFocused = document.activeElement || null;
    modalEl.classList.add('visible');
    setBackgroundInert(modalEl, true);

    var box = getModalBox(modalEl);
    var focusables = getFocusable(box);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else if (box) {
      if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
      box.focus();
    }
  }

  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.classList.remove('visible');
    setBackgroundInert(modalEl, false);

    var restoreTo = state.lastFocused;
    state.lastFocused = null;
    if (restoreTo && typeof restoreTo.focus === 'function' && document.contains(restoreTo)) {
      restoreTo.focus();
    }
  }

  // Keep Tab / Shift+Tab cycling inside the open dialog.
  function trapModalFocus(e, modalEl) {
    var box = getModalBox(modalEl);
    if (!box) return;
    var focusables = getFocusable(box);
    if (focusables.length === 0) {
      e.preventDefault();
      box.focus();
      return;
    }
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || document.activeElement === box) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last || document.activeElement === box) {
      e.preventDefault();
      first.focus();
    }
  }

  function openHistoryModal() {
    el.historyList.innerHTML = '<div style="text-align:center;padding:12px;">Loading today\'s entries...</div>';
    openModal(el.historyModal);
    refreshTodayFeed();
  }

  // --- Settings & CSV Device Importer ---
  function openSettingsModal() {
    var urlInput = document.getElementById('settingSpreadsheetUrl');
    if (urlInput) urlInput.value = state.settings.spreadsheetUrl || '';
    document.getElementById('settingEngineer').value = state.settings.engineer || '';
    document.getElementById('settingTimezone').value = state.settings.timeZone || 'Asia/Jakarta';
    document.getElementById('settingFallback').value = state.settings.fallbackDuration || 5;
    document.getElementById('settingUppercase').checked = !state.settings.disableUppercaseHostname;
    var statusEl = document.getElementById('spreadsheetConnectionStatus');
    if (statusEl) {
      if (state.settings.spreadsheetUrl) {
        statusEl.textContent = 'Configured (Click Test to verify)';
        statusEl.style.color = 'var(--primary)';
      } else {
        statusEl.textContent = 'Local Server Mode (Tasks saved locally)';
        statusEl.style.color = 'var(--text-muted)';
      }
    }
    openModal(el.settingsModal);
  }

  function handleSaveSettings(e) {
    e.preventDefault();
    var urlInput = document.getElementById('settingSpreadsheetUrl');
    if (urlInput) {
      state.settings.spreadsheetUrl = urlInput.value.trim();
    }
    state.settings.engineer = document.getElementById('settingEngineer').value.trim();
    state.settings.timeZone = document.getElementById('settingTimezone').value.trim() || 'Asia/Jakarta';
    state.settings.fallbackDuration = parseInt(document.getElementById('settingFallback').value, 10) || 5;
    state.settings.disableUppercaseHostname = !document.getElementById('settingUppercase').checked;

    localStorage.setItem('task_logger_settings', JSON.stringify(state.settings));
    callBackend('saveSettings', state.settings, function() {
      showToast('Settings saved successfully.', 'info');
      closeModal(el.settingsModal);
      // Refresh config only — the clock sync is already initialised and must not
      // register a second set of listeners/intervals.
      refreshConfig();
    });
  }

  function handleTestSpreadsheetConnection() {
    var urlInput = document.getElementById('settingSpreadsheetUrl');
    var statusEl = document.getElementById('spreadsheetConnectionStatus');
    var testBtn = document.getElementById('btnTestSpreadsheet');
    var targetUrl = urlInput ? urlInput.value.trim() : '';

    if (!targetUrl) {
      if (statusEl) {
        statusEl.textContent = 'Please enter a Google Apps Script Web App URL first.';
        statusEl.style.color = 'var(--warning)';
      }
      return;
    }

    // Single exit point: the button can never stay stuck on "Testing...".
    var finish = function(message, color) {
      if (testBtn) {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Connection';
      }
      if (statusEl) {
        statusEl.textContent = message;
        statusEl.style.color = color;
      }
    };

    if (testBtn) {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
    }
    if (statusEl) {
      statusEl.textContent = 'Testing connection...';
      statusEl.style.color = 'var(--primary)';
    }

    try {
      callBackend('testSpreadsheet', { url: targetUrl }, function(res) {
        if (res && res.success) {
          finish('Connected! ' + (res.message || ''), 'var(--success)');
        } else {
          finish('Error: ' + (res ? res.error : 'Connection failed'), 'var(--danger)');
        }
      }, function(err) {
        finish('Error connecting to server' + (err && err.message ? ': ' + err.message : ''), 'var(--danger)');
      });
    } catch (err) {
      finish('Error connecting to server', 'var(--danger)');
    }
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
        // Refresh devices list (config only — no clock re-init)
        refreshConfig();
      } else {
        el.csvImportResult.textContent = 'Error: ' + (res ? res.error : 'Import failed');
        el.csvImportResult.style.color = 'var(--danger)';
      }
    });
  }

  // --- Initial Configuration Loader ---
  // Fetches sheet metadata & validation only (safe to re-run any time).
  function refreshConfig() {
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
        if (res.tasks && Array.isArray(res.tasks)) {
          var hasNewT = false;
          res.tasks.forEach(function(t) { if (addUniqueOption(state.tasks, t, false)) hasNewT = true; });
          if (hasNewT) try { localStorage.setItem('task_logger_tasks', JSON.stringify(state.tasks)); } catch(e) {}
        }
        if (res.actions && Array.isArray(res.actions)) {
          var hasNewA = false;
          res.actions.forEach(function(a) { if (addUniqueOption(state.actions, a, false)) hasNewA = true; });
          if (hasNewA) try { localStorage.setItem('task_logger_actions', JSON.stringify(state.actions)); } catch(e) {}
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
  }

  function loadInitialConfig() {
    // 1. Clock Sync (registers its listeners once)
    ClockSync.initAutoSync(function(onSuccess, onFailure) {
      callBackend('serverTime', null, onSuccess, onFailure);
    });

    // 2. Fetch sheet metadata & validation
    refreshConfig();

    // 3. Update today rows & live activity feed
    refreshTodayFeed();
  }

  // --- App Initialization ---
  function init() {
    initElements();

    // Remember the pristine Save button markup (icon + Ctrl+Enter hint).
    SAVE_LABEL_HTML = el.btnSave ? el.btnSave.innerHTML : '';

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
    var cachedTasks = localStorage.getItem('task_logger_tasks');
    if (cachedTasks) {
      try { state.tasks = JSON.parse(cachedTasks); } catch(e) {}
    }
    if (!state.tasks || state.tasks.length === 0) {
      state.tasks = DEFAULT_TASKS.slice();
    }
    var cachedActions = localStorage.getItem('task_logger_actions');
    if (cachedActions) {
      try { state.actions = JSON.parse(cachedActions); } catch(e) {}
    }
    if (!state.actions || state.actions.length === 0) {
      state.actions = DEFAULT_ACTIONS.slice();
    }

    // Theme toggle
    if (state.settings.darkMode) {
      document.body.classList.add('dark-mode');
    }

    // Time ticker
    updateClockDisplay();
    setInterval(updateClockDisplay, 1000);

    // Comboboxes (Task, Action, Hostname autocomplete & dropdowns)
    initComboboxes();

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
      el.btnMore.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      el.btnMore.innerHTML = isExpanded ? '&#9650; Less details' : '&#9660; More details';
    });

    // Save button
    el.btnSave.addEventListener('click', handleSave);

    // Keyboard shortcuts: Ctrl/Cmd+Enter saves; dialogs own Escape and Tab.
    document.addEventListener('keydown', function(e) {
      var activeModal = getVisibleModal();
      if (activeModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeModal(activeModal);
        } else if (e.key === 'Tab') {
          trapModalFocus(e, activeModal);
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (state.saving) return;
        e.preventDefault();
        handleSave();
      }
    });

    // Header buttons
    el.btnHistory.addEventListener('click', openHistoryModal);
    el.btnSettings.addEventListener('click', openSettingsModal);
    if (el.btnRefreshFeed) {
      el.btnRefreshFeed.addEventListener('click', function() {
        refreshTodayFeed(function() {
          showToast('Live feed updated', 'info');
        });
      });
    }
    el.btnThemeToggle.addEventListener('click', function() {
      var isDark = document.body.classList.toggle('dark-mode');
      state.settings.darkMode = isDark;
      localStorage.setItem('task_logger_settings', JSON.stringify(state.settings));
    });

    // Modal close buttons & backdrop dismissal
    el.btnCloseSettings.addEventListener('click', function() { closeModal(el.settingsModal); });
    el.btnCloseHistory.addEventListener('click', function() { closeModal(el.historyModal); });
    [el.settingsModal, el.historyModal].forEach(function(modalEl) {
      if (!modalEl) return;
      modalEl.addEventListener('click', function(e) {
        if (e.target === modalEl) closeModal(modalEl);
      });
    });
    el.formSettings.addEventListener('submit', handleSaveSettings);
    var btnTest = document.getElementById('btnTestSpreadsheet');
    if (btnTest) btnTest.addEventListener('click', handleTestSpreadsheetConnection);
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
