import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import * as realRedis from "../../lib/redis";

// In-memory redis so the cache legs never touch the real Upstash instance —
// crackle's cachedFetcherGet does not catch a failed cache READ, so without
// this the whole crackle leg dies before fetching in test environments.
// Same snapshot/restore pattern as hydration.test.ts (mock.module patches
// the global registry and would otherwise leak into other test files).
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
	// reuse the real enum so values can't drift from it
	Ttl: originalRedis.Ttl,
}));

afterAll(() => {
	mock.module("../../lib/redis", () => originalRedis);
});

const { getHaatzUserByFid, getUserInEitherWorld } = await import(
	"../../lib/hub-api"
);

// fixtures in the gateway's protobuf-JSON shape (white-lie typing — these
// arrive deserialized over http)
const HAATZ_PROOFS = {
	proofs: [
		{
			timestamp: 1717775858,
			name: "haatzuser",
			owner: "0xda22919e01e249ba4c96dba46bee29e4981835fc",
			fid: 2,
			type: "USERNAME_TYPE_FNAME",
		},
		{
			timestamp: 1714415299,
			name: "haatzuser.eth",
			owner: "0xda22919e01e249ba4c96dba46bee29e4981835fc",
			fid: 2,
			type: "USERNAME_TYPE_ENS_L1",
		},
	],
};

const HAATZ_USER_DATA = {
	messages: [
		{
			data: {
				type: "MESSAGE_TYPE_USER_DATA_ADD",
				fid: 2,
				timestamp: 184968776,
				network: "FARCASTER_NETWORK_MAINNET",
				userDataBody: { type: "USER_DATA_TYPE_USERNAME", value: "haatzuser" },
			},
		},
		{
			data: {
				type: "MESSAGE_TYPE_USER_DATA_ADD",
				fid: 2,
				timestamp: 184968777,
				network: "FARCASTER_NETWORK_MAINNET",
				userDataBody: { type: "USER_DATA_TYPE_DISPLAY", value: "Haatz User" },
			},
		},
	],
};

const EMPTY = { proofs: [], messages: [] };

const originalFetch = globalThis.fetch;

// hosts tell the legs apart: the same /v1 uris mean different worlds
const stubFetch = (impl: (url: string) => Response) => {
	globalThis.fetch = Object.assign(
		async (input: any) => impl(String(input instanceof Request ? input.url : input)),
	) as unknown as typeof fetch;
};

// answer every haatz-host fetch from a url-keyed responder; anything off the
// haatz host fails loudly so a test that leaks past its world is visible
const haatzAnswer = (respond: (url: string) => unknown) =>
	stubFetch((url) => {
		if (!url.includes("haatz.quilibrium.com")) {
			throw new Error(`unexpected fetch: ${url}`);
		}
		return Response.json(respond(url));
	});

afterEach(() => {
	globalThis.fetch = originalFetch;
	cacheStore.clear();
});

describe("getHaatzUserByFid", () => {
	test("maps proofs and user data onto shim's User", async () => {
		haatzAnswer((url) =>
			url.includes("userNameProofsByFid") ? HAATZ_PROOFS : HAATZ_USER_DATA,
		);

		const user = await getHaatzUserByFid(2);

		expect(user?.username).toBe("haatzuser"); // the USER_DATA message wins
		expect(user?.fname).toBe("haatzuser"); // newest fname proof
		expect(user?.attestations).toEqual(["haatzuser.eth"]); // the ENS proof
		expect(user?.displayName).toBe("Haatz User");
		expect(user?.primaryAddress).toBeNull(); // comes from Warpcast, not the hub
	});

	test("an empty answer is a clean miss", async () => {
		haatzAnswer((url) =>
			url.includes("userNameProofsByFid")
				? { proofs: [] }
				: { messages: [] },
		);

		expect(await getHaatzUserByFid(999999999)).toBeUndefined();
	});

	test("throws on a non-ok answer — an outage, never an empty world", async () => {
		stubFetch(() => new Response("internal error", { status: 500 }));

		expect(getHaatzUserByFid(2)).rejects.toThrow(/\[500\]/);
	});
});

describe("getUserInEitherWorld", () => {
	test("Hypersnap is primary — a hit never reaches crackle", async () => {
		stubFetch((url) => {
			if (!url.includes("haatz.quilibrium.com")) {
				throw new Error(`crackle must not be called, got: ${url}`);
			}
			return url.includes("userNameProofsByFid")
				? Response.json(HAATZ_PROOFS)
				: Response.json(HAATZ_USER_DATA);
		});

		const user = await getUserInEitherWorld(2);

		expect(user?.username).toBe("haatzuser");
	});

	test("a clean Hypersnap miss consults crackle", async () => {
		let crackleCalled = false;
		stubFetch((url) => {
			if (url.includes("haatz.quilibrium.com")) {
				return url.includes("userNameProofsByFid")
					? Response.json({ proofs: [] })
					: Response.json({ messages: [] });
			}
			crackleCalled = true;
			return url.includes("userNameProofsByFid")
				? Response.json({ proofs: HAATZ_PROOFS.proofs })
				: Response.json(EMPTY);
		});

		const user = await getUserInEitherWorld(2);

		expect(crackleCalled).toBe(true);
		// proofs alone still produce a user (fname + attestations)
		expect(user?.fname).toBe("haatzuser");
	});

	test("a Hypersnap outage falls through to crackle", async () => {
		stubFetch((url) => {
			if (url.includes("haatz.quilibrium.com")) {
				return new Response("internal error", { status: 500 });
			}
			return url.includes("userNameProofsByFid")
				? Response.json({ proofs: HAATZ_PROOFS.proofs })
				: Response.json(EMPTY);
		});

		const user = await getUserInEitherWorld(2);

		expect(user?.fname).toBe("haatzuser");
	});

	test("a miss on both worlds is a real miss", async () => {
		stubFetch(() => Response.json(EMPTY));

		expect(await getUserInEitherWorld(999999999)).toBeUndefined();
	});
});
