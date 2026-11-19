// A tiny in-process LRU with TTL, sitting in front of lmdis. Hot reads
// skip the HTTP hop and the JSON parse entirely — lmdis answers come back
// over the wire as strings that must be parsed on every GET, and the
// biggest read paths (/reverse-chron feed hydration, /h lookups) re-read
// the same keys hundreds of times during a single burst. The cache is
// bounded by entry count AND wire size: a channelFeed:* entry can be tens
// of KB of JSON, and an unbounded count-only LRU would be its own memory
// burst on a box that is already fighting one.
//
// TTL discipline: entries carry a PER-ENTRY ttl. The redis.ts wrapper
// stamps set()-warmed entries at write time and caps backfilled entries at
// the underlying lmdis entry's remaining lifetime (which it knows for
// every key this process wrote, and refuses to cache keys it doesn't) —
// so an entry can never serve past its upstream validity, no matter how
// late in its lmdis life it was learned. The class default (30s) is the
// cap for writes; do not raise it above the shortest lmdis TTL (Ttl.SHORT
// = 60s) without revisiting the wrapper.

export class HotCache {
	private entries = new Map<
		string,
		{ value: unknown; at: number; ttlMs: number }
	>();

	constructor(
		private readonly maxEntries = 512,
		private readonly ttlMs = 30_000,
		private readonly maxWireBytes = 32_768,
		private readonly now: () => number = () => Date.now(),
	) {}

	// A hit is returned wrapped so cached falsy values (`false`, "") stay
	// distinguishable from a miss (undefined). Recency is bumped by
	// re-insertion; the TTL clock is NOT refreshed on read — expiry is a
	// property of when the value was learned, not of how often it is read.
	get(key: string): { value: unknown } | undefined {
		const entry = this.entries.get(key);
		if (entry === undefined) {
			return undefined;
		}
		if (this.now() - entry.at >= entry.ttlMs) {
			this.entries.delete(key);
			return undefined;
		}
		// Map iteration order is insertion order — re-inserting marks recency.
		this.entries.delete(key);
		this.entries.set(key, entry);
		return { value: entry.value };
	}

	// wireBytes is the caller-side serialized size of the value; ttlMs
	// defaults to the class TTL and may be shortened per entry (the
	// wrapper caps backfills at the upstream entry's remaining lifetime).
	// Oversize values are refused: they stay lmdis-cached, they just don't
	// occupy LRU slots.
	set(
		key: string,
		value: unknown,
		wireBytes: number,
		ttlMs = this.ttlMs,
	): void {
		if (wireBytes > this.maxWireBytes) {
			return;
		}
		this.entries.delete(key);
		if (this.entries.size >= this.maxEntries) {
			this.evict();
		}
		this.entries.set(key, { value, at: this.now(), ttlMs });
	}

	invalidate(key: string): void {
		this.entries.delete(key);
	}

	// Drop every entry. The wrapper exposes this so tests (and an operator
	// who just flushed lmdis from another process) can reset the in-process
	// view instead of waiting out the TTL.
	clear(): void {
		this.entries.clear();
	}

	// First drop expired entries (they are free space), then — still full —
	// evict the least-recently-used entry (the Map head after the recency
	// bump in get()). Deleting during Map iteration is safe.
	private evict(): void {
		const now = this.now();
		for (const [key, entry] of this.entries) {
			if (now - entry.at >= entry.ttlMs) {
				this.entries.delete(key);
			}
			if (this.entries.size < this.maxEntries) {
				return;
			}
		}
		const oldest = this.entries.keys().next();
		if (!oldest.done) {
			this.entries.delete(oldest.value);
		}
	}
}
