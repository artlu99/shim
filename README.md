# shim

The Shim API is a thin Farcaster read layer. It runs on [Bun](https://bun.sh/) and [Elysia](https://elysiajs.com/), stores casts in SQLite, and caches its own network calls through a sibling Redis (`redis:7.2-alpine`) over Bun's native RESP client. Production is Docker Compose on a Debian VPS.

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

Open [http://localhost:3000](http://localhost:3000). The local store is `data/shim.sqlite`. A local `.env` needs `HUB_GRPC_ENDPOINT` and `REDIS_URL` (e.g. `redis://127.0.0.1:6379` for bare-metal `bun dev`). On a box, `install.sh` writes those; Compose overrides `REDIS_URL` to `redis://redis:6379` for the app container. `HYPERSNAP_API_ENDPOINT` is optional — it defaults to Quilibrium's public node and backs `/h`'s hash-only network resolution on a local-index miss. `HAATZ_GATEWAY_ENDPOINT` is optional too and defaults to the same node; it backs the `/v1` gateway that corpus sync and user hydration use.

Upgrading from v1 (lmdis): drop `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `LMDIS_REST_TOKEN` from `.env`, set `REDIS_URL` if you run outside Compose, then `docker compose up -d --build`. The old `lmdis` / `lmdisdata` resources can be removed after the new stack is healthy (`docker compose rm -sf lmdis`; `docker volume rm` the project’s `lmdisdata` if you no longer need it).

The last Render/Neon tree was the `cloud-final` tag.

## The Snapchain vs Hypersnap fork

Snapchain and Hypersnap are forked (2026-11-12): a message on one is not guaranteed to appear on the other. shim treats a hash or a user on either world as valid. Hypersnap is primary everywhere — cast resolution, corpus sync (`/refresh`, feeds), and user hydration go to Hypersnap's `/v1` gateway first, and Snapchain gRPC (via `HUB_GRPC_ENDPOINT`) is consulted only on a clean Hypersnap miss or a Hypersnap outage. A miss on both worlds answers "not found"; a world that fails without answering is an outage (503), never a false miss.

Following-graph expansion went fork-aware with the other Hypersnap-primary paths: `POST /refresh` with a `username` walks followees via Hypersnap `/v1/linksByFid` first, Snapchain on a clean miss (skipped for native fids). A total outage is not treated as "follows nobody" — the named fid still refreshes, and the response message says so.

Name→fid resolution went fork-aware (2026-11-16): `/f/:username` and the internal username walks resolve through Snapchain proofs first — canonical for the legacy space — and consult Hypersnap's proof registry only on a Snapchain miss. Hypersnap answers are **provisional** and marked as such (`provisional: true`, `origin` field): names are not uniquely owned in Hypersnap world — multiple fids can carry the same name, and what decides is the fid and its social standing, not the registry (think multiple "Muhammed Ali"s). The Hypersnap answer therefore also carries the fork profile's `followerCount` and `profileUsername` so callers can judge contested names. Both registries missing cleanly answers `fid: null`; a registry failing without answering is an outage (503), never a false miss.

Native fids and the 2^32 boundary (2026-11-16): the hard fork allocates "native" fids above the legacy uint32 ceiling (2^32 = 4294967296) so they can never collide with pre-fork fids. A native fid therefore cannot exist on Snapchain or in the Warpcast backend — by construction, not policy — so the Snapchain legs (user fallback, cast lookup, corpus sync, and verifications fallback) are skipped entirely for one — Hypersnap still answers their verifications, and a Hypersnap outage during a native-fid sync stays a 503 instead of wearing Snapchain's empty answer as a miss. Route params are parsed as canonical decimal strings (`parseFid`) rather than `Number()`-coerced, so fids past `Number.MAX_SAFE_INTEGER` (2^53) answer 400 instead of silently rounding to a neighboring fid; JS numbers stay exact well past the native range, so no BigInt is involved. Both haatz gateways serialize native fids as decimal JSON strings (legacy fids as numbers — measured), so every gateway fid goes through `parseGatewayFid`, which accepts both forms; the `typeof number` checks it replaced silently dropped every native cast from the hash-only index and corpus sync.

## Install

`install.sh` runs as the deploy user. It does not use sudo or install packages. Git, Docker Engine, and the Compose plugin must already be installed. The script checks those, then runs `docker info` and looks for rootless mode. Joining the `docker` group is root-equivalent. Rootless setup is documented at <https://docs.docker.com/engine/security/rootless/>. A rootful daemon does not fail the script. It prints a warning, points at rootless setup instructions, and continues. It clones this repo to `$HOME/shim`. The app binds `127.0.0.1:7300`. When `$HOME/shim/.env` is missing it writes one with `REDIS_URL`, `SHIM_PORT`, `COMPOSE_PROJECT_NAME`, and `HUB_GRPC_ENDPOINT`, mode `600`. A re-run leaves an existing `.env` in place. It does not start Compose or install cloudflared.

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

Use the port from `.env` in that curl when it is not 7300. `upgrade.sh` fast-forwards this checkout to `origin/main` when the tree is clean, then rebuilds. A dirty tree exits and leaves the stack alone. When the running app's `SHIM_GIT_SHA` already equals `git rev-parse --short HEAD`, it skips the image build and runs `docker compose up -d`, which applies a changed `.env` or compose file and leaves the containers alone when nothing drifted. Otherwise it bakes that SHA in and runs `docker compose up -d --build`. `docker compose down` is not part of an upgrade. Volumes stay.

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

`package.json` `version` is the release. Tag that commit `vX.Y.Z`. `GET /info` reports the version, the `SHIM_GIT_SHA` baked in at image build (`unknown` when unset), the process start time, resident memory, the sqlite file size, and cast counts (stored, live, and distinct fids — the first two are the rowid high-water mark, exact under the append-only write discipline; `fids` is a distinct-fid sample of the latest 50k casts). `sqliteBytes` is null for an in-memory store.
