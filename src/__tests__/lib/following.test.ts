import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import * as realRedis from "../../lib/redis";

// Same in-memory redis snapshot as user-lookup.test.ts — the paginated
// cache legs must not touch a real lmdis, and must not leak into other files.
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

const { getFollowingByFid } = await import("../../lib/hub-api");

const originalFetch = globalThis.fetch;

afterEach(() => {
	cacheStore.clear();
	globalThis.fetch = originalFetch;
});

// itty-fetcher passes a Request — unwrap .url like user-lookup.test.ts
const stubFetch = (impl: (url: string) => Response) => {
	globalThis.fetch = Object.assign(
		async (input: any) =>
			impl(String(input instanceof Request ? input.url : input)),
	) as unknown as typeof fetch;
};

const linkPage = (targetFids: Array<number | string>) => ({
	messages: targetFids.map((targetFid) => ({
		data: {
			linkBody: {
				type: "follow",
				targetFid,
			},
		},
	})),
	nextPageToken: "",
});

describe("getFollowingByFid", () => {
	test("Hypersnap is primary — a hit never reaches crackle", async () => {
		stubFetch((url) => {
			if (!url.includes("haatz.quilibrium.com")) {
				throw new Error(`crackle must not be called, got: ${url}`);
			}
			if (!url.includes("linksByFid")) {
				throw new Error(`unexpected fetch: ${url}`);
			}
			return Response.json(linkPage([10, 20, "4294967296"]));
		});

		expect(await getFollowingByFid(2, 1)).toEqual([10, 20, 4294967296]);
	});

	test("a clean Hypersnap miss consults crackle for legacy fids", async () => {
		stubFetch((url) => {
			if (url.includes("haatz.quilibrium.com")) {
				return Response.json(linkPage([]));
			}
			if (!url.includes("linksByFid")) {
				throw new Error(`unexpected fetch: ${url}`);
			}
			return Response.json(linkPage([3, 4]));
		});

		expect(await getFollowingByFid(2, 1)).toEqual([3, 4]);
	});

	test("native fids resolve from Hypersnap alone — crackle is never consulted", async () => {
		stubFetch((url) => {
			if (!url.includes("haatz.quilibrium.com")) {
				throw new Error(`crackle must not be called, got: ${url}`);
			}
			return Response.json(linkPage([100]));
		});

		expect(await getFollowingByFid(2 ** 32, 1)).toEqual([100]);
	});

	test("a native-fid Hypersnap outage throws — never an empty follow list", async () => {
		stubFetch((url) => {
			if (url.includes("haatz.quilibrium.com")) {
				return new Response("internal error", { status: 500 });
			}
			throw new Error(`crackle must not be called, got: ${url}`);
		});

		await expect(getFollowingByFid(2 ** 32, 1)).rejects.toThrow(
			/following lookup outage/,
		);
	});

	test("an empty Hypersnap answer plus crackle outage throws for legacy fids", async () => {
		stubFetch((url) => {
			if (url.includes("haatz.quilibrium.com")) {
				return Response.json(linkPage([]));
			}
			return new Response("internal error", { status: 500 });
		});

		await expect(getFollowingByFid(2, 1)).rejects.toThrow(
			/following lookup outage/,
		);
	});
});
