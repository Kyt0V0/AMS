# AMS Tauri Build Notes

## 1) Prerequisites
- Rust toolchain (`rustup`, `cargo`)
- Node.js + npm
- Tauri system dependencies for your OS

## 2) Install frontend dependencies
```bash
npm install
```

## 3) Configure backend URL
Set API base so the desktop app can reach the FastAPI backend:
```bash
export VITE_API_BASE=http://127.0.0.1:8000
```

## 4) Run desktop app in dev mode
```bash
npm run tauri:dev
```

## 5) Build desktop application bundle
```bash
npm run tauri:build
```

## Notes
- The desktop app wraps the existing React frontend; cryptography remains client-side.
- Keep backend running separately (FastAPI) unless you later embed it into the Tauri runtime.
- Current config builds the native `.app` bundle on macOS (app target) to keep packaging reliable in coursework environments.
