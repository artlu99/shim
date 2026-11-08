FROM oven/bun:1-slim
WORKDIR /app

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "src/index.tsx"]
