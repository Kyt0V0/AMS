#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import NoReturn

from _common import ROOT, load_env

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


def main() -> None:
    parser = argparse.ArgumentParser(description="Start AMS Personal on this computer.")
    parser.add_argument("--port", type=int, help="port to listen on (default 8100, or AMS_PORT)")
    parser.add_argument("--no-browser", action="store_true", help="do not open the browser automatically")
    parser.add_argument("--rebuild", action="store_true", help="rebuild the web client even if it looks up to date")
    args = parser.parse_args()

    ensure_backend()
    ensure_frontend(args.rebuild)

    load_env()
    env = dict(os.environ)
    env["PYTHONPATH"] = str(BACKEND)
    if args.port:
        env["AMS_PORT"] = str(args.port)
    if args.no_browser:
        env["AMS_NO_BROWSER"] = "1"

    try:
        sys.exit(subprocess.run([str(VENV_PYTHON), "-m", "ams"], cwd=ROOT, env=env).returncode)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        fail(f"a setup step failed (exit code {error.returncode}). See the output above.")
