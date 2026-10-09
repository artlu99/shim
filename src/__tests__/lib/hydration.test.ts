import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import * as hubApi from "../../lib/hub-api";
import * as proNft from "../../lib/pro-nft";
// Snapshot the real exports before mock.module. The namespace is a live
// binding, so passing it back in afterAll would reinstall the mock.
import * as realRedis from "../../lib/redis";
import * as warpcast from "../../lib/warpcast";

const originalRedis = {
	default: realRedis.default,
	Ttl: realRedis.Ttl,
};

let getUserByFid: typeof import("../../lib/hydration").getUserByFid;
let getSentFromBySignerKey: typeof import(
	"../../lib/hydration"
).getSentFromBySignerKey;
let hydrateText: typeof import("../../lib/hydration").hydrateText;

// In-memory redis so getUserByFid's cache never touches the real Upstash
// instance (mocked users must not leak into prod cache or between tests).
const userCacheStore = new Map<string, string>();

// fixtures
const mockFid = 123;
const mockUser1 = {
	fid: mockFid,
	username: "testuser",
	displayName: "Test User",
	pfpUrl: null,
	bio: null,
	primaryAddress: null,
	proNft: {
		order: 10001,
		subscribed_at: new Date(1234567890 * 1000).toISOString(),
		expires_at: new Date(1234567891 * 1000).toISOString(),
		status: "unsubscribed" as "unsubscribed" | "subscribed",
		fid: mockFid,
	},
};

const mockUser2 = {
	fid: mockFid + 1,
	username: "user2",
	displayName: "User Two",
	pfpUrl: null,
	bio: null,
	primaryAddress: null,
	proNft: {
		order: 10002,
		subscribed_at: new Date(1234567890 * 1000).toISOString(),
		expires_at: new Date(1234567891 * 1000).toISOString(),
		status: "unsubscribed" as "unsubscribed" | "subscribed",
		fid: mockFid + 1,
	},
};

// Create spies that we can configure per test
const hubUserSpy = spyOn(hubApi, "getHubUserByFid");
const proNftSpy = spyOn(proNft, "getProNftDetails");
const primaryAddressSpy = spyOn(warpcast, "getUserPrimaryAddress");

describe("Hydration Functions", () => {
	beforeAll(async () => {
		mock.module("../../lib/redis", () => {
			const client = {
				get: async (key: string) => {
					const raw = userCacheStore.get(key);
					return raw === undefined ? null : JSON.parse(raw);
				},
				set: async (key: string, value: string) => {
					userCacheStore.set(key, value);
					return "OK";
				},
			};
			return {
				default: () => client,
				// reuse the real enum so values can't drift from it
				Ttl: originalRedis.Ttl,
			};
		});

		// import after mocking so hydration binds to the mocked redis
		({
			getUserByFid,
			getSentFromBySignerKey,
			hydrateText,
		} = await import("../../lib/hydration"));
	});

	beforeEach(() => {
		userCacheStore.clear();

		hubUserSpy.mockReset();
		proNftSpy.mockReset();
		primaryAddressSpy.mockReset();

		hubUserSpy.mockResolvedValue(undefined);
		proNftSpy.mockResolvedValue(undefined);
		primaryAddressSpy.mockResolvedValue(undefined);
	});

	afterAll(() => {
		mock.module("../../lib/redis", () => originalRedis);
		hubUserSpy.mockRestore();
		proNftSpy.mockRestore();
		primaryAddressSpy.mockRestore();
	});

	describe("getUserByFid", () => {
		it("should return a complete user object when all data is available", async () => {
			const mockHubUser = {
				fid: mockFid,
				username: "testuser",
				displayName: "Test User",
				pfpUrl: "https://example.com/pfp.jpg",
				bio: "Test bio",
				primaryAddress: null,
				proNft: null,
			};

			const mockPrimaryAddress = "0x1234567890abcdef" as `0x${string}`;

			const mockProNftDetails = {
				fid: mockFid,
				order: 1,
				timestamp: 1234567890,
				expires: 1234567891,
			};

			hubUserSpy.mockResolvedValue(mockHubUser);
			primaryAddressSpy.mockResolvedValue({
				fid: mockFid,
				protocol: "ethereum",
				address: mockPrimaryAddress,
			});
			proNftSpy.mockResolvedValue(mockProNftDetails);

			const result = await getUserByFid(123);

			expect(hubUserSpy).toHaveBeenCalledWith(123);
			expect(primaryAddressSpy).toHaveBeenCalledWith(123);
			expect(proNftSpy).toHaveBeenCalledWith(123);

			expect(result).toEqual({
				fid: 123,
				username: "testuser",
				displayName: "Test User",
				pfpUrl: "https://example.com/pfp.jpg",
				bio: "Test bio",
				primaryAddress: mockPrimaryAddress,
				proNft: {
					order: 1,
					subscribed_at: new Date(1234567890 * 1000).toISOString(),
					expires_at: new Date(1234567891 * 1000).toISOString(),
					status: "unsubscribed" as "unsubscribed" | "subscribed",
				},
			});
		});

		it("should handle missing hub user data", async () => {
			hubUserSpy.mockResolvedValue(undefined);
			primaryAddressSpy.mockResolvedValue(undefined);
			proNftSpy.mockResolvedValue(undefined);

			const result = await getUserByFid(123);

			expect(result).toEqual({
				fid: 123,
				username: null,
				displayName: null,
				pfpUrl: null,
				bio: null,
				primaryAddress: null,
				proNft: null,
			});
		});

		it("should handle partial hub user data", async () => {
			const mockHubUser = {
				fid: mockFid,
				username: "testuser",
				displayName: null,
				pfpUrl: "https://example.com/pfp.jpg",
				bio: null,
				primaryAddress: null,
				proNft: null,
			};

			hubUserSpy.mockResolvedValue(mockHubUser);
			primaryAddressSpy.mockResolvedValue(undefined);
			proNftSpy.mockResolvedValue(undefined);

			const result = await getUserByFid(123);

			expect(result).toEqual({
				fid: 123,
				username: "testuser",
				displayName: null,
				pfpUrl: "https://example.com/pfp.jpg",
				bio: null,
				primaryAddress: null,
				proNft: null,
			});
		});

		it("should handle missing primary address", async () => {
			const mockHubUser = {
				fid: mockFid,
				username: "testuser",
				displayName: "Test User",
				pfpUrl: null,
				bio: "Test bio",
				primaryAddress: null,
				proNft: null,
			};

			hubUserSpy.mockResolvedValue(mockHubUser);
			primaryAddressSpy.mockResolvedValue(undefined);
			proNftSpy.mockResolvedValue(undefined);

			const result = await getUserByFid(123);

			expect(result.primaryAddress).toBeNull();
		});

		it("should handle missing pro NFT details", async () => {
			const mockHubUser = {
				fid: mockFid,
				username: "testuser",
				displayName: "Test User",
				pfpUrl: null,
				bio: "Test bio",
				primaryAddress: null,
				proNft: null,
			};

			hubUserSpy.mockResolvedValue(mockHubUser);
			primaryAddressSpy.mockResolvedValue(undefined);
			proNftSpy.mockResolvedValue(undefined);

			const result = await getUserByFid(123);

			expect(result.proNft).toBeNull();
		});

		it("should serve repeat calls from cache without refetching", async () => {
			const mockHubUser = {
				fid: mockFid,
				username: "testuser",
				displayName: "Test User",
				pfpUrl: null,
				bio: null,
				primaryAddress: null,
				proNft: null,
			};

			hubUserSpy.mockResolvedValue(mockHubUser);
			// null is a successful "no address" result; undefined is a fetch failure
			primaryAddressSpy.mockResolvedValue(null);
			proNftSpy.mockResolvedValue(undefined);

			const first = await getUserByFid(123);

			// the result was persisted, so the second call is served by the cache
			expect(userCacheStore.has("user:123")).toBe(true);

			const second = await getUserByFid(123);

			// each underlying fetcher ran exactly once despite two calls
			expect(hubUserSpy).toHaveBeenCalledTimes(1);
			expect(primaryAddressSpy).toHaveBeenCalledTimes(1);
			expect(proNftSpy).toHaveBeenCalledTimes(1);
			expect(second).toEqual(first);
		});

		it("should coalesce concurrent calls into a single fetch", async () => {
			const mockHubUser = {
				fid: mockFid,
				username: "testuser",
				displayName: "Test User",
				pfpUrl: null,
				bio: null,
				primaryAddress: null,
				proNft: null,
			};

			hubUserSpy.mockResolvedValue(mockHubUser);
			// null is a successful "no address" result; undefined is a fetch failure
			primaryAddressSpy.mockResolvedValue(null);
			proNftSpy.mockResolvedValue(undefined);

			const [first, second] = await Promise.all([
				getUserByFid(123),
				getUserByFid(123),
			]);

			expect(hubUserSpy).toHaveBeenCalledTimes(1);
			expect(primaryAddressSpy).toHaveBeenCalledTimes(1);
			expect(proNftSpy).toHaveBeenCalledTimes(1);
			expect(second).toEqual(first);
		});

		it("should not cache a missing hub user", async () => {
			hubUserSpy.mockResolvedValue(undefined);
			primaryAddressSpy.mockResolvedValue(null);
			proNftSpy.mockResolvedValue(undefined);

			await getUserByFid(123);
			await getUserByFid(123);

			expect(hubUserSpy).toHaveBeenCalledTimes(2);
			expect(primaryAddressSpy).toHaveBeenCalledTimes(2);
			expect(proNftSpy).toHaveBeenCalledTimes(2);
			expect(userCacheStore.has("user:123")).toBe(false);
		});

		it("should not cache a failed primary address lookup", async () => {
			hubUserSpy.mockResolvedValue({
				fid: mockFid,
				username: "testuser",
				displayName: "Test User",
				pfpUrl: null,
				bio: null,
				primaryAddress: null,
				proNft: null,
			});
			primaryAddressSpy.mockResolvedValue(undefined);
			proNftSpy.mockResolvedValue(undefined);

			await getUserByFid(123);
			await getUserByFid(123);

			expect(hubUserSpy).toHaveBeenCalledTimes(2);
			expect(primaryAddressSpy).toHaveBeenCalledTimes(2);
			expect(proNftSpy).toHaveBeenCalledTimes(2);
			expect(userCacheStore.has("user:123")).toBe(false);
		});

		it("should recompute pro status on cache hits so expiry is never stale", async () => {
			// simulate a user cached while their pro was still active
			userCacheStore.set(
				`user:${mockFid}`,
				JSON.stringify({
					fid: mockFid,
					username: "testuser",
					displayName: "Test User",
					pfpUrl: null,
					bio: null,
					primaryAddress: null,
					proNft: {
						order: 1,
						subscribed_at: new Date(Date.now() - 86_400_000).toISOString(),
						expires_at: new Date(Date.now() - 60_000).toISOString(), // expired 1 min ago
						status: "subscribed", // stale value from cache-time
					},
				}),
			);

			const result = await getUserByFid(mockFid);

			// served from cache — no underlying fetches
			expect(hubUserSpy).not.toHaveBeenCalled();
			expect(primaryAddressSpy).not.toHaveBeenCalled();
			expect(proNftSpy).not.toHaveBeenCalled();
			expect(result.proNft?.status).toBe("unsubscribed");
		});
	});

	describe("getSentFromBySignerKey", () => {
		it("should return 'neynar' for neynar signer key", async () => {
			const signerKey =
				"0x0e10fec94a39c27f6ea39191b310c13c53cb8f6be209b3c48d7278f6688df603" as `0x${string}`;
			const result = await getSentFromBySignerKey(signerKey);
			expect(result).toBe("neynar");
		});

		it("should return 'artlu' for artlu signer key", async () => {
			const signerKey =
				"0xc6dab75cc8e1d720a6f8a9aff8c6ae2eb48e5442b3a863b88413331dbde6c206" as `0x${string}`;
			const result = await getSentFromBySignerKey(signerKey);
			expect(result).toBe("artlu");
		});

		it("should return 'recaster-fc' for recaster-fc signer key", async () => {
			const signerKey =
				"0x4d25071459be1161bbeb299cecac7668bb04f6009e00498e3606e0839d31e064" as `0x${string}`;
			const result = await getSentFromBySignerKey(signerKey);
			expect(result).toBe("recaster-fc");
		});

		it("should return 'warpcast' for warpcast signer key", async () => {
			const signerKey =
				"0xba30336ba6bed65f11b79a0d5c8f78885b614b95386fcb3734f0d6aa2cb7ea1f" as `0x${string}`;
			const result = await getSentFromBySignerKey(signerKey);
			expect(result).toBe("warpcast");
		});

		it("should return null for unknown signer key", async () => {
			const signerKey =
				"0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`;
			const result = await getSentFromBySignerKey(signerKey);
			expect(result).toBeNull();
		});

		it("should return undefined for empty signer key", async () => {
			const signerKey = "" as `0x${string}`;
			const result = await getSentFromBySignerKey(signerKey);
			expect(result).toBeUndefined();
		});

		it("should return null for falsy signer key", async () => {
			const signerKey = "0x" as `0x${string}`;
			const result = await getSentFromBySignerKey(signerKey);
			expect(result).toBeNull();
		});
	});

	describe("hydrateText", () => {
		it("should return null for null text", async () => {
			const result = await hydrateText(null, [1, 2], [0, 5]);
			expect(result).toBeNull();
		});

		it("should return null for empty text", async () => {
			const result = await hydrateText("", [1, 2], [0, 5]);
			expect(result).toBeNull();
		});

		it("should return original text when no mentions", async () => {
			const text = "Hello world!";
			const result = await hydrateText(text, null, null);
			expect(result).toBe(text);
		});

		it("should return original text when mentions array is empty", async () => {
			const text = "Hello world!";
			const result = await hydrateText(text, [], []);
			expect(result).toBe(text);
		});

		it("should hydrate text with single mention", async () => {
			const mockUser = {
				fid: mockFid,
				username: "testuser",
				displayName: "Test User",
				pfpUrl: null,
				bio: null,
				primaryAddress: null,
				proNft: null,
			};

			hubUserSpy.mockResolvedValue(mockUser);

			const text = "Hello @world!";
			const mentions = [123];
			const mentionsPositions = [6]; // Position of '@' in "Hello @world!"

			const result = await hydrateText(text, mentions, mentionsPositions);

			expect(hubUserSpy).toHaveBeenCalledWith(123);
			expect(result).toBe("Hello @testuser world!");
		});

		it("should hydrate text with multiple mentions", async () => {
			hubUserSpy
				.mockResolvedValueOnce(mockUser1)
				.mockResolvedValueOnce(mockUser2);

			const text = "Hello @user1 and @user2!";
			const mentions = [123, 456];
			const mentionsPositions = [6, 16]; // Positions of '@' characters

			const result = await hydrateText(text, mentions, mentionsPositions);

			expect(hubUserSpy).toHaveBeenCalledWith(123);
			expect(hubUserSpy).toHaveBeenCalledWith(456);
			expect(result).toBe("Hello @testuser user1 and@user2 @user2!");
		});

		it("should handle mentions in different order than positions", async () => {
			hubUserSpy
				.mockResolvedValueOnce(mockUser1)
				.mockResolvedValueOnce(mockUser2);

			const text = "Hello @user2 and @user1!";
			const mentions = [123, 456]; // user1, user2
			const mentionsPositions = [16, 6]; // user2 position, user1 position (reversed)

			const result = await hydrateText(text, mentions, mentionsPositions);

			expect(result).toBe("Hello @user2 user2 and@testuser @user1!");
		});

		it("should handle unknown users with <unknown> placeholder", async () => {
			hubUserSpy.mockResolvedValue(undefined);

			const text = "Hello @unknown!";
			const mentions = [999];
			const mentionsPositions = [6];

			const result = await hydrateText(text, mentions, mentionsPositions);

			expect(result).toBe("Hello @<unknown> unknown!");
		});

		it("should handle mentions at the beginning of text", async () => {
			hubUserSpy.mockResolvedValue(mockUser1);

			const text = "@testuser Hello world!";
			const mentions = [123];
			const mentionsPositions = [0];

			const result = await hydrateText(text, mentions, mentionsPositions);

			expect(result).toBe("@testuser testuser Hello world!");
		});

		it("should handle mentions at the end of text", async () => {
			hubUserSpy.mockResolvedValue(mockUser1);

			const text = "Hello world! @testuser";
			const mentions = [123];
			const mentionsPositions = [13]; // Position of '@' at the end

			const result = await hydrateText(text, mentions, mentionsPositions);

			expect(result).toBe("Hello world! @testuser testuser");
		});

		it("should handle consecutive mentions", async () => {
			hubUserSpy
				.mockResolvedValueOnce(mockUser1)
				.mockResolvedValueOnce(mockUser2);

			const text = "Hello @user1@user2!";
			const mentions = [123, 456];
			const mentionsPositions = [6, 12]; // Consecutive positions

			const result = await hydrateText(text, mentions, mentionsPositions);

			expect(result).toBe("Hello @testuser user1@user2 user2!");
		});

		it("should handle unicode characters correctly", async () => {
			hubUserSpy.mockResolvedValue(mockUser1);

			const text = "Hello @user with emoji 🚀!";
			const mentions = [123];
			const mentionsPositions = [6];

			const result = await hydrateText(text, mentions, mentionsPositions);

			expect(result).toBe("Hello @testuser user with emoji 🚀!");
		});

		it("should handle mixed case usernames", async () => {
			hubUserSpy.mockResolvedValue(mockUser1);

			const text = "Hello @testuser!";
			const mentions = [123];
			const mentionsPositions = [6];

			const result = await hydrateText(text, mentions, mentionsPositions);

			expect(result).toBe("Hello @testuser testuser!");
		});

		it("should handle mentions with special characters in usernames", async () => {
			hubUserSpy.mockResolvedValue(mockUser1);

			const text = "Hello @user!";
			const mentions = [123];
			const mentionsPositions = [6];

			const result = await hydrateText(text, mentions, mentionsPositions);

			expect(result).toBe("Hello @testuser user!");
		});
	});
});
