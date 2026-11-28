import { afterEach, describe, expect, spyOn, test } from "bun:test";
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

let hypersnapCast: ReturnType<typeof spyOn>;

afterEach(() => {
	hypersnapCast?.mockRestore();
	globalThis.fetch = originalFetch;
});

type Answer = () => Promise<ReturnType<typeof cast> | undefined>;
const stubHypersnap = (answer: Answer) => {
	hypersnapCast = spyOn(
		hypersnap,
		"getHypersnapCastByFidAndHash",
	).mockImplementation(answer);
};

describe("getCastInEitherWorld", () => {
	test("returns a Hypersnap hit", async () => {
		stubHypersnap(async () => cast(1));

		const result = await getCastInEitherWorld(1, HASH);

		expect(result?.origin).toBe("hypersnap");
		expect(result?.cast.fid).toBe(1);
	});

	test("a clean miss is undefined", async () => {
		stubHypersnap(async () => undefined);

		const result = await getCastInEitherWorld(1, HASH);

		expect(result).toBeUndefined();
	});

	test("a Hypersnap outage throws — never a silent miss", async () => {
		stubHypersnap(async () => {
			throw new Error("hypersnap down");
		});

		expect(getCastInEitherWorld(1, HASH)).rejects.toThrow(
			/cast lookup outage: hypersnap down/,
		);
	});
});

describe("getCastInEitherWorld: coalescing", () => {
	const busy = <T>(answer: () => Promise<T>, ms = 15) => {
		let calls = 0;
		return {
			impl: async () => {
				calls++;
				await new Promise((resolve) => setTimeout(resolve, ms));
				return answer();
			},
			callCount: () => calls,
		};
	};

	test("concurrent callers of the same cast share one walk", async () => {
		const hyper = busy(async () => cast(1));
		stubHypersnap(hyper.impl);

		const [a, b] = await Promise.all([
			getCastInEitherWorld(1, HASH),
			getCastInEitherWorld(1, HASH),
		]);

		expect(hyper.callCount()).toBe(1);
		expect(a?.origin).toBe("hypersnap");
		expect(b?.origin).toBe("hypersnap");
	});

	test("distinct fids do not coalesce", async () => {
		const hyper = busy(async () => cast(1));
		stubHypersnap(hyper.impl);

		await Promise.all([
			getCastInEitherWorld(1, HASH),
			getCastInEitherWorld(2, HASH),
		]);

		expect(hyper.callCount()).toBe(2);
	});

	test("a shared outage throws for every concurrent caller and clears", async () => {
		const hyper = busy(async (): Promise<never> => {
			throw new Error("hypersnap down");
		});
		stubHypersnap(hyper.impl);

		const [a, b] = await Promise.allSettled([
			getCastInEitherWorld(1, HASH),
			getCastInEitherWorld(1, HASH),
		]);
		expect(a.status).toBe("rejected");
		expect(b.status).toBe("rejected");
		expect(hyper.callCount()).toBe(1);

		stubHypersnap(async () => cast(1));
		const result = await getCastInEitherWorld(1, HASH);
		expect(result?.origin).toBe("hypersnap");
	});

	test("a settled flight is not reused — a sequential repeat re-walks", async () => {
		const hyper = busy(async () => cast(1));
		stubHypersnap(hyper.impl);

		await getCastInEitherWorld(1, HASH);
		await getCastInEitherWorld(1, HASH);

		expect(hyper.callCount()).toBe(2);
	});
});
