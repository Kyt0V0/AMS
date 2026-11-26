#!/usr/bin/env bash
set -euo pipefail

# AQA NEA note: macOS startup helper for local/lab deployment.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required."
  exit 1
fi

cd "$BACKEND_DIR"
if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m app.migration_runner

# Start backend in background.
# Use python -m to avoid stale venv console-script shebang paths.
nohup python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 > "$BACKEND_DIR/backend.log" 2>&1 &
echo "Backend started (log: $BACKEND_DIR/backend.log)"
deactivate

cd "$FRONTEND_DIR"
npm install
npm run tauri:build

APP_BUNDLE="$FRONTEND_DIR/src-tauri/target/release/bundle/macos/Access Management System.app"
if [[ -d "$APP_BUNDLE" ]]; then
  echo "Build complete: $APP_BUNDLE"
  echo "Optional install to Applications:"
  echo "  ditto \"$APP_BUNDLE\" \"/Applications/Access Management System.app\""
  open "$APP_BUNDLE"
else
  echo "macOS app bundle not found."
  exit 1
fi
