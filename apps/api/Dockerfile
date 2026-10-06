# syntax=docker/dockerfile:1.7
# CardFlow API image: Node 22 + the vendored Python grader (opencv-python-headless).
# Build from the repo root:  docker build -f apps/api/Dockerfile -t cardflow-api .
# Run locally:               docker run -p 8080:8080 --memory=2g --cpus=1 cardflow-api
# Hosting provider, database and photo retention are still open decisions; nothing
# here creates cloud resources. Configure the platform in its dashboard (not railway.toml).
ARG NODE_VERSION=22
ARG PYTHON_VERSION=3.12

############################
# 1) Node deps + source    #
############################
FROM node:${NODE_VERSION}-bookworm-slim AS node-build
WORKDIR /repo
RUN corepack enable
# Manifests first for layer caching. Every workspace package.json is copied so
# --frozen-lockfile sees the same importers as the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.node-next.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY legacy/api/package.json legacy/api/
COPY legacy/cardflows-shared/package.json legacy/cardflows-shared/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --no-optional --filter "@cardflow/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
# Runs from TypeScript source with tsx (a production dependency). @cardflow/shared
# ships TS source, so there is no separate compile step.
RUN rm -rf apps/api/.venv apps/api/data apps/api/models \
 && find . -name '*.test.ts' -not -path '*/node_modules/*' -delete

#################################
# 2) Python venv for the grader #
#################################
FROM python:${PYTHON_VERSION}-slim-bookworm AS py-build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY apps/api/vendor/cardgrading/requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --only-binary=:all: -r /tmp/requirements.txt \
 && /opt/venv/bin/python -c "import cv2, numpy; print('cv2', cv2.__version__, 'numpy', numpy.__version__)" \
 && find /opt/venv -name '__pycache__' -prune -exec rm -rf {} +

#################
# 3) Runtime    #
#################
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime
COPY --from=node-build /usr/local/bin/node /usr/local/bin/node
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /repo --shell /usr/sbin/nologin app \
 && mkdir -p /data && chown app:app /data
COPY --from=py-build /opt/venv /opt/venv
COPY --from=node-build --chown=app:app /repo /repo
WORKDIR /repo/apps/api
ENV NODE_ENV=production \
    PORT=8080 \
    CARD_FLOW_SQLITE_PATH=/data/cardflow.sqlite \
    CARDFLOW_GRADE_CARD_PYTHON=/opt/venv/bin/python \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    TMPDIR=/tmp
# /data is ephemeral unless the platform mounts a volume there (DB choice is open).
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "src/index.ts"]
