import { stat } from "node:fs/promises";
import { Elysia, t } from "elysia";
import { getInfoCounts, sqliteFilePath } from "../lib/sqlite";
import { SHIM_GIT_SHA, SHIM_VERSION } from "../version";

const startedAtMs = Date.now();

// Null for an in-memory store and for a database file that is not on disk.
const fileBytes = async (path: string): Promise<number | null> => {
	if (path === ":memory:") return null;
	try {
		return (await stat(path)).size;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
};

export const info = new Elysia().get(
	"/info",
	async () => {
		const memory = process.memoryUsage();
		return {
			version: SHIM_VERSION,
			gitSha: SHIM_GIT_SHA,
			startedAt: new Date(startedAtMs).toISOString(),
			resources: {
				rssBytes: memory.rss,
				sqliteBytes: await fileBytes(sqliteFilePath()),
			},
			database: await getInfoCounts(),
		};
	},
	{
		detail: {
			tags: ["Status"],
			summary: "Version, resource use, and database counts",
			description:
				"Local snapshot of this process. No hub calls. sqliteBytes is null for an in-memory store and when the database file is not on disk.",
		},
		response: t.Object({
			version: t.String(),
			gitSha: t.String(),
			startedAt: t.String(),
			resources: t.Object({
				rssBytes: t.Number(),
				sqliteBytes: t.Union([t.Number(), t.Null()]),
			}),
			database: t.Object({
				casts: t.Number(),
				liveCasts: t.Number(),
				fids: t.Number(),
			}),
		}),
	},
);
