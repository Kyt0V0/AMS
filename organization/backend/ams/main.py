from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import sessionmaker
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import __version__
from .config import Settings
from .core import AppContext
from .db import make_engine, upgrade_schema
from .mail import create_mailer
from .middleware import BodyLimitMiddleware, HardeningMiddleware
from .routers import account, admin, auth, credentials
from .security import ServerKeys

log = logging.getLogger("ams")

LOOPBACK = {"127.0.0.1", "localhost", "::1"}
LOCAL_HOSTS = ["localhost", "127.0.0.1"]


class _ClientFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    engine = make_engine(settings.database_url)
    upgrade_schema(engine)
    ctx = AppContext(
        settings=settings,
        keys=ServerKeys.load(settings),
        session_factory=sessionmaker(bind=engine, autoflush=False, expire_on_commit=False),
        mailer=create_mailer(settings),
    )

    docs = {} if settings.debug else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="AMS", version=__version__, **docs)
    app.state.ctx = ctx
    app.state.engine = engine
    app.state.setup_token = auth.ensure_setup_token(ctx)

    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(HardeningMiddleware)
    allowed_hosts = list(settings.allowed_hosts)
    if not allowed_hosts and not settings.behind_proxy and settings.host in LOOPBACK:
        allowed_hosts = LOCAL_HOSTS
    if allowed_hosts:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)

    @app.exception_handler(RequestValidationError)
    async def _invalid_request(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        field = ".".join(str(part) for part in first.get("loc", ())[1:])
        message = f"Invalid value for {field}" if field else "Invalid request"
        return JSONResponse(status_code=422, content={"detail": message})

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception):
        log.exception("Unhandled error", exc_info=exc)
        return JSONResponse(status_code=500, content={"detail": "Something went wrong on the server"})

    for module in (auth, account, credentials, admin):
        app.include_router(module.router)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "version": __version__}

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    def _unknown_api(rest: str):
        raise HTTPException(status_code=404, detail="Not found")

    if (settings.static_dir / "index.html").is_file():
        app.mount("/", _ClientFiles(directory=settings.static_dir, html=True), name="client")
    else:
        @app.get("/", include_in_schema=False)
        def _client_missing():
            return PlainTextResponse(
                "The AMS server is running, but the web client has not been built yet.\n"
                "Run:  cd frontend && npm install && npm run build\n",
                status_code=503,
            )

    return app
