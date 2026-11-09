# shim

The Shim API is a thin Farcaster read layer. It runs on [Bun](https://bun.sh/) and [Elysia](https://elysiajs.com/), stores casts in SQLite, and caches through a sibling [lmdis](https://github.com/artlu99/lmdis) service. Production is Docker Compose on a Debian VPS.

The last Render/Neon tree is the `cloud-final` tag.

On a Debian VPS, as the deploy user (not root), with git, Docker Engine, and the Compose plugin already installed:

```bash
curl -fsSL https://raw.githubusercontent.com/artlu99/shim/main/install.sh | bash
```

Pipe to `bash`, not `sh`. To bind a port other than 7300: `curl -fsSL https://raw.githubusercontent.com/artlu99/shim/main/install.sh | SHIM_PORT=7301 bash`. Then start Compose as in [Install](#install).

## Development

```bash
bun install
bun dev
```

Open <http://localhost:3000>. The local store is `data/shim.sqlite`. A local `.env` needs `HUB_GRPC_ENDPOINT`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN`. On a box, `install.sh` writes those.

## Install

`install.sh` runs as the deploy user. It does not use sudo, install packages, or create swap. Git, Docker Engine, and the Compose plugin must already be installed. The script checks those, then runs `docker info` and looks for rootless mode. Joining the `docker` group is root-equivalent. Rootless setup is documented at <https://docs.docker.com/engine/security/rootless/>. A rootful daemon does not fail the script. It prints a warning, points at rootless setup instructions, and continues. It clones this repo to `$HOME/shim` and lmdis beside it. The app binds `127.0.0.1:7300`. When `$HOME/shim/.env` is missing it writes one: 32 bytes from `/dev/urandom` go in both `LMDIS_REST_TOKEN` and `UPSTASH_REDIS_REST_TOKEN`, mode `600`, and the value is not printed. A re-run leaves an existing `.env` in place. It does not start Compose or install cloudflared.

From a checkout: `bash install.sh`. If 7300 is already taken, set `SHIM_PORT` before the first run (`SHIM_PORT=7301 bash install.sh`, or on the `bash` side of the curl pipe). Compose reads that value from `.env`. If `.env` already exists, edit `SHIM_PORT` there instead. The container still listens on 3000.

Then:

```bash
cd ~/shim
SHIM_GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
curl -s localhost:7300/health
curl -s localhost:7300/info
```

Use the port from `.env` in that curl when it is not 7300.

## Ingress

Point an existing remotely-managed cloudflared public hostname at `http://127.0.0.1:7300`, or at the `SHIM_PORT` in `.env` when that is different. Optional: Cloudflare Access on the path `refresh`, which is the only mutating route. The in-process refresh cron never leaves the box, so Access does not affect it. The host port is bound to loopback, so it is not behind Access.

## Seed and backup

A new volume starts empty. Copy a snapshot from a potato that already has history. `VACUUM INTO` is consistent while the app is running; a plain copy of a live WAL database is not.

```bash
docker compose exec app bun -e 'const {Database}=require("bun:sqlite"); new Database(process.env.SQLITE_PATH).exec("VACUUM INTO \'/app/data/backup.sqlite\'")'
```

Copy `backup.sqlite` onto the new volume as `shim.sqlite`. Or leave the file empty and `POST /refresh` for the fids you care about. That path is capped per fid and will not reproduce the full historical corpus.

## Reboot

`restart: unless-stopped` brings the stack back after a reboot. `docker compose stop` stays stopped across reboot until `docker compose start`. `docker compose down` deletes the containers; volumes survive, but nothing starts again until `docker compose up -d`.

## Version

`package.json` `version` is the release. Tag that commit `vX.Y.Z`. `GET /info` reports the version, the `SHIM_GIT_SHA` baked in at image build (`unknown` when unset), process memory, load average, the sqlite file size, and cast/follow counts.
