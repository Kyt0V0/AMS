from __future__ import annotations

from urllib.parse import urlsplit

from starlette.exceptions import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

MAX_BODY_BYTES = 1024 * 1024
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
REQUEST_HEADER = "x-ams-request"

CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

SECURITY_HEADERS = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
}


def _reject(status: int, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail})


class HardeningMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        is_api = request.url.path.startswith("/api/")
        response = self._precheck(request) if is_api else None
        if response is None:
            response = await call_next(request)

        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if is_api:
            response.headers["Cache-Control"] = "no-store"
        return response

    @staticmethod
    def _precheck(request: Request) -> Response | None:
        if request.method in SAFE_METHODS:
            return None

        if request.headers.get(REQUEST_HEADER) != "1":
            return _reject(403, "Request blocked")
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).netloc.lower() != request.headers.get("host", "").lower():
            return _reject(403, "Request blocked")

        length = request.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > MAX_BODY_BYTES:
            return _reject(413, "Request too large")
        return None


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, limit: int = MAX_BODY_BYTES):
        self.app = app
        self.limit = limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.limit:
                    raise HTTPException(status_code=413, detail="Request too large")
            return message

        await self.app(scope, limited_receive, send)
