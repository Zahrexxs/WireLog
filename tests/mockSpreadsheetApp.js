/**
 * Daily Task Logger — Mock Google Apps Script Environment
 * Provides high-fidelity mocks of SpreadsheetApp, Sheet, Range,
 * LockService, CacheService, and PropertiesService for Node.js unit tests.
 */

class MockRange {
  constructor(sheet, row, col, numRows = 1, numCols = 1) {
    this.sheet = sheet;
    this.row = row; // 1-based
    this.col = col; // 1-based
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const result = [];
    for (let r = 0; r < this.numRows; r++) {
      const rowArr = [];
      for (let c = 0; c < this.numCols; c++) {
        const val = this.sheet._getCell(this.row + r, this.col + c).value;
        rowArr.push(val !== undefined ? val : '');
      }
      result.push(rowArr);
    }
    return result;
  }

  setValues(values) {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        if (values[r] && values[r][c] !== undefined) {
          this.sheet._getCell(this.row + r, this.col + c).value = values[r][c];
        }
      }
    }
    return this;
  }

  getValue() {
    return this.sheet._getCell(this.row, this.col).value;
  }

  setValue(val) {
    this.sheet._getCell(this.row, this.col).value = val;
    return this;
  }

  getFormula() {
    return this.sheet._getCell(this.row, this.col).formula || '';
  }

  setFormula(formula) {
    this.sheet._getCell(this.row, this.col).formula = formula;
    return this;
  }

  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        this.sheet._getCell(this.row + r, this.col + c).value = '';
      }
    }
    return this;
  }

  copyFormatToRange(sheet, startCol, endCol, startRow, endRow) {
    // Mock format copy
    return this;
  }

  copyTo(targetRange, options) {
    return this;
  }

  getDataValidation() {
    return this.sheet._getCell(this.row, this.col).validation || null;
  }

  setDataValidations(validations) {
    return this;
  }
}

class MockSheet {
  constructor(name, rows = 100, cols = 20) {
    this.name = name;
    this.maxRows = rows;
    this.maxCols = cols;
    this.cells = {}; // 'r_c': { value, formula, validation }
    this.parent = null;
  }

  _getCell(r, c) {
    const key = `${r}_${c}`;
    if (!this.cells[key]) {
      this.cells[key] = { value: '', formula: '', validation: null };
    }
    return this.cells[key];
  }

  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getParent() { return this.parent; }

  getLastRow() {
    let maxR = 0;
    for (const key of Object.keys(this.cells)) {
      const [r, c] = key.split('_').map(Number);
      const cell = this.cells[key];
      if (cell.value !== '' && cell.value !== null && cell.value !== undefined) {
        if (r > maxR) maxR = r;
      }
    }
    return maxR;
  }

  getLastColumn() {
    let maxC = 0;
    for (const key of Object.keys(this.cells)) {
      const [r, c] = key.split('_').map(Number);
      const cell = this.cells[key];
      if (cell.value !== '' && cell.value !== null && cell.value !== undefined) {
        if (c > maxC) maxC = c;
      }
    }
    return Math.max(maxC, 14);
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    return new MockRange(this, row, col, numRows, numCols);
  }

  getDataRange() {
    const lr = Math.max(this.getLastRow(), 1);
    const lc = Math.max(this.getLastColumn(), 1);
    return new MockRange(this, 1, 1, lr, lc);
  }

  insertRowAfter(afterRow) {
    this.maxRows++;
    return this;
  }

  appendRow(rowArr) {
    const nextRow = this.getLastRow() + 1;
    for (let c = 0; c < rowArr.length; c++) {
      this._getCell(nextRow, c + 1).value = rowArr[c];
    }
    return this;
  }
}

class MockSpreadsheet {
  constructor() {
    this.sheets = [new MockSheet('Task Log'), new MockSheet('Devices'), new MockSheet('_Config')];
    this.sheets.forEach(s => s.parent = this);
  }

  getSheetByName(name) {
    return this.sheets.find(s => s.getName().toLowerCase() === name.toLowerCase()) || null;
  }

  getSheets() {
    return this.sheets;
  }

  insertSheet(name) {
    const s = new MockSheet(name);
    s.parent = this;
    this.sheets.push(s);
    return s;
  }
}

const mockPropertiesStore = {
  script: {},
  user: {}
};

const MockPropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => mockPropertiesStore.script[k] || null,
    setProperty: (k, v) => { mockPropertiesStore.script[k] = String(v); }
  }),
  getUserProperties: () => ({
    getProperty: (k) => mockPropertiesStore.user[k] || null,
    setProperty: (k, v) => { mockPropertiesStore.user[k] = String(v); }
  })
};

const mockCacheStore = {};
const MockCacheService = {
  getScriptCache: () => ({
    get: (k) => mockCacheStore[k] || null,
    put: (k, v, exp) => { mockCacheStore[k] = v; },
    remove: (k) => { delete mockCacheStore[k]; }
  })
};

const MockLockService = {
  getScriptLock: () => ({
    waitLock: (timeout) => true,
    releaseLock: () => {}
  })
};

module.exports = {
  MockRange,
  MockSheet,
  MockSpreadsheet,
  MockPropertiesService,
  MockCacheService,
  MockLockService
};
