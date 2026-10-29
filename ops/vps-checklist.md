# shim-SH VPS checklist (Contabo US Central St. Louis, box live since 2026-10)

Stack: 3 compose services (app / postgres:17-alpine / lmdis) + the box's EXISTING
cloudflared (remotely-managed) as ingress. No compose tunnel service, no
TUNNEL_TOKEN — ingress is a dashboard public hostname -> http://localhost:7300.

## Host validation (record output)
- [x] Port scan 2026-10-27: 7300 NOT in use; 5432/6380/3001 taken on host but
      irrelevant (postgres/lmdis publish NO ports; app's internal 3000 is
      compose-namespaced). Re-verify at deploy time anyway:
- [ ] `sudo ss -tulpn | grep ':7300'` — must be EMPTY
- [ ] `nproc && free -h && df -h /` — expect ~2 cores / 3.8Gi / 195G free
- [ ] `vmstat 1 5` — steal (`st`) <5% sustained
- [ ] `apt install -y sysstat && iostat -x 1 5` — disk sanity for LMDB + PG

## Setup
- [ ] `sudo bash ops/swap-setup.sh` (2G swapfile + docker + docker group for the
      invoking user + chown of /opt/shim and /opt/lmdis + sibling checkouts
      /opt/shim@sh and /opt/lmdis) — then RE-LOGIN (docker group needs a new session)
- [ ] If the box was set up with the OLD script version: do the docker group +
      chown manually — `sudo usermod -aG docker "$USER"` (re-login) and
      `sudo chown -R "$USER":"$USER" /opt/shim /opt/lmdis`
- [ ] `git status -sb` on /opt/shim must read `## sh...origin/sh` and `git pull` must NOT hit EACCES
- [ ] No `bun install` on the host — deps install inside the image build
- [ ] Stage `/opt/shim/.env` from `.env.sh.example` (editor, NOT shell history):
  - PG_PASSWORD (openssl rand -hex 16) — DATABASE_URL password MUST equal it
    (postgres user is created with it at FIRST boot; later changes need ALTER USER)
  - LMDIS_REST_TOKEN (openssl rand -hex 32) — UPSTASH_REDIS_REST_TOKEN MUST equal it
  - DATABASE_URL_PRO_NFT — remote ponder secret (route stays)
  - HUB_GRPC_ENDPOINT — current bare host:port from upstream .env.example
  - NO TUNNEL_TOKEN (existing host tunnel), NO DEV (inverted flag disables gRPC),
    NO MY_VARIABLE (dead placeholder)
- [ ] `chmod 600 .env`
- [ ] `docker compose config --quiet && echo "env OK"`

## Cloudflare (existing remotely-managed tunnel)
- [ ] Zero Trust -> Networks -> Tunnels -> the EXISTING tunnel -> Public
      Hostname -> Add: hostname `shim.<yourdomain>` -> service `http://localhost:7300`
      (7300 = host side of the app's loopback binding; load-bearing)
- [ ] Optional: CF Access self-hosted app scoped to path `/refresh*`

## Deploy + verify
- [ ] `docker compose config --quiet && docker compose up -d --build`
- [ ] `docker compose ps` — 3 services healthy (app/postgres/lmdis)
- [ ] `curl localhost:7300/health` -> OK; then `curl https://shim.<yourdomain>/health`
- [ ] Bootstrap data: POST /refresh for seed fids (528,617,2210,4407,6596,8800)
      — see upstream refresh route; then `curl localhost:7300/stats` shows rows
- [ ] First refresh-fids cron cycle at :08 (`docker compose logs app`)
- [ ] lmdis sweep + disk gauge live:
      `docker compose exec lmdis curl -s -H "Authorization: Bearer $LMDIS_REST_TOKEN" localhost:3000/metrics | grep -E 'lmdis_lmdb_disk_bytes|lmdis_sweep_errors'`
- [ ] Soak 48h: no OOM/restart loops (`docker compose ps`, `free -h`, `docker stats`)

## Cutover (zero-flip)
- [ ] `shim.<yourdomain>` is a NEW hostname — Render keeps serving its own URL
      untouched; there is NO DNS flip. Decommission Render only when satisfied.
- [ ] If the cached User shape ever changes in a future upstream sync:
      deploy first, then `docker compose exec app bun run user:flush`
