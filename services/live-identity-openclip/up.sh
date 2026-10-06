#!/bin/sh
# Start the OpenCLIP livestream identity sidecar (smoke or full index).
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
pidfile="$root/live-identity.pid"
logfile="$root/live-identity.log"
host="${LIVE_IDENTITY_HOST:-127.0.0.1}"
port="${LIVE_IDENTITY_PORT:-8092}"
index="${LIVE_IDENTITY_INDEX:-$root/data/smoke-index}"
# OpenCLIP model load can take minutes on CPU / Intel Macs.
wait_secs="${LIVE_IDENTITY_WAIT_SECS:-240}"

if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
  echo "live-identity OpenCLIP already running (pid $(cat "$pidfile"))"
  exit 0
fi

if [ ! -d "$root/.venv" ]; then
  echo "Create the venv first: cd services/live-identity-openclip && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

if [ ! -f "$index/hnsw.bin" ]; then
  echo "Building smoke index at $index"
  "$root/.venv/bin/python" "$root/scripts/build_smoke_index.py"
fi

export LIVE_IDENTITY_INDEX="$index"
export LIVE_IDENTITY_HOST="$host"
export LIVE_IDENTITY_PORT="$port"
nohup "$root/.venv/bin/python" "$root/serve.py" >"$logfile" 2>&1 &
echo $! > "$pidfile"

echo "Waiting up to ${wait_secs}s for live-identity OpenCLIP at http://$host:$port/health (log: $logfile)"
i=0
while [ "$i" -lt "$wait_secs" ]; do
  if curl -fsS "http://$host:$port/health" >/dev/null 2>&1; then
    echo "live-identity OpenCLIP is up at http://$host:$port"
    exit 0
  fi
  if ! kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "live-identity OpenCLIP exited during startup; see $logfile" >&2
    rm -f "$pidfile"
    exit 1
  fi
  i=$((i + 1))
  sleep 1
done

echo "live-identity OpenCLIP did not become ready; see $logfile" >&2
exit 1
