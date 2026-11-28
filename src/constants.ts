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
// unauthenticated caller must not drive unbounded gateway work
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

// Haatz castsByFid walks pages of CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE until
// the caller's cap or the gateway runs dry. /refresh passes this so a cold
// fid is not sealed after a single page. Every caller is clamped to it.
// History: 10000 from birth, cut to 2000 by the harden sweep (8e1030d) that
// bounded fan-outs. The loop that motivated the cut — parse-thread
// saturation starving the in-process lmdis cache into its deadline, whose
// fail-open traffic re-saturated the core — died with lmdis: the Redis
// cache is out-of-process and maxmemory-bounded, so a wide walk now costs
// walk-time latency, never failures. Back to 10000 because the walk is
// newest-first and the upsert seals the watermark at the newest cast: a
// warm fid whose delta exceeds the cap permanently loses its oldest casts,
// and a cold one never stores more than the cap — at 2000 the corpus's
// largest accounts sat just above 2000 rows. Measured 2026-11-24 at the
// 2000 cap: a 55-fid cold wave walked 46k casts in 37s, RSS peaked +80MB
// over rest and settled back, /health stayed 200 with p100 522ms against a
// 5s probe budget. Overridable per box — the fleet's boxes differ — via
// MAX_SYNC_MESSAGES in .env.
const parsedSyncCap = Number(process.env.MAX_SYNC_MESSAGES);
export const MAX_SYNC_MESSAGES =
	Number.isInteger(parsedSyncCap) && parsedSyncCap >= 500
		? parsedSyncCap
		: 10000;

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
// crackle.farcaster.xyz:3381 surface) proxied on 443. Corpus sync travels
// over HTTPS /v1 — castsByFid (adds AND removes), castsByParent,
// startTimestamp (live-verified 2026-11-12).
export const HAATZ_GATEWAY_ENDPOINT =
	process.env.HAATZ_GATEWAY_ENDPOINT || "https://haatz.quilibrium.com";
export const HAATZ_GATEWAY_TIMEOUT_MS = 10_000;
