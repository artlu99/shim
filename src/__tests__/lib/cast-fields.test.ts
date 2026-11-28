import { describe, expect, test } from "bun:test";
import {
	asCastTypeName,
	asChain,
	asFormatVersion,
} from "../../lib/cast-fields";

describe("asCastTypeName", () => {
	test("accepts protocol string and enum forms", () => {
		expect(asCastTypeName("CAST")).toBe("CAST");
		expect(asCastTypeName("LONG_CAST")).toBe("LONG_CAST");
		expect(asCastTypeName("TEN_K_CAST")).toBe("TEN_K_CAST");
		expect(asCastTypeName(0)).toBe("CAST");
		expect(asCastTypeName(1)).toBe("LONG_CAST");
		expect(asCastTypeName(2)).toBe("TEN_K_CAST");
	});

	test("rejects Hypersnap client types and junk", () => {
		expect(asCastTypeName("cast")).toBeUndefined();
		expect(asCastTypeName("cast-reply")).toBeUndefined();
		expect(asCastTypeName(3)).toBeUndefined();
		expect(asCastTypeName(undefined)).toBeUndefined();
	});
});

describe("asFormatVersion", () => {
	test("accepts non-negative integers", () => {
		expect(asFormatVersion(0)).toBe(0);
		expect(asFormatVersion(1)).toBe(1);
	});

	test("rejects non-integers and negatives", () => {
		expect(asFormatVersion(-1)).toBeUndefined();
		expect(asFormatVersion(1.5)).toBeUndefined();
		expect(asFormatVersion("1")).toBeUndefined();
		expect(asFormatVersion(undefined)).toBeUndefined();
	});
});

describe("asChain", () => {
	test("maps a root segment (no root CastId)", () => {
		expect(asChain({ index: 0, count: 2 })).toEqual({ index: 0, count: 2 });
	});

	test("maps a later segment with a 0x-normalized root hash", () => {
		expect(
			asChain({
				root: { fid: 4926, hash: "4e8b2f2bcbaf19689fa3b41aa76671552a922d22" },
				index: 1,
				count: 2,
			}),
		).toEqual({
			root: {
				fid: 4926,
				hash: "0x4e8b2f2bcbaf19689fa3b41aa76671552a922d22",
			},
			index: 1,
			count: 2,
		});
	});

	test("maps a protobuf root hash (Uint8Array)", () => {
		const hash = Uint8Array.from(
			Buffer.from("4e8b2f2bcbaf19689fa3b41aa76671552a922d22", "hex"),
		);
		expect(asChain({ root: { fid: 4926, hash }, index: 1, count: 2 })).toEqual({
			root: {
				fid: 4926,
				hash: "0x4e8b2f2bcbaf19689fa3b41aa76671552a922d22",
			},
			index: 1,
			count: 2,
		});
	});

	test("rejects malformed shapes", () => {
		expect(asChain(null)).toBeUndefined();
		expect(asChain({ index: 0 })).toBeUndefined();
		expect(asChain({ index: -1, count: 1 })).toBeUndefined();
		expect(asChain({ root: { fid: 1 }, index: 1, count: 2 })).toBeUndefined();
	});
});
