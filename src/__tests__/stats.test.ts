import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { mutuals } from "../routes/live";

describe("Stats Routes", () => {
    const app = new Elysia().use(mutuals);

    describe("should get mutuals", () => {
        const testCases = [
            { fid1: 3, fid2: 1689, expectedMutualsAtLeast: 800 },
        ];

        for (const { fid1, fid2, expectedMutualsAtLeast } of testCases) {
            it(`should get mutuals for fids ${fid1} and ${fid2}`, async () => {
                const response = await app.handle(
                    new Request(`http://localhost/mutuals/${fid1}/${fid2}`)
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