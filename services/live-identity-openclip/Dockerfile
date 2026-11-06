# syntax=docker/dockerfile:1.7
# Live-identity OpenCLIP / DINOv2 fusion sidecar for Railway.
# Build context = this directory (Railway rootDirectory =
# services/live-identity-openclip, builder = Dockerfile):
#   docker build -t live-identity-openclip:ci .
# From repo root:
#   docker build -f services/live-identity-openclip/Dockerfile \
#     -t live-identity-openclip:ci services/live-identity-openclip
#
# Models are NOT baked in. Mount the ship bundle on a Railway volume at
# /data/trained-model (bundle under /data/trained-model/bundle/) and set
# TRAINED_MODEL_* / PRINT_RERANK_* per docs/RELEASE_ENV.md and
# docs/RAILWAY_VOLUME_SETUP.md. /health returns HTTP 200 before models are
# uploaded so the first deploy can succeed; then upload the bundle and restart.
#
# CPU-only torch keeps the image smaller than the default CUDA wheel.

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LIVE_IDENTITY_HOST=0.0.0.0 \
    LIVE_IDENTITY_PORT=8080 \
    PORT=8080 \
    LIVE_IDENTITY_DEVICE=cpu \
    LIVE_IDENTITY_INDEX=/data/trained-model/openclip-index

WORKDIR /app

# Runtime libs + build tools for hnswlib (compiled from source; purged below).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      libgomp1 \
      libglib2.0-0 \
      build-essential \
      python3-dev \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 --shell /usr/sbin/nologin app

COPY requirements.txt /app/requirements.txt

# Install CPU torch first so the requirements pin does not pull a CUDA wheel.
# Drop pytest/onnx* — they are for local tests and scripts/export_onnx.py only.
# Purge the C++ toolchain after hnswlib builds so the runtime image stays leaner.
RUN pip install --index-url https://download.pytorch.org/whl/cpu \
      torch torchvision \
 && grep -vE '^(pytest|onnx($|>=|==)|onnxruntime)' /app/requirements.txt > /tmp/req-runtime.txt \
 && pip install -r /tmp/req-runtime.txt \
 && apt-get update \
 && apt-get purge -y --auto-remove build-essential python3-dev \
 && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/req-runtime.txt

# Runtime code only — never copy models/, catalog/, or the ship bundle.
COPY --chown=app:app \
     serve.py \
     fusion_score.py \
     orb_rerank.py \
     printing_rerank.py \
     trained_dinov2.py \
     trained_dinov2_fusion.py \
     warp.py \
     /app/
COPY --chown=app:app reranker /app/reranker

# Volume mount point for the trained-model bundle (Railway mounts over /data).
RUN mkdir -p /data/trained-model \
 && chown -R app:app /data /app

USER app

EXPOSE 8080

# Railway injects PORT; map it onto LIVE_IDENTITY_PORT that serve.py reads.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8080}/health" >/dev/null || exit 1

CMD ["sh", "-c", "export LIVE_IDENTITY_HOST=\"${LIVE_IDENTITY_HOST:-0.0.0.0}\"; export LIVE_IDENTITY_PORT=\"${PORT:-${LIVE_IDENTITY_PORT:-8080}}\"; exec python serve.py"]
