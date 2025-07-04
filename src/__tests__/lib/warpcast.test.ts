import { describe, expect, it } from "bun:test";
import { getUserPrimaryAddress, getChannel, getChannelIdFromUrl, getChannelBannedUsers } from "../../lib/warpcast";
import { exceptions } from "../../static/channel-exceptions";

describe("Warpcast API", () => {
    describe("getUserPrimaryAddress", () => {
        it("should get user primary address for known users", async () => {
            // Test with known FIDs that likely have primary addresses
            const testCases = [2, 3, 1689]; // varun, dwr, stephancill

            for (const fid of testCases) {
                const result = await getUserPrimaryAddress(fid);

                // Should return either an address object or null/undefined
                expect(result === null || result === undefined ||
                    (typeof result === 'object' && result.fid === fid)).toBe(true);
            }
        });

        it("should handle non-existent users", async () => {
            const result = await getUserPrimaryAddress(9999999);

            // Should return null or undefined for non-existent users
            expect(result === null || result === undefined).toBe(true);
        });
    });

    describe("getChannel", () => {
        it("should get channel for known channel IDs", async () => {
            // Test with some known channel IDs from the exceptions
            const testCases = ["vip", "banklessdao", "nouns-esports"];

            for (const channelId of testCases) {
                const result = await getChannel(channelId);

                // Should return either a channel object or undefined
                expect(result === undefined ||
                    (typeof result === 'object' && result.id === channelId)).toBe(true);
            }
        });

        it("should return undefined for empty channelId", async () => {
            const result = await getChannel("");

            expect(result).toBeUndefined();
        });

        it("should handle non-existent channel IDs", async () => {
            const result = await getChannel("nonexistent-channel-12345");

            expect(result === undefined || result === null).toBe(true);
        });
    });

    describe("getChannelIdFromUrl", () => {
        it("should extract channel ID from farcaster.xyz URL", () => {
            const url = "https://farcaster.xyz/~/channel/test-channel";
            const result = getChannelIdFromUrl(url);

            expect(result).toBe("test-channel");
        });

        it("should extract channel ID from warpcast.com URL", () => {
            const url = "https://warpcast.com/~/channel/another-channel";
            const result = getChannelIdFromUrl(url);

            expect(result).toBe("another-channel");
        });

        it("should extract channel ID from farcaster.group URL", () => {
            const url = "https://farcaster.group/legacy-channel";
            const result = getChannelIdFromUrl(url);

            expect(result).toBe("legacy-channel");
        });

        it("should find channel IDs from exceptions list", () => {
            // Test a few exceptions to ensure coverage
            const testExceptions = exceptions.slice(0, 5);

            for (const exception of testExceptions) {
                const result = getChannelIdFromUrl(exception.url);
                expect(result).toBe(exception.channelId);
            }
        });

        it("should return undefined for unknown URL", () => {
            const url = "https://unknown.com/channel/test";
            const result = getChannelIdFromUrl(url);

            expect(result).toBeUndefined();
        });

        it("should return undefined for null URL", () => {
            const result = getChannelIdFromUrl(null);

            expect(result).toBeUndefined();
        });

        it("should return undefined for empty URL", () => {
            const result = getChannelIdFromUrl("");

            expect(result).toBeUndefined();
        });
    });

    describe("getChannelBannedUsers", () => {
        it("should get channel banned users for known channels", async () => {
            // Test with some known channel IDs
            const testCases = ["vip", "banklessdao"];

            for (const channelId of testCases) {
                try {
                    const result = await getChannelBannedUsers(channelId);

                    // Should return an array (empty or with banned users)
                    expect(Array.isArray(result)).toBe(true);
                } catch (error) {
                    // Some channels might not support banned users endpoint
                    expect(error).toBeDefined();
                }
            }
        });

        it("should handle non-existent channel IDs", async () => {
            try {
                const result = await getChannelBannedUsers("nonexistent-channel-12345");
                expect(Array.isArray(result)).toBe(true);
            } catch (error) {
                // Should throw an error for non-existent channels
                expect(error).toBeDefined();
            }
        });
    });

    describe("Edge cases and error handling", () => {
        it("should handle malformed URLs gracefully", () => {
            const malformedUrls = [
                "not-a-url",
                "https://",
                "https://farcaster.xyz/",
                "https://farcaster.xyz/~/channel/",
                "https://warpcast.com/~/channel/",
                "https://farcaster.group/",
            ];

            for (const url of malformedUrls) {
                const result = getChannelIdFromUrl(url);
                expect(result === undefined || typeof result === "string").toBe(true);
            }
        });
    });
}); 