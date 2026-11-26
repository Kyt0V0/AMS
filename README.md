# AMS — Access Management System

A password vault that encrypts everything in your browser before it is stored.
The server never sees your passwords or your master password.

## History

AMS started in late 2025 as coursework for the AQA A-Level NEA (non-exam
assessment): a desktop app with a separate backend. That is **v1.0**, and it
has already been assessed.

After the assessment it was rebuilt as a web app with stronger security.
**v2.0** is the newest version and was not part of the coursework.

| Version | What it is | Where |
| --- | --- | --- |
| **v2.0** (newest) | Web app in two editions: personal and organization | This branch, tag `v2.0` |
| **v1.0** | The original desktop app | Tag `v1.0` |

To look at the original: `git checkout v1.0`.

## v2.0 editions

Each folder is a complete app with its own code, tests and guide.

| | [`personal/`](personal/) | [`organization/`](organization/) |
| --- | --- | --- |
| **For** | One person, one computer | A team on a network |
| **Network** | None; this computer only | HTTPS on your network |
| **Accounts** | One vault | Many users, each with their own vault |
| **Roles** | – | Administrator, Editor, Viewer |
| **Sharing** | – | Share entries; revoking re-encrypts them |
| **Two-step sign-in** | – | E-mailed codes |
| **Address** | <http://localhost:8100> | <http://localhost:8000> |

Both have a recovery code, 11 languages, and light and dark themes.
They do not share data.

## Start

You need Python 3.11+ and Node.js 20+.

```bash
python3 personal/scripts/start.py
```

```bash
python3 organization/scripts/start.py
```

On Windows, double-click `start.bat` in either folder.
Works on Windows, macOS and Linux.

Guides: [personal/README.md](personal/README.md) ·
[organization/SETUP.md](organization/SETUP.md)

## Roles (organization edition)

| Action | Administrator | Editor | Viewer |
| --- | --- | --- | --- |
| View own or shared entries | Yes | Yes | If shared |
| Create, edit, delete own entries | Yes | Yes | No |
| Share entries | Yes | If allowed | No |
| Manage users, view audit log | Yes | No | No |

The server enforces every rule.

## Security

- Master password stretched with Argon2id; it never leaves the browser.
- Every entry has its own AES-256-GCM key. Names and notes are encrypted too.
- Sessions, rate limits and role checks are handled by the server.

This code has automated tests but no independent security audit.
Details: [organization/README.md](organization/README.md#security-model).

## Publishing your own copy

Never commit a `data/` folder or a `.env` file. They hold the database, keys
and mail password. The `.gitignore` files already exclude them.

## License

[MIT](LICENSE)
