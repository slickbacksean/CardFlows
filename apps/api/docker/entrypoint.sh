#!/bin/sh
# CardFlow API container entrypoint (docs/RAILWAY_DEPLOY.md).
# root:  make the data dir owned by `app` (Railway mounts volumes as root), then drop to app.
# app:   volume guard -> maintenance? -> Litestream restore-if-missing -> migrate under flock -> start.
set -eu

DB="${CARD_FLOW_SQLITE_PATH:-/data/cardflow.sqlite}"
DATA_DIR="$(dirname "$DB")"
LITESTREAM_CONFIG="${LITESTREAM_CONFIG:-/etc/litestream.yml}"
NODE_CMD="node --import tsx src/index.ts"

log() { printf '%s\n' "entrypoint: $*"; }
die() { printf '%s\n' "entrypoint: $*" >&2; exit 1; }

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # Only entries not already owned by app, so this stays fast as the volume grows.
  find "$DATA_DIR" -xdev \! -user app -exec chown app:app {} +
  exec gosu app "$0" "$@"
fi

# Volume guard (same rule as sqliteVolumeProblem in src/production-config.ts).
if [ "${NODE_ENV:-}" = "production" ] && [ "${CARD_FLOW_REQUIRE_VOLUME:-}" != "false" ]; then
  if [ -n "${RAILWAY_ENVIRONMENT_NAME:-}" ] || [ "${CARD_FLOW_REQUIRE_VOLUME:-}" = "true" ]; then
    MOUNT="${RAILWAY_VOLUME_MOUNT_PATH:-}"
    [ -n "$MOUNT" ] || die "No Railway volume is mounted: attach a volume at /data before deploying (the DB would be lost on redeploy)."
    case "$DB" in
      "${MOUNT%/}"/*) ;;
      *) die "CARD_FLOW_SQLITE_PATH ($DB) must be inside the volume ($MOUNT)." ;;
    esac
  fi
fi

if [ "${CARD_FLOW_MAINTENANCE:-}" = "1" ]; then
  log "maintenance mode: skipping restore, migrations and Litestream"
  exec node --import tsx src/maintenance.ts
fi

MODE="${CARD_FLOW_LITESTREAM_MODE:-auto}"
if [ "$MODE" = "auto" ]; then
  if [ -n "${LITESTREAM_BUCKET:-}" ]; then MODE=replicate; else MODE=off; fi
fi
case "$MODE" in
  off)
    [ "${CARD_FLOW_BACKUPS_REQUIRED:-}" != "true" ] || die "backups required but LITESTREAM_* not set (CARD_FLOW_BACKUPS_REQUIRED=true)"
    ;;
  replicate | restore-only) ;;
  *) die "CARD_FLOW_LITESTREAM_MODE must be auto, replicate, restore-only or off (got $MODE)" ;;
esac
export CARD_FLOW_LITESTREAM_MODE_EFFECTIVE="$MODE"
export CARD_FLOW_SQLITE_PATH="$DB"
: "${LITESTREAM_PATH:=litestream/cardflow.sqlite}"
: "${LITESTREAM_REGION:=auto}"
: "${LITESTREAM_REQUIRE_CONTENT_MD5:=true}"
export LITESTREAM_PATH LITESTREAM_REGION LITESTREAM_REQUIRE_CONTENT_MD5
export LITESTREAM_HEARTBEAT_URL="${LITESTREAM_HEARTBEAT_URL:-}"
log "litestream mode: $MODE"

if [ "$MODE" != "off" ]; then
  EXISTED=0
  [ -f "$DB" ] && EXISTED=1
  # Exits 0 when the DB exists or there is no replica yet (first boot); auth/network errors abort the boot.
  litestream restore -config "$LITESTREAM_CONFIG" -if-db-not-exists -if-replica-exists "$DB"
  if [ "$EXISTED" = "0" ] && [ -f "$DB" ]; then
    log "litestream: restored DB from replica"
  fi
fi

flock -w 120 "$DATA_DIR/.migrate.lock" \
  node --import tsx src/db/apply-migration.ts "$DB" --backup-dir "$DATA_DIR/pre-migrate" --keep 3

if [ "$MODE" = "replicate" ]; then
  exec litestream replicate -config "$LITESTREAM_CONFIG" -exec "$NODE_CMD"
fi
exec $NODE_CMD
