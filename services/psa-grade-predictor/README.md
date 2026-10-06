# CardFlow Prepare — dual-branch PSA CNN sidecar
#
# Upstream training repo (clone separately; no license / no public weights):
#   https://github.com/jshan9078/PSAGradePredictor
#
# Priority / full checklist: docs/RUNTIME_CONFIG_PRIORITY.md
#
# This service imports that clone at runtime. CardFlow does not vendor its source.

## Setup

```bash
git clone https://github.com/jshan9078/PSAGradePredictor.git upstream

# Real grades: put your trained phase2_best.pth in checkpoints/
# Wiring smoke only (untrained — not meaningful grades):
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python scripts/make_smoke_checkpoint.py

export PSA_GRADE_UPSTREAM="$(pwd)/upstream"
export PSA_GRADE_CHECKPOINT="$(pwd)/checkpoints/phase2_best.pth"
export PSA_GRADE_CONFIG="$(pwd)/checkpoints/psa_dual_branch_config.json"
# optional: export PSA_GRADE_TOKEN=dev-shared-secret
python serve.py
```

Health: `GET http://127.0.0.1:8091/health`  
Estimate: `POST http://127.0.0.1:8091/v1/estimate` multipart `front` + `back`

## Wire into CardFlow API

```bash
# apps/api/.env
CARD_FLOW_GRADE_ESTIMATE_ENABLED=true
CARD_FLOW_PSA_GRADE_URL=http://127.0.0.1:8091
CARD_FLOW_PSA_GRADE_TOKEN=dev-shared-secret   # if set on the sidecar
```

When `CARD_FLOW_PSA_GRADE_URL` is set, Prepare uses this CNN path instead of Claude.
Claude remains a fallback only if the URL is unset but `ANTHROPIC_API_KEY` is present.

CI stays on the mock provider. Fail soft: sidecar down → empty photo estimate.
