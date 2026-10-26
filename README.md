# Daily Task Logger

> A lightweight, mobile-first Google Apps Script web application built for network engineers to log daily tasks into an existing Google Sheet in seconds, with dates and times synchronized to the server clock.

---

## Features

- **Blazing Fast Entry (<15s)**: One-screen mobile-optimized layout with the 6 essential fields (`Task`, `Action`, `Hostname`, `Start`, `End`, `Save`) visible without scrolling on standard mobile screens ($390 \times 844\text{ px}$). Supports `Ctrl+Enter` to save.
- **Server-Synchronized Clock**: Server clock (`Asia/Jakarta` WIB) is the clock of record. Compensates for client device clock drift using NTP-style round-trip latency calculation ($\text{offset} = \text{serverNow} + \frac{\text{RTT}}{2} - \text{receiveTime}$). Re-syncs every 5 minutes and on tab focus.
- **Auto / Manual Time Intelligence**:
  - `Date`, `Start`, and `End` start in **AUTO** mode.
  - `End` tracks real-time synced clock.
  - `Start` tracks `End - typical duration` (computed dynamically from the median of the last 10 entries for the matching Task + Action pair, or 5-minute fallback).
  - Quick duration chips (`+1m`, `+5m`, `+10m`, `+15m`, `+30m`, `+60m`, `+90m`).
  - Persistent timer mode ("Start task" / "Finish") surviving browser refreshes.
- **Resilient & Offline-Ready**:
  - Offline queue in browser `localStorage` displayed as **"Pending (n)"**. Automatically retries and flushes upon reconnect and window focus with zero duplicates.
  - 30-second **Undo window**: Reverses the last save only if cells have not been altered manually in Google Sheets.
- **Fuzzy Device Autocomplete**: Searches against the `Devices` inventory tab and distinct historical sheet entries (e.g. typing `"tomang"` suggests `SW1_KCP JAKARTA TOMANG`). Unregistered hostnames show a "New device" notice and can be saved normally.
- **Task Presets & Sticky Defaults**: 1-tap presets for recurring routines (e.g. `Cek Endpoint Cabang`). Post-save "Next entry" preserves repeated metadata while blanking `Hostname` and `Remark`.
- **Zero-Bloat Vanilla Stack**: Zero frameworks, zero bundlers, zero external CDNs or web fonts. Entire gzipped client bundle is **under 18 KB** (well within the 60 KB budget).

---

## Architecture & Sheet Contract

Columns are matched dynamically by header text string (default header row 1, configurable):

| # | Column Header | Form Control | Default |
| :-: | :--- | :--- | :--- |
| 1 | `No` | Automatic (`previous No + 1`; leaves formulas untouched) | Auto |
| 2 | `Tanggal` | Date picker (Google Sheets serial number, e.g. `46266`) | Today (Auto) |
| 3 | `Task` | Combobox / Text | Last used |
| 4 | `Action` | Combobox / Text | Last used |
| 5 | `Category [CR, INCIDENT, SUPPORT]` | 3-way toggle | `SUPPORT` |
| 6 | `Project Category` | Dropdown | `KANTOR CABANG` |
| 7 | `Severity` | Dropdown | `Minor` |
| 8 | `Impacted Device [Hostname]` | Autocomplete with fuzzy match | Empty |
| 9 | `Status` | Dropdown | `CLOSED` |
| 10 | `Request by` | Dropdown | `Desktop` |
| 11 | `Time Duration: Start` | Time input (Day fraction, e.g. `551/1440`) | Auto (`End - duration`) |
| 12 | `Time Duration: End` | Time input (Day fraction, e.g. `551/1440`) | Auto (`now`) |
| 13 | `Engineer` | Dropdown / User Setting | Configured name |
| 14 | `Remark/Note` | Textarea | Empty |

---

## Directory Structure

```
├── .clasp.json             # Google Clasp project configuration
├── appsscript.json         # Apps Script manifest (Asia/Jakarta, V8 runtime)
├── package.json            # Node.js scripts for test and local server
├── README.md               # Complete operational guide
├── docs/
│   ├── PRD.md              # Authoritative Product Requirements Document
│   └── SPRINTS.md          # Sprint backlog and acceptance criteria
├── server/
│   ├── Code.js             # Web app entry point (doGet, saveEntry, getConfig, undoLast, etc.)
│   ├── columnMapper.js     # Dynamic header matcher and merged column resolver
│   ├── sheetOperations.js  # Next-row finder, style cloner, and row writer
│   ├── timeUtils.js        # Google Sheets serial date and day fraction converter
│   └── validation.js       # Idempotency UUID guard, formula escaping, time logic check
├── client/
│   ├── index.html          # Mobile-first single-screen responsive interface
│   ├── styles.css          # Clean CSS (<14 KB raw, <4 KB gzip), dark mode support
│   ├── app.js              # Application state machine, offline queue, event handlers
│   ├── clockSync.js        # NTP-style client-server clock synchronizer
│   └── autocomplete.js     # Client-side fuzzy search for device hostnames
└── tests/
    ├── mockSpreadsheetApp.js# Mock Google Apps Script environment for Node.js
    ├── unitTests.js         # Comprehensive 21-scenario unit test suite
    ├── localServer.js       # Local HTTP server with simulated google.script.run
    └── e2eChecklist.md      # 20-point verification checklist
```

---

## Local Development & Testing

### 1. Run Unit Tests (Pure Logic & Serial Math)
No external npm dependencies required:
```bash
npm test
# Or: node tests/unitTests.js
```
Validates:
- Date serial conversions (`9/1/2026` -> `46266`).
- Time day fractions (`9:11:00 AM` -> `551/1440`).
- Dynamic column mapping with merged `Time Duration` headers.
- First empty row finder and formula preservation in `No`.
- Formula injection escaping (`=`, `+`, `-`, `@`).
- NTP clock offset formula.
- Fuzzy device hostname autocomplete.

### 2. Run Local Development Server
Test the frontend and mock backend directly in your browser:
```bash
npm run serve
# Or: node tests/localServer.js
```
Open **`http://localhost:3000`** in your browser to test:
- Auto/Manual time badges and quick duration chips.
- Persistent timer mode across reloads.
- Hostname autocomplete against simulated inventory.
- Offline queueing and auto-sync.
- 30-second Undo toast.

---

## Deployment with Clasp (Google Apps Script)

### Step 1: Install and Authenticate Clasp
Ensure you have Node.js installed, then install `@google/clasp`:
```bash
npm install -g @google/clasp
clasp login
```
*Note: Make sure the Google Apps Script API is enabled on your Google account: https://script.google.com/home/usersettings*

### Step 2: Bind Clasp to Your Google Sheet
1. Open your Google Spreadsheet (e.g. `"Task Log TEST"`).
2. Go to **Extensions** > **Apps Script**.
3. In the script editor, click the **Gear Icon (Project Settings)** and copy the **Script ID**.
4. In `.clasp.json`, update the `scriptId`:
   ```json
   {
     "scriptId": "PASTE_YOUR_COPIED_SCRIPT_ID_HERE",
     "rootDir": "."
   }
   ```

### Step 3: Push Code to Apps Script
```bash
clasp push
```

### Step 4: Configure Script Properties (Environment Variables)
In the Apps Script editor (**Project Settings** > **Script Properties**):
- `TASK_LOG_SHEET_NAME`: Name of your task log sheet tab (e.g. `Task Log`).
- `HEADER_ROW`: Header row index (default: `1`).
- `DEFAULT_TIMEZONE`: Default timezone (default: `Asia/Jakarta`).
- `TARGET_SHEET_ID`: (Optional) ID of target spreadsheet if using a standalone script.

### Step 5: Deploy Web App
In the Apps Script editor:
1. Click **Deploy** > **New deployment**.
2. Select type: **Web app**.
3. Configure:
   - **Description**: `Daily Task Logger v1.0`
   - **Execute as**: `Me` (your Google account)
   - **Who has access**: `Only myself`
4. Click **Deploy** and copy the generated Web App URL.
5. Open the Web App URL on your phone or laptop. On iOS Safari or Android Chrome, tap **Add to Home Screen** to install as a standalone app!

---

## Production Cut-Over & Rollback Runbook

### Moving from Test Sheet to Production Sheet
1. Test all 20 scenarios from `tests/e2eChecklist.md` on the test sheet copy.
2. In the Apps Script editor, open **Project Settings** > **Script Properties**.
3. Update `TARGET_SHEET_ID` to your production spreadsheet ID (or bind the script directly to the production sheet).
4. Save one live test entry and verify:
   - Incremental `No` matches previous rows.
   - Date and time are written as serial numbers / fractions matching existing formatting.
   - Dropdown values strictly match sheet data validation rules.

### Rollback Procedure
If any issue occurs in production:
1. In the Apps Script editor, click **Deploy** > **Manage deployments**.
2. Select the active deployment and click the **Pencil (Edit)** icon.
3. Under **Version**, select the previous stable version from the dropdown.
4. Click **Deploy**. Rollback takes effect immediately for all devices.
5. If an errant row was added, Google Sheets native **Version History** (`Ctrl+Alt+Shift+H`) allows restoring any sheet cell or row in one click.
