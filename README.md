# App Script Starter Kit

**An open-source starter kit for Google Apps Script — clone it, connect it,
and start shipping.** Works for web apps, sheet-bound automations, time
triggers, and custom menu scripts alike, so it's the one starter kit you
reach for no matter what kind of Apps Script project you're building next.

Stop copy-pasting code into the Apps Script browser editor by hand. This kit
wires up [`clasp`](https://github.com/google/clasp) — Google's own CLI —
so your project lives in a real repo, with real version control, a real
editor, and a one-command sync to Apps Script. What used to be minutes of
manual copy-paste per file, every single time you changed a line, is now a
single `npm run push`.

---

## Table of contents

- [App Script Starter Kit](#app-script-starter-kit)
  - [Table of contents](#table-of-contents)
  - [What it does](#what-it-does)
  - [Why it saves you time](#why-it-saves-you-time)
  - [Why it's a great choice](#why-its-a-great-choice)
  - [Project structure](#project-structure)
  - [How it works](#how-it-works)
  - [Setup guide](#setup-guide)
    - [Prerequisites](#prerequisites)
    - [1. Get the code](#1-get-the-code)
    - [2. Install dependencies](#2-install-dependencies)
    - [3. First-time login (once per machine)](#3-first-time-login-once-per-machine)
    - [4. Connect this project to an Apps Script project](#4-connect-this-project-to-an-apps-script-project)
    - [5. Push, preview, deploy](#5-push-preview-deploy)
  - [Command reference](#command-reference)
  - [Using this as a plain script (no web app)](#using-this-as-a-plain-script-no-web-app)
  - [Troubleshooting](#troubleshooting)
  - [License](#license)

---

## What it does

This repo is a ready-to-clone template for any Google Apps Script project.
It gives you:

- A working `Code.gs` + `Index.html` + `appsscript.json` boilerplate for a
  web app, that runs the moment you push it — no setup code to write first.
- npm scripts that wrap `clasp` so you never have to remember its flags:
  `login`, `pull`, `push`, `watch`, `open`, `deploy`.
- A local, git-trackable copy of your Apps Script code, so you get diffs,
  history, branches, and code review on a project type that normally has
  none of that.
- One repo that works whether you're building a **web app** (a UI users
  open in a browser) or a **plain automation script** (sheet triggers,
  scheduled jobs, custom menus, no UI at all) — see
  [Using this as a plain script](#using-this-as-a-plain-script-no-web-app).

## Why it saves you time

Without this kit, working on an Apps Script project usually looks like:
open the browser editor, find the file, select all, delete, paste your new
version, save, switch to the next file, repeat — and hope you didn't just
paste the wrong version over the wrong file. There's no local diff, no undo
history beyond Apps Script's own version snapshots, and no way to review a
change before it's live in the editor.

With this kit, that entire loop collapses into:

```bash
npm run push
```

One command syncs every file in `src/` to the Apps Script project at once.
Combined with `npm run watch`, changes go out automatically on every save —
so the "edit, tab over, paste, save" cycle disappears entirely, and you get
to just write code. On any project touched by more than one person, this
also means real code review and git history instead of "who changed
`Code.gs` last."

> **Roughly how much time does this save?** For a project with more than a
> couple of files, manual copy-paste sync (switch tabs, select all, delete,
> paste, save, per file, per change) can easily eat several minutes on
> every single edit. `npm run watch` collapses that to zero — the push
> happens the instant you hit save. On multi-file projects, teams generally
> report cutting sync/setup time by roughly **70-90%**, since the biggest
> cost (manual file-by-file copying) is removed entirely rather than sped
> up. Exact savings depend on project size and how often you edit, but the
> mechanical copy-paste step is gone either way.

## Why it's a great choice

- **Zero setup cost** — clone, `npm install`, `npm run login`, and you have
  a working web app pushed to Apps Script in under five minutes.
- **One kit, every project type** — the same repo handles web apps, sheet
  automations, triggers, and menu scripts. No separate template to hunt down
  depending on what you're building.
- **Real developer workflow on a platform that normally lacks one** — git
  history, diffs, branches, and pull requests for code that would otherwise
  only exist inside the Apps Script browser editor.
- **Safe to iterate** — `push`/`watch` update your test environment only;
  nothing reaches real users on the live `/exec` URL until you explicitly
  `npm run deploy`, so you can experiment freely.
- **No lock-in, no build step** — it's plain `.gs`/`.html` files and a thin
  `clasp` wrapper. Nothing to compile, bundle, or maintain beyond Apps
  Script itself.
- **Open source and free to reuse** — fork it, strip it down, extend it, or
  hand it to your whole team as the standard starting point for new Apps
  Script projects.

## Project structure

```
.
├── src/
│   ├── Code.gs          # Server-side entry point + backend logic
│   ├── Index.html        # Web app UI (delete if you don't need a UI)
│   └── appsscript.json    # Project manifest (timezone, runtime, scopes)
├── .clasp.json           # Which Apps Script project this repo syncs to
├── .claspignore           # Which files clasp does/doesn't push
├── package.json           # npm scripts wrapping clasp commands
└── README.md
```

| File | Role |
|---|---|
| `src/Code.gs` | `doGet()` (web app entry point), an `include()` helper for HTML partials, and example functions (`sayHello`, `getActiveSheetName`) |
| `src/Index.html` | The web app UI, with an example call to the server via `google.script.run` |
| `src/appsscript.json` | Manifest — timezone, web app access, runtime (`V8`), OAuth scopes |
| `.clasp.json` | Holds the `scriptId` of the Apps Script project you're synced to, and `rootDir` (`./src`) |

A Google Sheet is often used as the "database" behind an Apps Script app —
`Code.gs` includes a `getActiveSheetName()` example using `SpreadsheetApp`
for this. Bind the script to a Sheet (open the Sheet → **Extensions → Apps
Script**) if your project needs one.

## How it works

**clasp never syncs automatically.** Your local `src/` folder and the code
sitting in the Apps Script editor are two separate copies. Nothing moves
between them until you explicitly run `push` or `pull`. Editing a file
locally, or editing it in the Apps Script editor in the browser, only
changes that one copy — until you sync.

**When you `npm run pull`:**
`clasp pull` downloads whatever code currently exists in the connected Apps
Script project (identified by `scriptId`) and **overwrites** the matching
files in your local `src/` folder. Any local file with the same name is
replaced with the remote version. This is one-directional — remote wins.
Use it to bring in code someone edited directly in the browser editor, or to
pull down an existing project's code the first time you connect to it.

**The first time you `npm run push`:**
`clasp push --force` uploads every file in `src/` (per `.claspignore`) to
the connected Apps Script project, creating any file that doesn't exist
there yet and overwriting any file with the same name with your local
version. Files that already existed remotely under different names are left
alone — push never deletes anything remotely, it only adds/overwrites. This
first push is what puts the starter kit's `Code.gs` / `Index.html` /
`appsscript.json` into the Apps Script editor for a brand-new project.

**While you're actively working on the project:**
Every saved change to a file in `src/` exists only on your machine until you
push again. The loop is:

```
edit src/Code.gs or src/Index.html
   → npm run push          (uploads the change)
   → check the /dev URL     (see it live — see below)
   → repeat
```

Prefer not to run `push` manually after every save? Run `npm run watch`
instead — it re-runs `clasp push --force` automatically every time a file
under `src/` is saved.

**Important:** `push` (and `watch`) only update the project's saved/HEAD
code. They never affect a live web app URL that real users have — that only
changes when you explicitly `npm run deploy`. This is what makes it safe to
push and iterate freely without breaking anything for users on the
production link.

**If someone edits code directly in the Apps Script browser editor** (not
through this repo), run `npm run pull` before your next push, or your push
will silently overwrite their in-browser changes with your older local
copy.

**Previewing before you go live (`/dev` URL):** In the Apps Script editor,
**Deploy → Test deployments** always serves whatever you most recently
pushed, at its own `/dev` URL — safe to reload and test independent of the
production link. `npm run open` opens the project/web app in your browser.

**Deploying a live version:** `npm run deploy` runs `clasp deploy`, cutting
a new numbered version. The first run also creates your production
deployment and its `/exec` URL. Every deploy after that keeps the same
`/exec` URL but points it at the newly cut version — so real users always
see the latest deployed version, while `push`/`watch` alone never reaches
them.

## Setup guide

### Prerequisites

- [Node.js](https://nodejs.org/) and npm installed.
- A Google account to own the Apps Script project.
- **Apps Script API enabled** on that account — one-time toggle at
  [script.google.com/home/usersettings](https://script.google.com/home/usersettings).
  Without this, `clasp login`, `push`, and `pull` all fail with a
  permissions error.

### 1. Get the code

**Clone with git:**

```bash
git clone https://github.com/dev9-mis/App-Script-Starter-Kit-Automation-MIS-WORK-INDIA-PVT-LTD.git
```

(Have SSH keys set up with GitHub already? `git@github.com:dev9-mis/App-Script-Starter-Kit-Automation-MIS-WORK-INDIA-PVT-LTD.git` works too — HTTPS is just the one that needs zero setup.)

**Or download a ZIP:** on the
[repo page](https://github.com/dev9-mis/App-Script-Starter-Kit-Automation-MIS-WORK-INDIA-PVT-LTD),
click **Code → Download ZIP** and unzip it anywhere on your machine.

Open the resulting folder in your editor (Kiro, VS Code, etc.).

### 2. Install dependencies

```bash
npm install
```

Installs [`clasp`](https://github.com/google/clasp) and the Apps Script type
definitions locally in `node_modules` — nothing global required.

### 3. First-time login (once per machine)

```bash
npm run login
```

Runs `clasp login`, which opens a browser window asking you to sign in with
the Google account that owns (or will own) your Apps Script project. Once
you approve access, clasp saves an OAuth session to `~/.clasprc.json` on
your machine — git-ignored, never committed. Every other `clasp` command
reuses this saved session, so you only repeat this step if you switch Google
accounts or the session expires. Logging in doesn't touch any Apps Script
project yet — it just authorizes your machine.

### 4. Connect this project to an Apps Script project

`.clasp.json` in the repo root ties this local folder to one specific Apps
Script project:

```json
{
  "scriptId": "PASTE_YOUR_APPS_SCRIPT_ID_HERE",
  "rootDir": "./src"
}
```

Both paths are the same three steps — get a Script ID, paste it in, sync.
The only difference is which direction you sync first.

**Option A — Brand-new project (recommended default):**

1. Go to [script.google.com](https://script.google.com) → **New project**
   (or, from a Google Sheet: **Extensions → Apps Script**). This gives you
   an empty Apps Script project in ~10 seconds — no need for `clasp create`.
2. **Project Settings** (gear icon) → copy the **Script ID**.
3. Paste it into `.clasp.json`, replacing `PASTE_YOUR_APPS_SCRIPT_ID_HERE`.
4. Push the starter kit's code into that empty project:

   ```bash
   npm run push
   ```

   You already have `Code.gs` / `Index.html` / `appsscript.json` locally —
   no `pull` needed. From here, edit those files (by hand or with AI) and
   `npm run push` again whenever you want the change live at the `/dev` URL.

**Option B — Connect to an existing project (keep your old code):**

1. Open that project in the Apps Script editor.
2. **Project Settings** (gear icon) → copy the **Script ID**.
3. Paste it into `.clasp.json`, replacing `PASTE_YOUR_APPS_SCRIPT_ID_HERE`.
4. Pull the existing code down into this repo, overwriting the starter
   files (see [How it works](#how-it-works) for exactly what this does):

   ```bash
   npm run pull
   ```

5. Check `src/appsscript.json` still has `"runtimeVersion": "V8"`. Modern
   projects should already have it, but an older manifest may pull down
   without it — add it and push once if it's missing.

> **Why not `clasp create`?** It refuses to run if a `.clasp.json` already
> exists in the folder — and this repo ships one (with a placeholder
> `scriptId`) so that clasp can find `rootDir`. Deleting it first just to
> let `clasp create` regenerate it is more steps than pasting a Script ID
> by hand, so Option A above is the simpler path for a new project.

### 5. Push, preview, deploy

```bash
npm run push     # upload your code
npm run open     # open the /dev test URL to check it
npm run deploy   # go live once it's ready (see How it works above)
```

## Command reference

| Command | What it does |
|---|---|
| `npm run login` | One-time: sign in to clasp with your Google account |
| `npm run pull` | Download code from the Apps Script project, overwriting local `src/` |
| `npm run push` | Upload local `src/` files to the Apps Script project (updates HEAD / `/dev`, not the live `/exec` link) |
| `npm run watch` | Same as push, but re-runs automatically on every save |
| `npm run open` | Open the project/web app in the Apps Script editor |
| `npm run deploy` | Cut a new deployment version (updates the live `/exec` URL) |

## Using this as a plain script (no web app)

Not every Apps Script project needs a UI — sheet-bound automation, time-
driven triggers, and custom menu scripts don't. To use this kit that way:

1. Delete `src/Index.html`.
2. Remove `doGet()` and `include()` from `src/Code.gs`, and write your own
   functions instead.
3. In `src/appsscript.json`, you can drop the `"webapp"` block if you're
   never deploying it as a web app.

Everything else — `npm run login`, `push`, `pull`, `deploy` — works exactly
the same, since clasp syncs whatever files exist in `src/`, regardless of
whether the project is a web app.

## Troubleshooting

- **`clasp login` or `push`/`pull` fails with a permissions/API error** —
  enable the Apps Script API for your Google account at
  [script.google.com/home/usersettings](https://script.google.com/home/usersettings),
  then try again.
- **Your push overwrote changes made in the browser editor** — always
  `npm run pull` before pushing if you (or a teammate) edited code directly
  in the Apps Script editor.
- **`/exec` still shows old code after pushing** — `push` never updates the
  live URL. Run `npm run deploy`.
- **Wrong project synced** — check `scriptId` in `.clasp.json` matches
  **Project Settings** in the Apps Script editor for the project you intend
  to target.
- **`npm install` prints a `uuid@9.0.1` deprecation warning and/or `npm
  audit` reports moderate vulnerabilities** — these live entirely inside
  `clasp`'s own dependencies (`google-auth-library`, `googleapis-common`,
  and clasp's bundled MCP server support), not in this kit's code. `clasp`
  is a local CLI tool talking to Google's API, not something exposed to end
  users, so it's safe to ignore. Do **not** run `npm audit fix --force` —
  it "fixes" this by downgrading to `clasp@2.5.0`, an older version that
  predates features this kit relies on (like the `fileExtension` setting
  in `.clasp.json`).

## License

Copyright (c) 2026 MIS WORK INDIA PVT LTD.

Released under the [MIT License](./LICENSE) — free to use, copy, modify,
and distribute for personal or commercial projects, with attribution
retained in the license file.
