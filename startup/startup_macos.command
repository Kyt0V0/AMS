#!/usr/bin/env bash
set -euo pipefail

# Double-click launcher for macOS Finder.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

"$SCRIPT_DIR/startup_macos.sh"

echo
echo "AMS startup finished. Press Enter to close this window."
read -r _
