#!/usr/bin/env bash
set -euo pipefail

# AQA NEA note: launchd entrypoint for keeping AMS backend available to the desktop app.
ROOT="/path/to/AMS/backend"
cd "$ROOT"
export AMS_DATABASE_URL="sqlite:////path/to/AMS/backend/dev.db"

exec "/path/to/AMS/backend/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
