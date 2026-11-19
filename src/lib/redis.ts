import invariant from "tiny-invariant";
import { HotCache } from "./hot-cache";
import { LmdisClient as Redis, type SetCommandOptions } from "./lmdis";

export enum Ttl {
	SHORT = 60, // 60 seconds
	FEED = 120, // 2 Minutes
	MEDIUM = 4 * 60 * 60, // 4 hours
	LONG = 7 * 24 * 60 * 60, // 7 days
}

// In-process micro-LRU in front of lmdis. Every cache GET used to pay an
// HTTP hop plus a JSON parse on the answer; hot reads now resolve in RAM.
// HOT_TTL_MS is the CAP on any entry's stamp — the wrapper caps every
// stamp at the underlying lmdis entry's remaining lifetime (see
// withHotCache), so no entry ever serves past its upstream validity.
export const HOT_TTL_MS = 30_000;
export const HOT_MAX_ENTRIES = 512;
// Values above this stay lmdis-cached but skip the LRU: channelFeed:*
// entries run to tens of KB, and an LRU full of them would be its own
// memory burst on a box that is already fighting one.
export const HOT_MAX_WIRE_BYTES = 32_768;

// Per-request deadline for the lmdis HTTP hop (LMDB is local-disk fast;
// this only exists so a stalled lmdis cannot pin callers — see the
// vendored client's timeoutMs note).
const LMDIS_TIMEOUT_MS = 5_000;

let redisInstance: CacheClient | null = null;

// Capture the pristine fetch at module load and inject it into the client.
// In production this is the global fetch, unchanged; in tests it makes the
// cache leg immune to files that stub globalThis.fetch for their own
// network clients — bun test runs files concurrently in one process, and
// a stubbed global would otherwise hijack lmdis HTTP calls.
const fetchImpl = globalThis.fetch.bind(globalThis);

// Mirror lmdis read semantics on values arriving through set(): callers
// pre-stringify, lmdis serializes strings as-is and parses them back on
// GET (falling back to the raw string when the value was never JSON).
// Storing the same deserialization keeps LRU hits byte-identical to what
// the lmdis path would have returned.
const toCachedValue = (value: unknown): unknown => {
	if (typeof value === "string") {
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	}
	return value;
};

const wireSize = (value: unknown): number => {
	if (typeof value === "string") {
		return value.length;
	}
	try {
		return JSON.stringify(value)?.length ?? Number.MAX_SAFE_INTEGER;
	} catch {
		return Number.MAX_SAFE_INTEGER;
	}
};

const withHotCache = (client: Redis) => {
	const hot = new HotCache(HOT_MAX_ENTRIES, HOT_TTL_MS, HOT_MAX_WIRE_BYTES);

	// Upstream write metadata for keys this process wrote. This is what
	// keeps the LRU honest on get()-backfills: an entry learned from lmdis
	// mid-life must not outlive the lmdis entry that backs it, so a
	// backfill is stamped at min(HOT_TTL_MS, remaining) — and a key whose
	// upstream TTL we don't know (written by a previous process, or
	// KEEPTTL) is never cached at all. Bounded: pruned opportunistically,
	// cleared wholesale past the cap (losing records only disables
	// backfill until the next set of that key).
	const wrote = new Map<string, { expiresAtMs: number; wireBytes: number }>();
	const WROTE_CAP = 8192;

	const recordWrite = (
		key: string,
		opts: SetCommandOptions | undefined,
		wireBytes: number,
	): { expiresAtMs: number; wireBytes: number } | undefined => {
		const now = Date.now();
		if (wrote.size > WROTE_CAP) {
			for (const [k, record] of wrote) {
				if (record.expiresAtMs <= now) {
					wrote.delete(k);
				}
			}
			if (wrote.size > WROTE_CAP) {
				wrote.clear();
			}
		}
		let expiresAtMs: number;
		if (opts?.ex !== undefined) {
			expiresAtMs = now + opts.ex * 1000;
		} else if (opts?.px !== undefined) {
			expiresAtMs = now + opts.px;
		} else if (opts?.exat !== undefined) {
			expiresAtMs = opts.exat * 1000;
		} else if (opts?.pxat !== undefined) {
			expiresAtMs = opts.pxat;
		} else if (opts?.keepTtl) {
			// the replaced value keeps the old TTL — remaining unknown
			wrote.delete(key);
			return undefined;
		} else {
			// plain SET clears any expiry: never expires upstream
			expiresAtMs = Number.POSITIVE_INFINITY;
		}
		const record = { expiresAtMs, wireBytes };
		wrote.set(key, record);
		return record;
	};

	return {
		async get<T>(key: string): Promise<T | null> {
			const hit = hot.get(key);
			if (hit !== undefined) {
				return hit.value as T;
			}
			const result = await client.get<T>(key);
			const record = wrote.get(key);
			if (result !== null && record !== undefined) {
				const remainingMs = record.expiresAtMs - Date.now();
				if (remainingMs > 0) {
					// no stringify here: the write already measured the bytes
					hot.set(
						key,
						result,
						record.wireBytes,
						Math.min(HOT_TTL_MS, remainingMs),
					);
				} else {
					wrote.delete(key);
				}
			}
			return result;
		},
		async set<T>(
			key: string,
			value: T,
			opts?: SetCommandOptions,
		): Promise<"OK" | null> {
			const result = await client.set(key, value, opts);
			// Only a write lmdis actually accepted may warm the LRU or record
			// upstream TTL knowledge. The warm is stamped at the upstream
			// entry's remaining lifetime, capped at HOT_TTL_MS — the same
			// discipline as a backfill, so even a sub-30s TTL can never be
			// served past its lmdis expiry. KEEPTTL (unknown remaining)
			// warms nothing.
			if (result === "OK") {
				const bytes = wireSize(value);
				const record = recordWrite(key, opts, bytes);
				if (record !== undefined) {
					const remainingMs = record.expiresAtMs - Date.now();
					hot.set(
						key,
						toCachedValue(value),
						bytes,
						Math.min(HOT_TTL_MS, Math.max(0, remainingMs)),
					);
				}
			}
			return result;
		},
		async del(...keys: string[]): Promise<number> {
			const removed = await client.del(...keys);
			// flush-users runs as a separate process, so it cannot reach this
			// LRU — an in-process invalidation covers the same-process case;
			// a cross-process flush leaves a HOT_TTL_MS tail of stale entries,
			// same class of caveat the flush script already documents.
			for (const key of keys) {
				hot.invalidate(key);
				wrote.delete(key);
			}
			return removed;
		},
		// Drop every LRU entry and write record — tests reset between cases;
		// an operator who flushed lmdis from another process can do the same
		// in-process.
		clear: () => {
			hot.clear();
			wrote.clear();
		},
		// Hash/set/counter/enumeration ops have no get() read path to serve
		// from the LRU — pass through untouched.
		hincrby: (key: string, field: string, increment: number) =>
			client.hincrby(key, field, increment),
		sadd: (key: string, ...members: (string | number)[]) =>
			client.sadd(key, ...members),
		smembers: (key: string) => client.smembers(key),
		srem: (key: string, ...members: (string | number)[]) =>
			client.srem(key, ...members),
		keys: (pattern?: string) => client.keys(pattern),
		scanKeys: (cursor: string, count: number, pattern?: string) =>
			client.scanKeys(cursor, count, pattern),
	};
};

export type CacheClient = ReturnType<typeof withHotCache>;

const redis = () => {
	if (!redisInstance) {
		invariant(
			process.env.UPSTASH_REDIS_REST_URL,
			"UPSTASH_REDIS_REST_URL is not set",
		);
		invariant(
			process.env.UPSTASH_REDIS_REST_TOKEN,
			"UPSTASH_REDIS_REST_TOKEN is not set",
		);
		redisInstance = withHotCache(
			new Redis({
				url: process.env.UPSTASH_REDIS_REST_URL ?? "",
				token: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
				fetch: fetchImpl,
				timeoutMs: LMDIS_TIMEOUT_MS,
			}),
		);
	}
	return redisInstance;
};

export default redis;
