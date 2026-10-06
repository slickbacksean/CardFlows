#!/bin/sh
set -eu

host="${LIVE_IDENTITY_HOST:-127.0.0.1}"
port="${LIVE_IDENTITY_PORT:-8092}"
curl -fsS "http://$host:$port/health" >/dev/null
echo "live-identity OpenCLIP ok"
