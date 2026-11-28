import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as haatzGateway from "../../lib/haatz-gateway";

const { syncCastsByFid, syncChannelFeed } = await import("../../lib/cast-sync");

const result = { casts: [], numNew: 0 } as Awaited<
	ReturnType<typeof haatzGateway.getHaatzCastsByFid>
>;

let haatz: ReturnType<typeof spyOn>;
let haatzFeed: ReturnType<typeof spyOn>;

afterEach(() => {
	haatz?.mockRestore();
	haatzFeed?.mockRestore();
});

describe("syncCastsByFid", () => {
	test("returns the Hypersnap answer", async () => {
		haatz = spyOn(haatzGateway, "getHaatzCastsByFid").mockImplementation(
			async () => ({ ...result, casts: [{ fid: 1 }] as any }),
		);

		const { casts } = await syncCastsByFid(1);

		expect(casts).toHaveLength(1);
		expect(haatz).toHaveBeenCalledWith(1, undefined, undefined, undefined);
	});

	test("a clean empty Hypersnap answer is the miss", async () => {
		haatz = spyOn(haatzGateway, "getHaatzCastsByFid").mockImplementation(
			async () => result,
		);

		const { casts } = await syncCastsByFid(1);

		expect(casts).toEqual([]);
	});

	test("watermark and upsert options travel through", async () => {
		haatz = spyOn(haatzGateway, "getHaatzCastsByFid").mockImplementation(
			async () => result,
		);

		await syncCastsByFid(528, 500, 1759000000, { upsert: true });

		expect(haatz).toHaveBeenCalledWith(528, 500, 1759000000, {
			upsert: true,
		});
	});

	test("a Hypersnap outage throws — never a silent empty world", async () => {
		haatz = spyOn(haatzGateway, "getHaatzCastsByFid").mockImplementation(
			async () => {
				throw new Error("haatz down");
			},
		);

		expect(syncCastsByFid(1)).rejects.toThrow(
			/cast sync outage for fid 1: haatz down/,
		);
	});

	test("native fids use the same Hypersnap path", async () => {
		const NATIVE_FID = 4294967296;
		haatz = spyOn(haatzGateway, "getHaatzCastsByFid").mockImplementation(
			async () => result,
		);

		const { casts } = await syncCastsByFid(NATIVE_FID);

		expect(casts).toEqual([]);
		expect(haatz).toHaveBeenCalledWith(
			NATIVE_FID,
			undefined,
			undefined,
			undefined,
		);
	});
});

describe("syncChannelFeed", () => {
	test("returns the Hypersnap answer", async () => {
		haatzFeed = spyOn(haatzGateway, "getHaatzChannelFeed").mockImplementation(
			async () => ({ ...result, casts: [{ fid: 1 }] as any }),
		);

		const { casts } = await syncChannelFeed(
			"https://warpcast.com/~/channel/india",
		);

		expect(casts).toHaveLength(1);
		expect(haatzFeed).toHaveBeenCalledWith(
			"https://warpcast.com/~/channel/india",
			undefined,
		);
	});

	test("a clean empty Hypersnap answer is the miss", async () => {
		haatzFeed = spyOn(haatzGateway, "getHaatzChannelFeed").mockImplementation(
			async () => result,
		);

		const { casts } = await syncChannelFeed(
			"https://warpcast.com/~/channel/india",
		);

		expect(casts).toEqual([]);
	});

	test("a Hypersnap outage throws — never a silent empty channel", async () => {
		haatzFeed = spyOn(haatzGateway, "getHaatzChannelFeed").mockImplementation(
			async () => {
				throw new Error("haatz down");
			},
		);

		expect(
			syncChannelFeed("https://warpcast.com/~/channel/india"),
		).rejects.toThrow(/channel feed outage.*haatz down/s);
	});
});
