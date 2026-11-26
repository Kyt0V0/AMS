'''
chmod +x setup.sh
./setup.sh
'''

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_brew() {
  if need_cmd brew; then
    return 0
  fi
  echo "Homebrew not found. Installing Homebrew..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi

  if ! need_cmd brew; then
    echo "Homebrew install failed or not on PATH."
    exit 1
  fi
}

brew_install_if_missing() {
  local formula="$1"
  if brew list --formula "$formula" >/dev/null 2>&1; then
    return 0
  fi
  brew install "$formula"
}

ensure_python() {
  if need_cmd python3; then
    return 0
  fi
  install_brew
  brew_install_if_missing python
  if ! need_cmd python3; then
    echo "python3 still not found after install."
    exit 1
  fi
}

ensure_pip() {
  if python3 -m pip --version >/dev/null 2>&1; then
    return 0
  fi
  python3 -m ensurepip --upgrade >/dev/null 2>&1 || true
  if ! python3 -m pip --version >/dev/null 2>&1; then
    echo "pip not available."
    exit 1
  fi
}

ensure_node() {
  if need_cmd node && need_cmd npm; then
    return 0
  fi
  install_brew
  brew_install_if_missing node
  if ! need_cmd node || ! need_cmd npm; then
    echo "node/npm still not found after install."
    exit 1
  fi
}

setup_backend() {
  if [[ ! -d "$BACKEND_DIR" ]]; then
    echo "Missing backend directory at $BACKEND_DIR"
    exit 1
  fi

  cd "$BACKEND_DIR"
  echo "Setting up backend..."

  python3 -m venv .venv
  source .venv/bin/activate
  python -m pip install --upgrade pip

  if [[ -f requirements.txt ]]; then
    pip install -r requirements.txt
  else
    pip install fastapi uvicorn sqlalchemy pydantic email-validator cryptography python-dotenv
    pip freeze > requirements.txt
  fi

  python -m app.migration_runner

  deactivate
}

setup_frontend() {
  if [[ ! -d "$FRONTEND_DIR" ]]; then
    echo "Missing frontend directory at $FRONTEND_DIR"
    exit 1
  fi

  cd "$FRONTEND_DIR"
  echo "Setting up frontend..."

  if [[ ! -f package.json ]]; then
    echo "package.json not found in frontend. Create the Vite project first."
    exit 1
  fi

  npm install
  npm install argon2-browser tweetnacl
}

main() {
  echo "Checking system dependencies..."
  ensure_python
  ensure_pip
  ensure_node

  setup_backend
  setup_frontend

  echo ""
  echo "Done."
  echo "To run backend:"
  echo "  cd backend && source .venv/bin/activate && python -m app.migration_runner && python -m uvicorn app.main:app --reload --port 8000"
  echo "To run frontend:"
  echo "  cd frontend && npm run dev"
}

main
