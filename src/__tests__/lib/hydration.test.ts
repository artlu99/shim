import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import {
    getSentFromBySignerKey,
    getUserByFid,
    hydrateText,
} from "../../lib/hydration";
import type { ProNftDetails, User } from "../../types";

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
        timestamp: 1234567890,
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
        timestamp: 1234567890,
        fid: mockFid + 1,
    },
};

// Create mock functions that we can reference
const mockGetHubUserByFid = mock(() => Promise.resolve(null as User | null));
const mockGetProNftDetails = mock(() => Promise.resolve(null as ProNftDetails | null));
const mockGetUserPrimaryAddress = mock(() => Promise.resolve(null as `0x${string}` | null));

describe("Hydration Functions", () => {
    beforeAll(() => {
        // Mock the modules with our mock functions
        mock.module("../../lib/hub-api", () => ({
            getHubUserByFid: mockGetHubUserByFid,
        }));
        mock.module("../../lib/pro-nft", () => ({
            getProNftDetails: mockGetProNftDetails,
        }));
        mock.module("../../lib/warpcast", () => ({
            getUserPrimaryAddress: mockGetUserPrimaryAddress,
        }));
    });

    beforeEach(() => {
        // Clear all mock state
        mockGetHubUserByFid.mockClear();
        mockGetProNftDetails.mockClear();
        mockGetUserPrimaryAddress.mockClear();

        // Set default mock implementations to return null/undefined
        mockGetHubUserByFid.mockResolvedValue(null);
        mockGetProNftDetails.mockResolvedValue(null);
        mockGetUserPrimaryAddress.mockResolvedValue(null);
    });

    afterAll(() => {
        // Restore all mocks
        mock.restore();
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
            };

            mockGetHubUserByFid.mockResolvedValue(mockHubUser);
            mockGetUserPrimaryAddress.mockResolvedValue(mockPrimaryAddress);
            mockGetProNftDetails.mockResolvedValue(mockProNftDetails);

            const result = await getUserByFid(123);

            expect(mockGetHubUserByFid).toHaveBeenCalledWith(123);
            expect(mockGetUserPrimaryAddress).toHaveBeenCalledWith(123);
            expect(mockGetProNftDetails).toHaveBeenCalledWith(123);

            expect(result).toEqual({
                fid: 123,
                username: "testuser",
                displayName: "Test User",
                pfpUrl: "https://example.com/pfp.jpg",
                bio: "Test bio",
                primaryAddress: null,
                proNft: {
                    order: 1,
                    timestamp: 1234567890,
                },
            });
        });

        it("should handle missing hub user data", async () => {
            mockGetHubUserByFid.mockResolvedValue(null);
            mockGetUserPrimaryAddress.mockResolvedValue(null);
            mockGetProNftDetails.mockResolvedValue(null);

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

            mockGetHubUserByFid.mockResolvedValue(mockHubUser);
            mockGetUserPrimaryAddress.mockResolvedValue(null);
            mockGetProNftDetails.mockResolvedValue(null);

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

            mockGetHubUserByFid.mockResolvedValue(mockHubUser);
            mockGetUserPrimaryAddress.mockResolvedValue(null);
            mockGetProNftDetails.mockResolvedValue(null);

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

            mockGetHubUserByFid.mockResolvedValue(mockHubUser);
            mockGetUserPrimaryAddress.mockResolvedValue(null);
            mockGetProNftDetails.mockResolvedValue(null);

            const result = await getUserByFid(123);

            expect(result.proNft).toBeNull();
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

            mockGetHubUserByFid.mockResolvedValue(mockUser);

            const text = "Hello @world!";
            const mentions = [123];
            const mentionsPositions = [6]; // Position of '@' in "Hello @world!"

            const result = await hydrateText(text, mentions, mentionsPositions);

            expect(mockGetHubUserByFid).toHaveBeenCalledWith(123);
            expect(result).toBe("Hello @testuser world!");
        });

        it("should hydrate text with multiple mentions", async () => {
            mockGetHubUserByFid
                .mockResolvedValueOnce(mockUser1)
                .mockResolvedValueOnce(mockUser2);

            const text = "Hello @user1 and @user2!";
            const mentions = [123, 456];
            const mentionsPositions = [6, 16]; // Positions of '@' characters

            const result = await hydrateText(text, mentions, mentionsPositions);

            expect(mockGetHubUserByFid).toHaveBeenCalledWith(123);
            expect(mockGetHubUserByFid).toHaveBeenCalledWith(456);
            expect(result).toBe("Hello @testuser user1 and@user2 @user2!");
        });

        it("should handle mentions in different order than positions", async () => {
            mockGetHubUserByFid
                .mockResolvedValueOnce(mockUser1)
                .mockResolvedValueOnce(mockUser2);

            const text = "Hello @user2 and @user1!";
            const mentions = [123, 456]; // user1, user2
            const mentionsPositions = [16, 6]; // user2 position, user1 position (reversed)

            const result = await hydrateText(text, mentions, mentionsPositions);

            expect(result).toBe("Hello @user2 user2 and@testuser @user1!");
        });

        it("should handle unknown users with <unknown> placeholder", async () => {
            mockGetHubUserByFid.mockResolvedValue(null);

            const text = "Hello @unknown!";
            const mentions = [999];
            const mentionsPositions = [6];

            const result = await hydrateText(text, mentions, mentionsPositions);

            expect(result).toBe("Hello @<unknown> unknown!");
        });

        it("should handle mentions at the beginning of text", async () => {
            mockGetHubUserByFid.mockResolvedValue(mockUser1);

            const text = "@testuser Hello world!";
            const mentions = [123];
            const mentionsPositions = [0];

            const result = await hydrateText(text, mentions, mentionsPositions);

            expect(result).toBe("@testuser testuser Hello world!");
        });

        it("should handle mentions at the end of text", async () => {
            mockGetHubUserByFid.mockResolvedValue(mockUser1);

            const text = "Hello world! @testuser";
            const mentions = [123];
            const mentionsPositions = [13]; // Position of '@' at the end

            const result = await hydrateText(text, mentions, mentionsPositions);

            expect(result).toBe("Hello world! @testuser testuser");
        });

        it("should handle consecutive mentions", async () => {
            mockGetHubUserByFid
                .mockResolvedValueOnce(mockUser1)
                .mockResolvedValueOnce(mockUser2);

            const text = "Hello @user1@user2!";
            const mentions = [123, 456];
            const mentionsPositions = [6, 12]; // Consecutive positions

            const result = await hydrateText(text, mentions, mentionsPositions);

            expect(result).toBe("Hello @testuser user1@user2 user2!");
        });

        it("should handle unicode characters correctly", async () => {
            mockGetHubUserByFid.mockResolvedValue(mockUser1);

            const text = "Hello @user with emoji 🚀!";
            const mentions = [123];
            const mentionsPositions = [6];

            const result = await hydrateText(text, mentions, mentionsPositions);

            expect(result).toBe("Hello @testuser user with emoji 🚀!");
        });

        it("should handle mixed case usernames", async () => {
            mockGetHubUserByFid.mockResolvedValue(mockUser1);

            const text = "Hello @testuser!";
            const mentions = [123];
            const mentionsPositions = [6];

            const result = await hydrateText(text, mentions, mentionsPositions);

            expect(result).toBe("Hello @testuser testuser!");
        });

        it("should handle mentions with special characters in usernames", async () => {
            mockGetHubUserByFid.mockResolvedValue(mockUser1);

            const text = "Hello @user!";
            const mentions = [123];
            const mentionsPositions = [6];

            const result = await hydrateText(text, mentions, mentionsPositions);

            expect(result).toBe("Hello @testuser user!");
        });
    });
});
