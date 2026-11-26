from __future__ import annotations

import sys
import threading
import webbrowser

import uvicorn

from .config import HOST, Settings
from .main import create_app


def main() -> int:
    settings = Settings.from_env()
    app = create_app(settings)
    address = f"http://localhost:{settings.port}"
    print(f"\n  AMS Personal is running at {address}", flush=True)
    print("  It is reachable from this computer only. Press Ctrl+C to stop.\n", flush=True)
    if settings.open_browser:
        threading.Timer(1.0, webbrowser.open, args=(address,)).start()

    uvicorn.run(app, host=HOST, port=settings.port, server_header=False, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
