# Daily Task Logger — Product Requirements Document (PRD)

> Version: 1.0  
> Date: October 26, 2026  
> Author: @Zahrexxs / Engineering Team  
> Status: Authoritative Specification  

---

## 1. Overview & Goal

Daily Task Logger replaces hand-typed spreadsheet rows with a lightweight, mobile-first one-screen web app that lets a network engineer log daily work in under 15 seconds, with date and time filled automatically from a server-synced clock. Every Save appends one correctly formatted row to an existing Google Sheet.

### 1.1 Goals and Targets

| Goal | Target |
| :--- | :--- |
| **Repeat entry time** | Under 15 seconds from page open to Save |
| **Automatic time capture** | At least 90% of entries saved without manual time typing |
| **Data integrity** | 0 rows with text-formatted dates or invalid dropdown values |
| **Reliability** | 0 entries lost when offline or after a failed save |

### 1.2 Scope
- **In Scope**: Single-user, single-sheet entry logging, Undo of the last save within 30 seconds, server-synced time, duration heuristics, offline queue, device inventory autocomplete, presets, sticky defaults.
- **Out of Scope**: Multi-user permissions/roles, manager approval workflows, historical reporting or BI dashboards, editing older historical rows in the sheet, replacing the Google Sheet database.

---

## 2. Architecture & Fixed Stack

```
+-----------------------------------------------------------------------+
| Browser Client (Mobile / Desktop)                                    |
| - Vanilla HTML5, CSS3, ES Modules (Zero dependencies, < 60 KB gzip)   |
| - LocalStorage: offline queue, sticky defaults, cached config, timer   |
| - Synced clock: serverTime offset calculation, periodic re-sync       |
+-----------------------------------+-----------------------------------+
                                    | google.script.run
                                    v
+-----------------------------------------------------------------------+
| Backend: Google Apps Script Web App (V8 Runtime)                      |
| - Container-bound to target spreadsheet                               |
| - Deployment: Execute as Me, Access: Only myself                      |
| - serverTime(), getConfig(), saveEntry(), undoLast(), todayRows()      |
| - LockService concurrency lock & Idempotency UUID guard               |
+-----------------------------------+-----------------------------------+
                                    | SpreadsheetApp API
                                    v
+-----------------------------------------------------------------------+
| Google Spreadsheet ("Task Log TEST" / Production)                    |
| - 14-column Task Log sheet (Header matched dynamically)               |
| - Devices tab (inventory for autocomplete)                            |
| - _Config tab (fallback presets and validation options)               |
+-----------------------------------------------------------------------+
```

### Stack Constraints:
- **Backend**: Google Apps Script (V8 runtime), container-bound to spreadsheet. Developed and deployed via `clasp`.
- **Frontend**: Single page served by `HtmlService.createHtmlOutputFromFile`. Plain Vanilla HTML, CSS, and ES Modules/vanilla JS. No external frameworks (no React/Vue), no bundlers (no webpack/vite), no external CDNs, no web fonts. Target bundle under 60 KB gzipped.
- **Storage**: The Google Sheet is the only database. Browser `localStorage` holds only offline queue, sticky defaults, and cached configuration.
- **Security & Privacy**: No analytics, no third-party HTTP requests, no secrets or Spreadsheet IDs committed to git (stored in Script Properties). Text starting with `=`, `+`, `-`, or `@` is stored as text (prepended with `'`) to prevent formula injection.

---

## 3. Sheet Contract (14 Columns)

Columns are matched dynamically by header text (never hardcoded column letters). Header row index is configurable (default row 1).

| # | Header Name in Sheet | Form Control | Source / Options | Default Value | Required |
| :-: | :--- | :--- | :--- | :--- | :-: |
| 1 | **No** | None (Auto) | Previous row `No + 1`; skipped if cell contains formula | Automatic | Auto |
| 2 | **Tanggal** | Date picker | Server clock | Today (Auto) | Yes |
| 3 | **Task** | Combobox | Presets + past values (e.g. `Cek Endpoint Cabang`) | Last used | Yes |
| 4 | **Action** | Combobox | Presets + past values (e.g. `Cek disabled user dan learned MAC Address`) | Last used | Yes |
| 5 | **Category [CR, INCIDENT, SUPPORT]** | 3-way toggle | Sheet data validation | `SUPPORT` | Yes |
| 6 | **Project Category** | Select | Sheet data validation (e.g. `KANTOR CABANG`) | `KANTOR CABANG` | Yes |
| 7 | **Severity** | Select | Sheet data validation (e.g. `Minor`) | `Minor` | Yes |
| 8 | **Impacted Device [Hostname]** | Autocomplete | `Devices` tab + distinct column values (e.g. `SW1_KCP JAKARTA TOMANG`) | Empty | Yes |
| 9 | **Status** | Select | Sheet data validation (e.g. `CLOSED`) | `CLOSED` | Yes |
| 10 | **Request by** | Select | Sheet data validation (e.g. `Desktop`, `IT REP`) | `Desktop` | Yes |
| 11 | **Time Duration: Start** | Time input | Server clock | `End - typical duration` (Auto) | Yes |
| 12 | **Time Duration: End** | Time input | Server clock | `now` (Auto) | Yes |
| 13 | **Engineer** | Select | Sheet data validation | Stored user name in Settings | No |
| 14 | **Remark/Note** | Text / Textarea | Free text | Empty | No |

*Note on Merged Header*: "Time Duration" is a merged header spanning two columns. The first column under it is **Start**, and the second column is **End**.

---

## 4. Write Rules

1. **Header-Based Mapping**: Columns are located by parsing the header row text. Missing required headers produce a descriptive error.
2. **Serial Number Formatting**:
   - Dates are written as Google Sheets serial numbers (e.g., `9/1/2026` -> `46266`).
   - Times are written as day fractions (e.g., `9:11:00 AM` -> `551/1440` or `0.3826388...`).
   - Number formats are copied directly from the row above. Never write dates or times as strings.
3. **Target Row Finder**:
   - Locate the first empty row below the last row where `No` or `Task` is filled.
   - Do NOT use `Sheet.appendRow()`.
   - If the target row lacks formatting or data validation, copy both formatting and validation rules from the row above.
4. **Row Numbering**: `No = previous No + 1`. If the `No` cell in the row above contains an array formula or formula, leave `No` untouched.
5. **Formula Injection Guard**: Any free text input beginning with `=`, `+`, `-`, or `@` is prefixed with `'` so it is stored purely as literal text.
6. **Idempotency**: Every submission carries a client-generated UUID. Duplicate UUIDs are acknowledged safely without appending a duplicate row.
7. **Concurrency**: Writes are guarded with `LockService.getScriptLock()` (wait up to 30 seconds).

---

## 5. Time Rules (Authoritative)

1. **Server Clock of Record**: Google Apps Script server clock is the single source of truth (default timezone: `Asia/Jakarta` / WIB). Configurable via Settings.
2. **Clock Synchronization**:
   - Client calls `serverTime()` on load.
   - Offset formula: $\text{offset} = \text{serverNow} + \frac{\text{roundTrip}}{2} - \text{clientReceiveTime}$.
   - Every "now" in UI $= \text{Date.now}() + \text{offset}$.
   - Periodic re-sync occurs every 5 minutes and whenever the browser tab regains focus (`visibilitychange` / `window.onfocus`).
3. **Auto / Manual Time Tracking**:
   - `Date`, `Start`, and `End` initialize in **AUTO** mode.
   - `End` tracks `now`.
   - `Start` tracks `End - typical duration` (median of last 10 durations for the selected Task + Action pair in the sheet, or 5-minute fallback setting).
   - Changing `Task` or `Action` automatically recalculates `Start` while `Start` is in AUTO mode.
   - Editing any time field manually switches only that field to **MANUAL** mode.
   - A reset icon allows reverting any field back to **AUTO** mode.
   - Badges clearly display "Auto" or "Manual" next to each time field.
4. **Quick Duration Chips**: Chips for `1, 5, 10, 15, 30, 60, 90 min` immediately set $\text{Start} = \text{End} - \text{chip duration}$.
5. **Timer Mode**: "Start task" records Start time and persists it to `localStorage` (survives page reloads). "Finish" stops the timer and sets $\text{End} = \text{now}$.
6. **Save Re-Stamping & Server Validation**:
   - At the exact moment Save is pressed, any field still in AUTO mode is re-stamped with the exact synced time.
   - Server validates:
     - $\text{End} \ge \text{Start}$.
     - Durations over 12 hours require explicit user confirmation.
     - Dates more than 1 day in the future are rejected.
7. **Midnight Crossing**: If `End` is earlier than `Start`, the UI prompts whether `End` falls on the next day. Never swap Start and End silently.
8. **Next Entry Behavior**: After Save, "Next entry" preserves `Category`, `Project Category`, `Severity`, `Status`, `Request by`, and `Engineer`, while clearing `Impacted Device [Hostname]` and `Remark/Note`. `Start` is recalculated according to Rule 3.
9. **Time Precision**: Precision is rounded to one minute; seconds are written as `:00` to match existing sheet conventions. The UI displays `h:mm AM/PM`.

---

## 6. Functional Requirements (FR-01 to FR-13)

| ID | Priority | Requirement | Acceptance Test |
| :--- | :---: | :--- | :--- |
| **FR-01** | P0 | Single-screen mobile-first form: Task, Action, Hostname, Start, End, and Save visible together without scrolling; `Ctrl+Enter` triggers Save. | All 6 primary controls visible without scrolling on $390 \times 844\text{ px}$ viewport. |
| **FR-02** | P0 | Save writes exactly one row in the existing format. | Appended row matches hand-typed rows: serial numbers, cell formats, data validation dropdown values, incremental `No`. |
| **FR-03** | P0 | Date, Start, and End auto-fill from server clock. | With device clock artificially set 10 minutes off, saved timestamp is within 1 second of actual server time. |
| **FR-04** | P0 | Individual time fields can be manually overridden; Auto/Manual badge and reset button. | Editing Start switches it to Manual while End remains Auto; clicking reset returns Start to Auto. |
| **FR-05** | P1 | Typical duration heuristic per Task & Action, quick duration chips, and persistent timer mode. | Start task -> reload page -> Finish: saved Start matches original. A task with 6, 8, 10 min history defaults to 8 min; unrecorded task defaults to 5 min. |
| **FR-06** | P1 | Sticky defaults and Next entry mode. | After Save, Hostname and Remark are blanked; Category, Project Category, Severity, Status, Request by, and Engineer retain their values. |
| **FR-07** | P1 | Presets for recurring tasks editable in `_Config` tab. | Tapping preset button (e.g. `Cek Endpoint Cabang`) auto-populates Task and Action. |
| **FR-08** | P1 | Hostname autocomplete with fuzzy matching from `Devices` tab plus historical sheet entries. | Typing `"tomang"` suggests `SW1_KCP JAKARTA TOMANG`. Unknown hostnames show a "new device" notice and can be saved normally. |
| **FR-09** | P1 | Today's entries list read back from sheet with row count and total logged minutes. | Displayed list and sums match the rows in the sheet for today's date. |
| **FR-10** | P1 | Undo last save within 30 seconds (only if row is unchanged). | Clicking Undo clears the row. If the row was manually edited in Google Sheets, Undo safely aborts and alerts user. |
| **FR-11** | P1 | Offline queue with "Pending (n)" status indicator, auto-retry on reconnect/focus, duplicate prevention. | Trigger 3 saves while offline; reconnect: exactly 3 rows written with no duplicates. |
| **FR-12** | P2 | Weekday coverage strip (Mon–Fri entries per day) with weekend notice. | Weekday with 0 logged entries is visibly flagged; Saturday/Sunday shows weekend status. |
| **FR-13** | P2 | Device CSV inventory import into `Devices` tab under Settings. | CSV paste/upload previews rows to add vs duplicates; deduplicates by uppercase hostname; autocompletes immediately after reload. |

---

## 7. Non-Functional Requirements

- **Performance**: First paint under 1.5 seconds on mobile 3G/4G connection. Total compressed payload under 60 KB gzipped.
- **Browser Compatibility**: Modern mobile and desktop browsers (iOS Safari, Android Chrome, Desktop Chrome/Firefox/Edge). Supports "Add to Home Screen" (PWA / web app shortcut).
- **Accessibility**: Explicit `<label>` elements, 44px minimum tap targets, WCAG AA contrast ratio, Auto/Manual state conveyed with text badges (not color alone).
- **Resilience**: Graceful offline handling, retry queues, optimistic UI with pending confirmations, clear toast notifications.
