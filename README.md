# Margin Entry Form — Equity + Commodity (Google Apps Script)

A Google Apps Script web app for recording and reporting daily margin entries
for Equity and Commodity desks. There's no external database — the bound
Google Sheet **is** the database; the app reads/writes sheet tabs directly
via `SpreadsheetApp`.

## What it does
- **Staff login** — checked against the `LOGIN PAGE` sheet tab (no Google
  account / OAuth login screen involved).
- **Per-user permissions** — a set of `YES`/blank columns on `LOGIN PAGE`
  gates which pages/actions each user sees (entry forms, master data, "+ Add",
  reports — see [Permissions](#login-page--permissions) below).
- **Equity / Commodity entry forms** — a spreadsheet-style grid to log margin
  rows for a date, with cascading auto-fill (User ID → Software → Name →
  Group → Branch) looked up from the matching `MASTER EQUITY` /
  `MASTER COMODDITY` sheet, plus a side panel for group-level margin entries.
- **Master data tables** — sortable/filterable/paginated views of the Master
  Equity/Commodity sheets, with an optional permissioned "+ Add" popup to
  append a new master row without opening the spreadsheet.
- **Response tables** — same sortable/filterable/paginated table UI over the
  `RESPONSES EQUITY` / `RESPONSES COMODDITY` / `RESPONSES 2 EQUITY` /
  `RESPONSES 2 COMODDITY` sheets, including a date-range filter popup.
- **Report view** — a 4-month rolling matrix per code/user/name/group, pulling
  matched rows from the Responses sheets for the selected month range.

## Required sheet tabs
Tab names must match **exactly** (case, spelling, spaces):

| Tab | Columns |
|---|---|
| `LOGIN PAGE` | `NAME` \| `ID` \| `PASSWORD` \| `EQUITY ENTRY` \| `COMODDITY ENTRY` \| `MASTER EQUITY` \| `MASTER COMODDITY` \| `RESPONSES 2 EQUITY` \| `RESPONSES EQUITY` \| `RESPONSES COMODDITY` \| `RESPONSES 2 COMODDITY` \| `MASTER EQUITY ADD ENTRY` \| `MASTER COMODDITY ADD ENTRY` |
| `MASTER EQUITY` | `CODE` \| `USER ID` \| `SOFTWARE` \| `NAME` \| `GROUP NAME` \| `BRANCH NAME` \| `TIMESTAMP` \| `LOGIN ID` |
| `MASTER COMODDITY` | same columns as `MASTER EQUITY` |
| `RESPONSES EQUITY` | `TIMESTAMP` \| `SELECT DATE` \| `CODE` \| `USER ID` \| `SOFTWARE` \| `NAME` \| `GROUP NAME` \| `MARGIN AS PER RMS` \| `MARGIN ALLOCATED ON ID` \| `BRANCH NAME` \| `LOGIN NAME` |
| `RESPONSES COMODDITY` | same columns as `RESPONSES EQUITY` |
| `RESPONSES 2 EQUITY` | `TIMESTAMP` \| `SELECT DATE` \| `GROUP NAME` \| `GROUP MARGIN` \| `LOGIN NAME` |
| `RESPONSES 2 COMODDITY` | same columns as `RESPONSES 2 EQUITY` |

Notes:
- Column headers tolerate wrapped/extra whitespace (`sheetToObjects_` in
  `Code.gs` normalizes them), and the `MASTER ... ADD ENTRY` permission
  columns also tolerate the "MATER ..." (missing S) misspelling.
- Branch Name is read from the `MASTER EQUITY` / `MASTER COMODDITY` sheets
  (per `CODE`), the same way User ID / Software / Name / Group Name are —
  there's no separate dropdown/config sheet.

## Login Page — permissions
Each row in `LOGIN PAGE` is one user. Setting a column to `YES` grants:

| Column | Grants |
|---|---|
| `EQUITY ENTRY` / `COMODDITY ENTRY` | Access to the Equity / Commodity entry form |
| `MASTER EQUITY` / `MASTER COMODDITY` | View the corresponding master data table |
| `MASTER EQUITY ADD ENTRY` / `MASTER COMODDITY ADD ENTRY` | Shows the "+ Add" button on that master table (popup insert) |
| `RESPONSES EQUITY` / `RESPONSES COMODDITY` | View the corresponding responses table |
| `RESPONSES 2 EQUITY` / `RESPONSES 2 COMODDITY` | View the corresponding group-margin responses table |
| `REPORT` | Access the Report view |

## Files
This is the actual file set wired into the live app (see `src/Code.gs`'s
`doGet()` and `include()` calls):

| File | Role |
|---|---|
| `Code.gs` | Server entry point — `doGet`, sheet reads/writes, permission checks |
| `appsscript.json` | Project manifest (timezone, web app access, runtime) |
| `Index.html` | Page shell — includes all partials below |
| `CSS.html` | All styles |
| `Common.html` | Shared client state, render loop, and utility functions |
| `EntryForm.html` | Equity/Commodity entry grid |
| `DataTable.html` | Master/Responses sortable/filterable table component |
| `Report.html` | 4-month rolling report view |
| `MasterAdd.html` | "+ Add" popup for master data |
| `DateRange.html` | Date-range filter popup used by `DataTable.html` |

### Legacy reference files
`src/CodeOld.gs` and `src/IndexMerged.html` are **not** loaded by the live app
(`doGet()` only evaluates `Index`, and nothing `include()`s them). They're
kept in the repo intentionally as reference examples of an earlier
single-sheet page layout, for the multi sheet-style "page format" support
planned for this project. `clasp push` syncs **every** `.html`/`.gs` file
under `src/` plus `appsscript.json` (see below), so these two are still
pushed to the Apps Script project — they just sit inert there since nothing
calls them.

## Deploy
1. Open the bound Google Sheet → **Extensions → Apps Script**.
2. Create the sheet tabs listed above with matching headers.
3. **Deploy → New deployment → Web app** → Execute as **Me** → Who has
   access **Anyone** (or "Anyone within [org]") → Deploy.

## clasp — push local files to the Apps Script project
This folder is wired for [`clasp`](https://github.com/google/clasp) so you
can edit files locally and push them straight into the Apps Script editor
instead of copy-pasting. `.clasp.json` points at `rootDir: ./src`.

**One-time setup**
```bash
npm install                # installs clasp locally
npx clasp login            # opens a browser to authorize clasp once
```
`.clasp.json` already has a `scriptId` set. If you're pointing this repo at a
different Apps Script project, replace it (Apps Script editor → Project
Settings → **Script ID**), or run
`npx clasp create --type webapp --title "Margin Entry Form" --rootDir ./src`
to generate a fresh one.

**Day-to-day**
```bash
npm run push        # clasp push --force
npm run watch        # clasp push --force --watch (re-uploads on every save)
```

**Test before it's live**
- In the Apps Script editor: **Deploy → Test deployments** — this always
  serves whatever you last pushed (the HEAD version), at its own `/dev` URL.
- `npm run open` opens the deployed web app in a browser.

**Go live once a version is stable**
```bash
npx clasp deploy -d "short description of this version"
```
This cuts a new numbered version and (on first run) creates the production
deployment; every later `clasp deploy` without `-i` makes a new version but
keeps the same web app URL. To update the *existing* production deployment
in place instead of creating a new one:
```bash
npm run deployments                   # note the deploymentId to update
npx clasp deploy -i <deploymentId> -d "v1.x - description"
```
The `/exec` URL only ever reflects a `clasp deploy`d version — `clasp push`
alone never affects users on the live link, which is what makes the test
deployment safe to iterate on.
