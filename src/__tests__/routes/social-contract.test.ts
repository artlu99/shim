import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { socialContract } from "../../routes/social-contract";

describe("Social Contract Routes", () => {
	const app = new Elysia().use(socialContract);

	describe("GET /signed/:fid", () => {
		// live suite: cold lmdis caches fan each fid out over the hub
		// (verifications) + Base RPC (balanceOf) — well past bun's 5s default
		it(
			"should get social contract signature by fid",
			async () => {
				const testCases = [
				// live values at authoring time — these drift as accounts sign
				{ fid: 2, expectedSigned: true }, // varun (yes)
				// dwr (yes — minted to non-primary verified address 0x187c…8899;
				// false-negatived by the old primary-only check)
				{ fid: 3, expectedSigned: true },
				{ fid: 194, expectedSigned: true }, // rish (yes)
				{ fid: 2904, expectedSigned: false }, // wake (no)
				{ fid: 3854, expectedSigned: true }, // darrylyeo (yes)
				{ fid: 4877, expectedSigned: false }, // trish (no)
				{ fid: 6546, expectedSigned: false }, // artlu (no)
				{ fid: 8004, expectedSigned: true }, // justin ahn (yes)
				{ fid: 10215, expectedSigned: true }, // zoo (yes)
				{ fid: 3319217, expectedSigned: false }, // decent-artlu (no)
				// no user data / no primary address at authoring time
				{ fid: 192274, expectedSigned: false },
			];

			for (const { fid, expectedSigned } of testCases) {
				const response = await app.handle(
					new Request(`http://localhost/signed/${fid}`),
				);
				const data = await response.json();

				expect(response.status).toBe(200);
				expect(data.success).toBe(true);
				expect(data.signed).toBe(expectedSigned);
			}
			},
			60_000,
		);
	});
});
