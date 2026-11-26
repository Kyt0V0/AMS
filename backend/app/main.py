from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
import os
from .routes import users, credentials, shares, admin
from .db import Base, engine
from .migration_runner import apply_migrations

from .field_crypto import ensure_app_key
ensure_app_key()

from dotenv import load_dotenv
load_dotenv()

from .bootstrap import get_bootstrap_token
get_bootstrap_token()

# AQA NEA note: initialize SQLite schema/migrations on startup so first-run bootstrap works on a clean database file.
apply_migrations()
Base.metadata.create_all(bind=engine)


app = FastAPI(title="Access Management System")

trusted_hosts_raw = os.getenv("AMS_TRUSTED_HOSTS", "").strip()
if trusted_hosts_raw:
    # AQA NEA note: set AMS_TRUSTED_HOSTS in deployment when running behind HTTPS reverse proxy.
    hosts = [h.strip() for h in trusted_hosts_raw.split(",") if h.strip()]
    if hosts:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)

if os.getenv("DEBUG", "").strip() == "1":
    from fastapi import Request
    from fastapi.responses import JSONResponse
    import traceback

    @app.exception_handler(Exception)
    async def all_exception_handler(request: Request, exc: Exception):
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        print("\n=== UNHANDLED EXCEPTION ===")
        print(f"{request.method} {request.url}")
        print(tb)
        return JSONResponse(status_code=500, content={"detail": "Internal Server Error", "traceback": tb})


default_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
]
cors_raw = os.getenv("AMS_CORS_ORIGINS", "").strip()
cors_origins = [o.strip() for o in cors_raw.split(",") if o.strip()] if cors_raw else default_origins

app.add_middleware(
    CORSMiddleware,
    # AQA NEA note: AMS_CORS_ORIGINS lets deployments allow trusted company LAN/web origins.
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(credentials.router)
app.include_router(shares.router)
app.include_router(admin.router)
