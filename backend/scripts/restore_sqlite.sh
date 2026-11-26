#!/usr/bin/env bash
set -euo pipefail

# AQA NEA operational note:
# Stop backend process before restore to avoid sqlite file lock conflicts.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_PATH="${1:-}"
DB_PATH="${2:-$ROOT_DIR/dev.db}"

if [[ -z "$BACKUP_PATH" ]]; then
  echo "Usage: $0 <backup_file> [target_db_path]"
  exit 1
fi

if [[ ! -f "$BACKUP_PATH" ]]; then
  echo "Backup file not found: $BACKUP_PATH"
  exit 1
fi

cp "$BACKUP_PATH" "$DB_PATH"
echo "Database restored to: $DB_PATH"
