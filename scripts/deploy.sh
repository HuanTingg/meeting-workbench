#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then echo 'This entry is for macOS. Windows: scripts/deploy.ps1'; exit 1; fi
for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [[ -x "$candidate" ]]; then eval "$("$candidate" shellenv)"; break; fi
done
if [[ "${1:-}" == --start ]]; then
  if [[ ! -f .runtime/native-tools.json ]]; then echo 'Run bash scripts/deploy.sh first.'; exit 1; fi
  exec "$(brew --prefix node@22)/bin/node" scripts/native.mjs start
fi
if ! command -v brew >/dev/null; then
  echo 'Installing Homebrew. macOS may ask for your system password and developer tools.'
  installer="$(mktemp)"
  curl -fLsS https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$installer"
  /bin/bash "$installer"
  rm -f "$installer"
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$candidate" ]]; then eval "$("$candidate" shellenv)"; break; fi
  done
fi
echo '[1/5] Preparing Node.js, Python and MySQL...'
brew install node@22 python@3.12 mysql@8.4
export PATH="$(brew --prefix node@22)/bin:$PATH"
mkdir -p .runtime
python_base="$(brew --prefix python@3.12)/bin/python3.12"
if [[ ! -x .runtime/funasr-venv/bin/python ]]; then "$python_base" -m venv .runtime/funasr-venv; fi
python_path="$PWD/.runtime/funasr-venv/bin/python"
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
echo '[2/5] Installing required speech dependencies and bundled FFmpeg...'
"$python_path" -m pip install --disable-pip-version-check -r services/funasr/requirements-native.txt
node -e 'const fs=require("fs");const [node,python,mysqld]=process.argv.slice(1);const file=".runtime/native-tools.json";const old=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):{};fs.writeFileSync(file,JSON.stringify({node,python,mysqld:old.mysqld||mysqld},null,2));' "$(command -v node)" "$python_path" "$(brew --prefix mysql@8.4)/bin/mysqld"
echo '[3/5] Installing and building web application...'
npm ci
npm run build
echo '[4/5] Downloading and loading all speech models (required)...'
"$python_path" scripts/prepare-funasr.py
echo '[5/5] Initializing database and starting services...'
exec node scripts/native.mjs setup
