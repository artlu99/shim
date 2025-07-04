import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { fu } from "../../routes/f-u";

describe("F-U Routes", () => {
    const app = new Elysia().use(fu);

    describe("GET /u/:fid", () => {
        it("should get username by fid successfully", async () => {
            const testCases = [
                { fid: 2, expectedUsername: "varunsrin.eth" },
                { fid: 3, expectedUsername: "dwr.eth" },
                { fid: 1689, expectedUsername: "stephancill.eth" }
            ];

            for (const { fid, expectedUsername } of testCases) {
                const response = await app.handle(
                    new Request(`http://localhost/u/${fid}`)
                );
                const data = await response.json();

                expect(response.status).toBe(200);
                expect(data.success).toBe(true);
                expect(data.username).toBe(expectedUsername);
            }
        });

        it("should handle non-existent fid", async () => {
            const response = await app.handle(
                new Request("http://localhost/u/9999999")
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
                { username: "dwr.eth", expectedFid: 3 },
                { username: "stephancill", expectedFid: 1689 }
            ];

            for (const { username, expectedFid } of testCases) {
                const response = await app.handle(
                    new Request(`http://localhost/f/${username}`)
                );
                const data = await response.json();

                expect(response.status).toBe(200);
                expect(data.success).toBe(true);
                expect(data.fid).toBe(expectedFid);
            }
        });

        it("should handle non-existent username", async () => {
            const response = await app.handle(
                new Request("http://localhost/f/nonexistentuser12345")
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
                { fid: 2, expectedUsername: "varunsrin.eth" },
                { fid: 3, expectedUsername: "dwr.eth" },
                { fid: 1689, expectedUsername: "stephancill.eth" }
            ];

            for (const { fid, expectedUsername } of testCases) {
                const response = await app.handle(
                    new Request(`http://localhost/user/${fid}`)
                );
                const data = await response.json();

                expect(response.status).toBe(200);
                expect(data.success).toBe(true);
                expect(data.user).toBeDefined();
                expect(data.user.fid).toBe(fid);
                expect(data.user.username).toBe(expectedUsername);
                expect(typeof data.user.displayName).toBe("string");
                expect(typeof data.user.pfpUrl).toBe("string");
                expect(typeof data.user.primaryAddress).toBe("string");
                expect(typeof data.user.proNft.order).toBe("number");
            }
        });
    });

    describe("Edge cases and error handling", () => {

        it("should handle unknown users", async () => {
            const response = await app.handle(
                new Request("http://localhost/user/9999999")
            );
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.user.fid).toBe(9999999);
            expect(data.user.username).toBe(null);
        });
    });
}); 