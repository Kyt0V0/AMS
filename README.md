# AMS (Access Management System)

This repository implements AMS for AQA A-Level NEA coursework.

## Stack (current implementation)
- Backend: FastAPI + SQLAlchemy
- Database: **SQLite only** (`backend/dev.db`)
- Frontend: React + TypeScript (Vite)
- Client-side cryptography: Web Crypto + argon2-browser + tweetnacl

## Security model summary
- Master password verification and key unlock happen client-side.
- Server stores only wrapped/encrypted key material and ciphertext payloads.
- Sharing uses X25519-derived shared secrets with per-recipient wrapped record keys.

## Account recovery (admin-assisted, out-of-band)
- The in-app recovery secret/ticket flow is intentionally disabled.
- Recovery is handled by authorized admins through outside communication and operational procedures.
- Any password reset must still preserve the core security invariant: no plaintext master password, REK, or private keys are sent to the server.

## Key rotation support
- Manual rotation endpoint: `POST /credentials/{credential_id}/rotate-key`
- `last_rotated_at` is persisted on credentials.
- Rotation overdue indicator uses configurable day threshold (`credential_rotation_days`, default 180).

## Crypto configuration
- Config source: `backend/security_config.json` and/or environment variables:
  - `AMS_ARGON2_TIME_COST`
  - `AMS_ARGON2_MEMORY_KIB`
  - `AMS_ARGON2_PARALLELISM`
  - `AMS_ARGON2_HASH_LEN`
  - `AMS_CREDENTIAL_ROTATION_DAYS`
- Admin UI can view/update crypto config via `/admin/crypto-config`.

## TLS / deployment notes
- Local development uses HTTP.
- Production should run AMS behind HTTPS/TLS termination (reverse proxy/load balancer).
- Set `AMS_TRUSTED_HOSTS` (comma-separated hostnames) in production.

## Company / LAN deployment
- Start backend on LAN interface (example): `uvicorn app.main:app --host 0.0.0.0 --port 8000`
- Configure CORS origins for company clients using `AMS_CORS_ORIGINS` (comma-separated).
- Configure host checks using `AMS_TRUSTED_HOSTS` (comma-separated).
- In the app login/register screen, set **Backend Server URL** to your server IP/host (saved per device).

## Backup / restore (SQLite)
- Backup script: `backend/scripts/backup_sqlite.sh`
- Restore script: `backend/scripts/restore_sqlite.sh`
- See script comments for safe usage.
