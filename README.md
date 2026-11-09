# shim

The Shim API is a thin Farcaster read layer. It runs on [Bun](https://bun.sh/) and [Elysia](https://elysiajs.com/), stores casts in SQLite, and caches through a sibling [lmdis](https://github.com/artlu99/lmdis) service. Production is Docker Compose on a Debian VPS.

The last Render/Neon tree is the `cloud-final` tag.

## Development

```bash
bun install
bun dev
```

Open <http://localhost:3000>. The local store is `data/shim.sqlite`. A local `.env` needs `HUB_GRPC_ENDPOINT`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN`. On a box, `install.sh` writes those.

## Install

`install.sh` runs as the deploy user. It does not use sudo, install packages, or create swap. Git, Docker Engine, and the Compose plugin must already be installed. The script checks those, and it checks that the current login is in the `docker` group without changing groups. It clones this repo to `$HOME/shim` and lmdis beside it. The app binds `127.0.0.1:7300`. When `$HOME/shim/.env` is missing it writes one: 32 bytes from `/dev/urandom` go in both `LMDIS_REST_TOKEN` and `UPSTASH_REDIS_REST_TOKEN`, mode `600`, and the value is not printed. A re-run leaves an existing `.env` in place. It does not start Compose or install cloudflared.

```bash
bash install.sh
```

Then:

```bash
cd ~/shim
SHIM_GIT_SHA=$(git rev-parse --short HEAD) docker compose up -d --build
curl -s localhost:7300/health
curl -s localhost:7300/info
```

## Ingress

Point an existing remotely-managed cloudflared public hostname at `http://127.0.0.1:7300`. Optional: Cloudflare Access on the path `refresh`, which is the only mutating route. The in-process refresh cron never leaves the box, so Access does not affect it. The host port is bound to loopback, so it is not behind Access.

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
