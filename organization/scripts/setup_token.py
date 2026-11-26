#!/usr/bin/env python3

from __future__ import annotations

import sys

from _common import data_dir


def main() -> int:
    folder = data_dir()
    token_file = folder / "setup-token.txt"
    if token_file.is_file():
        print(token_file.read_text(encoding="utf-8").strip())
        return 0
    if (folder / "ams.db").exists():
        print("Setup is already complete: an administrator account exists, so there is no setup token.", file=sys.stderr)
    else:
        print("No setup token yet. Start the server once first:  python3 scripts/start.py", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
