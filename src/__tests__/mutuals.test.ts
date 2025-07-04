import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { mutuals } from "../routes/live";

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

}); 