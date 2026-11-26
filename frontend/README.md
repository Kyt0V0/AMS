# AMS Frontend

React + TypeScript + Vite frontend for AMS.

## Run
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

## Notes
- KDF/crypto parameters are fetched from backend (`/users/crypto-config`) with safe defaults.
- In-app recovery secret/ticket flow is disabled; admin recovery is handled out-of-band by organization process.
- Backend database is SQLite-only in this project.
- Local dev uses HTTP; production deployment should be behind HTTPS/TLS termination.

## Server Setup (Company Network)
1. Run the backend on the server LAN interface, for example:
   - `uvicorn app.main:app --host 0.0.0.0 --port 8000`
2. Configure backend CORS and trusted hosts:
   - `AMS_CORS_ORIGINS` for allowed client origins
   - `AMS_TRUSTED_HOSTS` for allowed hostnames/IPs
3. In the desktop/web app login screen, set **Backend Server URL** to your company AMS backend (for example `http://10.0.0.25:8000`) and save it on that device.

See project root [README.md](../README.md) for deployment, security model, and backup/restore notes.
