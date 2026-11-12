import { beforeAll, describe, expect, it } from "bun:test";

// hub-grpc throws at import time without HUB_GRPC_ENDPOINT. HUB_GRPC_DISABLED=1
// selects the no-client path so this file does not dial a hub.
process.env.HUB_GRPC_ENDPOINT ??= "grpc://localhost:2283";
process.env.HUB_GRPC_DISABLED = "1";

type PageRequest = { pageToken?: Uint8Array; pageSize: number };
type ScriptedPage = { messages: number[]; next?: number | "empty" };

let collectPagedMessages: typeof import("../../lib/hub-grpc").collectPagedMessages;
let isHubNotFound: typeof import("../../lib/hub-grpc").isHubNotFound;

const script = (pages: ScriptedPage[]) => {
	const calls: PageRequest[] = [];
	const fetchPage = async (request: PageRequest) => {
		calls.push(request);
		const page = pages[calls.length - 1];
		if (!page) {
			throw new Error(`fetched past the script at call ${calls.length}`);
		}
		return {
			messages: page.messages,
			nextPageToken:
				page.next === undefined
					? undefined
					: page.next === "empty"
						? new Uint8Array()
						: new Uint8Array([page.next]),
		};
	};
	return { fetchPage, calls };
};

describe("isHubNotFound", () => {
	beforeAll(async () => {
		({ isHubNotFound } = await import("../../lib/hub-grpc"));
	});

	it("matches the errCode exactly", () => {
		expect(isHubNotFound({ errCode: "not_found" })).toBe(true);
		expect(isHubNotFound({ errCode: "unavailable" })).toBe(false);
		expect(isHubNotFound({ errCode: "bad_request" })).toBe(false);
	});

	it("matches a stringified HubError", () => {
		expect(isHubNotFound("HubError: not_found: cast not found")).toBe(true);
		expect(isHubNotFound(new Error("connect ECONNREFUSED"))).toBe(false);
	});

	it("is false for junk", () => {
		expect(isHubNotFound(undefined)).toBe(false);
		expect(isHubNotFound(null)).toBe(false);
		expect(isHubNotFound(42)).toBe(false);
	});
});

describe("collectPagedMessages", () => {
	beforeAll(async () => {
		({ collectPagedMessages } = await import("../../lib/hub-grpc"));
	});

	it("returns one page when the hub sends no token", async () => {
		const { fetchPage, calls } = script([{ messages: [1, 2, 3] }]);

		const got = await collectPagedMessages(fetchPage, 10, 500);

		expect(got).toEqual([1, 2, 3]);
		expect(calls).toEqual([{ pageToken: undefined, pageSize: 10 }]);
	});

	it("follows nextPageToken until the hub runs dry", async () => {
		const { fetchPage, calls } = script([
			{ messages: [1, 2], next: 9 },
			{ messages: [3, 4] },
		]);

		const got = await collectPagedMessages(fetchPage, 10, 2);

		expect(got).toEqual([1, 2, 3, 4]);
		expect(calls).toHaveLength(2);
		expect(calls[0]).toEqual({ pageToken: undefined, pageSize: 2 });
		expect(Array.from(calls[1].pageToken ?? [])).toEqual([9]);
		expect(calls[1].pageSize).toBe(2);
	});

	it("stops at the cap without fetching another page", async () => {
		const { fetchPage, calls } = script([
			{ messages: [1, 2, 3, 4], next: 9 },
			{ messages: [5] },
		]);

		const got = await collectPagedMessages(fetchPage, 3, 500);

		expect(got).toEqual([1, 2, 3]);
		expect(calls).toHaveLength(1);
		expect(calls[0].pageSize).toBe(3);
	});

	it("asks for the remaining budget on later pages", async () => {
		const { fetchPage, calls } = script([
			{ messages: [1, 2], next: 4 },
			{ messages: [3, 4], next: 8 },
			{ messages: [5] },
		]);

		const got = await collectPagedMessages(fetchPage, 5, 2);

		expect(got).toEqual([1, 2, 3, 4, 5]);
		expect(calls.map((call) => call.pageSize)).toEqual([2, 2, 1]);
	});

	it("stops on an empty page even when a token is attached", async () => {
		const { fetchPage, calls } = script([
			{ messages: [], next: 9 },
			{ messages: [1] },
		]);

		const got = await collectPagedMessages(fetchPage, 10, 500);

		expect(got).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it("treats a zero-length token as the end", async () => {
		const { fetchPage, calls } = script([
			{ messages: [1], next: "empty" },
			{ messages: [2] },
		]);

		const got = await collectPagedMessages(fetchPage, 10, 500);

		expect(got).toEqual([1]);
		expect(calls).toHaveLength(1);
	});

	it("fetches nothing when the cap or page size is not positive", async () => {
		const { fetchPage, calls } = script([{ messages: [1] }]);

		expect(await collectPagedMessages(fetchPage, 0, 500)).toEqual([]);
		expect(await collectPagedMessages(fetchPage, -3, 500)).toEqual([]);
		expect(await collectPagedMessages(fetchPage, 10, 0)).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});
