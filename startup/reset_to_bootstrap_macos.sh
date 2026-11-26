#!/usr/bin/env bash
set -euo pipefail

# AQA NEA note: resets AMS to first-run bootstrap state for demonstration/testing.
PROJECT_ROOT="/path/to/AMS"
PROJECT_BACKEND="$PROJECT_ROOT/backend"
RUNTIME_BACKEND="$HOME/.ams_backend_runtime"
LAUNCH_AGENT="$HOME/Library/LaunchAgents/com.ams.backend.plist"
PROJECT_TOKEN_FILE="$PROJECT_ROOT/BOOTSTRAP_TOKEN.txt"

echo "Stopping backend LaunchAgent (if running)..."
launchctl unload "$LAUNCH_AGENT" >/dev/null 2>&1 || true

echo "Removing SQLite database files..."
rm -f \
  "$PROJECT_BACKEND/dev.db" \
  "$PROJECT_BACKEND/dev.db-wal" \
  "$PROJECT_BACKEND/dev.db-shm" \
  "$RUNTIME_BACKEND/dev.db" \
  "$RUNTIME_BACKEND/dev.db-wal" \
  "$RUNTIME_BACKEND/dev.db-shm"

echo "Removing bootstrap token files..."
rm -f \
  "$PROJECT_BACKEND/bootstrap_token.txt" \
  "$RUNTIME_BACKEND/bootstrap_token.txt"

echo "Syncing backend code/data into runtime backend..."
mkdir -p "$RUNTIME_BACKEND"
rsync -a --delete "$PROJECT_BACKEND/" "$RUNTIME_BACKEND/"

echo "Recreating runtime backend launcher script..."
cat > "$RUNTIME_BACKEND/backend_service_macos.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/.ams_backend_runtime"
export AMS_DATABASE_URL="sqlite:////path/to/AMS/backend/dev.db"
exec "$HOME/.ams_backend_runtime/.venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
SH
chmod +x "$RUNTIME_BACKEND/backend_service_macos.sh"

echo "Starting backend LaunchAgent..."
launchctl load "$LAUNCH_AGENT"
sleep 2

echo "Writing token into project token file..."
if [[ -f "$RUNTIME_BACKEND/bootstrap_token.txt" ]]; then
  cp "$RUNTIME_BACKEND/bootstrap_token.txt" "$PROJECT_TOKEN_FILE"
fi

echo
echo "Bootstrap verification:"
printf "Status: "
curl -sS -m 5 http://127.0.0.1:8000/admin/bootstrap/status
printf "\nToken file: %s\n" "$RUNTIME_BACKEND/bootstrap_token.txt"
printf "Bootstrap token: "
cat "$RUNTIME_BACKEND/bootstrap_token.txt"
printf "\n"
printf "Project token file: %s\n" "$PROJECT_TOKEN_FILE"

echo "Done. App is reset to bootstrap mode."
