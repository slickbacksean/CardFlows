#!/bin/sh
set -eu

addr="${CARD_FLOW_HUDS_ADDRESS:-127.0.0.1}"
port="${CARD_FLOW_HUDS_PORT:-9999}"
curl -fsS "http://$addr:$port/overlay/" >/dev/null
echo "HUDS overlay ok"
