import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
	clearUpstashEnv,
	installUpstashEnv,
	lmdisMock,
} from "./../helpers/lmdis-mock";
import {
	getHaatzProfileByFid,
	getHypersnapCastByFidAndHash,
	getHypersnapCastByHash,
} from "../../lib/hypersnap";
import redis from "../../lib/redis";

// trimmed from a live haatz.quilibrium.com answer (same fixture as
// hypersnap.test.ts)
const FIXTURE = {
	object: "cast",
	hash: "A7C5F47033DA848D6D16DAC11C61838634A50C23",
	parent_url: null,
	parent_author: { fid: null },
	author: { object: "user", fid: 3854, username: "darrylyeo" },
	text: "My thoughts on the merger",
	timestamp: "2026-10-18T00:50:15.000Z",
	embeds: [],
};

const HASH = "0xa7c5f47033da848d6d16dac11c61838634a50c23";

const originalFetch = globalThis.fetch;

const stubFetch = (impl: () => Promise<Response>) => {
	let calls = 0;
	globalThis.fetch = Object.assign(async () => {
		calls++;
		return impl();
	}) as unknown as typeof fetch;
	return () => calls;
};

beforeAll(() => {
	// before the first redis() call constructs the singleton (lazy, first
	// use inside a test)
	installUpstashEnv();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	lmdisMock.reset();
	// the in-process LRU is module state the mock reset cannot reach —
	// a leftover entry would answer later tests before any fetch runs
	redis().clear();
});

afterAll(() => {
	lmdisMock.stop();
	// other files share this process's env — leave them the cache-less
	// world they were written against
	clearUpstashEnv();
});

describe("getHypersnapCastByHash: cache", () => {
	test("a live answer is cached under hyp:cast: — the repeat read is an LRU hit with no fetch and no lmdis ops", async () => {
		const fetchCalls = stubFetch(async () =>
			Response.json({ cast: FIXTURE }, { status: 200 }),
		);

		const first = await getHypersnapCastByHash(HASH as `0x${string}`);
		expect(first?.fid).toBe(3854);
		expect(fetchCalls()).toBe(1);
		// first call: one GET miss + one SET under the fork-world namespace
		expect(lmdisMock.opCount(`hyp:cast:${HASH}`)).toBe(2);
		expect(lmdisMock.store.has(`hyp:cast:${HASH}`)).toBe(true);

		// repeat read: LRU hit — no network fetch, no lmdis command
		const opsBeforeRepeat = lmdisMock.opCount(`hyp:cast:${HASH}`);
		const second = await getHypersnapCastByHash(HASH as `0x${string}`);
		expect(second?.fid).toBe(3854);
		expect(fetchCalls()).toBe(1);
		expect(lmdisMock.opCount(`hyp:cast:${HASH}`)).toBe(opsBeforeRepeat);
	});

	test("a 404 is negatively cached — the repeat miss performs no fetch", async () => {
		const fetchCalls = stubFetch(async () =>
			Response.json({ error: "not found" }, { status: 404 }),
		);

		expect(await getHypersnapCastByHash(HASH as `0x${string}`)).toBeUndefined();
		expect(fetchCalls()).toBe(1);
		expect(await getHypersnapCastByHash(HASH as `0x${string}`)).toBeUndefined();
		expect(fetchCalls()).toBe(1);

		const stored = JSON.parse(
			lmdisMock.store.get(`hyp:cast:${HASH}`)?.value ?? "null",
		);
		expect(stored).toEqual({ hypersnap404: true });
	});

	test("an outage is never cached — the next caller retries the network", async () => {
		const fetchCalls = stubFetch(async () => {
			throw new Error("connect ECONNREFUSED");
		});
		expect(getHypersnapCastByHash(HASH as `0x${string}`)).rejects.toThrow();
		expect(fetchCalls()).toBe(1);
		expect(lmdisMock.store.has(`hyp:cast:${HASH}`)).toBe(false);

		// network recovers — a clean miss must not be worn
		stubFetch(async () =>
			Response.json({ cast: FIXTURE }, { status: 200 }),
		);
		const cast = await getHypersnapCastByHash(HASH as `0x${string}`);
		expect(cast?.fid).toBe(3854);
	});

	test("a malformed answer is never cached", async () => {
		stubFetch(async () => Response.json({ cast: {} }, { status: 200 }));
		expect(getHypersnapCastByHash(HASH as `0x${string}`)).rejects.toThrow(
			/malformed/,
		);
		expect(lmdisMock.store.has(`hyp:cast:${HASH}`)).toBe(false);
	});

	test("a hash-only lmdis outage degrades to uncached — the live answer stands", async () => {
		lmdisMock.failNextRequest();
		const fetchCalls = stubFetch(async () =>
			Response.json({ cast: FIXTURE }, { status: 200 }),
		);

		// the cache read fails (502 non-JSON), the live fetch answers
		const cast = await getHypersnapCastByHash(HASH as `0x${string}`);
		expect(cast?.fid).toBe(3854);
		expect(fetchCalls()).toBe(1);
	});

	test("ByFidAndHash reads the same cached entry and keeps its fid filter", async () => {
		const fetchCalls = stubFetch(async () =>
			Response.json({ cast: FIXTURE }, { status: 200 }),
		);
		expect(
			await getHypersnapCastByFidAndHash(3854, HASH as `0x${string}`),
		).toBeDefined();
		expect(fetchCalls()).toBe(1);
		const opsAfterFirst = lmdisMock.opCount(`hyp:cast:${HASH}`);

		// same hash, wrong fid: served from the cache — no fetch, no lmdis
		// ops — and the per-fid filter still answers a clean miss
		expect(
			await getHypersnapCastByFidAndHash(2, HASH as `0x${string}`),
		).toBeUndefined();
		expect(fetchCalls()).toBe(1);
		expect(lmdisMock.opCount(`hyp:cast:${HASH}`)).toBe(opsAfterFirst);
	});
});

describe("getHaatzProfileByFid: cache", () => {
	test("a profile is cached under hyp:profile: — the repeat read performs no fetch", async () => {
		const fetchCalls = stubFetch(async () =>
			Response.json(
				{
					user: {
						username: "darrylyeo",
						display_name: "Darryl Yeo",
						pfp_url: "https://example.com/pfp.png",
						follower_count: 9,
						profile: { bio: { text: "hello" } },
					},
				},
				{ status: 200 },
			),
		);

		const first = await getHaatzProfileByFid(3854);
		expect(first.followerCount).toBe(9);
		expect(fetchCalls()).toBe(1);

		const second = await getHaatzProfileByFid(3854);
		expect(second).toEqual(first);
		expect(fetchCalls()).toBe(1);
	});

	test("an outage is not cached — the retry reaches the network", async () => {
		const outageFetch = stubFetch(async () =>
			Response.json({ error: "boom" }, { status: 500 }),
		);
		expect(getHaatzProfileByFid(3854)).rejects.toThrow();
		expect(outageFetch()).toBe(1);
		expect(lmdisMock.store.has("hyp:profile:3854")).toBe(false);

		const retryFetch = stubFetch(async () =>
			Response.json(
				{ user: { username: "late", follower_count: 0 } },
				{ status: 200 },
			),
		);
		expect((await getHaatzProfileByFid(3854)).username).toBe("late");
		expect(retryFetch()).toBe(1);
	});
});

describe("the redis wrapper's hot cache", () => {
	test("a set warms the LRU, a del invalidates it", async () => {
		const redis = (await import("../../lib/redis")).default;
		const client = redis();

		await client.set("wrapper:test", JSON.stringify({ a: 1 }), {
			ex: 60,
		});
		// an LRU hit performs zero lmdis ops
		expect(await client.get("wrapper:test")).toEqual({ a: 1 });
		expect(lmdisMock.opCount("wrapper:test")).toBe(1); // the SET only

		await client.del("wrapper:test");
		// del only invalidates the LRU in-process; the lmdis key is gone,
		// so the read after it is a real miss
		expect(await client.get("wrapper:test")).toBeNull();
		expect(lmdisMock.opCount("wrapper:test")).toBe(3); // SET, DEL, GET
	});

	test("a cached boolean false reads back as a hit, not a miss", async () => {
		const redis = (await import("../../lib/redis")).default;
		const client = redis();

		await client.set("wrapper:bool", false, { ex: 60 });
		expect(await client.get<boolean>("wrapper:bool")).toBe(false);
		expect(lmdisMock.opCount("wrapper:bool")).toBe(1); // the SET only
	});

	// The LRU must never serve a value past the lifetime of the lmdis entry
	// that backs it. Backfills are stamped at the upstream remaining TTL
	// (known from this process's own writes) and keys with unknown upstream
	// TTL are never cached at all.
	test("a backfilled entry never serves past its upstream lifetime", async () => {
		const client = redis();
		await client.set("bf:known", JSON.stringify({ v: 1 }), { ex: 1 });
		expect(await client.get("bf:known")).toEqual({ v: 1 }); // LRU hit

		redis().clear(); // force the next read to backfill from lmdis
		expect(await client.get("bf:known")).toEqual({ v: 1 }); // backfilled

		// past the upstream expiry neither layer serves it, and the dead
		// record does not come back
		await Bun.sleep(1100);
		expect(await client.get("bf:known")).toBeNull();
	});

	test("a sub-30s TTL is served no longer than its lmdis lifetime", async () => {
		const client = redis();
		// a write with ex below HOT_TTL_MS: the LRU stamp must cap at it
		await client.set("bf:short", JSON.stringify({ v: 1 }), { ex: 1 });
		await Bun.sleep(1100);
		expect(await client.get("bf:short")).toBeNull();
	});

	test("a key this process never wrote is not backfilled into the LRU", async () => {
		const { LmdisClient } = (await import("../../lib/lmdis")) as any;
		const raw = new LmdisClient({
			url: process.env.UPSTASH_REDIS_REST_URL,
			token: process.env.UPSTASH_REDIS_REST_TOKEN,
		});
		await raw.set("bf:unknown", JSON.stringify({ v: 2 }), { ex: 60 });

		const client = redis();
		redis().clear();
		expect(await client.get("bf:unknown")).toEqual({ v: 2 }); // from lmdis
		// not cached: the repeat read pays another lmdis round-trip
		expect(await client.get("bf:unknown")).toEqual({ v: 2 });
		// SET + GET + GET
		expect(lmdisMock.opCount("bf:unknown")).toBe(3);
	});
});
