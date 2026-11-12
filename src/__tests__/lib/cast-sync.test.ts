import "./../helpers/hub-env";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as haatzGateway from "../../lib/haatz-gateway";
import * as hubGrpc from "../../lib/hub-grpc";

const { syncCastsByFid, syncChannelFeed } = await import("../../lib/cast-sync");

const result = { casts: [], numNew: 0 } as Awaited<
	ReturnType<typeof haatzGateway.getHaatzCastsByFid>
>;

let haatz: ReturnType<typeof spyOn>;
let snapchain: ReturnType<typeof spyOn>;
let haatzFeed: ReturnType<typeof spyOn>;
let snapchainFeed: ReturnType<typeof spyOn>;

afterEach(() => {
	// only the spies this file's tests actually stubbed exist — a restoring
	// crash in afterEach marks every test in the file failed
	haatz?.mockRestore();
	snapchain?.mockRestore();
	haatzFeed?.mockRestore();
	snapchainFeed?.mockRestore();
});

const stubLegs = (
	haatzAnswer: () => Promise<unknown>,
	snapchainAnswer: () => Promise<unknown>,
) => {
	haatz = spyOn(haatzGateway, "getHaatzCastsByFid").mockImplementation(
		haatzAnswer as any,
	);
	snapchain = spyOn(hubGrpc, "getCastsByFid").mockImplementation(
		snapchainAnswer as any,
	);
};

describe("syncCastsByFid", () => {
	test("Hypersnap is primary — a hit never reaches Snapchain", async () => {
		stubLegs(
			async () => ({ ...result, casts: [{ fid: 1 }] as any }),
			async () => {
				throw new Error("Snapchain must not be called");
			},
		);

		const { casts } = await syncCastsByFid(1);

		expect(casts).toHaveLength(1);
		expect(snapchain).not.toHaveBeenCalled();
	});

	test("a clean Hypersnap miss consults Snapchain", async () => {
		stubLegs(
			async () => result,
			async () => ({ ...result, casts: [{ fid: 1 }] as any }),
		);

		const { casts } = await syncCastsByFid(1);

		expect(casts).toHaveLength(1);
	});

	test("a Hypersnap outage falls through to Snapchain", async () => {
		stubLegs(
			async () => {
				throw new Error("haatz gateway answered 500");
			},
			async () => result,
		);

		const { casts } = await syncCastsByFid(1);

		expect(casts).toEqual([]);
	});

	test("watermark and upsert options travel through to both legs", async () => {
		stubLegs(async () => result, async () => result);

		await syncCastsByFid(528, 500, 1759000000, { upsert: true });

		expect(haatz).toHaveBeenCalledWith(528, 500, 1759000000, {
			upsert: true,
		});
	});

	test("both worlds failing throws the outage — never a silent empty world", async () => {
		stubLegs(
			async () => {
				throw new Error("haatz down");
			},
			async () => {
				throw new Error("snapchain down");
			},
		);

		expect(syncCastsByFid(1)).rejects.toThrow(
			/outage.*haatz down.*snapchain down/s,
		);
	});
});

describe("syncChannelFeed", () => {
	test("Hypersnap is primary", async () => {
		haatzFeed = spyOn(haatzGateway, "getHaatzChannelFeed").mockImplementation(
			async () => ({ ...result, casts: [{ fid: 1 }] as any }),
		);
		snapchainFeed = spyOn(hubGrpc, "rawChannelFeed").mockImplementation(
			async () => {
				throw new Error("Snapchain must not be called");
			},
		);

		const { casts } = await syncChannelFeed("https://warpcast.com/~/channel/india");

		expect(casts).toHaveLength(1);
		expect(snapchainFeed).not.toHaveBeenCalled();
	});

	test("both worlds failing throws the outage", async () => {
		haatzFeed = spyOn(haatzGateway, "getHaatzChannelFeed").mockImplementation(
			async () => {
				throw new Error("haatz down");
			},
		);
		snapchainFeed = spyOn(hubGrpc, "rawChannelFeed").mockImplementation(
			async () => {
				throw new Error("snapchain down");
			},
		);

		expect(
			syncChannelFeed("https://warpcast.com/~/channel/india"),
		).rejects.toThrow(/outage/);
	});
});
