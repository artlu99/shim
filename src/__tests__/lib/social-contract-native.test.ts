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
	test("asks Hypersnap for verifications and never falls back to Snapchain", async () => {
		// Native fids can verify on Hypersnap; Snapchain cannot know them.
		// An empty haatz answer is proven-none — Base RPC is never reached.
		globalThis.fetch = Object.assign(async (input: any) => {
			const url = String(input instanceof Request ? input.url : input);
			if (!url.includes("haatz.quilibrium.com")) {
				throw new Error(`crackle/Base must not be called, got: ${url}`);
			}
			if (!url.includes("verificationsByFid")) {
				throw new Error(`unexpected fetch: ${url}`);
			}
			return Response.json({ messages: [], nextPageToken: "" });
		}) as unknown as typeof fetch;

		const signed = await hasFidSignedSocialContract(4294967296);

		expect(signed).toBe(false);
		// the proven-none answer caches MEDIUM, so repeat visits stay free
		expect(cacheStore.get("social-contract:v2:4294967296")).toBe("false");
	});
});
