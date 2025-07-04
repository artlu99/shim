import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { fu } from "../routes/f-u";

describe("F-U Routes", () => {
    const app = new Elysia().use(fu);

    describe("should get username by fid", () => {
        const testCases = [
            { fid: 2, expectedUsername: "varunsrin.eth" },
            { fid: 3, expectedUsername: "dwr.eth" },
            { fid: 1689, expectedUsername: "stephancill.eth" }
        ];

        for (const { fid, expectedUsername } of testCases) {
            it(`should get username "${expectedUsername}" for fid ${fid}`, async () => {
                const response = await app.handle(
                    new Request(`http://localhost/u/${fid}`)
                );
                const data = await response.json();

                expect(response.status).toBe(200);
                expect(data.success).toBe(true);
                expect(data.username).toBe(expectedUsername);
            });
        }
    });

    it("should get fid by username", async () => {
        const testCases = [
            { username: "v", expectedFid: 2 }, // note: ENS and username do not match
            { username: "dwr.eth", expectedFid: 3 },
            { username: "stephancill", expectedFid: 1689 } // note: no ENS
        ];

        for (const { username, expectedFid } of testCases) {
            it(`should get fid "${expectedFid}" for username "${username}"`, async () => {
                const response = await app.handle(
                    new Request(`http://localhost/f/${username}`)
                );
                const data = await response.json();

                expect(response.status).toBe(200);
                expect(data.success).toBe(true);
                expect(data.fid).toBe(expectedFid);
            });
        }
    });
}); 