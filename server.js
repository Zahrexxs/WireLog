/**
 * Daily Task Logger — Production Node.js Server
 * Hostable on local server, VPS, or Docker container.
 * 
 * Supports:
 * 1. Direct proxying to Google Apps Script Web App (auto-forwards saves to Google Sheets)
 * 2. Standalone local JSON persistence in ./data/ when running offline/independent
 * 3. Dynamic per-user Spreadsheet Web App URL configuration via Settings UI or .env
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const TimeUtils = require('./server/timeUtils.js');
const ColumnMapper = require('./server/columnMapper.js');
const Validation = require('./server/validation.js');
const SheetOperations = require('./server/sheetOperations.js');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');

// Ensure persistent data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');

// Initialize data files if not present
function loadJsonFile(filePath, defaultVal) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
  }
  return defaultVal;
}

function saveJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`Error saving ${filePath}:`, e.message);
  }
}

let storedSettings = loadJsonFile(SETTINGS_FILE, {
  spreadsheetUrl: process.env.SPREADSHEET_WEBAPP_URL || process.env.SPREADSHEET_URL || '',
  engineer: process.env.DEFAULT_ENGINEER || 'Network Engineer',
  timeZone: process.env.DEFAULT_TIMEZONE || 'Asia/Jakarta',
  fallbackDuration: 5,
  disableUppercaseHostname: false
});

let storedDevices = loadJsonFile(DEVICES_FILE, [
  'SW1_KCP JAKARTA TOMANG',
  'SW1_AREA JAMBI',
  'ROUTER_CORE_HQ'
]);

const defaultTasks = [
  'Cek Endpoint Cabang',
  'Backup Configuration',
  'Troubleshooting Network Interface',
  'VLAN & Port Security Audit',
  'Firmware Upgrade & Maintenance',
  'Routing BGP/OSPF Check',
  'Hardware Replacement (RMA)',
  'Monitoring & Bandwidth Check'
];

const defaultActions = [
  'Cek disabled user dan learned MAC Address',
  'Show running-config dan export backup ke TFTP/FTP',
  'Investigasi link flap, CRC errors, dan input drops',
  'Konfigurasi access port, trunking, dan port-security',
  'Verifikasi BGP neighbor status dan routing table',
  'Inspeksi utilisasi CPU, memory, dan bandwidth uplink',
  'Reboot dan health-check perangkat setelah maintenance',
  'Ganti patch cord dan verifikasi link operational up'
];

let storedTasks = loadJsonFile(TASKS_FILE, []);

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * Sends a request to Google Apps Script Web App (handles 302 redirects)
 */
function forwardToGoogleAppsScript(targetUrl, action, payload) {
  return new Promise((resolve, reject) => {
    if (!targetUrl || !targetUrl.startsWith('http')) {
      return resolve(null); // No remote URL configured
    }

    const postData = JSON.stringify({ action: action, payload: payload });
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = client.request(options, (res) => {
      // Handle Google redirect (302)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect (usually GET on the redirect target)
        https.get(res.headers.location, (redRes) => {
          let redBody = '';
          redRes.on('data', chunk => redBody += chunk);
          redRes.on('end', () => {
            try {
              resolve(JSON.parse(redBody));
            } catch (e) {
              resolve({ success: true, message: 'Google Apps Script processed request' });
            }
          });
        }).on('error', reject);
        return;
      }

      let resBody = '';
      res.on('data', chunk => resBody += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(resBody));
        } catch (e) {
          resolve({ success: true, raw: resBody });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * API Request Router
 */
async function handleApi(endpoint, body, res) {
  let responseData = { success: false, error: 'Unknown endpoint' };
  const targetWebappUrl = storedSettings.spreadsheetUrl || process.env.SPREADSHEET_WEBAPP_URL || '';

  try {
    // 1. Health check
    if (endpoint === '/api/health') {
      responseData = {
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: Date.now(),
        mode: targetWebappUrl ? 'google-sheets-connected' : 'local-storage',
        hasSpreadsheetUrl: Boolean(targetWebappUrl)
      };
    }

    // 2. Test Spreadsheet Connection
    else if (endpoint === '/api/testSpreadsheet') {
      const testUrl = (body && body.url) || targetWebappUrl;
      if (!testUrl) {
        responseData = { success: false, error: 'No Spreadsheet Web App URL provided.' };
      } else {
        try {
          const remoteRes = await forwardToGoogleAppsScript(testUrl, 'serverTime', {});
          if (remoteRes && (remoteRes.serverNowMs || remoteRes.success)) {
            responseData = {
              success: true,
              message: 'Successfully connected to Google Spreadsheet Web App!',
              serverTime: remoteRes.formattedTime || remoteRes.isoString
            };
          } else {
            responseData = {
              success: false,
              error: 'Connected, but received unexpected response. Ensure Web App is deployed with Access: Anyone.'
            };
          }
        } catch (err) {
          responseData = { success: false, error: 'Connection failed: ' + err.message };
        }
      }
    }

    // 3. Server Time
    else if (endpoint === '/api/serverTime') {
      const now = new Date();
      const tz = storedSettings.timeZone || 'Asia/Jakarta';
      responseData = {
        serverNowMs: now.getTime(),
        timeZone: tz,
        isoString: now.toISOString(),
        formattedTime: TimeUtils.formatTimeForInput(now, tz),
        formattedDate: TimeUtils.formatDateForInput(now, tz)
      };
    }

    // 4. Get Configuration & Dropdowns
    else if (endpoint === '/api/getConfig') {
      // If connected to remote Google Apps Script, fetch live sheet options
      if (targetWebappUrl) {
        try {
          const remoteConfig = await forwardToGoogleAppsScript(targetWebappUrl, 'getConfig', {});
          if (remoteConfig && remoteConfig.success) {
            remoteConfig.settings = Object.assign({}, remoteConfig.settings, storedSettings);
            responseData = remoteConfig;
            return sendJson(res, responseData);
          }
        } catch (e) {
          console.warn('Could not fetch config from remote Google Apps Script, using local fallback:', e.message);
        }
      }

      // Local fallback
      const knownTasks = new Set(defaultTasks);
      const knownActions = new Set(defaultActions);
      for (const t of storedTasks) {
        if (t.task) knownTasks.add(t.task.trim());
        if (t.action) knownActions.add(t.action.trim());
      }

      responseData = {
        success: true,
        tasks: Array.from(knownTasks),
        actions: Array.from(knownActions),
        dropdownOptions: {
          category: ['SUPPORT', 'CR', 'INCIDENT'],
          projectCategory: ['KANTOR CABANG'],
          severity: ['Minor', 'Major', 'Critical'],
          status: ['CLOSED', 'IN PROGRESS', 'PENDING', 'OPEN'],
          requestBy: ['Desktop', 'IT REP', 'Network', 'User'],
          engineer: storedSettings.engineer ? [storedSettings.engineer] : ['Network Engineer']
        },
        presets: [
          {
            label: 'Cek Endpoint Cabang',
            task: 'Cek Endpoint Cabang',
            action: 'Cek disabled user dan learned MAC Address',
            category: 'SUPPORT',
            projectCategory: 'KANTOR CABANG',
            severity: 'Minor'
          }
        ],
        devices: storedDevices,
        typicalDurations: {
          'cek endpoint cabang|||cek disabled user dan learned mac address': 5
        },
        settings: storedSettings
      };
    }

    // 5. Save Entry
    else if (endpoint === '/api/saveEntry') {
      const entry = body;
      const valid = Validation.validateEntry(entry, { serverNowMs: Date.now() });

      if (!valid.isValid) {
        responseData = { success: false, error: valid.errors.join(' ') };
      } else {
        // Forward to Google Apps Script if URL configured
        if (targetWebappUrl) {
          try {
            const remoteResult = await forwardToGoogleAppsScript(targetWebappUrl, 'saveEntry', entry);
            if (remoteResult && (remoteResult.success || remoteResult.rowNumber)) {
              // Also store in local backup
              storedTasks.push(Object.assign({ savedAt: new Date().toISOString(), syncedToGoogle: true }, entry));
              saveJsonFile(TASKS_FILE, storedTasks);
              return sendJson(res, remoteResult);
            }
          } catch (err) {
            console.error('Remote Google Sheet save failed, persisting locally:', err.message);
          }
        }

        // Local persistent save
        const rowNumber = storedTasks.length + 2; // header is row 1
        const record = Object.assign({
          rowNumber: rowNumber,
          no: storedTasks.length + 1,
          savedAt: new Date().toISOString(),
          syncedToGoogle: Boolean(targetWebappUrl)
        }, entry);

        storedTasks.push(record);
        saveJsonFile(TASKS_FILE, storedTasks);

        // Auto-add new device if unregistered
        if (entry.hostname && !storedDevices.includes(entry.hostname.toUpperCase())) {
          storedDevices.push(entry.hostname.toUpperCase());
          saveJsonFile(DEVICES_FILE, storedDevices);
        }

        responseData = {
          success: true,
          rowNumber: rowNumber,
          no: record.no,
          entry: entry,
          localOnly: !targetWebappUrl
        };
      }
    }

    // 6. Undo Last Save
    else if (endpoint === '/api/undoLast') {
      const rowNum = body.rowNumber;
      if (targetWebappUrl) {
        try {
          const remoteUndo = await forwardToGoogleAppsScript(targetWebappUrl, 'undoLast', body);
          if (remoteUndo && remoteUndo.success) {
            return sendJson(res, remoteUndo);
          }
        } catch (e) {
          console.warn('Remote undo failed:', e.message);
        }
      }

      // Local undo
      if (storedTasks.length > 0) {
        const last = storedTasks.pop();
        saveJsonFile(TASKS_FILE, storedTasks);
        responseData = { success: true, rowNumber: last.rowNumber || rowNum };
      } else {
        responseData = { success: false, reason: 'No rows to undo.' };
      }
    }

    // 7. Today's Rows Feed
    else if (endpoint === '/api/todayRows') {
      if (targetWebappUrl) {
        try {
          const remoteToday = await forwardToGoogleAppsScript(targetWebappUrl, 'todayRows', {});
          if (remoteToday && remoteToday.success) {
            return sendJson(res, remoteToday);
          }
        } catch (e) {
          console.warn('Could not fetch today rows from Google Apps Script, using local:', e.message);
        }
      }

      // Local today rows calculation
      const todayIso = new Date().toISOString().slice(0, 10);
      const matching = storedTasks.filter(t => t.tanggal === todayIso || (t.savedAt && t.savedAt.startsWith(todayIso)));

      let totalMinutes = 0;
      const formattedRows = matching.map(r => {
        const startMin = Validation.parseTimeToMinutes(r.timeStart) || 0;
        const endMin = Validation.parseTimeToMinutes(r.timeEnd) || 0;
        let dur = endMin - startMin;
        if (dur < 0) dur += 1440;
        totalMinutes += dur;

        return {
          rowNumber: r.rowNumber || 0,
          task: r.task,
          action: r.action,
          hostname: r.hostname,
          timeStart: r.timeStart,
          timeEnd: r.timeEnd,
          durationMinutes: dur
        };
      });

      responseData = {
        success: true,
        count: formattedRows.length,
        totalMinutes: totalMinutes,
        rows: formattedRows
      };
    }

    // 8. Save Settings (includes customizable Spreadsheet link)
    else if (endpoint === '/api/saveSettings') {
      storedSettings = Object.assign({}, storedSettings, body);
      saveJsonFile(SETTINGS_FILE, storedSettings);
      responseData = { success: true, settings: storedSettings };
    }

    // 9. Import Devices
    else if (endpoint === '/api/importDevices') {
      const csvStr = typeof body === 'string' ? body : (body && body.csv ? body.csv : '');
      const lines = csvStr.trim().split(/\r?\n/);
      let added = 0;
      let skipped = 0;

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(s => s.trim());
        const host = (parts[0] || '').toUpperCase();
        if (host) {
          if (!storedDevices.includes(host)) {
            storedDevices.push(host);
            added++;
          } else {
            skipped++;
          }
        }
      }

      saveJsonFile(DEVICES_FILE, storedDevices);
      responseData = { success: true, addedCount: added, skippedCount: skipped };
    }

  } catch (err) {
    responseData = { success: false, error: err.message };
  }

  sendJson(res, responseData);
}

function sendJson(res, data) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

// HTTP Server
const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = parsedUrl.pathname;

  // API router
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

  // Static files router
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
      res.end('404 Not Found: ' + pathname);
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`⚡ Daily Task Logger Server is running!`);
  console.log(`📍 Local URL:     http://localhost:${PORT}`);
  console.log(`🌐 Network Bind:  http://${HOST}:${PORT}`);
  console.log(`📁 Data Storage:  ${DATA_DIR}`);
  console.log(`🔗 Mode:          ${storedSettings.spreadsheetUrl ? 'Connected to Google Sheets' : 'Local Storage Mode'}`);
  console.log(`======================================================\n`);
});

// Graceful termination for Docker
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => process.exit(0));
});
