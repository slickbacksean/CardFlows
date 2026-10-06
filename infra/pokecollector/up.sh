#!/bin/sh
# Start unmodified PokéCollector + Postgres, wait until /api/health is ok,
# then trigger first-run English set/card sync if the catalog is still empty.
set -eu

root="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
compose_file="$root/docker-compose.yml"
health_url="${POKECOLLECTOR_HEALTH_URL:-http://127.0.0.1:8000/api/health}"
sync_url="${POKECOLLECTOR_SYNC_URL:-http://127.0.0.1:8000/api/sync/}"
status_url="${POKECOLLECTOR_SYNC_STATUS_URL:-http://127.0.0.1:8000/api/sync/status}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to start PokéCollector. pnpm test does not need it." >&2
  exit 1
fi

if [ -f "$root/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$root/.env"
  set +a
fi
if [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "ADMIN_PASSWORD is empty. Set it in infra/pokecollector/.env (gitignored) before starting PokéCollector." >&2
  exit 1
fi

mkdir -p "$root/data/auth" "$root/data/backups"

docker compose -f "$compose_file" --project-directory "$root" up -d

echo "Waiting for PokéCollector at $health_url"

i=0
while [ "$i" -lt 60 ]; do
  if curl -fsS "$health_url" >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 2
done

if ! "$root/health.sh"; then
  echo "PokéCollector did not become healthy. Check: docker compose -f $compose_file logs backend" >&2
  exit 1
fi

# Scheduler also full-syncs on an empty catalog. POST is idempotent if already running.
sync_body="$(curl -fsS -X POST "$sync_url" || true)"
if [ -n "$sync_body" ]; then
  printf 'First-run English set/card sync: %s\n' "$sync_body"
else
  echo "Could not POST $sync_url (scheduler may already be syncing). Check $status_url"
fi

echo "PokéCollector is up. CardFlow API stays on mocks unless you opt into later HTTP ports."
echo "pnpm test does not require this stack."
