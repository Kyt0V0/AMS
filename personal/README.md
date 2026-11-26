# AMS Personal

A private password vault for one person, running entirely on your own computer.
There are no accounts, no roles, no sharing and no network access: just your
vault, protected by your master password.

Need several users with different levels of access? Use the
[organization edition](../organization/) instead.

## Start

Requirements: Python 3.11+ and Node.js 20+ (Node is only used once, to build the pages).

| System | Command |
| --- | --- |
| macOS / Linux | `./start.sh` |
| Windows | `start.bat` |
| Any | `python3 scripts/start.py` |

The first start takes a minute or two while it prepares itself. It then opens
<http://localhost:8100> in your browser. Leave the window running; Ctrl+C stops it.

## First run

1. Enter your name (optional) and choose a **master password** of 12+ characters.
   A long phrase is best.
2. **Save the recovery code** that appears. It is shown once and is the only way
   back in if you forget the master password. Nobody can reset it for you.
3. Unlock with your master password and start adding entries.

## What you can do

| Area | What it does |
| --- | --- |
| **Vault** | Add, search, view, edit and delete credentials. Password generator, strength meter, copy with automatic clipboard clearing. |
| **Security check** | Finds weak, reused and old passwords. |
| **Settings** | Change your name, master password or recovery code; set the auto-lock time and reminder age; see recent unlock attempts; language and theme; delete the vault. |

Dates and times are shown in your computer's time zone.

The vault locks itself after 10 minutes without activity (changeable in
Settings) and whenever you reload or close the page.

## How it stays private

| Protection | How |
| --- | --- |
| This computer only | The app listens on `127.0.0.1` and has no setting to change that. It also refuses any request that arrives under a name other than `localhost`. |
| Encrypted before saving | AES-256-GCM in the browser. Each entry has its own key; names and notes are encrypted too. The file on disk contains no readable entries. |
| Master password | Stretched with Argon2id. One derived key checks the password, a separate one unwraps the vault and is never stored. |
| Other web pages | A page open in another tab cannot drive the vault: every change needs a same-origin request with a special header, and the cookie is `HttpOnly` and `SameSite=Strict`. |
| Guessing | Wrong passwords are throttled, and every failed attempt appears under *Settings → Recent activity*. |

Limits worth knowing:

- Software running on your computer under your login (malware, or someone
  sitting at an unlocked session) is outside what any local vault can defend
  against. Lock the vault, and lock your computer.
- Losing both the master password and the recovery code means losing the vault.
- This code has automated tests but has not had an independent security audit.

## Your data

Everything is in the `data/` folder next to this file (`vault.db`).

```bash
python3 scripts/backup.py
```

makes a safe copy in `data/backups/`. Backups are still encrypted. Keep some on
another disk; if this computer fails, a backup plus your master password is all
you need. To restore, stop the app and copy a backup over `data/vault.db`.

## Settings file

Optional: copy `.env.example` to `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AMS_PORT` | `8100` | Port on this computer (`--port` does the same). |
| `AMS_NO_BROWSER` | `0` | `1` stops the browser opening at start (`--no-browser`). |
| `AMS_DATA_DIR` | `./data` | Where the vault is stored. |
| `AMS_SESSION_IDLE_MINUTES` / `AMS_SESSION_MAX_HOURS` | `15` / `12` | Upper limits on how long the vault can stay open. |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `python3: command not found` | Install Python; on Windows use `py -3 scripts\start.py`. |
| "Node.js (with npm) is required" | Install Node.js, open a new terminal, start again. |
| "Address already in use" | Start with `--port 8101`. |
| Page says the app did not respond | The start window was closed. Run the start command again. |
| Forgot the master password | Unlock screen → **Forgot your password?** → enter the recovery code. |
| Start over | *Settings → Delete my vault*, or stop the app and delete the `data/` folder. **This erases everything.** |

## Development

```bash
cd backend && .venv/bin/python -m pip install -r requirements-dev.txt && .venv/bin/python -m pytest
cd frontend && npm test && npm run build
cd frontend && npm run test:e2e      # the real client code against a real local server
```

```
backend/ams/          local API (FastAPI): auth, account, credentials
frontend/src/
  lib/crypto.ts       all encryption (start here to review it)
  lib/vault.ts        entry encryption and password health
  state/, pages/      session (lock/unlock) and the screens
scripts/              start and backup helpers
```
