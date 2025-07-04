import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { mutuals } from "../routes/live";

describe("Stats Routes", () => {
    const app = new Elysia().use(mutuals);

    describe("should get mutuals", () => {
        const testCases = [
            { fid: 5650, expectedMutualsAtLeast: 109 }, // vitalik
            { fid: 37, expectedMutualsAtLeast: 53 }, // balajis
            { fid: 2, expectedMutualsAtLeast: 1000 }, // varun
            { fid: 3, expectedMutualsAtLeast: 5200 }, // dwr
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