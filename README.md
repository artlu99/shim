# shim

The Shim API is a thin Farcaster read layer. It runs on [Bun](https://bun.sh/) and [Elysia](https://elysiajs.com/), stores casts in SQLite, and caches its own network calls through a sibling [lmdis](https://github.com/artlu99/lmdis) service. Production is Docker Compose on a Debian VPS.

On a Debian VPS, ensure git and rootless Docker Engine + Compose plugin are set up. Then as the deploy user (not root):

```bash
curl -fsSL https://raw.githubusercontent.com/artlu99/shim/main/install.sh | bash
```

Then:

```bash
./upgrade.sh
```

## Development

```bash
bun install
bun dev
```

Open [http://localhost:3000](http://localhost:3000). The local store is `data/shim.sqlite`. A local `.env` needs `HUB_GRPC_ENDPOINT`, `UPSTASH_REDIS_REST_URL`, and `UPSTASH_REDIS_REST_TOKEN` (can be lmdis). On a box, `install.sh` writes those. `HYPERSNAP_API_ENDPOINT` is optional — it defaults to Quilibrium's public node and backs `/h`'s hash-only network resolution on a local-index miss. `HAATZ_GATEWAY_ENDPOINT` is optional too and defaults to the same node; it backs the `/v1` gateway that corpus sync and user hydration use.

The last Render/Neon tree was the `cloud-final` tag.

## The Snapchain vs Hypersnap fork

Snapchain and Hypersnap are forked (2026-11-12): a message on one is not guaranteed to appear on the other. shim treats a hash or a user on either world as valid. Hypersnap is primary everywhere — cast resolution, corpus sync (`/refresh`, feeds), and user hydration go to Hypersnap's `/v1` gateway first, and Snapchain gRPC (via `HUB_GRPC_ENDPOINT`) is consulted only on a clean Hypersnap miss or a Hypersnap outage. A miss on both worlds answers "not found"; a world that fails without answering is an outage (503), never a false miss.

Two things deliberately stay Snapchain-world only (2026-11-12 23:19 CET):

- **Following-graph expansion.** `POST /refresh` with a `username` resolves the follow list on Snapchain only. A Hypersnap-only account's casts sync fine when its fid is named directly or reached by another refresh path, but the username→followees walk never sees it.
- **Username→fid mappings.** `getHubFidByUsername` (the `/f-u` route, `/wc` URI search, `/:username/casts-and-replies`) resolves names through Snapchain proofs. A Hypersnap-only account's username will not resolve to its fid until this moves or the fork heals.

Both are revisited when the two networks realign — or when the follow graph and name proofs are needed from the Hypersnap world, which the same gateway already serves.

## Install

`install.sh` runs as the deploy user. It does not use sudo or install packages. Git, Docker Engine, and the Compose plugin must already be installed. The script checks those, then runs `docker info` and looks for rootless mode. Joining the `docker` group is root-equivalent. Rootless setup is documented at <https://docs.docker.com/engine/security/rootless/>. A rootful daemon does not fail the script. It prints a warning, points at rootless setup instructions, and continues. It clones this repo to `$HOME/shim` and lmdis beside it. The app binds `127.0.0.1:7300`. When `$HOME/shim/.env` is missing it writes one: 32 bytes from `/dev/urandom` go in both `LMDIS_REST_TOKEN` and `UPSTASH_REDIS_REST_TOKEN`, mode `600`, and the value is not printed. A re-run leaves an existing `.env` in place. It does not start Compose or install cloudflared.

From a checkout: `bash install.sh`. If 7300 is already taken, set `SHIM_PORT` before the first run (`SHIM_PORT=7301 bash install.sh`, or on the `bash` side of the curl pipe). Compose reads that value from `.env`. If `.env` already exists, edit `SHIM_PORT` there instead. The container still listens on 3000.

Compose also names containers and volumes from the project name. The default is `shim`, which is what an existing checkout keeps when `.env` has no `COMPOSE_PROJECT_NAME`. A new `.env` gets `shim-<user>`, so a second account on the same machine does not replace the first account's containers. Do not edit `name:` in `docker-compose.yml`. A later `git pull` would overwrite it. Set `COMPOSE_PROJECT_NAME` in that checkout's `.env` instead.

Then:

```bash
bash ~/shim/upgrade.sh
```

```sh
curl -s localhost:7300/health
```

```sh
curl -s localhost:7300/info
```

Use the port from `.env` in that curl when it is not 7300. `upgrade.sh` fast-forwards this checkout to `origin/main` when the tree is clean, then rebuilds. A dirty tree exits and leaves the stack alone. It does not pull `~/lmdis`. When the running app's `SHIM_GIT_SHA` already equals `git rev-parse --short HEAD`, it skips the image build and runs `docker compose up -d`, which applies a changed `.env` or compose file and leaves the containers alone when nothing drifted. Otherwise it bakes that SHA in and runs `docker compose up -d --build`. `docker compose down` is not part of an upgrade. Volumes stay.

## Ingress

Point an existing remotely-managed cloudflared public hostname at `http://127.0.0.1:7300`, or at the `SHIM_PORT` in `.env` when that is different. Optional: Cloudflare Access on the path `refresh`, which is the only mutating route. The in-process refresh cron never leaves the box, so Access does not affect it. The host port is bound to loopback, so it is not behind Access.

## Seed and backup (optional)

A new volume starts empty. `VACUUM INTO` is consistent while the app is running; a plain copy of a live WAL database is not.

```bash
docker compose exec app bun -e 'const {Database}=require("bun:sqlite"); new Database(process.env.SQLITE_PATH).exec("VACUUM INTO \'/app/data/backup.sqlite\'")'
```

Copy `backup.sqlite` onto the new volume as `shim.sqlite`. Or leave the file empty and `POST /refresh` for the fids you care about. That path is capped per fid and will not reproduce the full historical corpus.

## Reboot

`restart: unless-stopped` brings the stack back after a reboot. `docker compose stop` stays stopped across reboot until `docker compose start`. `docker compose down` deletes the containers; volumes survive, but nothing starts again until `docker compose up -d`.

## Version

`package.json` `version` is the release. Tag that commit `vX.Y.Z`. `GET /info` reports the version, the `SHIM_GIT_SHA` baked in at image build (`unknown` when unset), the process start time, resident memory, the sqlite file size, and cast counts (stored, live, and distinct fids). `sqliteBytes` is null for an in-memory store.
