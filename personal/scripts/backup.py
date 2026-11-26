#!/usr/bin/env python3

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from _common import data_dir


def main() -> int:
    folder_in = data_dir()
    source = folder_in / "vault.db"
    if not source.exists():
        print(f"No database found at {source}", file=sys.stderr)
        return 1

    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else folder_in / "backups"
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"vault-{datetime.now():%Y%m%d-%H%M%S}.db"

    with sqlite3.connect(source) as live, sqlite3.connect(target) as copy:
        live.backup(copy)
    os.chmod(target, 0o600)
    print(f"Backup written to {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
