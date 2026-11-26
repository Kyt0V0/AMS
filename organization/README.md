# AMS — Access Management System (web edition)

A shared password and credential vault for a team, used through a web browser.
Everything a user stores is encrypted **in their browser** before it reaches the
server, so the server and its administrators can manage accounts but can never
read vault contents.

This is the **organization edition**: many users, roles and sharing, served over a
network. For a single person on one computer, see the [personal edition](../personal/).

This is a ground-up rework of the original desktop AMS. See
[What changed from the original](#what-changed-from-the-original).

## Quick start

Requirements: Python 3.11+ and Node.js 20+ (Node is only needed to build the web client).

```bash
python3 scripts/start.py
```

(`./start.sh` on macOS/Linux and `start.bat` on Windows do the same thing.)

The first run creates the Python environment, builds the web client and starts
the server on <http://localhost:8000>. Open that address on the same computer
and create the first administrator account; the one-time **setup token** is
filled in for you. (From another computer, get it with
`python3 scripts/setup_token.py` on the server.)

**New here? Follow the step-by-step guide in [SETUP.md](SETUP.md).**

## Serving a network of users

Browsers only allow the cryptography AMS depends on over **HTTPS** (or on
`localhost`), and plain HTTP would expose sessions to the network. AMS therefore
refuses to listen on the network without TLS. There are three ways to provide it:

1. **Built-in certificate (simplest).**

   ```bash
   python3 scripts/start.py --lan
   ```

   Generates a certificate in `data/tls/`, listens on every interface and
   accepts only requests addressed to this computer's own names and address.
   Users open `https://<server-ip>:8000`. Install `data/tls/ams-ca.crt` on each
   device once and browsers trust the server without a warning; the steps are in
   [SETUP.md](SETUP.md). Add names with `--name ams.office.lan` (repeatable);
   delete `data/tls/` to regenerate.

2. **Your own certificate.** Set `AMS_TLS_CERT` and `AMS_TLS_KEY` (and `AMS_HOST=0.0.0.0`) in `.env`.

3. **Behind a reverse proxy** that terminates HTTPS on the same machine, with
   `AMS_BEHIND_PROXY=1`. Example Caddyfile:

   ```
   ams.example.com {
       reverse_proxy 127.0.0.1:8000
   }
   ```

With options 2 and 3, also set `AMS_ALLOWED_HOSTS` to the names users type (see
`.env.example`). Without it the server accepts only `localhost` when it listens
on this computer, and any name when it is on the network or behind a proxy.

New people join by **invitation**: an administrator creates a single-use link in
*Administration → Invitations* and sends it to them. Open registration exists as
a policy switch but is off by default.

## Using it

| Area | What it does |
| --- | --- |
| **Vault** | Add, search, view, edit and delete credentials. Password generator, strength meter, copy with automatic clipboard clearing. |
| **Sharing** | Share an entry read-only with a colleague. Revoking re-encrypts the entry with a new key, so the revoked copy stops working. |
| **Security check** | Finds your weak, reused and old passwords. Calculated locally; nothing about password quality is sent to the server. |
| **Settings** | Profile, master password, recovery code, signed-in devices, language (11, including right-to-left), light/dark theme. |
| **Administration** | People (roles, disable, sign out, delete), invitations, security policy, activity log. |

Roles: **Administrator** manages the system, **Editor** keeps and shares their own
entries, **Viewer** can only read what is shared with them. Viewers are strictly
read-only; the full table is in the
[top-level README](../README.md#roles-organization-edition).

**Two-step sign-in (e-mail codes).** With an outgoing mail server configured
(`AMS_SMTP_*` in `.env`), users can turn on two-step sign-in in *Settings*: after
the master password, a 6-digit code is e-mailed and must be entered to finish
signing in. An administrator can require it for everyone under
*Administration → Policy*. Codes last 10 minutes, work once, allow five guesses
and are stored only as hashes. Changing an e-mail address then also needs a code
sent to the new address. Check your mail settings first with
`backend/.venv/bin/python scripts/test_email.py you@example.com`, which sends a
code and asks you to type it back. See [SETUP.md](SETUP.md#6-turn-on-two-step-sign-in-optional).

**Time zones.** The server keeps every timestamp in UTC and behaves the same
whatever zone the machine is set to. Dates and times are shown in the zone of the
device you are looking at, and "days ago" follows that device's calendar. The
activity log states which zone it is using.

**Forgotten master password.** Nobody can reset it for you; that is what keeps
the vault private. Each account gets a **recovery code** when it is created (and
can replace it in Settings). The code lets the user choose a new master password
without losing data. Without the password *and* the code, the vault cannot be opened.

## Security model

| Protection | How |
| --- | --- |
| End-to-end encryption | AES-256-GCM in the browser (WebCrypto). Each entry has its own key; names and notes are encrypted too, not only the password. |
| Master password | Stretched with Argon2id in the browser. Two separate keys are derived from it: one proves identity to the server, the other unwraps the vault and never leaves the device. The server stores only an Argon2id hash of the first. |
| Sharing | ECDH P-256 key agreement between owner and recipient; each recipient gets their own wrapped copy of the entry key, bound to that entry and that person. Key fingerprints can be compared out-of-band. |
| Two-step sign-in | Optional or enforced e-mailed one-time code after the password; no session exists until it is confirmed. Ten wrong codes lock code sign-in for that account for a day. |
| E-mail address | Changing it needs the master password and a code sent to the new address; the old address is told about the change. |
| Sessions | Random token in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie; only its hash is stored. Idle and absolute timeouts, sign out other devices, revocation on password change. |
| Auto-lock | Decryption keys live in memory only. The vault locks after inactivity and on page reload. |
| Brute force | Per-account and per-address throttling of sign-in and recovery; sign-in does not reveal which accounts exist. |
| Cross-site attacks | Strict Content-Security-Policy, no third-party scripts, same-origin checks plus a required custom header on every state-changing request, clickjacking protection, HSTS over HTTPS. Requests under an unexpected host name are refused. |
| Oversized requests | Request bodies are cut off at 1 MB, however they are sent. |
| Data at rest | User names and e-mails are encrypted with a server key; look-ups use keyed hashes. |
| Accountability | Audit log of sign-ins, failures, sharing, key rotation and administrative actions. |
| Least privilege | Role checks on every endpoint; the last administrator cannot be removed; entries that are not yours are indistinguishable from entries that do not exist. |

Honest limits, so they can be planned for:

- As with any web-based vault, users trust the server to deliver unmodified
  application code and genuine public keys. Use real TLS, restrict who can reach
  and administer the server, and compare key fingerprints for sensitive shares.
- Revoking a share cannot un-see a password someone already viewed: change the
  password itself when that matters.
- The built-in certificate protects the connection only on devices where the
  authority certificate (`data/tls/ams-ca.crt`) has been installed. A user who
  clicks through a browser warning instead has no protection against an impostor server.
- E-mailed codes are only as safe as the mailbox they go to, and they do not
  encrypt anything: the vault is still protected by the master password alone.
  If the mail server is down, accounts that need a code cannot sign in until it is back.
- This code has automated tests but has not had an independent security audit.

## Configuration

Set environment variables or copy `.env.example` to `.env`. The main ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AMS_HOST` / `AMS_PORT` | `127.0.0.1` / `8000` | Listening address. |
| `AMS_TLS_CERT` / `AMS_TLS_KEY` | – | Serve HTTPS directly. |
| `AMS_ALLOWED_HOSTS` | see above | Accepted host names. `--lan` fills it in with this computer's names and address. |
| `AMS_BEHIND_PROXY` | `0` | Trust `X-Forwarded-*` from a local reverse proxy. |
| `AMS_SESSION_IDLE_MINUTES` / `AMS_SESSION_MAX_HOURS` | `15` / `12` | Session lifetime. |
| `AMS_SMTP_HOST`, `_PORT`, `_SECURITY`, `_USER`, `_PASSWORD`, `_FROM` | – | Outgoing mail for verification codes. |
| `AMS_DATA_DIR` | `./data` | Database, server key, setup token, certificate. |
| `AMS_SECRET_KEY` | generated | Server key, if you want it stored apart from the data folder. |

Password policy, auto-lock time, key-derivation cost and open registration are
changed in the app under *Administration → Policy*.

## Backups

```bash
python3 scripts/backup.py
```

Copies the live database safely to `data/backups/`. Also keep one copy of
`data/secret.key` somewhere separate; without it user names and e-mails in a
backup cannot be read. To restore, stop the server and copy a backup over `data/ams.db`.

## Project layout

```
backend/ams/          FastAPI application
  routers/            auth, account, credentials (vault + sharing), admin
  core.py             sessions, permissions, audit, policy
  security.py         server-side hashing and field encryption
  mail.py, codes.py   e-mail sender and one-time verification codes
  middleware.py       security headers, cross-site request rejection
backend/tests/        API tests
frontend/src/
  lib/crypto.ts       all browser-side cryptography (start here to review it)
  lib/vault.ts        entry encryption, sharing, password health
  state/              session (lock/unlock) and vault state
  pages/, components/ user interface
  i18n/               translations
scripts/              start, setup-token, e-mail test, certificate and backup helpers
```

## Development

```bash
# API tests
cd backend && .venv/bin/python -m pip install -r requirements-dev.txt && .venv/bin/python -m pytest

# Browser-side crypto, time-zone and translation tests, type-check, production build
cd frontend && npm test && npm run build

# End-to-end: the real client code against a real server on a spare port
cd frontend && npm run test:e2e

# Live-reload development: run the server, then the Vite dev server (proxies /api)
python3 scripts/start.py          # terminal 1
cd frontend && npm run dev        # terminal 2 -> http://localhost:5173
```

Run a single server process (the default): rate limiting is kept in memory and
the database is SQLite.

## What changed from the original

| Original AMS | This version |
| --- | --- |
| Desktop app (Tauri) plus a separate backend; each client had to be pointed at a server URL | One server serves both the API and the web client; users just open a URL |
| The key that unwraps the vault was sent to the server as the login "proof" and stored there in plain form | Separate authentication and encryption keys; the server stores only a slow hash of the former |
| Private key kept only in one browser's local storage, so an account worked on one device | Private key stored encrypted on the server; sign in from any device |
| Anyone could look up a user's e-mail and encrypted keys without signing in | Sign-in reveals nothing about which accounts exist |
| Hand-written JWT held in memory, no revocation | Server-side sessions in hardened cookies, revocable, with timeouts |
| No rate limiting; open self-registration | Throttling and temporary lock-out; invitation-only by default |
| Entry names and system names stored in clear | Whole entry encrypted, including its name |
| Revoking a share left the old key valid | Revoking rotates the entry key |
| Changing the Argon2 settings locked out every existing user | Parameters are stored per user |
| `can_share` and other flags were not enforced | Permissions enforced on the server and tested |
| Admin screens dumped raw database rows, including login verifiers | Admin sees people, invitations, policy and an audit log, never key material |
| `Math.random()` password generator | Cryptographically secure generator |
| No way back after a forgotten password | Recovery code |
| Inline-styled pages, repeated code, three overlapping migration scripts | Design system with light/dark themes, responsive layout, shared components, one schema definition |

The new encryption scheme is intentionally incompatible with the old database:
existing data cannot be converted without each user's master password. Start
fresh and re-enter (or re-share) credentials.
