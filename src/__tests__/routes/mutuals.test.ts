import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { mutuals } from "../../routes/live";

describe("Mutuals Routes", () => {
    const app = new Elysia().use(mutuals);

    describe("should check mutuals", () => {
        const testCases = [
            { fid: 5650, expectedMutualsAtLeast: 100 }, // vitalik
            { fid: 37, expectedMutualsAtLeast: 50 }, // balajis
            { fid: 2, expectedMutualsAtLeast: 1400 }, // varun
            { fid: 3, expectedMutualsAtLeast: 3700 }, // dwr
        ];

        for (const { fid, expectedMutualsAtLeast } of testCases) {
            it(`should get mutuals for fid ${fid}`, async () => {
                const response = await app.handle(
                    new Request(`http://localhost/mutuals/${fid}`)
                );
                const data = await response.json();

                expect(response.status).toBe(200);
                expect(data.success).toBe(true);
                expect(data.mutuals.count).toBeGreaterThanOrEqual(expectedMutualsAtLeast);
                expect(data.mutuals.fids.length).toBeGreaterThanOrEqual(expectedMutualsAtLeast);
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