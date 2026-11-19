// A minimal in-process lmdis: the protocol subset the vendored LmdisClient
// speaks (POST / with a JSON-array command; SET with EX/PX, GET with lazy
// expiry, DEL), served on an OS-assigned port. Tests call installUpstashEnv()
// in beforeAll and clearUpstashEnv() + lmdisMock.stop() in afterAll — env is
// only pointed at the mock for this file's window; every other test file
// keeps the cache-less world it was written against (lib cache legs throw
// the env invariant and degrade to uncached).

const store = new Map<string, { value: string; expiresAt?: number }>();
// per-key op counts: assertions scope themselves to their own key prefixes
// so noise from any other cache client cannot break them
const opsByKey = new Map<string, number>();
let failNext = false;

const server = Bun.serve({
	port: 0,
	fetch: async (req) => {
		if (req.headers.get("authorization") !== "Bearer lmdis-mock-token") {
			return Response.json(
				{ error: "Missing authorization token", code: "UNAUTHORIZED" },
				{ status: 401 },
			);
		}
		if (failNext) {
			failNext = false;
			return new Response("<html>502 bad gateway</html>", { status: 502 });
		}
		const body = (await req.json().catch(() => undefined)) as
			| unknown[]
			| undefined;
		if (!Array.isArray(body)) {
			return Response.json(
				{ error: "invalid JSON", code: "VALIDATION_ERROR" },
				{ status: 400 },
			);
		}
		const [cmd, key] = body as [string, string];
		opsByKey.set(key, (opsByKey.get(key) ?? 0) + 1);
		const now = Date.now();
		if (cmd === "SET") {
			const value = body[2] as string;
			let expiresAt: number | undefined;
			if (body[3] === "EX") expiresAt = now + Number(body[4]) * 1000;
			if (body[3] === "PX") expiresAt = now + Number(body[4]);
			store.set(key, { value, expiresAt });
			return Response.json({ result: "OK" });
		}
		if (cmd === "GET") {
			const entry = store.get(key);
			if (!entry) {
				return Response.json({ result: null });
			}
			if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
				store.delete(key);
				return Response.json({ result: null });
			}
			return Response.json({ result: entry.value });
		}
		if (cmd === "DEL") {
			return Response.json({ result: store.delete(key) ? 1 : 0 });
		}
		return Response.json(
			{ error: `unsupported command ${cmd}`, code: "VALIDATION_ERROR" },
			{ status: 400 },
		);
	},
});

export const installUpstashEnv = () => {
	process.env.UPSTASH_REDIS_REST_URL = server.url.toString();
	process.env.UPSTASH_REDIS_REST_TOKEN = "lmdis-mock-token";
};

export const clearUpstashEnv = () => {
	delete process.env.UPSTASH_REDIS_REST_URL;
	delete process.env.UPSTASH_REDIS_REST_TOKEN;
};

export const lmdisMock = {
	/** raw lmdis keyspace — assert on stored values and TTL entries */
	store,
	/** commands executed for keys under `prefix` (LRU hits perform zero) */
	opCount: (prefix: string) => {
		let total = 0;
		for (const [key, count] of opsByKey) {
			if (key.startsWith(prefix)) total += count;
		}
		return total;
	},
	reset: () => {
		store.clear();
		opsByKey.clear();
		failNext = false;
	},
	/** next request answers 502 with a non-JSON body — a cache outage */
	failNextRequest: () => {
		failNext = true;
	},
	stop: () => server.stop(true),
};
