import "./../helpers/hub-env";
import { afterAll, beforeAll, describe, expect, it, spyOn, type Mock } from "bun:test";
import { MAX_SYNC_MESSAGES } from "../../constants";

// The sync leg is spied so no test ever reaches the live haatz gateway or
// hub — a real sync with upsert would write into the shared sqlite corpus
// other test files count on.

let processFids: typeof import("../../routes/refresh").processFids;
let syncCastsByFidSpy: Mock<(...args: any[]) => any>;
let getLatestCastTimestampsSpy: Mock<(...args: any[]) => any>;

describe("processFids", () => {
	beforeAll(async () => {
		({ processFids } = await import("../../routes/refresh"));

		// spyOn (not mock.module — that patches the global registry and leaks
		// into other test files' tests, since bun evaluates all files before
		// running any)
		const castSync = await import("../../lib/cast-sync");
		const sqlite = await import("../../lib/sqlite");
		syncCastsByFidSpy = spyOn(castSync, "syncCastsByFid");
		getLatestCastTimestampsSpy = spyOn(sqlite, "getLatestCastTimestamps");
	});

	afterAll(() => {
		syncCastsByFidSpy.mockRestore();
		getLatestCastTimestampsSpy.mockRestore();
	});

	it("passes the watermark for known fids", async () => {
		syncCastsByFidSpy.mockImplementation(async () => ({ casts: [], numNew: 0 }));
		getLatestCastTimestampsSpy.mockImplementation(
			async (fids: number[]) => new Map(fids.map((fid) => [fid, 1759000000])),
		);

		const stats = await processFids([528]);

		expect(stats.stats.totalFids).toBe(1);
		expect(stats.stats.failedFids).toBe(0);
		expect(syncCastsByFidSpy).toHaveBeenCalledWith(
			528,
			MAX_SYNC_MESSAGES,
			1759000000,
			{ upsert: true },
		);
	});

	it("passes no watermark for unknown fids", async () => {
		syncCastsByFidSpy.mockImplementation(async () => ({ casts: [], numNew: 0 }));
		getLatestCastTimestampsSpy.mockImplementation(async () => new Map());

		await processFids([617]);

		expect(syncCastsByFidSpy).toHaveBeenCalledWith(
			617,
			MAX_SYNC_MESSAGES,
			undefined,
			{ upsert: true },
		);
	});

	it("handles mixed known and unknown fids", async () => {
		syncCastsByFidSpy.mockImplementation(async () => ({ casts: [], numNew: 0 }));
		getLatestCastTimestampsSpy.mockImplementation(
			async (fids: number[]) =>
				new Map(fids.filter((fid) => fid === 2210).map((fid) => [fid, 1759123456])),
		);

		const stats = await processFids([2210, 4407]);

		expect(stats.success).toBe(true);
		expect(stats.stats.totalFids).toBe(2);
		expect(syncCastsByFidSpy).toHaveBeenCalledWith(
			2210,
			MAX_SYNC_MESSAGES,
			1759123456,
			{ upsert: true },
		);
		expect(syncCastsByFidSpy).toHaveBeenCalledWith(
			4407,
			MAX_SYNC_MESSAGES,
			undefined,
			{ upsert: true },
		);
	});

	it("counts a fid whose sync fails on both worlds, without failing the run", async () => {
		syncCastsByFidSpy.mockImplementation(async (fid: number) => {
			if (fid === 867) {
				throw new Error("cast sync outage for fid 867: haatz | snapchain");
			}
			return { casts: [], numNew: 0 };
		});
		getLatestCastTimestampsSpy.mockImplementation(async () => new Map());

		const stats = await processFids([867, 309]);

		expect(stats.success).toBe(true);
		expect(stats.stats.totalFids).toBe(2);
		expect(stats.stats.failedFids).toBe(1);
	});
});
