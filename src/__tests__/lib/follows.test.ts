import { describe, expect, it } from "bun:test";
import { getFollowingByFid } from "../../lib/hub-api";

describe("follows", () => {
	it("should get follows by fid", async () => {
		const testCases = [
			{ fid: 2, expectedFollows: 1854 },
			{ fid: 3, expectedFollows: 77 },
			{ fid: 1689, expectedFollows: 1424 },
			{ fid: 6546, expectedFollows: 0 },
		];

		for (const { fid, expectedFollows } of testCases) {
			const follows = await getFollowingByFid(fid);
			expect(follows.length).toBeGreaterThanOrEqual(expectedFollows - 10);
			expect(follows.length).toBeLessThanOrEqual(expectedFollows + 10);
		}
	});
});
