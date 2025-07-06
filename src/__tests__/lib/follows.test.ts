import { describe, expect, it } from "bun:test";
import { getFollowingByFid } from "../../lib/hub-api";
import { getMutuals } from "../../lib/mutuals";

describe("follows", () => {
    it("should get follows by fid", async () => {
        const testCases = [
            { fid: 2, expectedFollows: 1680 },
            { fid: 3, expectedFollows: 4292 },
            { fid: 1689, expectedFollows: 1342 },
            { fid: 6546, expectedFollows: 0 }
        ];

        for (const { fid, expectedFollows } of testCases) {
            const follows = await getFollowingByFid(fid);
            expect(follows.length).toBeGreaterThanOrEqual(expectedFollows - 10);
            expect(follows.length).toBeLessThanOrEqual(expectedFollows + 10);
        }
    });
});

describe("mutuals", () => {
    it("should get mutuals", async () => {
        const res = await getMutuals(5650);
        expect(res.includes(3)).toBe(true);
    })

    it("should not be mutuals", async () => {
        const res = await getMutuals(2);
        expect(res.includes(6546)).toBe(false);
    })

})

