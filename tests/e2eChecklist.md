# Daily Task Logger — End-to-End Verification Checklist (20 Scenarios)

> Target: Task S4-4 (Sprint 4 Acceptance Test)  
> All 20 scenarios must pass on mobile and laptop viewports.

---

### Phase 1: Core Form & UI Ergonomics
- [x] **TC-01: One-Screen Viewport Fit (FR-01)**
  - *Action*: Open app on a $390 \times 844\text{ px}$ viewport (iPhone 12/13/14).
  - *Expected*: Task, Action, Hostname, Start, End, and Save button are visible simultaneously without scrolling.
- [x] **TC-02: Keyboard Shortcut (Ctrl+Enter / Cmd+Enter)**
  - *Action*: Fill mandatory fields and press `Ctrl+Enter` (or `Cmd+Enter` on macOS).
  - *Expected*: Trigger save immediately without requiring touch/mouse click.
- [x] **TC-03: Required Field Validation**
  - *Action*: Leave Hostname blank and click Save.
  - *Expected*: Save blocked with clear toast message: "Please fill all required fields".
- [x] **TC-04: Theme Toggle & Dark Mode**
  - *Action*: Click theme toggle or switch OS preference to dark.
  - *Expected*: Colors invert to dark palette with high-contrast borders and text.

---

### Phase 2: Sheet Contract & Data Integrity
- [x] **TC-05: Real Serial Date & Time Day Fractions (FR-02 & S1-5)**
  - *Action*: Save an entry with date `9/1/2026` and time `9:11:00 AM`.
  - *Expected*: Cell contains integer `46266` and fraction `551/1440` (displayed as formatted date/time, NOT text strings).
- [x] **TC-06: Formula Preservation in `No` Column (Rule 2.4)**
  - *Action*: Pre-populate previous row with `=ROW()-1` formula.
  - *Expected*: App leaves `No` untouched so the spreadsheet formula computes row number.
- [x] **TC-07: Incremental Integer `No` Calculation**
  - *Action*: Previous row has plain number `42`.
  - *Expected*: App automatically writes `43` in the new row.
- [x] **TC-08: Format & Data Validation Cloning (S1-4)**
  - *Action*: Save a row on an unformatted row below formatted entries.
  - *Expected*: Border styles, fonts, number formatting, and dropdown validation are copied from row above.
- [x] **TC-09: Formula Injection Guard (Section 2.4)**
  - *Action*: Enter Task as `=HYPERLINK("http://evil.com")` or `+12345` or `@admin`.
  - *Expected*: Stored in Google Sheets with leading `'` so it cannot execute as a formula.

---

### Phase 3: Time Engine & Synchronization
- [x] **TC-10: Clock Drift Compensation (FR-03 & S2-2)**
  - *Action*: Artificially adjust device clock 10 minutes ahead/behind.
  - *Expected*: Synced clock and saved timestamp reflect accurate server time within 1 second.
- [x] **TC-11: Auto vs Manual Badges & Independent Overrides (FR-04 & S2-3)**
  - *Action*: Edit Start time manually; leave End time untouched.
  - *Expected*: Start badge switches to `Manual` (with reset icon); End badge remains `Auto`.
- [x] **TC-12: Typical Duration Calculation (FR-05 & S2-4)**
  - *Action*: Select Task & Action with historical entries of 6, 8, 10 min.
  - *Expected*: Start auto-calculates to `End - 8 min` (median).
- [x] **TC-13: Quick Duration Chips**
  - *Action*: Tap `+15m` chip.
  - *Expected*: Start is set to `End - 15 min`; Start badge switches to `Manual`.
- [x] **TC-14: Persistent Task Timer (S2-5)**
  - *Action*: Click "Start task", refresh the browser page, then click "Finish".
  - *Expected*: Original start time is preserved across the reload; End is stamped at moment of finish.
- [x] **TC-15: Midnight Crossing Prompt (Rule 2.5 & S2-6)**
  - *Action*: Enter Start as `23:30` and End as `01:15`.
  - *Expected*: Dialog prompts whether task ends on next day; if confirmed, accepted without silent swap.
- [x] **TC-16: Re-Stamping at Instant of Save (Rule 2.5 #7 & S2-7)**
  - *Action*: Leave Start and End on Auto for 2 minutes, then click Save.
  - *Expected*: End is re-stamped with the exact server timestamp at the moment Save was pressed.

---

### Phase 4: Speed Features & Resilience
- [x] **TC-17: Sticky Defaults & Next Entry (FR-06 & S3-1)**
  - *Action*: Save an entry.
  - *Expected*: Category, Project Category, Severity, Status, Request by, and Engineer stay selected; Hostname and Remark are blanked.
- [x] **TC-18: Hostname Fuzzy Autocomplete & New Device Notice (FR-08 & S3-3)**
  - *Action*: Type `"branch"` in Hostname.
  - *Expected*: Suggests `SW1_BRANCH_A`. Type an unknown device -> displays `New device` warning but allows save.
- [x] **TC-19: 30-Second Undo Window (FR-10 & S3-5)**
  - *Action*: Save entry; click "Undo" within 30 seconds.
  - *Expected*: Row content is cleared from the sheet; form inputs are restored. If row was manually edited in Google Sheet, Undo is safely refused.
- [x] **TC-20: Offline Queue with Zero Loss (FR-11 & S4-2)**
  - *Action*: Disconnect network; perform 3 saves; reconnect network.
  - *Expected*: Banner shows "Pending (3)"; upon reconnect, all 3 rows land in the sheet with original timestamps and zero duplicates.
