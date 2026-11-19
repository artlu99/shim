FROM oven/bun:1-slim
WORKDIR /app

# The compose healthcheck probes with curl, not bun: a probe that
# cold-starts a JS runtime every 30s burns CPU/RAM on a box that fights
# bursts, and a bare exit 1 hides the failure reason that curl prints.
# oven/bun slim ships without curl — install it here, as root, before
# the USER switch below.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

# SQLite store lives here (SQLITE_PATH=/app/data/shim.sqlite, compose volume
# shimdata). The dir must EXIST and be owned by `bun` in the image: docker
# seeds a fresh named volume by copying this path's ownership — a mount point
# created at attach time would be root-owned and the app would die with
# EACCES on first write.
RUN mkdir -p /app/data && chown bun:bun /app/data

ENV NODE_ENV=production
ENV TZ=UTC
ENV PORT=3000

# .git is not in the image. Compose passes the sha at build time.
ARG SHIM_GIT_SHA=unknown
ENV SHIM_GIT_SHA=${SHIM_GIT_SHA}

USER bun
EXPOSE 3000

# No image-level HEALTHCHECK: docker-compose.yml defines both services'
# probes and overrides this layer's copy anyway — one source of truth.
# --smol trims JSC's heap growth ambitions (more GC, less RSS ratchet);
# it is the production posture only — the dev script stays un-smol.
CMD ["bun", "--smol", "src/shim-service.tsx"]
