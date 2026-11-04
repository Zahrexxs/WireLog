# Daily Task Logger — Sprint Backlog & Verification Plan

> Version: 1.0  
> Date: October 26, 2026  
> Author: @Zahrexxs / Engineering Team  
> Status: All Sprints Completed & Verified  

---

## Sprint Overview

| Sprint | Goal | Target Deliverable | Status |
| :---: | :--- | :--- | :---: |
| **Sprint 1** | Foundation and Core Save | Mobile entry lands as a correct, formatted row in the test Google Sheet | **DONE** |
| **Sprint 2** | Time Engine & Synchronization | Auto time tracks server clock accurately; all time fields overridable | **DONE** |
| **Sprint 3** | Speed Features & Workflow Optimization | Repeat entry completed in under 15 seconds; presets and autocomplete | **DONE** |
| **Sprint 4** | Hardening, Resilience & Production Cut-Over | Offline queue, duplicate guard, LockService, and zero-risk production release | **DONE** |

---

## Sprint 1: Foundation and Core Save (~8.5 h)

- [x] **S1-1: Setup Test Sheet & Validate Web App Permissions (1h)**
  - *Description*: Create copy of the spreadsheet named `"Task Log TEST"`, extract exact 14-column header row, and deploy a minimal "hello world" Google Apps Script web app (`Execute as: Me`, `Access: Only myself`) to verify account permission.
  - *Acceptance Criteria*: Header row confirmed in `docs/PRD.md`; web app successfully loads on both mobile phone and desktop.

- [x] **S1-2: Repository Architecture & Clasp Configuration (0.5h)**
  - *Description*: Establish project directory structure (`server/`, `client/`, `tests/`, `docs/`) and `.clasp.json` linked to the Apps Script project. Ensure no sensitive sheet IDs or credentials are committed to git.
  - *Acceptance Criteria*: `clasp push` and `clasp deploy` succeed cleanly from a fresh checkout.

- [x] **S1-3: Dynamic Column Mapper (1h)**
  - *Description*: Develop `columnMapper.js` to map sheet column headers dynamically by text string, support merged `"Time Duration"` (Start, End) columns, and handle arbitrary header row indices.
  - *Acceptance Criteria*: Unit tests pass on fixtures with merged headers and inserted columns; missing mandatory headers throw clear errors.

- [x] **S1-4: Next-Row Finder & Style Cloner (1h)**
  - *Description*: Implement logic to locate the first empty row below the last populated `No` or `Task` cell (without using `appendRow`), and clone cell formatting and data validation from the row immediately above.
  - *Acceptance Criteria*: Unit test passes against fixtures with trailing formatted blank rows; successfully copies validation rules to unformatted target rows.

- [x] **S1-5: Date & Time Serial Number Converter (0.5h)**
  - *Description*: Implement bidirectional converter between JavaScript `Date`/ISO strings and Google Sheets serial numbers and day fractions in `Asia/Jakarta` and UTC.
  - *Acceptance Criteria*: Test confirms `9/1/2026` converts to `46266`; `9:11:00 AM` converts to `551/1440` ($0.3826388...$); both `Asia/Jakarta` and UTC cases pass.

- [x] **S1-6: Backend `saveEntry()` Core Implementation (1h)**
  - *Description*: Implement `saveEntry(payload)` in Apps Script. Validates fields, calculates next `No`, formats date/time serials, writes with `setValues()`, and returns saved row number.
  - *Acceptance Criteria*: Executing `saveEntry()` from editor writes a row with number formats and data validation identical to existing rows.

- [x] **S1-7: Single-Screen Form & Save Integration (2h)**
  - *Description*: Build lightweight, responsive one-screen HTML/CSS/JS frontend covering all 14 fields with native date and time inputs. Connect Save button to `google.script.run.saveEntry()` with row number toast feedback.
  - *Acceptance Criteria*: Saving from a mobile browser writes the row to the test sheet; required field validation prevents incomplete saves.

- [x] **S1-8: Dynamic `getConfig()` & Validation Extractor (1.5h)**
  - *Description*: Implement `getConfig()` in Apps Script to extract dropdown validation lists directly from the sheet's validation rules (both inline lists and range references), falling back to `_Config` tab.
  - *Acceptance Criteria*: Form dropdown options match the sheet's data validation; editing list values in the sheet updates the form options upon page reload.

---

## Sprint 2: Time Engine & Synchronization (~11 h)

- [x] **S2-1: `serverTime()` Endpoint (0.5h)**
  - *Description*: Server function returning epoch milliseconds and ISO timestamp formatted in the configured timezone (`Asia/Jakarta`).
  - *Acceptance Criteria*: Accurate server time returned; timezone changes in configuration are reflected.

- [x] **S2-2: Client Clock Sync Module (1.5h)**
  - *Description*: Client-side time synchronizer calculating clock offset using round-trip latency ($\text{offset} = \text{serverNow} + \frac{\text{RTT}}{2} - \text{receiveTime}$). Re-syncs every 5 minutes and on window focus.
  - *Acceptance Criteria*: Unit tests pass; with device system clock offset by 10 minutes, UI clock displays within 1 second of true server time.

- [x] **S2-3: Auto / Manual State Machine (2h)**
  - *Description*: Independent state tracking for Date, Start, and End fields. Fields track synced clock when AUTO; manual edits switch field to MANUAL; reset button restores AUTO. Auto/Manual badges displayed.
  - *Acceptance Criteria*: Modifying Start manually leaves End in AUTO; clicking reset returns Start to AUTO.

- [x] **S2-4: Typical Duration Heuristics & Quick Chips (2h)**
  - *Description*: Heuristic calculator deriving typical task duration from the median of the last 10 sheet rows for the matching Task + Action pair (fallback: 5 min). Add clickable chips: 1, 5, 10, 15, 30, 60, 90 min.
  - *Acceptance Criteria*: Task with recorded history of 6, 8, 10 minutes defaults to 8 minutes; unrecorded task defaults to 5 minutes; selecting chip 10 sets Start = End - 10 min.

- [x] **S2-5: Persistent Task Timer Mode (1.5h)**
  - *Description*: In-app timer with "Start task" and "Finish". Start timestamp is persisted in `localStorage` so active timing survives browser refresh.
  - *Acceptance Criteria*: Page reload mid-task retains initial Start time; clicking "Finish" sets End to current synced time.

- [x] **S2-6: Server-Side Time Validation & Midnight Crossing (1.5h)**
  - *Description*: Server validates $\text{End} \ge \text{Start}$. Prompts user if End spans into the next day (midnight crossing). Rejects dates > 1 day in the future. Durations > 12h require explicit confirmation.
  - *Acceptance Criteria*: Setting End earlier than Start prompts next-day confirmation; > 12h prompts confirmation; future date > 1 day rejected.

- [x] **S2-7: Auto-Field Re-stamping on Save (1h)**
  - *Description*: Ensure any field remaining in AUTO mode is re-stamped with the exact synced server timestamp at the exact millisecond Save is triggered.
  - *Acceptance Criteria*: Saved End timestamp is within 1 second of actual server time at the instant of Save.

- [x] **S2-8: User Settings Panel (1h)**
  - *Description*: Slide-out or modal settings dialog allowing configuration of Engineer name, timezone, and fallback task duration, persisted in User Properties / localStorage.
  - *Acceptance Criteria*: Settings persist across sessions; modifying timezone updates AUTO time conversions accordingly.

---

## Sprint 3: Speed Features & Workflow Optimization (~12.5 h)

- [x] **S3-1: Sticky Defaults & "Next Entry" Optimization (1.5h)**
  - *Description*: Post-save workflow retaining Category, Project Category, Severity, Status, Request by, and Engineer, while blanking Hostname and Remark. Recalculates Start based on Rule 3.
  - *Acceptance Criteria*: After successful Save, form is primed for next entry with repeated metadata preserved.

- [x] **S3-2: Task Presets System (1.5h)**
  - *Description*: Fast-fill buttons for recurring tasks configured in `_Config` tab (e.g. `Cek Endpoint Cabang`).
  - *Acceptance Criteria*: Tapping a preset button instantly populates Task and Action; adding a preset in `_Config` reflects in UI.

- [x] **S3-3: Hostname Autocomplete & Fuzzy Search (2.5h)**
  - *Description*: Fast client-side fuzzy search querying `Devices` inventory tab merged with distinct hostnames from the task log sheet. Cached for 6 hours in localStorage. Displays "New device" badge for unregistered hostnames.
  - *Acceptance Criteria*: Typing `"branch"` matches `SW1_BRANCH_A`; unknown hostname displays warning but allows saving.

- [x] **S3-4: Today's Entries Feed & Metrics (1.5h)**
  - *Description*: Slide-up or expandable list reading today's logged entries from sheet with total count and cumulative minutes logged.
  - *Acceptance Criteria*: Displayed list matches rows in sheet for today's date; total duration sum matches sheet entries.

- [x] **S3-5: Undo Window (30 Seconds) (1.5h)**
  - *Description*: 30-second post-save toast with "Undo" button. Backend clears the specific row only if row values still match what was written.
  - *Acceptance Criteria*: Clicking Undo removes the row; if the row was manually altered in the sheet, Undo safely refuses.

- [x] **S3-6: Mobile Ergonomics & Dark Mode (2h)**
  - *Description*: Ergonomic thumb-zone layout pass: prominent Save button, secondary fields in collapsible accordion ("More"), native dark mode support (`prefers-color-scheme`).
  - *Acceptance Criteria*: Passes FR-01 on $390 \times 844\text{ px}$; bundle size under 60 KB gzipped.

- [x] **S3-7: Device CSV Inventory Importer (2h)**
  - *Description*: Settings utility to paste or upload CSV device list into the `Devices` tab, deduplicating by uppercase hostname.
  - *Acceptance Criteria*: CSV import adds new hostnames while skipping duplicates; reports added/skipped count; immediately available for autocomplete.

---

## Sprint 4: Hardening, Resilience & Production Cut-Over (~8.5 h)

- [x] **S4-1: Idempotency UUID Guard & Concurrency Locking (1.5h)**
  - *Description*: Unique client UUID generated per submission. Server caches recent UUIDs in CacheService to reject double-clicks. All writes wrapped with `LockService.getScriptLock()`.
  - *Acceptance Criteria*: Submitting identical payload twice results in exactly one sheet row; rapid concurrent saves write consecutive rows safely.

- [x] **S4-2: Offline Queue & Background Sync Engine (2.5h)**
  - *Description*: Intercept network failures or offline status; queue unsent entries in `localStorage` under `"Pending (n)"`. Auto-flush queue when connection is restored or tab gains focus.
  - *Acceptance Criteria*: Disconnect network -> trigger 3 saves -> reconnect -> all 3 rows land in sheet with original timestamps and zero duplicates.

- [x] **S4-3: Weekday Coverage Strip (1h)**
  - *Description*: Mon–Fri visual strip at the top of the form indicating number of tasks logged per weekday of current week, alerting to unlogged days.
  - *Acceptance Criteria*: Days with 0 entries clearly highlighted; weekend notice displayed on Saturday/Sunday.

- [x] **S4-4: Automated & Manual End-to-End Test Suite (1.5h)**
  - *Description*: Comprehensive 20-scenario test suite validating offline saves, midnight crossings, bad device clock, duplicate clicks, and edge-case inputs.
  - *Acceptance Criteria*: All 20 scenarios pass with 100% expected sheet state.

- [x] **S4-5: Production Cut-Over & Rollback Runbook (1h)**
  - *Description*: Switch target spreadsheet ID in Script Properties from `"Task Log TEST"` to production sheet. Log verified test entry. Document rollback steps.
  - *Acceptance Criteria*: Appended row matches hand-typed production rows in number format, dropdown validation, and `No`; rollback runbook tested.

- [x] **S4-6: Setup & Operations Documentation (README.md) (1h)**
  - *Description*: Complete operational documentation covering `clasp` setup, deployment versions, adding dropdown options, and troubleshooting.
  - *Acceptance Criteria*: A developer can clone the repo and deploy a working instance following `README.md` without additional instructions.
