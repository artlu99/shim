import { afterEach, describe, expect, test } from "bun:test";
import {
	getHypersnapCastByFidAndHash,
	getHypersnapCastByHash,
	hypersnapCastToCast,
} from "../../lib/hypersnap";

// trimmed from a live haatz.quilibrium.com answer
const FIXTURE = {
	object: "cast",
	hash: "A7C5F47033DA848D6D16DAC11C61838634A50C23",
	parent_url: "chain://eip155:7777777/erc721:0x4f86113",
	parent_author: { fid: null },
	author: { object: "user", fid: 3854, username: "darrylyeo" },
	text: "My thoughts on the merger",
	timestamp: "2026-10-18T00:50:15.000Z",
	embeds: [
		{ cast_id: { fid: 37, hash: "83c734e1985ad2b6f28bea2938a750981740a093" } },
		{ url: "https://example.com/picture.png" },
	],
	mentioned_profiles: [{ fid: 527487 }, { username: "no-fid" }],
	reactions: { likes_count: 103 },
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("hypersnapCastToCast", () => {
	test("maps the client-API shape onto shim's Cast", () => {
		const cast = hypersnapCastToCast(FIXTURE);
		expect(cast).toBeDefined();
		expect(cast!.fid).toBe(3854);
		expect(cast!.hash).toBe(
			"0xa7c5f47033da848d6d16dac11c61838634a50c23",
		);
		expect(cast!.timestamp).toBe(
			Math.floor(Date.parse("2026-10-18T00:50:15.000Z") / 1000),
		);
		expect(cast!.text).toBe("My thoughts on the merger");
		expect(cast!.rawText).toBeNull();
		expect(cast!.parentUrl).toBe("chain://eip155:7777777/erc721:0x4f86113");
		expect(cast!.parentCastId).toBeUndefined();
		expect(cast!.embeds).toEqual([
			{
				url: undefined,
				castId: {
					fid: 37,
					hash: "0x83c734e1985ad2b6f28bea2938a750981740a093",
				},
			},
			{ url: "https://example.com/picture.png", castId: undefined },
		]);
		expect(cast!.mentions).toEqual([527487]);
		expect(cast!.mentionsPositions).toEqual([]);
	});

	test("maps a reply's parent_hash onto parentCastId", () => {
		const cast = hypersnapCastToCast({
			...FIXTURE,
			parent_url: null,
			parent_hash: "83c734e1985ad2b6f28bea2938a750981740a093",
			parent_author: { fid: 37 },
		});
		expect(cast!.parentCastId).toEqual({
			fid: 37,
			hash: "0x83c734e1985ad2b6f28bea2938a750981740a093",
		});
		expect(cast!.parentUrl).toBeUndefined();
	});

	test("rejects shapes without an author fid, hash, or timestamp", () => {
		expect(hypersnapCastToCast({ ...FIXTURE, author: {} })).toBeUndefined();
		expect(hypersnapCastToCast({ ...FIXTURE, hash: undefined })).toBeUndefined();
		expect(
			hypersnapCastToCast({ ...FIXTURE, timestamp: "not-a-date" }),
		).toBeUndefined();
		expect(hypersnapCastToCast(null)).toBeUndefined();
	});

	// Haatz sometimes leaves a zero-width range at the bang and the
	// username out of the text — splice @username in at that byte.
	test("splices a zero-width mention range into text", () => {
		const text = "from !";
		const bang = new TextEncoder().encode(text).indexOf("!".charCodeAt(0));
		const cast = hypersnapCastToCast({
			...FIXTURE,
			text,
			mentioned_profiles: [{ fid: 230238, username: "mvr" }],
			mentioned_profiles_ranges: [{ start: bang, end: bang }],
		});
		expect(cast!.text).toBe("from @mvr!");
		expect(cast!.mentions).toEqual([230238]);
		expect(cast!.mentionsPositions).toEqual([bang]);
		expect(cast!.rawText).toBeNull();
	});

	// apply from the end so the earlier byte offset stays valid after
	// the later insertion grows the buffer
	test("applies multiple mention ranges from the end", () => {
		const text = "a!b!";
		const bytes = new TextEncoder().encode(text);
		const first = bytes.indexOf("!".charCodeAt(0));
		const second = bytes.indexOf("!".charCodeAt(0), first + 1);
		const cast = hypersnapCastToCast({
			...FIXTURE,
			text,
			mentioned_profiles: [
				{ fid: 1, username: "first" },
				{ fid: 2, username: "second" },
			],
			mentioned_profiles_ranges: [
				{ start: first, end: first },
				{ start: second, end: second },
			],
		});
		expect(cast!.text).toBe("a@first!b@second!");
		expect(cast!.mentions).toEqual([1, 2]);
		expect(cast!.mentionsPositions).toEqual([first, second]);
	});

	// the sort must not depend on the API listing ranges in text order —
	// positions stay in profile order even when ranges arrive back-to-front
	test("splices correctly when ranges arrive out of text order", () => {
		const text = "a!b!";
		const bytes = new TextEncoder().encode(text);
		const first = bytes.indexOf("!".charCodeAt(0));
		const second = bytes.indexOf("!".charCodeAt(0), first + 1);
		const cast = hypersnapCastToCast({
			...FIXTURE,
			text,
			mentioned_profiles: [
				{ fid: 1, username: "first" },
				{ fid: 2, username: "second" },
			],
			mentioned_profiles_ranges: [
				{ start: second, end: second },
				{ start: first, end: first },
			],
		});
		expect(cast!.text).toBe("a@second!b@first!");
		expect(cast!.mentions).toEqual([1, 2]);
		expect(cast!.mentionsPositions).toEqual([second, first]);
	});

	test("a missing username splices @<unknown>", () => {
		const text = "hi !";
		const bang = new TextEncoder().encode(text).indexOf("!".charCodeAt(0));
		const cast = hypersnapCastToCast({
			...FIXTURE,
			text,
			mentioned_profiles: [{ fid: 9 }],
			mentioned_profiles_ranges: [{ start: bang, end: bang }],
		});
		expect(cast!.text).toBe("hi @<unknown>!");
		expect(cast!.mentionsPositions).toEqual([bang]);
	});

	test("an out-of-range mention range leaves the text untouched", () => {
		const text = "no splice";
		const cast = hypersnapCastToCast({
			...FIXTURE,
			text,
			mentioned_profiles: [{ fid: 230238, username: "mvr" }],
			mentioned_profiles_ranges: [{ start: 999, end: 999 }],
		});
		expect(cast!.text).toBe("no splice");
		expect(cast!.mentions).toEqual([230238]);
		expect(cast!.mentionsPositions).toEqual([]);
	});
});

describe("getHypersnapCastByHash", () => {
	const HASH = "0xa7c5f47033da848d6d16dac11c61838634a50c23";

	// Bun's fetch type carries a preconnect member the stubs don't
	// implement — the client only ever calls fetch(url, init).
	const stubFetch = (impl: () => Promise<Response>) => {
		globalThis.fetch = Object.assign(impl) as unknown as typeof fetch;
	};

	test("resolves the cast on a 200 answer", async () => {
		stubFetch(async () =>
			Response.json({ cast: FIXTURE }, { status: 200 }),
		);
		const cast = await getHypersnapCastByHash(HASH as `0x${string}`);
		expect(cast?.fid).toBe(3854);
	});

	test("answers undefined on an authoritative 404 miss", async () => {
		stubFetch(async () =>
			Response.json({ error: "not found" }, { status: 404 }),
		);
		const cast = await getHypersnapCastByHash(HASH as `0x${string}`);
		expect(cast).toBeUndefined();
	});

	test("throws on a transport failure — an outage, not a verdict", async () => {
		stubFetch(async () => {
			throw new Error("connect ECONNREFUSED");
		});
		expect(getHypersnapCastByHash(HASH as `0x${string}`)).rejects.toThrow();
	});

	test("throws when the answer names a different cast", async () => {
		stubFetch(async () =>
			Response.json(
				{ cast: { ...FIXTURE, hash: "b".repeat(40) } },
				{ status: 200 },
			),
		);
		expect(getHypersnapCastByHash(HASH as `0x${string}`)).rejects.toThrow(
			/different cast/,
		);
	});
});

describe("getHypersnapCastByFidAndHash", () => {
	const HASH = "0xa7c5f47033da848d6d16dac11c61838634a50c23";

	// FIXTURE's author is fid 3854
	test("returns the cast when the author fid matches", async () => {
		globalThis.fetch = Object.assign(async () =>
			Response.json({ cast: FIXTURE }, { status: 200 }),
		) as unknown as typeof fetch;
		const cast = await getHypersnapCastByFidAndHash(
			3854,
			HASH as `0x${string}`,
		);
		expect(cast?.fid).toBe(3854);
	});

	// the hash-only index is globally keyed: a hit naming another author
	// means the hash belongs to a different fid's cast — a miss, not an error
	test("a hit naming a different author is a clean miss", async () => {
		globalThis.fetch = Object.assign(async () =>
			Response.json({ cast: FIXTURE }, { status: 200 }),
		) as unknown as typeof fetch;
		const cast = await getHypersnapCastByFidAndHash(2, HASH as `0x${string}`);
		expect(cast).toBeUndefined();
	});

	test("a 404 stays a clean miss", async () => {
		globalThis.fetch = Object.assign(async () =>
			Response.json({ error: "not found" }, { status: 404 }),
		) as unknown as typeof fetch;
		const cast = await getHypersnapCastByFidAndHash(
			3854,
			HASH as `0x${string}`,
		);
		expect(cast).toBeUndefined();
	});

	test("an outage propagates to the caller", async () => {
		globalThis.fetch = Object.assign(async () => {
			throw new Error("connect ECONNREFUSED");
		}) as unknown as typeof fetch;
		expect(
			getHypersnapCastByFidAndHash(3854, HASH as `0x${string}`),
		).rejects.toThrow();
	});
});
