import { describe, expect, test } from "bun:test";
import { HotCache } from "../../lib/hot-cache";

// injected clock — deterministic TTL tests without fake timers
let clock = 0;
const make = (
	overrides?: Partial<{ max: number; ttl: number; bytes: number }>,
) =>
	new HotCache(
		overrides?.max ?? 3,
		overrides?.ttl ?? 1000,
		overrides?.bytes ?? 100,
		() => clock,
	);

describe("HotCache", () => {
	test("a hit returns the stored value; a miss is undefined", () => {
		const cache = make();
		expect(cache.get("a")).toBeUndefined();
		cache.set("a", { x: 1 }, 10);
		expect(cache.get("a")).toEqual({ value: { x: 1 } });
	});

	test("cached falsy values stay distinguishable from a miss", () => {
		const cache = make();
		cache.set("f", false, 5);
		cache.set("s", "", 0);
		cache.set("z", 0, 1);
		expect(cache.get("f")).toEqual({ value: false });
		expect(cache.get("s")).toEqual({ value: "" });
		expect(cache.get("z")).toEqual({ value: 0 });
	});

	test("an expired entry answers a miss", () => {
		const cache = make();
		cache.set("a", 1, 1);
		expect(cache.get("a")).toEqual({ value: 1 });
		clock += 1000;
		expect(cache.get("a")).toBeUndefined();
	});

	test("an entry exactly at the TTL boundary is expired", () => {
		const cache = make();
		cache.set("a", 1, 1);
		clock += 999;
		expect(cache.get("a")).toEqual({ value: 1 });
		clock += 1;
		expect(cache.get("a")).toBeUndefined();
	});

	test("capacity evicts least-recently-used, not most-recently-set", () => {
		const cache = make();
		cache.set("a", 1, 1);
		cache.set("b", 2, 1);
		cache.set("c", 3, 1);
		// touching "a" makes it the most recent; "b" becomes the victim
		expect(cache.get("a")).toEqual({ value: 1 });
		cache.set("d", 4, 1);
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("a")).toEqual({ value: 1 });
		expect(cache.get("c")).toEqual({ value: 3 });
		expect(cache.get("d")).toEqual({ value: 4 });
	});

	test("eviction reclaims expired entries before dropping live ones", () => {
		const cache = make(); // capacity 3, class TTL 1000
		cache.set("a", 1, 1, 100); // dies early
		cache.set("b", 2, 1);
		cache.set("c", 3, 1); // full
		clock += 200; // a expired; b and c live
		cache.set("d", 4, 1); // evict(): reclaim a — oldest-only would drop live b
		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("b")).toEqual({ value: 2 });
		expect(cache.get("c")).toEqual({ value: 3 });
		expect(cache.get("d")).toEqual({ value: 4 });
	});

	test("a per-entry TTL overrides the class TTL in both directions", () => {
		const cache = make();
		cache.set("short", 1, 1, 10);
		cache.set("long", 2, 1, 100_000);
		clock += 500;
		expect(cache.get("short")).toBeUndefined();
		expect(cache.get("long")).toEqual({ value: 2 });
	});

	test("re-setting a key refreshes its value and recency", () => {
		const cache = make();
		cache.set("a", 1, 1);
		cache.set("b", 2, 1);
		cache.set("c", 3, 1); // full
		cache.set("a", 99, 1); // refresh — a becomes most recent
		cache.set("d", 4, 1); // evict: "b" is the LRU victim, not "a"
		expect(cache.get("a")).toEqual({ value: 99 });
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("c")).toEqual({ value: 3 });
		expect(cache.get("d")).toEqual({ value: 4 });
	});

	test("oversize values are refused but existing entries survive", () => {
		const cache = make();
		cache.set("a", 1, 1);
		cache.set("big", "x".repeat(101), 101);
		expect(cache.get("big")).toBeUndefined();
		expect(cache.get("a")).toEqual({ value: 1 });
	});

	test("invalidate drops the entry", () => {
		const cache = make();
		cache.set("a", 1, 1);
		cache.invalidate("a");
		expect(cache.get("a")).toBeUndefined();
		cache.invalidate("never-there");
	});

	// HOT_TTL_MS is a freshness bound, not a correctness invariant —
	// correctness comes from the wrapper stamping every entry at the
	// upstream entry's remaining lifetime (see the backfill tests in
	// hypersnap-cache.test.ts). Keeping the cap well under the shortest
	// upstream TTL (Ttl.SHORT = 60s) stays the sane default.
	test("the wrapper constants stay under the shortest Redis TTL", async () => {
		const { HOT_TTL_MS, HOT_MAX_ENTRIES, HOT_MAX_WIRE_BYTES } =
			await import("../../lib/redis");
		const { Ttl } = await import("../../lib/redis");
		expect(HOT_TTL_MS).toBeLessThan(Ttl.SHORT * 1000);
		expect(HOT_MAX_ENTRIES).toBeGreaterThan(0);
		expect(HOT_MAX_WIRE_BYTES).toBeGreaterThan(0);
	});
});
