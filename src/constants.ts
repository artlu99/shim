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
export const REFRESH_PARALLEL_BATCHES = 20;

// getCastsByFid walks pages of CASTS_AND_REPLIES_DEFAULT_PAGE_SIZE until the
// caller's cap or the hub runs dry. /refresh passes this so a cold fid is not
// sealed after a single page. Every caller is clamped to it.
export const MAX_SYNC_MESSAGES = 10000;

// hub rpc
export const HUB_RPC_DEADLINE_MS = 10_000;

// fan-out batching: async fetch bursts (feed hydration, mention hydration,
// stats usernames) go through mapBatch in chunks of this size instead of
// one unbounded Promise.all
export const HTTP_FAN_OUT_BATCH_SIZE = 20;

// Hypersnap (Quilibrium's Snapchain fork) serves a Warpcast-client-shaped
// HTTP API on the node. Its /v2/farcaster/cast?type=hash endpoint is the
// only open network source of hash-only cast resolution — canonical
// Snapchain is keyed fid + hash everywhere, because the protocol's message
// key is (fid, hash). /h falls back to it on a local-index miss.
export const HYPERSNAP_API_ENDPOINT =
	process.env.HYPERSNAP_API_ENDPOINT || "https://haatz.quilibrium.com";
export const HYPERSNAP_TIMEOUT_MS = 10_000;
