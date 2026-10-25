# syntax=docker/dockerfile:1.7
# CardFlow API image: Node 22 + the vendored Python grader (opencv-python-headless).
# Build from the repo root:  docker build -f apps/api/Dockerfile -t cardflow-api .
# Run locally:               docker run -p 8080:8080 --memory=2g --cpus=1 cardflow-api
# Hosting: Railway, SQLite on a volume mounted at /data, Litestream replication to object
# storage (docs/RAILWAY_DEPLOY.md). Nothing here creates cloud resources. Configure Railway in
# its dashboard: railway.toml/railway.json are deprecated and new services can't use them.
# The entrypoint (docker/entrypoint.sh) starts as root only to chown /data, then drops to `app`.
ARG NODE_VERSION=22
ARG PYTHON_VERSION=3.12

############################
# 1) Node deps + source    #
############################
FROM node:${NODE_VERSION}-bookworm-slim AS node-build
WORKDIR /repo
# better-sqlite3 compiles with node-gyp on install (no prebuilt binary is fetched), so the
# build stage needs Python, make and a C++ compiler. They don't reach the runtime image;
# both stages are Debian bookworm, so the compiled addon matches the runtime glibc.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
# Manifests first for layer caching. Every workspace package.json is copied so
# --frozen-lockfile sees the same importers as the lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.node-next.json ./
COPY patches patches
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY apps/admin/package.json apps/admin/
COPY legacy/api/package.json legacy/api/
COPY legacy/cardflows-shared/package.json legacy/cardflows-shared/
# The repo uses node-linker=hoisted for React Native, which ignores --filter and would pull
# in Expo. The isolated linker installs only the API's production tree (same lockfile).
# Optional deps stay on: tsx needs esbuild's platform binary. onnxruntime-node (optional,
# used only when an OBB model is mounted) keeps its bundled CPU build; no CUDA download.
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
# No BuildKit cache mount: Railway only accepts cache ids of the form s/<service id>-<path>.
RUN pnpm install --frozen-lockfile --prod --filter "@cardflow/api..." --config.node-linker=isolated \
 && rm -rf node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v3/darwin \
           node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v3/win32
COPY packages/shared packages/shared
COPY apps/api apps/api
# Build admin SPA first with its own isolated install
COPY apps/admin apps/admin
WORKDIR /repo/apps/admin
RUN pnpm install --config.node-linker=hoisted && pnpm build
WORKDIR /repo
# Copy admin build to API public directory
RUN mkdir -p apps/api/public/admin && cp -r apps/admin/dist/* apps/api/public/admin/
# Runs from TypeScript source with tsx (a production dependency). @cardflow/shared
# ships TS source, so there is no separate compile step.
RUN rm -rf apps/api/.venv apps/api/data apps/api/models apps/admin \
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

###########################
# 3) Litestream (pinned)  #
###########################
FROM debian:bookworm-slim AS litestream
ARG LITESTREAM_VERSION=0.5.17
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && case "${TARGETARCH:-amd64}" in \
      amd64) A=x86_64; SHA=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d ;; \
      arm64) A=arm64;  SHA=f8ca4a050095c1efbda2c4365172e61bf9d955ea0d9ac42f448b52e51819baa5 ;; \
      *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; esac \
 && curl -fsSL -o /tmp/ls.tgz "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${A}.tar.gz" \
 && echo "${SHA}  /tmp/ls.tgz" | sha256sum -c - \
 && tar -xzf /tmp/ls.tgz -C /usr/local/bin litestream && /usr/local/bin/litestream version

#################
# 4) Runtime    #
#################
FROM python:${PYTHON_VERSION}-slim-bookworm AS runtime
COPY --from=node-build /usr/local/bin/node /usr/local/bin/node
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates gosu sqlite3 util-linux \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /repo --shell /usr/sbin/nologin app \
 && mkdir -p /data && chown app:app /data
COPY --from=py-build /opt/venv /opt/venv
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY apps/api/docker/litestream.yml /etc/litestream.yml
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
# /data is ephemeral unless a volume is mounted there (Railway: a volume at /data).
# No USER: the entrypoint chowns the root-mounted volume, then runs everything as app (uid 10001).
COPY --chmod=0755 apps/api/docker/entrypoint.sh /repo/apps/api/docker/entrypoint.sh
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/repo/apps/api/docker/entrypoint.sh"]
