#!/bin/bash
# s0ulctl install — patch 9router to load the system prompt from a markdown file.
# Idempotent. Multi-install aware. Safe to re-run after `npm i -g 9router`.
#
# Usage:
#   ./install.sh              # patch all discovered 9router installs
#   ./install.sh --restart    # also restart 9router.service (needs sudo)

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
LOADER="$HERE/soul-loader.cjs"
SOUL_PATH="${S0ULCTL_PATH:-/etc/s0ulctl/soul.md}"

[ -f "$LOADER" ] || { echo "error: soul-loader.cjs not next to install.sh"; exit 1; }

if [ ! -f "$SOUL_PATH" ]; then
  echo "warn: $SOUL_PATH does not exist yet"
  echo "      the loader will fall back to \"You are a helpful assistant.\" until you create it"
fi

find_apps() {
  local seen=""
  for d in \
    /home/*/.nvm/versions/node/*/lib/node_modules/9router/app \
    /home/*/.hermes/tools/node-*/lib/node_modules/9router/app \
    "$(npm root -g 2>/dev/null)/9router/app" \
    "$(dirname "$(readlink -f "$(which 9router 2>/dev/null)" 2>/dev/null)" 2>/dev/null)/app"; do
    [ -n "$d" ] && [ -f "$d/custom-server.js" ] || continue
    case " $seen " in *" $d "*) continue;; esac
    seen="$seen $d"
    echo "$d"
  done
}

APPS=$(find_apps)
[ -n "$APPS" ] || { echo "error: no 9router install found"; exit 1; }
echo "found 9router installs:"
echo "$APPS" | sed 's/^/  /'

for APP in $APPS; do
  echo
  echo "patching $APP"
  cp "$LOADER" "$APP/soul-loader.cjs"

  CS="$APP/custom-server.js"
  if ! grep -q 'soul-loader' "$CS"; then
    cp "$CS" "$CS.bak-$(date +%Y%m%d%H%M%S)"
    python3 - "$CS" <<'PY'
import sys
p = sys.argv[1]
src = open(p).read()
anchor = 'const { pathToFileURL } = require("url");\n'
if src.count(anchor) != 1:
    print(f"error: anchor count = {src.count(anchor)} in {p}")
    sys.exit(1)
src = src.replace(
    anchor,
    anchor + '\nconst s0ul = require("./soul-loader.cjs"); s0ul.install();\n',
)
open(p, "w").write(src)
PY
  fi
  grep -q 's0ul.install' "$CS" || { echo "error: loader not wired into $CS"; exit 1; }
  node --check "$CS" || { echo "error: $CS has syntax errors after patch"; exit 1; }

  CHUNKS="$APP/.next-cli-build/server/chunks"
  [ -d "$CHUNKS" ] || { echo "error: $CHUNKS not found"; exit 1; }

  python3 - "$CHUNKS" <<'PY'
import os, sys, glob
chunks = sys.argv[1]

targets = [
    ('"You are CodeBuddy Code."',
     '(globalThis.__s0ulctl?.()||"You are CodeBuddy Code.")'),
    ('"You are a helpful AI assistant that helps with software engineering tasks."',
     '(globalThis.__s0ulctl?.()||"You are a helpful AI assistant that helps with software engineering tasks.")'),
    ('"You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks."',
     '(globalThis.__s0ulctl?.()||"You are MiMoCode, an interactive CLI tool that helps users with software engineering tasks.")'),
]

for path in sorted(glob.glob(os.path.join(chunks, "*.js"))):
    try:
        src = open(path, "r", encoding="utf-8").read()
    except Exception:
        continue
    out = src
    for old, new in targets:
        if old in out and new not in out:
            out = out.replace(old, new)
    if out != src:
        bak = path + ".bak-s0ulctl"
        if not os.path.exists(bak):
            open(bak, "w", encoding="utf-8").write(src)
        open(path, "w", encoding="utf-8").write(out)
        print(f"  patched {os.path.basename(path)}")

hits = sum(1 for p in glob.glob(os.path.join(chunks, "*.js"))
           if "globalThis.__s0ulctl" in open(p).read())
print(f"  chunks with s0ulctl call: {hits}")
if hits == 0:
    print("error: no chunk matched any target string")
    sys.exit(1)
PY
  [ "$?" = "0" ] || { echo "error: chunk patch failed"; exit 1; }

  for bak in "$CHUNKS"/*.bak-s0ulctl; do
    [ -f "$bak" ] || continue
    live="${bak%.bak-s0ulctl}"
    node --check "$live" || { echo "error: $live invalid after patch"; exit 1; }
  done
done

echo
if [ "${1:-}" = "--restart" ]; then
  sudo systemctl restart 9router.service && echo "9router restarted"
else
  echo "done. restart 9router to activate: sudo systemctl restart 9router.service"
fi
