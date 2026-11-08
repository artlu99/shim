import { stat } from "node:fs/promises";
import { loadavg } from "node:os";
import { Elysia, t } from "elysia";
import { getInfoCounts, sqliteFilePath } from "../lib/sqlite";
import { SHIM_GIT_SHA, SHIM_VERSION } from "../version";

const startedAtMs = Date.now();

const bytesAt = async (path: string): Promise<number | null> => {
	try {
		return (await stat(path)).size;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
};

const sqliteSizes = async (path: string) => {
	if (path === ":memory:") {
		return { path, bytes: null, walBytes: null, shmBytes: null };
	}
	const [bytes, walBytes, shmBytes] = await Promise.all([
		bytesAt(path),
		bytesAt(`${path}-wal`),
		bytesAt(`${path}-shm`),
	]);
	return { path, bytes, walBytes, shmBytes };
};

export const info = new Elysia().get(
	"/info",
	async () => {
		const memory = process.memoryUsage();
		const path = sqliteFilePath();
		const [one, five, fifteen] = loadavg();
		return {
			version: SHIM_VERSION,
			gitSha: SHIM_GIT_SHA,
			startedAt: new Date(startedAtMs).toISOString(),
			uptimeSec: Math.floor((Date.now() - startedAtMs) / 1000),
			resources: {
				rssBytes: memory.rss,
				heapUsedBytes: memory.heapUsed,
				heapTotalBytes: memory.heapTotal,
				externalBytes: memory.external,
				loadavg: [one, five, fifteen] as [number, number, number],
				sqlite: await sqliteSizes(path),
			},
			database: await getInfoCounts(),
		};
	},
	{
		detail: {
			tags: ["Status"],
			summary: "Version, resource use, and database counts",
			description:
				"Local snapshot. No hub calls. loadavg is the host's on Linux, including inside Docker. sqlite sizes are null for an in-memory store and for sidecars that are not on disk.",
		},
		response: t.Object({
			version: t.String(),
			gitSha: t.String(),
			startedAt: t.String(),
			uptimeSec: t.Number(),
			resources: t.Object({
				rssBytes: t.Number(),
				heapUsedBytes: t.Number(),
				heapTotalBytes: t.Number(),
				externalBytes: t.Number(),
				loadavg: t.Tuple([t.Number(), t.Number(), t.Number()]),
				sqlite: t.Object({
					path: t.String(),
					bytes: t.Union([t.Number(), t.Null()]),
					walBytes: t.Union([t.Number(), t.Null()]),
					shmBytes: t.Union([t.Number(), t.Null()]),
				}),
			}),
			database: t.Object({
				casts: t.Number(),
				liveCasts: t.Number(),
				follows: t.Number(),
				fids: t.Number(),
			}),
		}),
	},
);
