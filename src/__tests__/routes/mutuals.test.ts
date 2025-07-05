import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { mutuals } from "../../routes/mutuals";

describe("Mutuals Routes", () => {
    const app = new Elysia().use(mutuals);

    describe("should check mutuals", () => {
        const testCases = [
            { fid: 5650, expectedMutuals: 109 }, // vitalik
            { fid: 37, expectedMutuals: 53 }, // balajis
            { fid: 2, expectedMutuals: 1490 }, // varun
            { fid: 3, expectedMutuals: 3942 }, // dwr
        ];

        for (const { fid, expectedMutuals } of testCases) {
            it(`should get mutuals for fid ${fid}`, async () => {
                const response = await app.handle(
                    new Request(`http://localhost/mutuals/${fid}`)
                );
                const data = await response.json();

                expect(response.status).toBe(200);
                expect(data.success).toBe(true);
                expect(data.mutuals.count).toBe(expectedMutuals);
                expect(data.mutuals.fids.length).toBeGreaterThanOrEqual(expectedMutuals);
            });
        }
    });

    describe("should check mutual status between two fids", () => {
        it("should check if vitalik and dwr are mutuals", async () => {
            const response = await app.handle(
                new Request("http://localhost/checkMutuals/5650/3")
            );
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(typeof data.isMutual).toBe("boolean");
            // We know vitalik and dwr should be mutuals based on the existing test data
            expect(data.isMutual).toBe(true);
        });

        it("should check if varun and artlu are not mutuals", async () => {
            const response = await app.handle(
                new Request("http://localhost/checkMutuals/2/6546")
            );
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(typeof data.isMutual).toBe("boolean");
            // We know varun and artlu should not be mutuals based on the existing test data
            expect(data.isMutual).toBe(false);
        });

        it("should check mutual status in reverse order", async () => {
            const response = await app.handle(
                new Request("http://localhost/checkMutuals/3/5650")
            );
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(typeof data.isMutual).toBe("boolean");
            // Should be the same result regardless of order
            expect(data.isMutual).toBe(true);
        });

        it("should handle non-mutual users", async () => {
            const response = await app.handle(
                new Request("http://localhost/checkMutuals/37/6546")
            );
            const data = await response.json();

            expect(response.status).toBe(200);
            expect(data.success).toBe(true);
            expect(typeof data.isMutual).toBe("boolean");
            // balajis and artlu should not be mutuals
            expect(data.isMutual).toBe(false);
        });
    });

    describe("should fail on edge cases", () => {
        it("same fid for both parameters", async () => {
            const response = await app.handle(
                new Request("http://localhost/checkMutuals/5650/5650")
            );

            expect(response.status).toBe(500);
        });

    });

}); 