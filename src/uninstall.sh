#!/bin/bash
# s0ulctl uninstall — restore every patched 9router install from .bak files.

set -u

find_apps() {
  local seen=""
  # Mirrors install.sh: S0ULCTL_APP_DIRS pins explicit paths,
  # S0ULCTL_HOME_ROOTS overrides the /home/* glob.
  local roots="${S0ULCTL_HOME_ROOTS:-/home/*}"
  for d in ${S0ULCTL_APP_DIRS:-} \
    $roots/.nvm/versions/node/*/lib/node_modules/9router/app \
    $roots/.hermes/tools/node-*/lib/node_modules/9router/app \
    "$(npm root -g 2>/dev/null)/9router/app" \
    "$(dirname "$(readlink -f "$(which 9router 2>/dev/null)" 2>/dev/null)" 2>/dev/null)/app"; do
    [ -n "$d" ] && [ -f "$d/custom-server.js" ] || continue
    case " $seen " in *" $d "*) continue;; esac
    seen="$seen $d"
    echo "$d"
  done
}

for APP in $(find_apps); do
  echo "restoring $APP"

  CS="$APP/custom-server.js"
  latest=$(ls -t "$CS".bak-* 2>/dev/null | head -1)
  if [ -n "$latest" ]; then
    cp "$latest" "$CS"
    echo "  custom-server.js restored from $latest"
  fi
  rm -f "$APP/soul-loader.cjs"

  for bak in "$APP/.next-cli-build/server/chunks"/*.bak-s0ulctl; do
    [ -f "$bak" ] || continue
    live="${bak%.bak-s0ulctl}"
    cp "$bak" "$live"
    rm "$bak"
    echo "  $(basename $live) restored"
  done
done

echo
echo "done. restart 9router to apply: sudo systemctl restart 9router.service"
