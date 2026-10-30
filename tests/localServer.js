/**
 * Daily Task Logger — Local Development Server
 * Simulates Google Apps Script Web App environment and google.script.run
 * for immediate browser preview and manual testing without deploying to Google.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const TimeUtils = require('../server/timeUtils.js');
const ColumnMapper = require('../server/columnMapper.js');
const Validation = require('../server/validation.js');
const SheetOperations = require('../server/sheetOperations.js');
const { MockSpreadsheet, MockPropertiesService, MockCacheService } = require('./mockSpreadsheetApp.js');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.resolve(__dirname, '..');

// In-memory test sheet
const mockSpreadsheet = new MockSpreadsheet();
const taskSheet = mockSpreadsheet.getSheetByName('Task Log');
const devSheet = mockSpreadsheet.getSheetByName('Devices');
const configSheet = mockSpreadsheet.getSheetByName('_Config');

// Initialize sheet headers
const defaultHeaders = [
  'No', 'Tanggal', 'Task', 'Action', 'Category [CR, INCIDENT, SUPPORT]',
  'Project Category', 'Severity', 'Impacted Device [Hostname]',
  'Status', 'Request by', 'Time Duration (Start)', 'Time Duration (End)',
  'Engineer', 'Remark/Note'
];
taskSheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);

// Seed sample historical row
const sampleRow = [
  1,
  TimeUtils.dateToSerial('9/1/2026'),
  'Cek Endpoint Cabang',
  'Cek disabled user dan learned MAC Address',
  'SUPPORT',
  'KANTOR CABANG',
  'Minor',
  'SW1_AREA JAMBI',
  'CLOSED',
  'Desktop',
  TimeUtils.timeToFraction('9:11:00 AM'),
  TimeUtils.timeToFraction('9:12:00 AM'),
  'Network Engineer',
  'Initial sample entry'
];
taskSheet.getRange(2, 1, 1, sampleRow.length).setValues([sampleRow]);

// Seed devices tab
devSheet.getRange(1, 1, 1, 3).setValues([['Hostname', 'Site', 'Project Category']]);
devSheet.getRange(2, 1, 3, 3).setValues([
  ['SW1_KCP JAKARTA TOMANG', 'Jakarta', 'KANTOR CABANG'],
  ['SW1_AREA JAMBI', 'Jambi', 'KANTOR CABANG'],
  ['ROUTER_CORE_HQ', 'Pusat', 'HEAD OFFICE']
]);

// Seed _Config tab
configSheet.getRange(1, 1, 1, 3).setValues([['Preset', 'Task', 'Action']]);
configSheet.getRange(2, 1, 1, 3).setValues([[
  'Cek Endpoint Cabang',
  'Cek Endpoint Cabang',
  'Cek disabled user dan learned MAC Address'
]]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml'
};

// API handler simulating google.script.run endpoints
function handleApi(endpoint, body, res) {
  let responseData = { success: false, error: 'Unknown endpoint' };

  try {
    const colMap = ColumnMapper.mapHeaders(taskSheet.getRange(1, 1, 1, 14).getValues()).map;

    if (endpoint === '/api/serverTime') {
      const now = new Date();
      responseData = {
        serverNowMs: now.getTime(),
        timeZone: 'Asia/Jakarta',
        isoString: now.toISOString(),
        formattedTime: TimeUtils.formatTimeForInput(now, 'Asia/Jakarta'),
        formattedDate: TimeUtils.formatDateForInput(now, 'Asia/Jakarta')
      };
    } else if (endpoint === '/api/getConfig') {
      const devices = ['SW1_KCP JAKARTA TOMANG', 'SW1_AREA JAMBI', 'ROUTER_CORE_HQ'];
      responseData = {
        success: true,
        colMap: colMap,
        dropdownOptions: {
          category: ['SUPPORT', 'CR', 'INCIDENT'],
          projectCategory: ['KANTOR CABANG'],
          severity: ['Minor', 'Major', 'Critical'],
          status: ['CLOSED', 'IN PROGRESS', 'PENDING', 'OPEN'],
          requestBy: ['Desktop', 'IT REP', 'Network'],
          engineer: ['Network Engineer']
        },
        presets: [
          {
            label: 'Cek Endpoint Cabang',
            task: 'Cek Endpoint Cabang',
            action: 'Cek disabled user dan learned MAC Address'
          }
        ],
        devices: devices,
        typicalDurations: {
          'cek endpoint cabang|||cek disabled user dan learned mac address': 5
        },
        settings: {
          engineer: 'Network Engineer',
          timeZone: 'Asia/Jakarta',
          fallbackDuration: 5,
          disableUppercaseHostname: false
        }
      };
    } else if (endpoint === '/api/saveEntry') {
      const entry = body;
      const valid = Validation.validateEntry(entry, { serverNowMs: Date.now() });
      if (!valid.isValid) {
        responseData = { success: false, error: valid.errors.join(' ') };
      } else {
        const targetRow = SheetOperations.findNextAvailableRow(taskSheet, colMap, 1);
        const computedNo = SheetOperations.calculateNextNo(taskSheet, colMap.no || 1, targetRow, 1);
        const rowVals = SheetOperations.assembleRowValues(colMap, entry, computedNo, 14);
        taskSheet.getRange(targetRow, 1, 1, 14).setValues([rowVals]);
        responseData = {
          success: true,
          rowNumber: targetRow,
          no: computedNo,
          entry: entry
        };
      }
    } else if (endpoint === '/api/undoLast') {
      const rowNum = body.rowNumber;
      const writtenEntry = body.entry;
      responseData = SheetOperations.undoLastRow(taskSheet, colMap, rowNum, writtenEntry);
    } else if (endpoint === '/api/todayRows') {
      const lastRow = taskSheet.getLastRow();
      const allRows = [];
      const allSerials = [];
      let totalMin = 0;

      for (let r = 2; r <= lastRow; r++) {
        const vals = taskSheet.getRange(r, 1, 1, 14).getValues()[0];
        if (typeof vals[1] === 'number') allSerials.push(vals[1]);
        if (vals[2]) { // has Task
          const startFrac = vals[10];
          const endFrac = vals[11];
          let durationMin = 0;
          if (typeof startFrac === 'number' && typeof endFrac === 'number') {
            durationMin = Math.round((endFrac - startFrac) * 1440);
            if (durationMin < 0) durationMin += 1440;
            totalMin += durationMin;
          }
          allRows.push({
            rowNumber: r,
            task: vals[2],
            action: vals[3],
            category: vals[4] || 'SUPPORT',
            hostname: vals[7],
            timeStart: TimeUtils.fractionToTimeStr(startFrac, true),
            timeEnd: TimeUtils.fractionToTimeStr(endFrac, true),
            durationMinutes: durationMin
          });
        }
      }
      responseData = {
        success: true,
        count: allRows.length,
        totalMinutes: totalMin,
        rows: allRows,
        weekCounts: TimeUtils.weekCountsFromSerials(
          allSerials,
          TimeUtils.dateToSerial(new Date(), 'Asia/Jakarta')
        )
      };
    } else if (endpoint === '/api/saveSettings') {
      responseData = { success: true };
    } else if (endpoint === '/api/testSpreadsheet') {
      const url = typeof body === 'string' ? body : ((body && (body.url || body.spreadsheetUrl)) || '');
      if (String(url).trim()) {
        responseData = { success: true, message: 'Connected (mock).' };
      } else {
        responseData = { success: false, error: 'No Spreadsheet Web App URL provided.' };
      }
    } else if (endpoint === '/api/importDevices') {
      responseData = { success: true, addedCount: 2, skippedCount: 1 };
    }
  } catch (err) {
    responseData = { success: false, error: err.message };
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(responseData));
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = parsedUrl.pathname;

  // Handle mock API calls
  if (pathname.startsWith('/api/')) {
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', () => {
      let body = null;
      try { body = bodyStr ? JSON.parse(bodyStr) : null; } catch (e) {}
      handleApi(pathname, body, res);
    });
    return;
  }

  // Handle static assets
  if (pathname === '/' || pathname === '/index.html') {
    pathname = '/client/index.html';
  } else if (!pathname.startsWith('/client/') && !pathname.startsWith('/server/')) {
    pathname = '/client' + pathname;
  }

  const filePath = path.join(ROOT_DIR, pathname);
  const ext = path.extname(filePath);
  const mimeType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File not found: ' + pathname);
      return;
    }

    if (ext === '.html') {
      // Inject client-side mock bridge for google.script.run
      let htmlStr = data.toString();
      const mockBridge = `
      <script>
        // Google Apps Script client runner emulation
        window.__MOCK_BACKEND__ = {
          serverTime: function() { return fetch('/api/serverTime').then(r => r.json()); },
          getConfig: function() { return fetch('/api/getConfig').then(r => r.json()); },
          saveEntry: function(payload) {
            return fetch('/api/saveEntry', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            }).then(r => r.json());
          },
          undoLast: function(payload) {
            return fetch('/api/undoLast', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            }).then(r => r.json());
          },
          todayRows: function() { return fetch('/api/todayRows').then(r => r.json()); },
          saveSettings: function(settings) {
            return fetch('/api/saveSettings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(settings)
            }).then(r => r.json());
          },
          importDevices: function(csv) {
            return fetch('/api/importDevices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(csv)
            }).then(r => r.json());
          },
          testSpreadsheet: function(payload) {
            return fetch('/api/testSpreadsheet', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            }).then(r => r.json());
          }
        };
      </script>
      `;
      htmlStr = htmlStr.replace('</head>', mockBridge + '</head>');
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(htmlStr);
    } else {
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(data);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`Daily Task Logger Local Dev Server running!`);
  console.log(`Access in browser: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
