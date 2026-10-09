import { afterAll, describe, expect, it, spyOn } from "bun:test";
import * as hubGrpc from "../../lib/hub-grpc";
import * as postgres from "../../lib/postgres";
import { processFids } from "../../routes/refresh";

// spyOn (not mock.module — that patches the global registry and leaks into
// other test files' tests, since bun evaluates all files before running any)
const getCastsByFidSpy = spyOn(hubGrpc, "getCastsByFid");
const getLatestCastTimestampsSpy = spyOn(postgres, "getLatestCastTimestamps");

describe("processFids", () => {
	afterAll(() => {
		getCastsByFidSpy.mockRestore();
		getLatestCastTimestampsSpy.mockRestore();
	});

	it("passes the watermark for known fids", async () => {
		getCastsByFidSpy.mockImplementation(async () => ({ casts: [], numNew: 0 }));
		getLatestCastTimestampsSpy.mockImplementation(
			async (fids: number[]) => new Map(fids.map((fid) => [fid, 1759000000])),
		);

		const stats = await processFids([528]);

		expect(stats.stats.totalFids).toBe(1);
		expect(getCastsByFidSpy).toHaveBeenCalledWith(528, 500, 1759000000);
	});

	it("passes no watermark for unknown fids", async () => {
		getCastsByFidSpy.mockImplementation(async () => ({ casts: [], numNew: 0 }));
		getLatestCastTimestampsSpy.mockImplementation(async () => new Map());

		await processFids([617]);

		expect(getCastsByFidSpy).toHaveBeenCalledWith(617, 500, undefined);
	});

	it("handles mixed known and unknown fids", async () => {
		getCastsByFidSpy.mockImplementation(async () => ({ casts: [], numNew: 0 }));
		getLatestCastTimestampsSpy.mockImplementation(
			async (fids: number[]) =>
				new Map(fids.filter((fid) => fid === 2210).map((fid) => [fid, 1759123456])),
		);

		const stats = await processFids([2210, 4407]);

		expect(stats.success).toBe(true);
		expect(stats.stats.totalFids).toBe(2);
		expect(getCastsByFidSpy).toHaveBeenCalledWith(2210, 500, 1759123456);
		expect(getCastsByFidSpy).toHaveBeenCalledWith(4407, 500, undefined);
	});
});
