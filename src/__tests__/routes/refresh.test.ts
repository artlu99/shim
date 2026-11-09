import { afterAll, beforeAll, describe, expect, it, spyOn, type Mock } from "bun:test";
import { MAX_SYNC_MESSAGES } from "../../constants";

// Stubs must be in place before the dynamic imports in beforeAll run:
// hub-grpc throws at import time without HUB_GRPC_ENDPOINT. HUB_GRPC_DISABLED=1
// selects the no-client path so this file does not dial a hub.
process.env.HUB_GRPC_ENDPOINT ??= "grpc://localhost:2283";
process.env.HUB_GRPC_DISABLED = "1";

let processFids: typeof import("../../routes/refresh").processFids;
let getCastsByFidSpy: Mock<(...args: any[]) => any>;
let getLatestCastTimestampsSpy: Mock<(...args: any[]) => any>;

describe("processFids", () => {
	beforeAll(async () => {
		({ processFids } = await import("../../routes/refresh"));

		// spyOn (not mock.module — that patches the global registry and leaks
		// into other test files' tests, since bun evaluates all files before
		// running any)
		const hubGrpc = await import("../../lib/hub-grpc");
		const sqlite = await import("../../lib/sqlite");
		getCastsByFidSpy = spyOn(hubGrpc, "getCastsByFid");
		getLatestCastTimestampsSpy = spyOn(sqlite, "getLatestCastTimestamps");
	});

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
		expect(getCastsByFidSpy).toHaveBeenCalledWith(
			528,
			MAX_SYNC_MESSAGES,
			1759000000,
			{ upsert: true },
		);
	});

	it("passes no watermark for unknown fids", async () => {
		getCastsByFidSpy.mockImplementation(async () => ({ casts: [], numNew: 0 }));
		getLatestCastTimestampsSpy.mockImplementation(async () => new Map());

		await processFids([617]);

		expect(getCastsByFidSpy).toHaveBeenCalledWith(
			617,
			MAX_SYNC_MESSAGES,
			undefined,
			{ upsert: true },
		);
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
		expect(getCastsByFidSpy).toHaveBeenCalledWith(
			2210,
			MAX_SYNC_MESSAGES,
			1759123456,
			{ upsert: true },
		);
		expect(getCastsByFidSpy).toHaveBeenCalledWith(
			4407,
			MAX_SYNC_MESSAGES,
			undefined,
			{ upsert: true },
		);
	});
});
