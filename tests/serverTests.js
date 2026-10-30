/**
 * Daily Task Logger — Node server integration tests
 * Boots the real server.js against a throwaway data directory and exercises
 * the local-storage write path, undo guard, timezone-aware feed, and
 * formula-injection parity with the Google Sheets backend.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PORT = 3400 + Math.floor(Math.random() * 200);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wirelog-test-'));

let child = null;
let passedTests = 0;
let totalTests = 0;

function todayInJakarta() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function makeEntry(overrides) {
  return Object.assign({
    uuid: crypto.randomUUID(),
    tanggal: todayInJakarta(),
    task: 'Cek Endpoint Cabang',
    action: 'Cek disabled user dan learned MAC Address',
    category: 'SUPPORT',
    projectCategory: 'KANTOR CABANG',
    severity: 'Minor',
    hostname: 'sw1_kcp tomang',
    status: 'CLOSED',
    requestBy: 'Desktop',
    timeStart: '09:00',
    timeEnd: '09:30',
    engineer: 'Zahri',
    remark: 'Normal note',
    isNextDay: false,
    confirmLongDuration: false,
    timeZone: 'Asia/Jakarta'
  }, overrides);
}

async function post(endpoint, body) {
  const res = await fetch(BASE_URL + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

function readTasks() {
  const file = path.join(DATA_DIR, 'tasks.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE_URL + '/api/health');
      if (res.ok) return;
    } catch (e) {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Server did not become healthy in time');
}

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

async function main() {
  child = spawn(process.execPath, [path.join(ROOT_DIR, 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR,
      SPREADSHEET_WEBAPP_URL: ''
    }),
    stdio: 'ignore'
  });

  await waitForServer();

  console.log('\n--- 1. Local write path parity with the Google Sheets backend ---');

  await test('Uppercases hostname and escapes formula-injection in local mode', async () => {
    const res = await post('/api/saveEntry', makeEntry({ remark: '=CMD|calc' }));
    assert.strictEqual(res.success, true);

    const stored = readTasks();
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].hostname, 'SW1_KCP TOMANG');
    assert.strictEqual(stored[0].remark, "'=CMD|calc");
  });

  await test('Escapes task text starting with =, +, - and @', async () => {
    const dangerous = [
      ['=HYPERLINK("http://evil")', "'=HYPERLINK"],
      ['+62812', "'+62812"],
      ['-200', "'-200"],
      ['@admin', "'@admin"]
    ];

    for (const [input, expectedPrefix] of dangerous) {
      await post('/api/saveEntry', makeEntry({ task: input }));
      const stored = readTasks();
      const last = stored[stored.length - 1];
      assert(
        last.task.startsWith(expectedPrefix),
        `Expected ${input} to be escaped, got ${JSON.stringify(last.task)}`
      );
    }
  });

  await test('Honours disableUppercaseHostname from server settings', async () => {
    await post('/api/saveSettings', { disableUppercaseHostname: true });
    await post('/api/saveEntry', makeEntry({ hostname: 'MixCase_Host' }));

    let stored = readTasks();
    assert.strictEqual(stored[stored.length - 1].hostname, 'MixCase_Host');

    await post('/api/saveSettings', { disableUppercaseHostname: false });
    await post('/api/saveEntry', makeEntry({ hostname: 'mixcase_lower' }));

    stored = readTasks();
    assert.strictEqual(stored[stored.length - 1].hostname, 'MIXCASE_LOWER');
  });

  console.log('\n--- 2. Undo targets the requested row, not the newest row ---');

  await test('Undo removes the specified row and refuses a mismatched entry', async () => {
    const first = makeEntry({ task: 'Undo Target A', hostname: 'SW_FIRST' });
    const second = makeEntry({ task: 'Undo Target B', hostname: 'SW_SECOND' });

    const saveA = await post('/api/saveEntry', first);
    const saveB = await post('/api/saveEntry', second);

    const beforeCount = readTasks().length;
    assert.strictEqual(saveB.rowNumber, saveA.rowNumber + 1);

    // Attempt to undo A while claiming to be B — must be refused.
    const mismatch = await post('/api/undoLast', {
      rowNumber: saveA.rowNumber,
      entry: second
    });
    assert.strictEqual(mismatch.success, false);
    assert.strictEqual(readTasks().length, beforeCount);

    // Correct undo of A must remove A and leave B intact.
    const ok = await post('/api/undoLast', { rowNumber: saveA.rowNumber, entry: first });
    assert.strictEqual(ok.success, true);

    const after = readTasks();
    assert.strictEqual(after.length, beforeCount - 1);
    assert.strictEqual(after.some(r => r.task === 'Undo Target A'), false);
    assert.strictEqual(after.some(r => r.task === 'Undo Target B'), true);
  });

  await test('Undo of an unknown row is refused', async () => {
    const res = await post('/api/undoLast', { rowNumber: 99999, entry: makeEntry({}) });
    assert.strictEqual(res.success, false);
    assert(/not found/i.test(res.reason));
  });

  await test('rowNumber stays contiguous after undo', async () => {
    const stored = readTasks();
    stored.forEach((row, index) => {
      assert.strictEqual(row.rowNumber, index + 2, `Row ${index} has stale rowNumber ${row.rowNumber}`);
    });
  });

  console.log('\n--- 3. Timezone-aware "today" feed ---');

  await test('todayRows returns today\'s entries from the configured timezone', async () => {
    const res = await post('/api/todayRows', {});
    assert.strictEqual(res.success, true);
    assert(res.count > 0, 'Expected at least one row logged today');

    const stored = readTasks();
    const expected = stored.filter(r => r.tanggal === todayInJakarta()).length;
    assert.strictEqual(res.count, expected);
    assert(
      res.rows.every(r => r.category && r.timeStart && r.timeEnd),
      'Feed rows must include category and times'
    );
  });

  await test('todayRows returns weekCounts for the current week', async () => {
    const res = await post('/api/todayRows', {});
    assert(res.weekCounts, 'weekCounts must be present');

    const total = Object.values(res.weekCounts).reduce((sum, n) => sum + Number(n || 0), 0);
    assert(total >= res.count, 'Week counts must include at least today\'s rows');
    assert(res.weekCounts.Mon !== undefined && res.weekCounts.Sun !== undefined);
  });

  console.log('\n--- 4. Numbering ---');

  await test('No increments monotonically across saves and undos', async () => {
    const before = readTasks();
    const maxNo = before.reduce((m, r) => Math.max(m, Number(r.no) || 0), 0);

    const res = await post('/api/saveEntry', makeEntry({ task: 'Numbering Probe' }));
    assert.strictEqual(res.no, maxNo + 1);
  });

  console.log('\n=======================================');
  console.log(`Results: ${passedTests} passed of ${totalTests} total tests`);
}

main()
  .catch(err => {
    console.error('FATAL:', err);
    passedTests = -1;
    totalTests = Math.max(totalTests, 1);
  })
  .finally(() => {
    if (child) child.kill();
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) {}
    if (passedTests === totalTests && totalTests > 0) {
      console.log('ALL SERVER TESTS PASSED SUCCESSFULLY! ✓\n');
      process.exit(0);
    } else {
      console.error(`FAILED: ${totalTests - passedTests} tests failed.\n`);
      process.exit(1);
    }
  });
