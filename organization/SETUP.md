# Setting up AMS

A step-by-step guide for getting AMS running after downloading it from GitHub.
For what AMS is and how it protects data, see [README.md](README.md).

## 1. What you need

| | Version | Check with |
| --- | --- | --- |
| Python | 3.11 or newer | `python3 --version` |
| Node.js (includes npm) | 20 or newer | `node --version` |
| A current browser | Chrome, Edge, Firefox or Safari | |

Node.js is only used once, to build the web pages. Get Python from
<https://www.python.org/downloads/> and Node.js from <https://nodejs.org>.

## 2. Download

```bash
git clone <repository-url> ams
cd ams
```

(Or download the ZIP from GitHub and unpack it.)

## 3. Start the server

| System | Command |
| --- | --- |
| macOS / Linux | `./start.sh` |
| Windows | `start.bat` |
| Any | `python3 scripts/start.py` |

The first start takes a minute or two: it creates a private Python environment
in `backend/.venv`, installs the server's dependencies, and builds the web
client. Later starts take a second.

When you see `AMS is starting on http://localhost:8000`, it is ready. Leave
this window open; closing it (or pressing Ctrl+C) stops the server.

## 4. Create the administrator account

Open <http://localhost:8000> **in a browser on the same computer**.

1. **Setup token** – already filled in for you. (It proves you control the
   server. If you are setting up from a different computer, see
   [Getting the setup token](#getting-the-setup-token) below.)
2. Choose a **username**, **email** and **master password** (12+ characters; a
   long phrase is best).
3. Press **Create administrator**.
4. **Save the recovery code** that appears. It is shown once and is the only
   way back in if you forget the master password. Nobody, including you as
   administrator, can reset a master password.
5. Sign in.

The setup token is single-use and disappears once this account exists.

## 5. Let other people use it

AMS only talks to this computer until you tell it otherwise.

**a. Serve the network over HTTPS**

Stop the server (Ctrl+C) and start it again with `--lan`:

```bash
python3 scripts/start.py --lan
```

This creates a certificate in `data/tls/` and prints the names and addresses the
server answers to (for example `192.168.1.20`); other people then open
`https://192.168.1.20:8000`. Requests addressed to any other name are refused;
add one with `--name ams.office.lan`.

**Install the authority certificate on each device.** The certificate is signed
by a one-time local authority, saved as `data/tls/ams-ca.crt`. Until a device
trusts that file its browser shows a warning, and a warning that people learn to
click through would look the same for an impostor server. Hand the file to each
person directly (USB stick, managed software deployment), not over the network
you are trying to protect, and have them install it once:

| System | How |
| --- | --- |
| Windows | Double-click the file → *Install Certificate* → *Local Machine* → *Place all certificates in the following store* → *Trusted Root Certification Authorities*. |
| macOS | Double-click the file to add it to Keychain Access, open it there, expand *Trust* and choose *Always Trust*. |
| Linux | Copy it to `/usr/local/share/ca-certificates/` and run `sudo update-ca-certificates` (Debian, Ubuntu), or to `/etc/pki/ca-trust/source/anchors/` and run `sudo update-ca-trust` (Fedora, RHEL). Chrome and Firefox may also need it imported under *Settings → Certificates → Authorities*. |
| iPhone / iPad | Open the file, install the profile in *Settings*, then enable it under *General → About → Certificate Trust Settings*. |
| Android | *Settings → Security → Encryption & credentials → Install a certificate → CA certificate*. |

The authority's private key is thrown away as soon as the server certificate is
signed, so the file cannot be used to vouch for any other site. The certificate
lasts two years; delete `data/tls/` to make a new one (for example after the
server's address changes), then install the new `ams-ca.crt` again.

If your organisation already has its own certificates or a reverse proxy, use
those instead; see [README.md](README.md#serving-a-network-of-users).

If the computer has a firewall, allow incoming connections on port 8000.

**b. Invite people**

Sign in as the administrator → **Administration → Invitations** → choose a role
→ **Create invitation**. Send the link to the person through a channel you
trust. Each link works once and expires (7 days by default).

| Role | Can do |
| --- | --- |
| Administrator | Everything an editor can, plus manage people, invitations and policy |
| Editor | Keep their own entries and share them |
| Viewer | Read entries that others share with them |

## 6. Turn on two-step sign-in (optional)

With this on, signing in needs the master password **and** a 6-digit code sent
to the person's e-mail address.

1. **Give AMS a mail server.** Copy `.env.example` to `.env` and fill in the
   `AMS_SMTP_*` lines with the details from your e-mail provider (most use port
   587 with `starttls`; many require an "app password" rather than your normal one).
2. **Test it.** This sends a code to the address and asks you to type it back:

   ```bash
   backend/.venv/bin/python scripts/test_email.py you@example.com
   ```

   (Windows: `backend\.venv\Scripts\python scripts\test_email.py you@example.com`)
3. **Restart the server** so it picks up the settings.
4. **Turn it on for yourself:** *Settings → Two-step sign-in → Turn on*, then
   enter the code you receive. This also proves your address works.
5. **Optionally require it for everyone:** *Administration → Policy → Require
   two-step sign-in for everyone*. Make sure each person's e-mail address is
   correct first, because from then on they need a code to get in.

If someone can no longer receive codes, an administrator can switch two-step
sign-in off for that account in *Administration → People* (when it is not
required for everyone).

## Getting the setup token

You only need this when the setup page is **not** opened on the server computer
itself (for example the server has no screen and you are using `--lan`). On the
server, run:

```bash
python3 scripts/setup_token.py
```

and paste the result into the **Setup token** field. The same token is also
printed in the server window on first start and stored in `data/setup-token.txt`.

The page fills the token in automatically only for a browser on the server
computer, connecting directly as `localhost`. Requests from other computers, or
through a proxy, never receive it.

## Everyday operation

| Task | How |
| --- | --- |
| Start | `python3 scripts/start.py` (add `--lan` for the network) |
| Stop | Ctrl+C in the server window |
| Change the port | `python3 scripts/start.py --port 9000` |
| Back up | `python3 scripts/backup.py` → `data/backups/` |
| Update | `git pull`, then start again (it rebuilds what changed) |
| Settings | copy `.env.example` to `.env` and edit |

Everything AMS stores lives in the `data/` folder (database, server key,
certificate). It is excluded from Git; never publish it. Keep a copy of
`data/secret.key` with your backups, stored separately from the database copies.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `python3: command not found` | Install Python; on Windows use `py -3 scripts\start.py`. |
| "Node.js (with npm) is required" | Install Node.js, open a new terminal, start again. |
| "Address already in use" | Another program uses port 8000: start with `--port 8001`. |
| Page says **A secure connection is required** | You opened `http://` from another computer. Start with `--lan` and use the `https://` address. |
| "Refusing to serve AMS to the network over plain HTTP" | You set `AMS_HOST` without a certificate. Use `--lan`. |
| Setup token field is empty | You are not on the server computer: run `python3 scripts/setup_token.py` there. |
| "Invalid setup token" | Copy it again without spaces. If setup was already completed there is no token; sign in instead. |
| Other computers cannot connect | Check the server's firewall and that you used `https://` and the right address. |
| "E-mail is not set up on this server" | Add the `AMS_SMTP_*` settings to `.env` and restart (step 6). |
| "The verification e-mail could not be sent" | Run `scripts/test_email.py`; it prints the reason (wrong password, port or security mode). |
| Code never arrives | Check the spam folder and the address in *Settings → Profile*; use **Send a new code**. |
| Forgot the master password | Sign-in page → **Forgot your password?** → enter the recovery code. |
| Start over from scratch | Stop the server and delete the `data/` folder. **This erases every account and entry.** |
