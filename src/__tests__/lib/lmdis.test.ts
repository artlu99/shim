import { afterAll, describe, expect, test } from "bun:test";
import { LmdisClient, LmdisError } from "../../lib/lmdis";

// Offline: a fake lmdis server routes on the key name in the command body,
// exercising the client's error labeling. Contract: cache-leg failures carry
// an "lmdis:" prefix, while hub-api's rethrowHubError prefixes hub-leg
// failures with "hub <uri>" — so a route-level catch can always tell which
// leg threw (the 2026-10-30 incident logged both as bare
// "Failed to parse JSON").
describe("LmdisClient error attribution", () => {
	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			const body = await req.text();
			if (body.includes("garbage-key")) {
				// 2xx with a non-JSON body (proxy error page / truncation)
				return new Response("<html>bad gateway</html>", { status: 200 });
			}
			if (body.includes("boom-key")) {
				// non-JSON 5xx
				return new Response("internal error", { status: 500 });
			}
			if (body.includes("error-key")) {
				// proper lmdis JSON error shape
				return Response.json(
					{ error: "wrong type", code: "WRONGTYPE" },
					{ status: 400 },
				);
			}
			return Response.json({ result: "OK" });
		},
	});

	const client = new LmdisClient({
		url: `http://localhost:${server.port}`,
		token: "test-token",
	});

	test("SET returns OK on the happy path", async () => {
		expect(await client.set("ok-key", "v", { ex: 60 })).toBe("OK");
	});

	test("garbage 200 body → LmdisError labeled with the cache leg and status", async () => {
		let thrown: unknown;
		try {
			await client.get("garbage-key");
			expect.unreachable();
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(LmdisError);
		expect(
			(thrown as Error).message.startsWith(
				"lmdis: response was not JSON (status 200)",
			),
		).toBe(true);
	});

	test("non-JSON 5xx → labeled with the status instead of a bare SyntaxError", async () => {
		let thrown: unknown;
		try {
			await client.get("boom-key");
			expect.unreachable();
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(LmdisError);
		expect(
			(thrown as Error).message.startsWith(
				"lmdis: response was not JSON (status 500)",
			),
		).toBe(true);
	});

	test("JSON error body → LmdisError with the server's error text (unchanged)", async () => {
		let thrown: unknown;
		try {
			await client.get("error-key");
			expect.unreachable();
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(LmdisError);
		expect((thrown as Error).message).toBe("wrong type");
	});

	afterAll(() => {
		void server.stop(true);
	});
});
