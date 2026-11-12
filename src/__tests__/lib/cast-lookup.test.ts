import "./../helpers/hub-env";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as hubGrpc from "../../lib/hub-grpc";
import * as hypersnap from "../../lib/hypersnap";

const { getCastInEitherWorld } = await import("../../lib/cast-lookup");

const HASH = `0x${"a".repeat(40)}` as `0x${string}`;

const cast = (fid: number) => ({
	fid,
	hash: HASH,
	text: "hi",
	rawText: "hi",
	embeds: [],
	mentions: [],
	mentionsPositions: [],
	parentCastId: undefined,
	parentUrl: undefined,
	timestamp: 0,
	signer: "" as `0x${string}`,
});

const originalFetch = globalThis.fetch;

let snapchain: ReturnType<typeof spyOn>;
let hypersnapCast: ReturnType<typeof spyOn>;

afterEach(() => {
	snapchain.mockRestore();
	hypersnapCast.mockRestore();
	globalThis.fetch = originalFetch;
});

// every test re-stubs both legs, so each test states the full world: what
// each network answers (cast, undefined = clean miss, or a throw = outage)
type Answer = () => Promise<ReturnType<typeof cast> | undefined>;
const stubWorlds = (snapchainAnswer: Answer, hypersnapAnswer: Answer) => {
	snapchain = spyOn(hubGrpc, "getCastById").mockImplementation(snapchainAnswer);
	hypersnapCast = spyOn(
		hypersnap,
		"getHypersnapCastByFidAndHash",
	).mockImplementation(hypersnapAnswer);
};

describe("getCastInEitherWorld", () => {
	test("Hypersnap is primary — a hit never reaches Snapchain", async () => {
		stubWorlds(
			() => {
				throw new Error("Snapchain must not be called");
			},
			async () => cast(1),
		);

		const result = await getCastInEitherWorld(1, HASH);

		expect(result?.origin).toBe("hypersnap");
		expect(snapchain).not.toHaveBeenCalled();
	});

	test("a Hypersnap miss consults Snapchain", async () => {
		stubWorlds(
			async () => cast(1),
			async () => undefined,
		);

		const result = await getCastInEitherWorld(1, HASH);

		expect(result?.origin).toBe("snapchain");
	});

	test("a miss on both worlds is a real miss", async () => {
		stubWorlds(
			async () => undefined,
			async () => undefined,
		);

		const result = await getCastInEitherWorld(1, HASH);

		expect(result).toBeUndefined();
	});

	test("a Hypersnap outage falls through to Snapchain", async () => {
		stubWorlds(
			async () => cast(1),
			async () => {
				throw new Error("connect ECONNREFUSED");
			},
		);

		const result = await getCastInEitherWorld(1, HASH);

		expect(result?.origin).toBe("snapchain");
	});

	test("no hit with one outage withholds the verdict — throw, not miss", async () => {
		stubWorlds(
			async () => {
				throw new Error("hub rpc deadline exceeded after 10000ms");
			},
			async () => undefined,
		);

		expect(getCastInEitherWorld(1, HASH)).rejects.toThrow(/outage/);
	});

	test("no hit with outages on both worlds throws once, naming both", async () => {
		stubWorlds(
			async () => {
				throw new Error("snapchain down");
			},
			async () => {
				throw new Error("hypersnap down");
			},
		);

		expect(getCastInEitherWorld(1, HASH)).rejects.toThrow(
			/snapchain down.*hypersnap down|hypersnap down.*snapchain down/,
		);
	});
});
