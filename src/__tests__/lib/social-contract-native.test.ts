import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import * as realRedis from "../../lib/redis";

// In-memory redis so the cache legs never touch the real Upstash instance.
// Same snapshot/restore pattern as hydration.test.ts / user-lookup.test.ts.
const originalRedis = {
	default: realRedis.default,
	Ttl: realRedis.Ttl,
};
const cacheStore = new Map<string, string>();

mock.module("../../lib/redis", () => ({
	default: () => ({
		get: async (key: string) => {
			const raw = cacheStore.get(key);
			return raw === undefined ? null : JSON.parse(raw);
		},
		set: async (key: string, value: string) => {
			cacheStore.set(key, value);
			return "OK";
		},
	}),
	Ttl: originalRedis.Ttl,
}));

afterAll(() => {
	mock.module("../../lib/redis", () => originalRedis);
});

const { hasFidSignedSocialContract } = await import(
	"../../lib/social-contract"
);

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	cacheStore.clear();
});

describe("hasFidSignedSocialContract: native fids", () => {
	test("answers false with zero outbound calls — the legacy world cannot know a native fid", async () => {
		// the verified-address source is Snapchain-only and the signing
		// check degrades through Base RPC — both predate the fork's
		// widened fid space. Any fetch means the short-circuit failed.
		globalThis.fetch = (async (input: any) => {
			throw new Error(`unexpected fetch: ${String(input)}`);
		}) as unknown as typeof fetch;

		const signed = await hasFidSignedSocialContract(4294967296);

		expect(signed).toBe(false);
		// the proven-none answer caches MEDIUM, so repeat visits stay free
		expect(
			cacheStore.get("social-contract:v2:4294967296"),
		).toBe("false");
	});
});
