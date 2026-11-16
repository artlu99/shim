import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import * as realRedis from "../../lib/redis";

// In-memory redis so the cache legs never touch the real Upstash instance.
// Same snapshot/restore pattern as user-lookup.test.ts.
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

const { getFidByUsernameInEitherWorld } = await import("../../lib/hub-api");

const originalFetch = globalThis.fetch;

// hosts tell the legs apart; within haatz, paths tell /v1 proofs from the
// /v2 profile join
const stubFetch = (impl: (url: string) => Response | Promise<Response>) => {
	globalThis.fetch = Object.assign(
		async (input: any) =>
			impl(String(input instanceof Request ? input.url : input)),
	) as unknown as typeof fetch;
};

const LEGACY_PROOF = {
	timestamp: 1623910375,
	name: "dwr",
	owner: "0x74232bf61e994655592747e20bdf6fa9b9476f79",
	fid: 3,
	type: "USERNAME_TYPE_FNAME",
};

// native fids arrive as decimal strings in the proof registry (measured
// 2026-11-16) — the exact shape that used to fall through a typeof-number
// check and vanish
const NATIVE_PROOF = {
	timestamp: 185322306,
	name: "muhammedali",
	owner: "0x7f512e5395010964a57e1fcbe1dfe5a92e5cd91b",
	fid: "4294967297",
	type: "USERNAME_TYPE_FNAME",
};

const HAATZ_PROFILE = {
	user: {
		fid: "4294967297",
		username: "muhammedali",
		display_name: "Muhammed Ali",
		// measured: pfp_url sits on the user object, not in profile
		pfp_url: "https://cdn.example.com/pfp.png",
		custody_address: "0x7f512e5395010964a57e1fcbe1dfe5a92e5cd91b",
		follower_count: 9,
		profile: { bio: { text: "floats like a butterfly" } },
	},
};

// both gateways answer an unknown name with HTTP 400 carrying the
// not-found detail (measured) — the clean-miss shape
const NOT_FOUND = Response.json(
	{
		error: "Failed to get username proof",
		error_detail: 'status: NotFound, message: "Username proof not found"',
	},
	{ status: 400 },
);

afterEach(() => {
	globalThis.fetch = originalFetch;
	cacheStore.clear();
});

describe("getFidByUsernameInEitherWorld", () => {
	test("Snapchain is primary — a hit never reaches Hypersnap", async () => {
		stubFetch((url) => {
			if (!url.includes("crackle.farcaster.xyz")) {
				throw new Error(`haatz must not be called, got: ${url}`);
			}
			return Response.json(LEGACY_PROOF);
		});

		const res = await getFidByUsernameInEitherWorld("dwr");

		expect(res?.fid).toBe(3);
		expect(res?.origin).toBe("snapchain");
		expect(res?.provisional).toBe(false);
		expect(res?.followerCount).toBeNull();
	});

	test("a Snapchain miss consults Hypersnap — provisional, string fid parsed, profile joined", async () => {
		stubFetch((url) => {
			if (url.includes("crackle.farcaster.xyz")) {
				return NOT_FOUND;
			}
			if (url.includes("/v1/userNameProofByName")) {
				return Response.json(NATIVE_PROOF);
			}
			if (url.includes("/v2/farcaster/user")) {
				return Response.json(HAATZ_PROFILE);
			}
			throw new Error(`unexpected fetch: ${url}`);
		});

		const res = await getFidByUsernameInEitherWorld("muhammedali");

		expect(res?.fid).toBe(4294967297); // the string form, parsed exactly
		expect(res?.origin).toBe("hypersnap");
		expect(res?.provisional).toBe(true);
		expect(res?.followerCount).toBe(9);
		expect(res?.profileUsername).toBe("muhammedali");
	});

	test("the profile join reads pfp_url from the user object, not profile", async () => {
		// regression guard for the measured shape — the first draft read
		// profile.pfp_url and could only ever answer null
		stubFetch((url) => {
			if (url.includes("crackle.farcaster.xyz")) {
				return NOT_FOUND;
			}
			if (url.includes("/v1/userNameProofByName")) {
				return Response.json(NATIVE_PROOF);
			}
			return Response.json(HAATZ_PROFILE);
		});

		const { getHaatzProfileByFid } = await import("../../lib/hypersnap");
		const profile = await getHaatzProfileByFid(4294967297);
		expect(profile.pfpUrl).toBe("https://cdn.example.com/pfp.png");
		expect(profile.bio).toBe("floats like a butterfly");
	});

	test("a miss on both worlds is a real miss", async () => {
		stubFetch(() => NOT_FOUND);

		expect(
			await getFidByUsernameInEitherWorld("no-such-name-xyz"),
		).toBeUndefined();
	});

	test("a Snapchain outage still answers from Hypersnap — provisional", async () => {
		stubFetch((url) => {
			if (url.includes("crackle.farcaster.xyz")) {
				return new Response("internal error", { status: 500 });
			}
			if (url.includes("/v1/userNameProofByName")) {
				return Response.json(NATIVE_PROOF);
			}
			return Response.json(HAATZ_PROFILE);
		});

		const res = await getFidByUsernameInEitherWorld("muhammedali");

		expect(res?.origin).toBe("hypersnap");
		expect(res?.provisional).toBe(true);
	});

	test("a miss on Snapchain and an outage on Hypersnap withholds the verdict", async () => {
		stubFetch((url) => {
			if (url.includes("crackle.farcaster.xyz")) {
				return NOT_FOUND;
			}
			return new Response("internal error", { status: 500 });
		});

		expect(getFidByUsernameInEitherWorld("muhammedali")).rejects.toThrow(
			/name lookup outage/,
		);
	});
});
