// logging
export const VERBOSE_LOGGING = true;

// protocol
export const FARCASTER_EPOCH = 1609459200;

// casts and replies endpoint
export const CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE = 500;

// database
export const UPSERT_CHUNK_SIZE = 500;

// hub
export const CASTS_DEFAULT_PAGE_SIZE = 100;
export const FEED_DEFAULT_PAGE_SIZE = 25;
export const URI_SEARCH_LOOKBACK = 5000;
export const REACTIONS_DEFAULT_PAGE_SIZE = 250;

// refresh endpoint
export const MAX_FOLLOWERS = 100;
// /refresh body fids array is clamped to this by t.Array maxItems — an
// unauthenticated caller must not drive unbounded hub/gRPC work
export const MAX_REFRESH_FIDS = 100;
// Fids walked concurrently by processFids. Each fid's walk parses up to
// MAX_SYNC_MESSAGES messages in 500-message pages on the single JS
// thread, so this constant is the wave's amplitude. History: 20-wide
// saturated the parse thread and — back when lmdis sat at its 512m cap —
// starved the cache into its deadline, and the fail-open traffic re-
// saturated the core. That amplification loop is gone (lmdis has headroom,
// cache legs hold, error rate zero), so width only costs walk-time latency
// now, never failures. 12: 3x faster than the incident-era 4, with probe
// headroom kept short of 20 (the only width ever observed pushing /health
// probes past their timeout). Overridable per box — the fleet's boxes
// differ — via REFRESH_PARALLEL_BATCHES in .env.
const parsedBatchWidth = Number(process.env.REFRESH_PARALLEL_BATCHES);
export const REFRESH_PARALLEL_BATCHES =
	Number.isInteger(parsedBatchWidth) && parsedBatchWidth >= 1
		? parsedBatchWidth
		: 12;

// getCastsByFid walks pages of CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE until the
// caller's cap or the hub runs dry. /refresh passes this so a cold fid is not
// sealed after a single page. Every caller is clamped to it.
export const MAX_SYNC_MESSAGES = 2000;

// hub rpc
export const HUB_RPC_DEADLINE_MS = 10_000;

// fan-out batching: async fetch bursts (feed hydration, mention hydration,
// stats usernames) go through mapBatch in chunks of this size instead of
// one unbounded Promise.all
export const HTTP_FAN_OUT_BATCH_SIZE = 20;

// /reverse-chron: same fid-array discipline as /refresh, plus a hard page
// ceiling so one POST cannot drive unbounded dual-world lookups
export const MAX_REVERSE_CHRON_LIMIT = 100;

// process-local remembered-user map — same entry budget as HotCache
export const REMEMBERED_USER_MAX_ENTRIES = 512;

// Hypersnap (Quilibrium's Snapchain fork) serves a Warpcast-client-shaped
// HTTP API on the node. Its /v2/farcaster/cast?type=hash endpoint is the
// only open network source of hash-only cast resolution — canonical
// Snapchain is keyed fid + hash everywhere, because the protocol's message
// key is (fid, hash). /h falls back to it on a local-index miss.
export const HYPERSNAP_API_ENDPOINT =
	process.env.HYPERSNAP_API_ENDPOINT || "https://haatz.quilibrium.com";
export const HYPERSNAP_TIMEOUT_MS = 10_000;

// The same haatz node also serves the snapchain /v1 HTTP JSON gateway (the
// crackle.farcaster.xyz:3381 surface) proxied on 443. The gRPC and raw
// gateway ports (2283, 3381-3383) sit behind a proxy front that only
// forwards web ports, so corpus sync travels over HTTPS /v1 — castsByFid
// (adds AND removes), castsByParent, startTimestamp all match the gRPC
// semantics (live-verified 2026-11-12).
export const HAATZ_GATEWAY_ENDPOINT =
	process.env.HAATZ_GATEWAY_ENDPOINT || "https://haatz.quilibrium.com";
export const HAATZ_GATEWAY_TIMEOUT_MS = 10_000;
