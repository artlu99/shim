import {
	RedisError,
	type RedisBackend,
	type SetCommandOptions,
} from "../../lib/redis";

// In-process RedisBackend for tests — same get/set/del + TTL subset the
// HotCache wrapper exercises. Tests call installRedisMock() in beforeAll
// and uninstallRedisMock() in afterAll so other files keep the cache-less
// world they were written against (lib cache legs throw the REDIS_URL
// invariant and degrade to uncached).

type Entry = { value: string; expiresAt?: number };

const store = new Map<string, Entry>();
const opsByKey = new Map<string, number>();
let failNext = false;

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

const touch = (key: string) => {
	opsByKey.set(key, (opsByKey.get(key) ?? 0) + 1);
	if (failNext) {
		failNext = false;
		throw new RedisError("connection refused");
	}
};

const readEntry = (key: string): string | null => {
	const entry = store.get(key);
	if (!entry) {
		return null;
	}
	if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
		store.delete(key);
		return null;
	}
	return entry.value;
};

export const memoryRedis: RedisBackend = {
	async get<T>(key: string): Promise<T | null> {
		touch(key);
		return deserialize<T>(readEntry(key));
	},

	async set<T>(
		key: string,
		value: T,
		opts?: SetCommandOptions,
	): Promise<"OK" | null> {
		touch(key);
		const now = Date.now();
		let expiresAt: number | undefined;
		if (opts?.ex !== undefined) expiresAt = now + opts.ex * 1000;
		else if (opts?.px !== undefined) expiresAt = now + opts.px;
		else if (opts?.exat !== undefined) expiresAt = opts.exat * 1000;
		else if (opts?.pxat !== undefined) expiresAt = opts.pxat;
		else if (opts?.keepTtl) {
			expiresAt = store.get(key)?.expiresAt;
		}
		store.set(key, { value: serialize(value), expiresAt });
		return "OK";
	},

	async del(...keys: string[]): Promise<number> {
		let removed = 0;
		for (const key of keys) {
			touch(key);
			if (store.delete(key)) {
				removed++;
			}
		}
		return removed;
	},

	async hincrby(): Promise<number> {
		throw new RedisError("hincrby is not implemented in the test mock");
	},
	async sadd(): Promise<number> {
		throw new RedisError("sadd is not implemented in the test mock");
	},
	async smembers(): Promise<string[]> {
		throw new RedisError("smembers is not implemented in the test mock");
	},
	async srem(): Promise<number> {
		throw new RedisError("srem is not implemented in the test mock");
	},
	async keys(pattern = "*"): Promise<string[]> {
		const now = Date.now();
		const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
		const exact = !pattern.endsWith("*");
		const out: string[] = [];
		for (const [key, entry] of store) {
			if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
				store.delete(key);
				continue;
			}
			if (exact ? key === pattern : key.startsWith(prefix)) {
				out.push(key);
			}
		}
		return out;
	},
	async scanKeys(
		_cursor: string,
		_count: number,
		pattern?: string,
	): Promise<[string, string[]]> {
		return ["0", await memoryRedis.keys(pattern)];
	},
};

export const redisMock = {
	/** raw keyspace — assert on stored values and TTL entries */
	store,
	/** commands executed for keys under `prefix` (LRU hits perform zero) */
	opCount: (prefix: string) => {
		let total = 0;
		for (const [key, count] of opsByKey) {
			if (key.startsWith(prefix)) total += count;
		}
		return total;
	},
	reset: () => {
		store.clear();
		opsByKey.clear();
		failNext = false;
	},
	/** next command throws a redis: connection error — a cache outage */
	failNextRequest: () => {
		failNext = true;
	},
	/**
	 * Write without going through HotCache — simulates another process
	 * (or a prior shim instance) seeding Redis.
	 */
	rawSet: async (
		key: string,
		value: unknown,
		opts?: SetCommandOptions,
	): Promise<"OK" | null> => memoryRedis.set(key, value, opts),
};

export const installRedisMock = async () => {
	const { resetRedisForTests } = await import("../../lib/redis");
	resetRedisForTests(memoryRedis);
};

export const uninstallRedisMock = async () => {
	const { resetRedisForTests } = await import("../../lib/redis");
	resetRedisForTests(null);
	redisMock.reset();
};
