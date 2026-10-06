#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
pidfile="$root/huds.pid"

if [ ! -f "$pidfile" ]; then
  echo "HUDS is not running"
  exit 0
fi

pid="$(cat "$pidfile")"
if kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
fi
rm -f "$pidfile"
echo "HUDS stopped"
