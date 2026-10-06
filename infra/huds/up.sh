#!/bin/sh
# Start unmodified HUDS serving the CardFlow livestream overlay HUD.
# Pin the npm package. Do not vendor HUDS source into apps/ or packages/.
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo="$(CDPATH= cd -- "$root/../.." && pwd)"
pidfile="$root/huds.pid"
# 0.0.0.0 so a physical phone can load EXPO_PUBLIC_HUDS_URL on the LAN.
# Loopback still works for simulator / pnpm huds:health.
addr="${CARD_FLOW_HUDS_ADDRESS:-0.0.0.0}"
port="${CARD_FLOW_HUDS_PORT:-9999}"
hud_dir="$root/overlay"

if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
  echo "HUDS already running (pid $(cat "$pidfile"))"
  exit 0
fi

huds_bin="$repo/node_modules/.bin/huds"
if [ ! -x "$huds_bin" ]; then
  echo "Pinned huds CLI is missing. From the repo root run: pnpm add -w huds@2.2.2" >&2
  exit 1
fi

"$huds_bin" -a "$addr" -p "$port" -d "overlay:$hud_dir" &
echo $! > "$pidfile"

echo "Waiting for HUDS overlay at http://$addr:$port/overlay/"
i=0
while [ "$i" -lt 20 ]; do
  if curl -fsS "http://$addr:$port/overlay/" >/dev/null 2>&1; then
    echo "HUDS overlay is up at http://$addr:$port/overlay/"
    echo "pnpm test does not require this process."
    exit 0
  fi
  i=$((i + 1))
  sleep 0.5
done

echo "HUDS did not become ready. Check the process on port $port." >&2
exit 1
