from __future__ import annotations

import sys

import uvicorn

from .config import Settings
from .main import LOOPBACK, create_app


def main() -> int:
    settings = Settings.from_env()
    use_tls = bool(settings.tls_cert and settings.tls_key)

    if bool(settings.tls_cert) != bool(settings.tls_key):
        print("Set both AMS_TLS_CERT and AMS_TLS_KEY, or neither.", file=sys.stderr)
        return 2
    if settings.host not in LOOPBACK and not use_tls and not settings.behind_proxy:
        print(
            "Refusing to serve AMS to the network over plain HTTP.\n"
            "  - run  python3 scripts/start.py --lan  to serve HTTPS with a generated certificate, or\n"
            "  - set AMS_TLS_CERT / AMS_TLS_KEY to your own certificate, or\n"
            "  - put AMS behind an HTTPS reverse proxy and set AMS_BEHIND_PROXY=1.",
            file=sys.stderr,
        )
        return 2

    app = create_app(settings)
    scheme = "https" if use_tls else "http"
    shown_host = "localhost" if settings.host in LOOPBACK else settings.host
    print(f"\n  AMS is starting on {scheme}://{shown_host}:{settings.port}", flush=True)
    if app.state.setup_token:
        print(
            "\n  First run: open the address above and create the administrator account.\n"
            f"  Setup token: {app.state.setup_token}\n"
            f"  (also saved in {settings.data_dir / 'setup-token.txt'})"
        )
    print(flush=True)

    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        ssl_certfile=str(settings.tls_cert) if use_tls else None,
        ssl_keyfile=str(settings.tls_key) if use_tls else None,
        proxy_headers=settings.behind_proxy,
        forwarded_allow_ips="127.0.0.1" if settings.behind_proxy else None,
        server_header=False,
        log_level="info",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
