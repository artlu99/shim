import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Elysia } from "elysia";
import * as hubApi from "../../lib/hub-api";
import * as hydration from "../../lib/hydration";
import * as socialContractLib from "../../lib/social-contract";
import { fu } from "../../routes/f-u";
import { socialContract } from "../../routes/social-contract";

// fid params arrive as strings over http. These tests pin the parse
// boundary: unparseable fids answer 400 — never a Number()-coerced
// neighbor (9007199254740993 used to silently round to 9007199254740992
// and serve a different fid's data) — and native fids travel the full
// route exactly.

// spyOn, not mock.module: bun's module registry is global across test
// files, so re-registering lib modules here (even to restore) re-evaluates
// the graph and breaks other files' wiring. And each test's spy must be
// mockRestore()d — mockReset leaves a dead wrapper in the shared namespace
// export, which is exactly how hydration.test.ts wiped out the one time
// this file used it. Same discipline as cast-sync.test.ts.
const NATIVE_FID = 4294967296;

const nativeUser = {
	fid: NATIVE_FID,
	username: null,
	fname: null,
	attestations: [],
	displayName: "2^32",
	pfpUrl: null,
	bio: "The first native FID on HyperSnap.",
	primaryAddress: null,
};

let usernameSpy: ReturnType<typeof spyOn> | undefined;
let userSpy: ReturnType<typeof spyOn> | undefined;
let signedSpy: ReturnType<typeof spyOn> | undefined;
let nameSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
	// only the spies this file's tests actually stubbed exist — a restoring
	// crash in afterEach marks every test in the file failed
	usernameSpy?.mockRestore();
	userSpy?.mockRestore();
	signedSpy?.mockRestore();
	nameSpy?.mockRestore();
});

// stub the world legs so a request past the parse boundary has
// deterministic answers and no network
const stubLegs = (legs: {
	getUsernameByFid?: () => Promise<unknown>;
	getUserByFid?: (fid: number) => Promise<unknown>;
	hasFidSignedSocialContract?: () => Promise<unknown>;
	getFidByUsernameInEitherWorld?: (username: string) => Promise<unknown>;
}) => {
	if (legs.getUsernameByFid) {
		usernameSpy = spyOn(hubApi, "getUsernameByFid").mockImplementation(
			legs.getUsernameByFid as any,
		);
	}
	if (legs.getUserByFid) {
		userSpy = spyOn(hydration, "getUserByFid").mockImplementation(
			legs.getUserByFid as any,
		);
	}
	if (legs.hasFidSignedSocialContract) {
		signedSpy = spyOn(
			socialContractLib,
			"hasFidSignedSocialContract",
		).mockImplementation(legs.hasFidSignedSocialContract as any);
	}
	if (legs.getFidByUsernameInEitherWorld) {
		nameSpy = spyOn(hubApi, "getFidByUsernameInEitherWorld").mockImplementation(
			legs.getFidByUsernameInEitherWorld as any,
		);
	}
};

const app = new Elysia().use(fu).use(socialContract);

const get = (path: string) =>
	app.handle(new Request(`http://localhost${path}`));

describe("fid parse boundary", () => {
	test("rejects floats with 400", async () => {
		const res = await get("/user/123.456");
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.success).toBe(false);
	});

	test("rejects negative and exponent forms with 400", async () => {
		expect((await get("/user/-1")).status).toBe(400);
		expect((await get("/u/1e9")).status).toBe(400);
	});

	test("rejects integers above the exact double range instead of rounding", async () => {
		// the silent-neighbor bug: Number("9007199254740993") rounds to
		// 9007199254740992, and the old route echoed the rounded fid back
		// as if it were the request
		const res = await get("/user/9007199254740993");
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.user).toBeUndefined();
	});

	test("rejects non-numeric params on every fid route with 400", async () => {
		expect((await get("/u/not-a-fid")).status).toBe(400);
		expect((await get("/signed/not-a-fid")).status).toBe(400);
	});
});

describe("native fids through the boundary", () => {
	test("/user echoes a native fid exactly", async () => {
		stubLegs({
			getUserByFid: async () => nativeUser,
			hasFidSignedSocialContract: async () => false,
		});

		const res = await get(`/user/${NATIVE_FID}`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);
		expect(data.user.fid).toBe(NATIVE_FID);
		expect(data.user.displayName).toBe("2^32");
		expect(data.user.signed).toBe(false);
		// the parsed fid reached the world legs, not the raw string
		expect(userSpy).toHaveBeenCalledWith(NATIVE_FID);
	});

	test("/u reports a missing username as null, not a dropped key", async () => {
		stubLegs({ getUsernameByFid: async () => undefined });

		const res = await get(`/u/${NATIVE_FID}`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);
		expect(data).toHaveProperty("username", null);
	});
});

describe("GET /f/:username (fork-aware name resolution)", () => {
	test("a Hypersnap-world name answers provisional with its social signals", async () => {
		stubLegs({
			getFidByUsernameInEitherWorld: async () => ({
				fid: 4294967297,
				origin: "hypersnap",
				provisional: true,
				followerCount: 9,
				profileUsername: "muhammedali",
			}),
		});

		const res = await get("/f/muhammedali");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);
		expect(data.fid).toBe(4294967297);
		expect(data.origin).toBe("hypersnap");
		expect(data.provisional).toBe(true);
		expect(data.followerCount).toBe(9);
		expect(data.profileUsername).toBe("muhammedali");
	});

	test("a miss on both worlds answers fid null, not a dropped key", async () => {
		stubLegs({ getFidByUsernameInEitherWorld: async () => undefined });

		const res = await get("/f/no-such-name");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.success).toBe(true);
		expect(data).toHaveProperty("fid", null);
		expect(data.provisional).toBe(false);
	});

	test("a withheld verdict answers 503, never a false miss", async () => {
		stubLegs({
			getFidByUsernameInEitherWorld: async () => {
				throw new Error("name lookup outage for x: hub unreachable");
			},
		});

		const res = await get("/f/anyone");
		expect(res.status).toBe(503);
		const data = await res.json();
		expect(data.success).toBe(false);
	});
});
