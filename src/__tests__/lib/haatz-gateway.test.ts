import "./../helpers/hub-env";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as hubApi from "../../lib/hub-api";
import * as sqlite from "../../lib/sqlite";

// fixture trimmed from a live haatz.quilibrium.com /v1/castsByFid answer
// (2026-11-12); timestamp is hub-time seconds since the Farcaster epoch
const ADD_MESSAGE = {
	data: {
		type: "MESSAGE_TYPE_CAST_ADD",
		fid: 3854,
		timestamp: 184993770,
		network: "FARCASTER_NETWORK_MAINNET",
		castAddBody: {
			embedsDeprecated: [],
			mentions: [],
			parentCastId: null,
			parentUrl: null,
			text: "gm!",
			embeds: [],
			mentionsPositions: [],
			type: "CAST",
		},
	},
	hash: "0x214ED2B913DBD917804F6904657315F4C134CAE8",
	hashScheme: "HASH_SCHEME_BLAKE3",
	signature: "hNaCiwKnLvzQN2wHXNOPmewiqP",
	signatureScheme: "SIGNATURE_SCHEME_ED25519",
	signer: "0x9856862E216FC994E0E20DFAB33E459EB1F8C4E8D78773CD57B7EB346586EF26",
};

const REMOVE_MESSAGE = {
	data: {
		type: "MESSAGE_TYPE_CAST_REMOVE",
		fid: 3854,
		timestamp: 184993771,
		network: "FARCASTER_NETWORK_MAINNET",
		castRemoveBody: { type: "CAST", targetHash: "3tv38BZa3Jt6hsjXNIbQ" },
	},
	hash: "0x6c00b4443ac66957af1688d5bd9f54d7284a5d8e",
	hashScheme: "HASH_SCHEME_BLAKE3",
	signature: "sig",
	signatureScheme: "SIGNATURE_SCHEME_ED25519",
	signer: "0x9856862e216fc994e0e20dfab33e459eb1f8c4e8d78773cd57b7eb346586ef26",
};

const stubFetch = (impl: (url: string) => Promise<Response>) => {
	globalThis.fetch = Object.assign(
		async (url: any) => impl(String(url)),
	) as unknown as typeof fetch;
};

const originalFetch = globalThis.fetch;

const { gatewayCastToCast, getHaatzCastsByFid, getHaatzChannelFeed } = await import(
	"../../lib/haatz-gateway"
);

let upsertSpy: ReturnType<typeof spyOn>;
let hydrateSpy: ReturnType<typeof spyOn>;

afterEach(() => {
	// only the spies this file's tests actually stubbed exist — a restoring
	// crash in afterEach marks every test in the file failed
	upsertSpy?.mockRestore();
	hydrateSpy?.mockRestore();
	globalThis.fetch = originalFetch;
});

// hydrateText resolves mention usernames over the network (hub-api's
// fork-aware wrapper); stub it there so the mapping tests never leave
// the process
const stubHydration = () => {
	hydrateSpy = spyOn(hubApi, "getUserInEitherWorld").mockImplementation(
		async (fid: number) => ({ fid, username: `user${fid}` }) as any,
	);
};

describe("gatewayCastToCast", () => {
	test("maps the protobuf-JSON shape onto shim's Cast", async () => {
		const cast = await gatewayCastToCast(ADD_MESSAGE);
		expect(cast?.fid).toBe(3854);
		expect(cast?.hash).toBe("0x214ed2b913dbd917804f6904657315f4c134cae8");
		expect(cast?.signer).toBe(
			"0x9856862e216fc994e0e20dfab33e459eb1f8c4e8d78773cd57b7eb346586ef26",
		);
		// hub-time seconds get the Farcaster epoch added, same as the gRPC path
		expect(cast?.timestamp).toBe(1609459200 + 184993770);
		expect(cast?.text).toBe("gm!");
		expect(cast?.rawText).toBe("gm!");
	});

	test("preserves mentions and their positions", async () => {
		stubHydration();
		const withMention = {
			...ADD_MESSAGE,
			data: {
				...ADD_MESSAGE.data,
				castAddBody: {
					...ADD_MESSAGE.data.castAddBody,
					mentions: [37],
					mentionsPositions: [0],
					text: "hi @37",
				},
			},
		};
		const cast = await gatewayCastToCast(withMention);
		expect(cast?.mentions).toEqual([37]);
		expect(cast?.mentionsPositions).toEqual([0]);
		expect(cast?.text).toContain("@user37");
	});

	test("drops unusable messages: removes, missing signer, missing body", async () => {
		expect(await gatewayCastToCast(REMOVE_MESSAGE)).toBeUndefined();
		expect(
			await gatewayCastToCast({ ...ADD_MESSAGE, signer: undefined }),
		).toBeUndefined();
		expect(
			await gatewayCastToCast({ ...ADD_MESSAGE, data: { ...ADD_MESSAGE.data, castAddBody: undefined } }),
		).toBeUndefined();
		expect(await gatewayCastToCast(null)).toBeUndefined();
	});
});

describe("getHaatzCastsByFid", () => {
	test("walks pages, filters removes, and stops at an empty token", async () => {
		stubHydration();
		upsertSpy = spyOn(sqlite, "upsertCasts").mockImplementation(async () => 2);
		let call = 0;
		const urls: string[] = [];
		stubFetch(async (url) => {
			urls.push(url);
			call += 1;
			if (call === 1) {
				return Response.json({
					messages: [ADD_MESSAGE, REMOVE_MESSAGE],
					nextPageToken: "tok1",
				});
			}
			return Response.json({ messages: [ADD_MESSAGE], nextPageToken: "" });
		});

		const { casts, numNew } = await getHaatzCastsByFid(3854, 100, undefined, {
			upsert: true,
		});

		expect(casts).toHaveLength(2); // the remove never becomes a cast
		expect(numNew).toBe(2);
		expect(urls).toHaveLength(2);
		expect(urls[0]).toContain("/v1/castsByFid?fid=3854");
		expect(urls[0]).toContain("reverse=true");
		expect(urls[0]).toContain("pageSize=100");
		expect(urls[1]).toContain("pageToken=tok1");
	});

	test("encodes the watermark as hub-time startTimestamp", async () => {
		stubHydration();
		upsertSpy = spyOn(sqlite, "upsertCasts").mockImplementation(async () => 0);
		const urls: string[] = [];
		stubFetch(async (url) => {
			urls.push(url);
			return Response.json({ messages: [], nextPageToken: "" });
		});

		await getHaatzCastsByFid(3854, 100, 1609459200 + 500);

		expect(urls[0]).toContain("startTimestamp=500");
	});

	test("an empty answer is a clean miss, upserting nothing", async () => {
		stubHydration();
		upsertSpy = spyOn(sqlite, "upsertCasts").mockImplementation(async () => 0);
		stubFetch(async () => Response.json({ messages: [], nextPageToken: "" }));

		const { casts, numNew } = await getHaatzCastsByFid(3854);

		expect(casts).toEqual([]);
		expect(numNew).toBe(0);
		expect(upsertSpy).not.toHaveBeenCalled();
	});

	test("throws on a non-ok answer — an outage, never an empty world", async () => {
		stubFetch(async () => new Response("internal error", { status: 500 }));
		expect(getHaatzCastsByFid(3854)).rejects.toThrow(/haatz gateway answered 500/);
	});

	test("throws on a transport failure", async () => {
		stubFetch(async () => {
			throw new Error("connect ECONNREFUSED");
		});
		expect(getHaatzCastsByFid(3854)).rejects.toThrow(/ECONNREFUSED/);
	});
});

describe("getHaatzChannelFeed", () => {
	test("answers one page and always upserts", async () => {
		stubHydration();
		upsertSpy = spyOn(sqlite, "upsertCasts").mockImplementation(async () => 1);
		const urls: string[] = [];
		stubFetch(async (url) => {
			urls.push(url);
			return Response.json({ messages: [ADD_MESSAGE], nextPageToken: "tok" });
		});

		const { casts, numNew } = await getHaatzChannelFeed(
			"https://warpcast.com/~/channel/india",
			3,
		);

		expect(casts).toHaveLength(1);
		expect(numNew).toBe(1);
		expect(upsertSpy).toHaveBeenCalled();
		expect(urls[0]).toContain("/v1/castsByParent?url=");
		expect(urls[0]).toContain("pageSize=3");
	});
});
