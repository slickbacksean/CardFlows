#!/bin/sh
# Health-check the local PokéCollector backend. Does not start Docker.
set -eu

url="${POKECOLLECTOR_HEALTH_URL:-http://127.0.0.1:8000/api/health}"
body="$(curl -fsS "$url")"

printf '%s\n' "$body"

case "$body" in
  *'"status":"ok"'*|*'"status": "ok"'*)
    exit 0
    ;;
esac

echo "PokéCollector health check failed: unexpected body" >&2
exit 1
