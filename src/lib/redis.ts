import { RedisClient } from "bun";
import invariant from "tiny-invariant";
import { HotCache } from "./hot-cache";

export enum Ttl {
	SHORT = 60, // 60 seconds
	FEED = 120, // 2 Minutes
	MEDIUM = 4 * 60 * 60, // 4 hours
	LONG = 7 * 24 * 60 * 60, // 7 days
}

export type SetCommandOptions = {
	ex?: number;
	px?: number;
	exat?: number;
	pxat?: number;
	keepTtl?: boolean;
	get?: boolean;
	nx?: boolean;
	xx?: boolean;
};

export class RedisError extends Error {
	constructor(message: string) {
		super(message.startsWith("redis:") ? message : `redis: ${message}`);
		this.name = "RedisError";
	}
}

// In-process micro-LRU in front of Redis. Hot reads skip the TCP hop and
// the JSON parse; the biggest read paths (/reverse-chron feed hydration,
// /h lookups) re-read the same keys hundreds of times during a burst.
// HOT_TTL_MS is the CAP on any entry's stamp — the wrapper caps every
// stamp at the underlying Redis entry's remaining lifetime (see
// withHotCache), so no entry ever serves past its upstream validity.
export const HOT_TTL_MS = 30_000;
export const HOT_MAX_ENTRIES = 512;
// Values above this stay Redis-cached but skip the LRU: channelFeed:*
// entries run to tens of KB, and an LRU full of them would be its own
// memory burst on a box that is already fighting one.
export const HOT_MAX_WIRE_BYTES = 32_768;

const REDIS_CONNECTION_TIMEOUT_MS = 5_000;

export type RedisBackend = {
	get<T>(key: string): Promise<T | null>;
	set<T>(key: string, value: T, opts?: SetCommandOptions): Promise<"OK" | null>;
	del(...keys: string[]): Promise<number>;
	hincrby(key: string, field: string, increment: number): Promise<number>;
	sadd(key: string, ...members: (string | number)[]): Promise<number>;
	smembers(key: string): Promise<string[]>;
	srem(key: string, ...members: (string | number)[]): Promise<number>;
	keys(pattern?: string): Promise<string[]>;
	scanKeys(
		cursor: string,
		count: number,
		pattern?: string,
	): Promise<[string, string[]]>;
	close?: () => void;
};

// Callers often pre-stringify; Redis stores strings as-is. Objects /
// numbers / bools are JSON-encoded so GET can round-trip the same shapes
// the old lmdis HTTP client returned.
const serialize = (value: unknown): string => {
	if (typeof value === "string") {
		return value;
	}
	return JSON.stringify(value);
};

const deserialize = <T>(value: string | null): T | null => {
	if (value === null) {
		return null;
	}
	try {
		return JSON.parse(value) as T;
	} catch {
		return value as T;
	}
};

const unsupportedSetOptions = (opts?: SetCommandOptions): string | null => {
	if (!opts) return null;
	if (opts.get) return "get";
	if (opts.nx) return "nx";
	if (opts.xx) return "xx";
	return null;
};

const wrapRedisError = (error: unknown): never => {
	if (error instanceof RedisError) {
		throw error;
	}
	const message =
		error instanceof Error ? error.message : JSON.stringify(error);
	throw new RedisError(message);
};

export class BunRedisBackend implements RedisBackend {
	private readonly client: RedisClient;

	constructor(url: string) {
		this.client = new RedisClient(url, {
			connectionTimeout: REDIS_CONNECTION_TIMEOUT_MS,
		});
	}

	async get<T>(key: string): Promise<T | null> {
		try {
			const result = await this.client.get(key);
			return deserialize<T>(result);
		} catch (error) {
			return wrapRedisError(error);
		}
	}

	async set<T>(
		key: string,
		value: T,
		opts?: SetCommandOptions,
	): Promise<"OK" | null> {
		const unsupported = unsupportedSetOptions(opts);
		if (unsupported) {
			throw new RedisError(`SET option "${unsupported}" is not supported`);
		}
		const serialized = serialize(value);
		try {
			if (opts?.ex !== undefined) {
				return await this.client.set(key, serialized, "EX", opts.ex);
			}
			if (opts?.px !== undefined) {
				return await this.client.set(key, serialized, "PX", opts.px);
			}
			if (opts?.exat !== undefined) {
				return await this.client.set(key, serialized, "EXAT", opts.exat);
			}
			if (opts?.pxat !== undefined) {
				return await this.client.set(key, serialized, "PXAT", opts.pxat);
			}
			if (opts?.keepTtl) {
				return await this.client.set(key, serialized, "KEEPTTL");
			}
			return await this.client.set(key, serialized);
		} catch (error) {
			return wrapRedisError(error);
		}
	}

	async del(...keys: string[]): Promise<number> {
		if (keys.length === 0) {
			return 0;
		}
		try {
			return await this.client.del(...keys);
		} catch (error) {
			return wrapRedisError(error);
		}
	}

	async hincrby(
		key: string,
		field: string,
		increment: number,
	): Promise<number> {
		try {
			return await this.client.hincrby(key, field, increment);
		} catch (error) {
			return wrapRedisError(error);
		}
	}

	async sadd(key: string, ...members: (string | number)[]): Promise<number> {
		try {
			return await this.client.sadd(key, ...members.map(String));
		} catch (error) {
			return wrapRedisError(error);
		}
	}

	async smembers(key: string): Promise<string[]> {
		try {
			return await this.client.smembers(key);
		} catch (error) {
			return wrapRedisError(error);
		}
	}

	async srem(key: string, ...members: (string | number)[]): Promise<number> {
		try {
			return await this.client.srem(key, ...members.map(String));
		} catch (error) {
			return wrapRedisError(error);
		}
	}

	async keys(pattern = "*"): Promise<string[]> {
		try {
			return await this.client.keys(pattern);
		} catch (error) {
			return wrapRedisError(error);
		}
	}

	async scanKeys(
		cursor: string,
		count: number,
		pattern?: string,
	): Promise<[string, string[]]> {
		try {
			const args = [cursor, "COUNT", String(count)];
			if (pattern !== undefined) {
				args.splice(1, 0, "MATCH", pattern);
			}
			const result = await this.client.send("SCAN", args);
			if (
				!Array.isArray(result) ||
				result.length !== 2 ||
				typeof result[0] !== "string" ||
				!Array.isArray(result[1])
			) {
				throw new RedisError("SCAN returned an unexpected shape");
			}
			return [result[0], result[1].map(String)];
		} catch (error) {
			return wrapRedisError(error);
		}
	}

	close(): void {
		this.client.close();
	}
}

// Mirror Redis read semantics on values arriving through set(): callers
// pre-stringify, Redis stores strings as-is, and we parse them back on
// GET (falling back to the raw string when the value was never JSON).
// Storing the same deserialization keeps LRU hits byte-identical to what
// the Redis path would have returned.
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

const withHotCache = (client: RedisBackend) => {
	const hot = new HotCache(HOT_MAX_ENTRIES, HOT_TTL_MS, HOT_MAX_WIRE_BYTES);

	// Upstream write metadata for keys this process wrote. This is what
	// keeps the LRU honest on get()-backfills: an entry learned from Redis
	// mid-life must not outlive the Redis entry that backs it, so a
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
			// Only a write Redis actually accepted may warm the LRU or record
			// upstream TTL knowledge. The warm is stamped at the upstream
			// entry's remaining lifetime, capped at HOT_TTL_MS — the same
			// discipline as a backfill, so even a sub-30s TTL can never be
			// served past its Redis expiry. KEEPTTL (unknown remaining)
			// warms nothing.
			if (result === "OK") {
				const bytes = wireSize(value);
				const record = recordWrite(key, opts, bytes);
				// Parse only what the LRU can actually hold: hot.set refuses
				// oversize entries (channelFeed:*, paginated hub: lists can
				// be hundreds of KB), so parsing those first spent a full
				// JSON.parse on every big cache write for an entry that
				// would never be served.
				if (record !== undefined && bytes <= HOT_MAX_WIRE_BYTES) {
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
		// an operator who flushed Redis from another process can do the same
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

let redisInstance: CacheClient | null = null;
let testBackend: RedisBackend | null = null;

/**
 * Tests inject an in-process backend (and clear it in afterAll) so the
 * HotCache wrapper can run without a live Redis. Production never calls
 * this — the singleton is built from REDIS_URL on first redis().
 */
export const resetRedisForTests = (backend: RedisBackend | null = null) => {
	redisInstance = null;
	testBackend = backend;
};

const redis = () => {
	if (!redisInstance) {
		if (testBackend) {
			redisInstance = withHotCache(testBackend);
		} else {
			invariant(process.env.REDIS_URL, "REDIS_URL is not set");
			redisInstance = withHotCache(
				new BunRedisBackend(process.env.REDIS_URL ?? ""),
			);
		}
	}
	return redisInstance;
};

export default redis;
