/**
 * Daily Task Logger — Unit Test Suite
 * Validates pure business logic, serial date conversions, column mapping,
 * next-row finder, formula injection escaping, clock synchronization, and autocomplete.
 */

const assert = require('assert');
const TimeUtils = require('../server/timeUtils.js');
const ColumnMapper = require('../server/columnMapper.js');
const Validation = require('../server/validation.js');
const SheetOperations = require('../server/sheetOperations.js');
const ClockSync = require('../client/clockSync.js');
const Autocomplete = require('../client/autocomplete.js');
const { MockSheet } = require('./mockSpreadsheetApp.js');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
  }
}

console.log('\n--- 1. TimeUtils Serial & Time Maths (S1-5) ---');

test('9/1/2026 gives serial number 46266', () => {
  const serial = TimeUtils.dateToSerial('9/1/2026');
  assert.strictEqual(serial, 46266, `Expected 46266 but got ${serial}`);
});

test('2026-09-01 (ISO) gives serial number 46266', () => {
  const serial = TimeUtils.dateToSerial('2026-09-01');
  assert.strictEqual(serial, 46266, `Expected 46266 but got ${serial}`);
});

test('9:11:00 AM gives day fraction 551/1440', () => {
  const frac = TimeUtils.timeToFraction('9:11:00 AM');
  const expected = 551 / 1440;
  assert(Math.abs(frac - expected) < 1e-9, `Expected ${expected} but got ${frac}`);
});

test('09:11 (24-hour) gives day fraction 551/1440', () => {
  const frac = TimeUtils.timeToFraction('09:11');
  const expected = 551 / 1440;
  assert(Math.abs(frac - expected) < 1e-9, `Expected ${expected} but got ${frac}`);
});

test('Serial 46266 converts back to 9/1/2026', () => {
  const dateStr = TimeUtils.serialToDateStr(46266);
  assert.strictEqual(dateStr, '9/1/2026');
});

test('Fraction 551/1440 converts to 9:11:00 AM', () => {
  const timeStr = TimeUtils.fractionToTimeStr(551 / 1440, true);
  assert.strictEqual(timeStr, '9:11:00 AM');
});

test('Serial 46266 resolves to Tuesday (weekday index 2)', () => {
  assert.strictEqual(TimeUtils.weekdayIndexFromSerial(46266), 2);
});

test('Week counts only include the current Mon-Sun week', () => {
  // 46266 is Tuesday; the week runs Mon 46265 .. Sun 46271.
  const counts = TimeUtils.weekCountsFromSerials([46265, 46265, 46266, 46260, 46271], 46266);
  assert.strictEqual(counts.Mon, 2);
  assert.strictEqual(counts.Tue, 1);
  assert.strictEqual(counts.Sun, 1);
  assert.strictEqual(counts.Wed, 0);
  // 46260 (previous Thursday) must not leak into this week.
  assert.strictEqual(counts.Thu, 0);
});

test('Week counts place Sunday in the week that started the preceding Monday', () => {
  // 46271 is Sunday of the 46265 week; the next Monday is 46272.
  const counts = TimeUtils.weekCountsFromSerials([46265, 46271, 46272], 46271);
  // 46272 is the following Monday and must be excluded (otherwise Mon would be 2).
  assert.strictEqual(counts.Mon, 1);
  assert.strictEqual(counts.Sun, 1);
});

console.log('\n--- 2. Dynamic Column Mapper (S1-3) ---');

test('Maps exact 14 columns matching sheet contract', () => {
  const headers = [
    'No', 'Tanggal', 'Task', 'Action', 'Category [CR, INCIDENT, SUPPORT]',
    'Project Category', 'Severity', 'Impacted Device [Hostname]',
    'Status', 'Request by', 'Time Duration (Start)', 'Time Duration (End)',
    'Engineer', 'Remark/Note'
  ];
  const res = ColumnMapper.mapHeaders(headers);
  assert.strictEqual(res.map.no, 1);
  assert.strictEqual(res.map.tanggal, 2);
  assert.strictEqual(res.map.task, 3);
  assert.strictEqual(res.map.action, 4);
  assert.strictEqual(res.map.category, 5);
  assert.strictEqual(res.map.projectCategory, 6);
  assert.strictEqual(res.map.severity, 7);
  assert.strictEqual(res.map.hostname, 8);
  assert.strictEqual(res.map.status, 9);
  assert.strictEqual(res.map.requestBy, 10);
  assert.strictEqual(res.map.timeStart, 11);
  assert.strictEqual(res.map.timeEnd, 12);
  assert.strictEqual(res.map.engineer, 13);
  assert.strictEqual(res.map.remark, 14);
});

test('Resolves merged "Time Duration" spanning two columns', () => {
  const primaryRow = [
    'No', 'Tanggal', 'Task', 'Action', 'Category', 'Project Category',
    'Severity', 'Impacted Device', 'Status', 'Request by',
    'Time Duration', '', 'Engineer', 'Remark'
  ];
  const secondaryRow = [
    '', '', '', '', '', '', '', '', '', '', 'Start', 'End', '', ''
  ];
  const res = ColumnMapper.mapHeaders([primaryRow, secondaryRow]);
  assert.strictEqual(res.map.timeStart, 11);
  assert.strictEqual(res.map.timeEnd, 12);
});

test('Handles inserted columns gracefully', () => {
  const headers = [
    'Inserted Extra', 'No', 'Tanggal', 'Task', 'Action', 'Category',
    'Project Category', 'Severity', 'Impacted Device', 'Status', 'Request by',
    'Time Duration: Start', 'Time Duration: End', 'Engineer', 'Remark'
  ];
  const res = ColumnMapper.mapHeaders(headers);
  assert.strictEqual(res.map.no, 2);
  assert.strictEqual(res.map.tanggal, 3);
  assert.strictEqual(res.map.timeStart, 12);
});

test('Throws readable error if required column is missing', () => {
  const headers = ['No', 'Tanggal', 'Task']; // missing action, category, etc.
  assert.throws(() => {
    ColumnMapper.mapHeaders(headers);
  }, /Missing required columns/);
});

console.log('\n--- 3. SheetOperations & Next-Row Finder (S1-4) ---');

test('Finds first empty row below populated rows', () => {
  const sheet = new MockSheet('Task Log', 20, 14);
  const colMap = { no: 1, task: 3 };

  // Set row 1 as header
  sheet.getRange(1, 1).setValue('No');
  sheet.getRange(1, 3).setValue('Task');

  // Fill rows 2 and 3
  sheet.getRange(2, 1).setValue(1);
  sheet.getRange(2, 3).setValue('Task A');
  sheet.getRange(3, 1).setValue(2);
  sheet.getRange(3, 3).setValue('Task B');

  const nextRow = SheetOperations.findNextAvailableRow(sheet, colMap, 1);
  assert.strictEqual(nextRow, 4, `Expected row 4 but got ${nextRow}`);
});

test('Ignores trailing formatted blank rows', () => {
  const sheet = new MockSheet('Task Log', 20, 14);
  const colMap = { no: 1, task: 3 };

  sheet.getRange(1, 1).setValue('No');
  sheet.getRange(2, 1).setValue(1);
  sheet.getRange(2, 3).setValue('Task 1');

  // Row 3 has some border or format but empty No/Task
  sheet.getRange(3, 5).setValue(''); // empty

  const nextRow = SheetOperations.findNextAvailableRow(sheet, colMap, 1);
  assert.strictEqual(nextRow, 3, `Expected row 3 but got ${nextRow}`);
});

test('Calculates previous No + 1 when cell has integer', () => {
  const sheet = new MockSheet('Task Log');
  sheet.getRange(2, 1).setValue(42);
  const nextNo = SheetOperations.calculateNextNo(sheet, 1, 3, 1);
  assert.strictEqual(nextNo, 43);
});

test('Leaves No untouched when cell contains a formula', () => {
  const sheet = new MockSheet('Task Log');
  sheet.getRange(2, 1).setFormula('=ROW()-1');
  const nextNo = SheetOperations.calculateNextNo(sheet, 1, 3, 1);
  assert.strictEqual(nextNo, null, 'Should return null to avoid overwriting formula');
});

console.log('\n--- 4. Validation & Security Guard (S1-6 & S4-1) ---');

test('Formula injection guard prefixes =, +, -, @ with single quote', () => {
  assert.strictEqual(Validation.escapeFormula('=SUM(A1:A10)'), "'=SUM(A1:A10)");
  assert.strictEqual(Validation.escapeFormula('+123456'), "'+123456");
  assert.strictEqual(Validation.escapeFormula('-200'), "'-200");
  assert.strictEqual(Validation.escapeFormula('@admin'), "'@admin");
  assert.strictEqual(Validation.escapeFormula('Normal text'), "Normal text");
});

test('Rejects invalid payload without required fields or UUID', () => {
  const res = Validation.validateEntry({ task: 'Test' });
  assert.strictEqual(res.isValid, false);
  assert(res.errors.length > 0);
});

test('Catches End time earlier than Start time without nextDay confirmation', () => {
  const entry = {
    uuid: 'test-uuid-1',
    tanggal: '2026-09-01',
    task: 'Task',
    action: 'Action',
    category: 'SUPPORT',
    projectCategory: 'KANTOR CABANG',
    severity: 'Minor',
    hostname: 'SW1',
    status: 'CLOSED',
    requestBy: 'Desktop',
    timeStart: '23:00',
    timeEnd: '01:00',
    isNextDay: false
  };
  const res = Validation.validateEntry(entry);
  assert.strictEqual(res.isValid, false);
  assert(res.errors.some(e => e.includes('midnight crossing')));
});

test('Accepts midnight crossing when isNextDay is true', () => {
  const entry = {
    uuid: 'test-uuid-2',
    tanggal: '2026-09-01',
    task: 'Task',
    action: 'Action',
    category: 'SUPPORT',
    projectCategory: 'KANTOR CABANG',
    severity: 'Minor',
    hostname: 'SW1',
    status: 'CLOSED',
    requestBy: 'Desktop',
    timeStart: '23:00',
    timeEnd: '01:00',
    isNextDay: true
  };
  const res = Validation.validateEntry(entry);
  assert.strictEqual(res.isValid, true);
});

console.log('\n--- 5. Clock Sync NTP Formula (S2-2) ---');

test('Calculates clock offset correctly given RTT and server time', () => {
  // Client sends at t=1000, server sees t=5000, client receives at t=1040
  // Round trip = 40ms. One-way = 20ms.
  // Server time at receive instant should be ~5020ms.
  // Offset = 5000 + 20 - 1040 = 3980ms.
  const offset = ClockSync.calculateOffset(1000, 5000, 1040);
  assert.strictEqual(offset, 3980);
});

console.log('\n--- 6. Hostname Autocomplete & Fuzzy Search (S3-3) ---');

test('Typing "tomang" matches "SW1_KCP JAKARTA TOMANG"', () => {
  const inventory = [
    'ROUTER_HQ_01',
    'SW1_KCP JAKARTA TOMANG',
    'SW2_KCP BANDUNG',
    'AP_BALI_01'
  ];
  const results = Autocomplete.search('tomang', inventory);
  assert(results.length > 0);
  assert.strictEqual(results[0].hostname, 'SW1_KCP JAKARTA TOMANG');
});

test('Recognizes exact match vs unknown hostname', () => {
  const inventory = ['SW1_TOMANG'];
  const res1 = Autocomplete.search('SW1_TOMANG', inventory);
  assert.strictEqual(res1[0].isExact, true);

  const res2 = Autocomplete.search('SW_UNKNOWN', inventory);
  assert.strictEqual(res2.length, 0);
});

console.log('\n--- 7. Task & Action Autocomplete & Dynamic Option Updating ---');

test('Typing "endpoint" matches Task "Cek Endpoint Cabang"', () => {
  const tasks = [
    'Backup Configuration',
    'Cek Endpoint Cabang',
    'Troubleshooting Network Interface'
  ];
  const results = Autocomplete.search('endpoint', tasks);
  assert(results.length > 0);
  assert.strictEqual(results[0].value, 'Cek Endpoint Cabang');
});

test('Typing "mac" matches Action "Cek disabled user dan learned MAC Address"', () => {
  const actions = [
    'Show running-config dan export backup ke TFTP/FTP',
    'Cek disabled user dan learned MAC Address',
    'Investigasi link flap, CRC errors, dan input drops'
  ];
  const results = Autocomplete.search('mac', actions);
  assert(results.length > 0);
  assert.strictEqual(results[0].value, 'Cek disabled user dan learned MAC Address');
});

test('Option updater unshifts new option and deduplicates case-insensitively', () => {
  const list = ['Cek Endpoint Cabang', 'Backup Configuration'];

  function addUnique(arr, val, prepend) {
    if (!val) return false;
    const trimmed = String(val).trim();
    if (!trimmed) return false;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].toLowerCase() === trimmed.toLowerCase()) return false;
    }
    if (prepend) arr.unshift(trimmed);
    else arr.push(trimmed);
    return true;
  }

  // Adding existing item in different case should return false
  const addedDupe = addUnique(list, 'cek endpoint cabang', true);
  assert.strictEqual(addedDupe, false);
  assert.strictEqual(list.length, 2);

  // Adding new item should unshift to position 0
  const addedNew = addUnique(list, 'New Custom Inspection', true);
  assert.strictEqual(addedNew, true);
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[0], 'New Custom Inspection');
});

console.log('\n=======================================');
console.log(`Results: ${passedTests} passed of ${totalTests} total tests`);
if (passedTests === totalTests) {
  console.log('ALL UNIT TESTS PASSED SUCCESSFULLY! ✓\n');
  process.exit(0);
} else {
  console.error(`FAILED: ${totalTests - passedTests} tests failed.`);
  process.exit(1);
}
