#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import NoReturn

from _common import ROOT, data_dir, host_names, load_env

BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV = BACKEND / ".venv"
VENV_PYTHON = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def fail(message: str) -> NoReturn:
    print(f"\nError: {message}", file=sys.stderr)
    sys.exit(1)


def run(command: list[str], cwd: Path) -> None:
    print(f"  $ {' '.join(command)}")
    subprocess.run(command, cwd=cwd, check=True)


def newest(paths: list[Path]) -> float:
    times = [p.stat().st_mtime for root in paths if root.exists() for p in ([root] if root.is_file() else root.rglob("*")) if p.is_file()]
    return max(times, default=0.0)


def ensure_backend() -> None:
    if sys.version_info < (3, 11):
        fail(f"Python 3.11 or newer is required (this is {sys.version.split()[0]}).")
    requirements = BACKEND / "requirements.txt"
    stamp = VENV / ".installed"
    if not VENV_PYTHON.exists():
        print("Creating the Python environment...")
        try:
            run([sys.executable, "-m", "venv", str(VENV)], ROOT)
        except subprocess.CalledProcessError:
            shutil.rmtree(VENV, ignore_errors=True)
            fail(
                "Python could not create a virtual environment.\n"
                "On Debian or Ubuntu install it with:  sudo apt install python3-venv\n"
                "On Fedora or RHEL:  sudo dnf install python3-pip"
            )
    if not stamp.exists() or stamp.stat().st_mtime < requirements.stat().st_mtime:
        print("Installing server dependencies...")
        run([str(VENV_PYTHON), "-m", "pip", "install", "--quiet", "--upgrade", "pip"], BACKEND)
        run([str(VENV_PYTHON), "-m", "pip", "install", "--quiet", "-r", str(requirements)], BACKEND)
        stamp.touch()


def ensure_frontend(force: bool) -> None:
    built = FRONTEND / "dist" / "index.html"
    sources = [FRONTEND / "src", FRONTEND / "public", FRONTEND / "index.html", FRONTEND / "package.json"]
    if not force and built.exists() and built.stat().st_mtime >= newest(sources):
        return
    npm = shutil.which("npm")
    if npm is None:
        fail("Node.js (with npm) is required to build the web client. Install it from https://nodejs.org and retry.")
    print("Building the web client...")
    if not (FRONTEND / "node_modules").exists():
        run([npm, "ci"], FRONTEND)
    run([npm, "run", "build"], FRONTEND)


def ensure_certificate(data_dir: Path, names: list[str]) -> tuple[Path, Path]:
    folder = data_dir / "tls"
    cert, key, authority = folder / "cert.pem", folder / "key.pem", folder / "ams-ca.crt"
    if not (cert.exists() and key.exists() and authority.exists()):
        print("Generating an HTTPS certificate...")
        run([str(VENV_PYTHON), str(ROOT / "scripts" / "make_cert.py"), str(cert), str(key), *names], ROOT)
    else:
        print(f"\n  To remove the browser warning, install {authority} on each device (see SETUP.md).")
    return cert, key


def main() -> None:
    parser = argparse.ArgumentParser(description="Start the AMS server.")
    parser.add_argument("--lan", action="store_true", help="serve other computers on the network over HTTPS")
    parser.add_argument("--port", type=int, help="port to listen on (default 8000, or AMS_PORT)")
    parser.add_argument("--name", action="append", default=[], help="extra host name or IP for the certificate (repeatable)")
    parser.add_argument("--rebuild", action="store_true", help="rebuild the web client even if it looks up to date")
    args = parser.parse_args()

    ensure_backend()
    ensure_frontend(args.rebuild)

    load_env()
    env = dict(os.environ)
    env["PYTHONPATH"] = str(BACKEND)
    if args.port:
        env["AMS_PORT"] = str(args.port)
    if args.lan:
        env["AMS_HOST"] = "0.0.0.0"
        if not (env.get("AMS_TLS_CERT") and env.get("AMS_TLS_KEY")) and env.get("AMS_BEHIND_PROXY", "0") in ("", "0"):
            cert, key = ensure_certificate(data_dir(), args.name)
            env["AMS_TLS_CERT"], env["AMS_TLS_KEY"] = str(cert), str(key)
            if not env.get("AMS_ALLOWED_HOSTS", "").strip():
                allowed = [name for name in host_names(args.name) if ":" not in name]
                env["AMS_ALLOWED_HOSTS"] = ",".join(allowed)
                print(f"  Accepting requests addressed to: {', '.join(allowed)}")
                print("  (add another name with --name, or set AMS_ALLOWED_HOSTS in .env)")

    try:
        sys.exit(subprocess.run([str(VENV_PYTHON), "-m", "ams"], cwd=ROOT, env=env).returncode)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        fail(f"a setup step failed (exit code {error.returncode}). See the output above.")
