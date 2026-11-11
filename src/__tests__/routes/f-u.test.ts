import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { fu } from "../../routes/f-u";

// Live hub and Warpcast answers. A cache does not make these meaningful.
const describeLive = process.env.LIVE === "1" ? describe : describe.skip;

describeLive("F-U Routes", () => {
	const app = new Elysia().use(fu);

	describe("GET /u/:fid", () => {
		it("should get username by fid successfully", async () => {
			// /u answers the hub preferred name (USER_DATA_TYPE_USERNAME)
			const testCases = [
				{ fid: 2, expectedUsername: "v" },
				{ fid: 3, expectedUsername: "dwr" },
				{ fid: 1689, expectedUsername: "stephancill" },
				{ fid: 230238, expectedUsername: "mvr" },
			];

			for (const { fid, expectedUsername } of testCases) {
				const response = await app.handle(
					new Request(`http://localhost/u/${fid}`),
				);
				const data = await response.json();

				expect(response.status).toBe(200);
				expect(data.success).toBe(true);
				expect(data.username).toBe(expectedUsername);
			}
		});

		it("should handle non-existent fid", async () => {
			const response = await app.handle(
				new Request("http://localhost/u/9999999"),
			);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.username).toBeUndefined();
		});
	});

	describe("GET /f/:username", () => {
		it("should get fid by username successfully", async () => {
			const testCases = [
				{ username: "v", expectedFid: 2 },
				{ username: "danromero.eth", expectedFid: 3 },
				{ username: "stephancill", expectedFid: 1689 },
				{ username: "mvr", expectedFid: 230238 },
			];

			for (const { username, expectedFid } of testCases) {
				const response = await app.handle(
					new Request(`http://localhost/f/${username}`),
				);
				const data = await response.json();

				expect(response.status).toBe(200);
				expect(data.success).toBe(true);
				expect(data.fid).toBe(expectedFid);
			}
		});

		it("should handle non-existent username", async () => {
			const response = await app.handle(
				new Request("http://localhost/f/nonexistentuser12345"),
			);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.fid).toBeUndefined();
		});
	});

	describe("GET /user/:fid", () => {
		it("should get hydrated user by fid successfully", async () => {
			const testCases = [
				// /user.username is the same hub preferred name /u returns.
				// mvr's newest proof is warpl.eth; that stays an attestation.
				{ fid: 2, expectedUsername: "v" },
				{ fid: 3, expectedUsername: "dwr" },
				{ fid: 1689, expectedUsername: "stephancill" },
				{
					fid: 230238,
					expectedUsername: "mvr",
					expectedFname: "mvr",
					expectedAttestations: ["warpl.eth", "martinvr.eth"],
				},
			];

			for (const {
				fid,
				expectedUsername,
				expectedFname,
				expectedAttestations,
			} of testCases) {
				const response = await app.handle(
					new Request(`http://localhost/user/${fid}`),
				);
				const data = await response.json();

				expect(response.status).toBe(200);
				expect(data.success).toBe(true);
				expect(data.user).toBeDefined();
				expect(data.user.fid).toBe(fid);
				expect(data.user.username).toBe(expectedUsername);
				if (expectedFname) {
					expect(data.user.fname).toBe(expectedFname);
					expect(data.user.attestations).toEqual(expectedAttestations);
				}
				expect(typeof data.user.displayName).toBe("string");
				expect(typeof data.user.pfpUrl).toBe("string");
				expect(typeof data.user.primaryAddress).toBe("string");
				expect(data.user).not.toHaveProperty("proNft");
			}
		});
	});

	describe("Edge cases and error handling", () => {
		it("should handle unknown users", async () => {
			const response = await app.handle(
				new Request("http://localhost/user/9999999"),
			);
			const data = await response.json();

			expect(response.status).toBe(200);
			expect(data.success).toBe(true);
			expect(data.user.fid).toBe(9999999);
			expect(data.user.username).toBe(null);
		});
	});
});
