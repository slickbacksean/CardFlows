#!/usr/bin/env bash
# Start the CNN grade sidecar (smoke or real checkpoint).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  echo "Missing .venv — run: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt" >&2
  exit 1
fi
# shellcheck disable=SC1091
source .venv/bin/activate

export PSA_GRADE_UPSTREAM="${PSA_GRADE_UPSTREAM:-$ROOT/upstream}"
export PSA_GRADE_CHECKPOINT="${PSA_GRADE_CHECKPOINT:-$ROOT/checkpoints/phase2_best.pth}"
export PSA_GRADE_CONFIG="${PSA_GRADE_CONFIG:-$ROOT/checkpoints/psa_dual_branch_config.json}"
export PSA_GRADE_HOST="${PSA_GRADE_HOST:-127.0.0.1}"
export PSA_GRADE_PORT="${PSA_GRADE_PORT:-8091}"

if [[ ! -d "$PSA_GRADE_UPSTREAM/src" ]]; then
  echo "Missing upstream at $PSA_GRADE_UPSTREAM — clone PSAGradePredictor there." >&2
  exit 1
fi
if [[ ! -f "$PSA_GRADE_CHECKPOINT" ]]; then
  echo "Missing checkpoint at $PSA_GRADE_CHECKPOINT" >&2
  echo "Smoke: python scripts/make_smoke_checkpoint.py" >&2
  exit 1
fi

exec python serve.py
