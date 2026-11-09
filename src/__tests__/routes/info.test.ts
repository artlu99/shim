import { Database } from "bun:sqlite";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import type { Cast } from "../../types";

// Set before the store singleton and version module load. These imports
// are dynamic so the assignments above them actually run first.
const dbPath = join(mkdtempSync(join(tmpdir(), "shim-info-")), "test.sqlite");
process.env.SQLITE_PATH = dbPath;
process.env.SHIM_GIT_SHA = "abc1234";

const { info } = await import("../../routes/info");
const { closeDb, upsertCasts } = await import("../../lib/sqlite");

const hash = (n: number): `0x${string}` =>
	`0x${n.toString(16).padStart(8, "0")}${"a".repeat(32)}`;

const cast = (n: number, fid: number): Cast => ({
	fid,
	hash: hash(n),
	text: null,
	rawText: null,
	embeds: [],
	mentions: [],
	mentionsPositions: [],
	timestamp: 1700000000 + n,
	signer: `0x${"0".repeat(40)}`,
});

describe("/info", () => {
	afterAll(async () => {
		await closeDb();
	});

	it("reports version, resources, and database counts", async () => {
		await upsertCasts([cast(1, 7), cast(2, 8)]);
		const side = new Database(dbPath);
		side.run("UPDATE casts SET deleted_at = ? WHERE hash = ?", [
			"1700000002",
			hash(2),
		]);
		side.close();

		const res = await new Elysia().use(info).handle(
			new Request("http://localhost/info"),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			version: string;
			gitSha: string;
			startedAt: string;
			uptimeSec: number;
			resources: {
				rssBytes: number;
				heapUsedBytes: number;
				heapTotalBytes: number;
				externalBytes: number;
				loadavg: number[];
				sqlite: {
					path: string;
					bytes: number | null;
					walBytes: number | null;
					shmBytes: number | null;
				};
			};
			database: {
				casts: number;
				liveCasts: number;
				fids: number;
			};
		};

		expect(body.version).toBe("1.0.0");
		expect(body.gitSha).toBe("abc1234");
		expect(Number.isNaN(Date.parse(body.startedAt))).toBe(false);
		expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
		expect(body.resources.rssBytes).toBeGreaterThan(0);
		expect(body.resources.heapUsedBytes).toBeGreaterThan(0);
		expect(body.resources.loadavg).toHaveLength(3);
		expect(body.resources.sqlite.path).toBe(dbPath);
		expect(body.resources.sqlite.bytes).toBeGreaterThan(0);
		expect(body.database).toEqual({
			casts: 2,
			liveCasts: 1,
			fids: 1,
		});
	});
});
