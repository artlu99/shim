# shim-SH VPS checklist (Contabo US Central St. Louis target)

## Before ordering
- [ ] Confirm checkout price (Cloud VPS 4: 4 vCPU/8GB/100GB, ~$7.90/mo list; promo renews at list after 24mo)
- [ ] Note: Hetzner US rejected — post-2026-06 prices, CPX22 ~$23 (see PLAN.md DECISION LOG)

## After first boot (spec + health validation, record output)
- [ ] `nproc && free -h && df -h /` — expect ~2 cores / 3.8Gi / ~40GB
- [ ] `vmstat 1 5` — steal column (`st`) must stay <5% sustained
- [ ] `apt install -y sysstat && iostat -x 1 5` — fsync/await sanity for LMDB+PG

## Setup
- [ ] `bash ops/swap-setup.sh` (swap + docker + sibling checkouts)
- [ ] `ss -tulpn` — confirm 7300/3000/5432 host-side conflicts (5432/3000 should NOT be published anyway)
- [ ] Stage `/opt/shim/.env` from `.env.sh.example` — generate secrets in an editor, NOT the shell:
  - `openssl rand -hex 32` for LMDIS_REST_TOKEN (UPSTASH_REDIS_REST_TOKEN must equal it)
  - `openssl rand -hex 16` for PG_PASSWORD
  - TUNNEL_TOKEN from Cloudflare Zero Trust dashboard (create tunnel first)
  - HUB_GRPC_ENDPOINT: read current value from upstream shim `.env.example`
- [ ] `chmod 600 .env`

## Cloudflare
- [ ] Zero Trust -> Networks -> Tunnels -> Create tunnel (cloudflared) -> copy token
- [ ] Public hostname: service `http://app:3000` — wait, tunnel runs as a compose service
  on the same network, so the tunnel's service URL is `http://app:3000` (compose DNS)
- [ ] Optional: CF Access policy on `/refresh*` path

## Deploy + verify
- [ ] `cd /opt/shim && docker compose up -d --build`
- [ ] `docker compose ps` — all 4 healthy
- [ ] `curl localhost:7300/health` -> OK
- [ ] Bootstrap data: trigger refresh for seed fids (livenessFids 528,617,2210,4407,6596,8800)
  via POST /refresh (see upstream route), then `curl localhost:7300/stats` shows rows
- [ ] Confirm first refresh-fids cron cycle at :08 (docker compose logs app)
- [ ] `docker compose exec lmdis wget -qO- localhost:3000/metrics --header="Authorization: Bearer $LMDIS_REST_TOKEN" | grep lmdis_lmdb_disk_bytes`
- [ ] Flip DNS/hostname from Render to the tunnel ONLY after 48h clean soak
- [ ] Keep Render service warm (not deleted) until soak passes — it is the rollback
