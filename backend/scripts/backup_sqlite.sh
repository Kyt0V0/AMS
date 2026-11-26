#!/usr/bin/env bash
set -euo pipefail

# AQA NEA operational note:
# Use sqlite .backup for a consistent snapshot while the app may be running.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${1:-$ROOT_DIR/dev.db}"
OUT_PATH="${2:-$ROOT_DIR/backup-$(date +%Y%m%d-%H%M%S).db}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "Database not found: $DB_PATH"
  exit 1
fi

sqlite3 "$DB_PATH" ".backup '$OUT_PATH'"
echo "Backup created: $OUT_PATH"
