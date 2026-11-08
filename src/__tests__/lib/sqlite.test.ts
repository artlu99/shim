import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	closeDb,
	getCastByHash,
	getCastByShortHash,
	getLatestCastTimestamps,
	getReverseChronFeed,
	getStats,
	insertFollows,
	upsertCasts,
} from "../../lib/sqlite";
import type { Cast } from "../../types";

// offline suite: exercises every sqlite.ts export against a temp file DB so
// nothing here touches the hub or lmdis
const dbPath = join(mkdtempSync(join(tmpdir(), "shim-sqlite-test-")), "test.sqlite");

// the singleton reads SQLITE_PATH on first use, so set it before any query
process.env.SQLITE_PATH = dbPath;

// synthetic but realistic hashes/timestamps; fixed-width unix-seconds keeps
// lexicographic == numeric order, same invariant the real data relies on.
// the varying hex sits at the FRONT of the hash (real hashes are random), so
// short prefixes stay unique — all-zero-padding would collide by construction
const hash = (n: number): `0x${string}` =>
	`0x${n.toString(16).padStart(8, "0")}${"f".repeat(32)}`;
const ts = (n: number) => (1700000000 + n * 60).toString();

const seedCasts = (count: number, startFid = 100): Cast[] =>
	[...Array(count)].map((_, i) => ({
		fid: startFid + (i % 3),
		hash: hash(i),
		text: null,
		rawText: null,
		embeds: [],
		mentions: [],
		mentionsPositions: [],
		timestamp: 1700000000 + i * 60,
		signer: `0x${"0".repeat(40)}`,
	}));

describe("sqlite store", () => {
	beforeAll(async () => {
		await upsertCasts(seedCasts(90));
	});

	afterAll(async () => {
		await closeDb();
	});

	describe("upsertCasts", () => {
		it("counts only newly inserted rows on conflict", async () => {
			const modified = await upsertCasts(seedCasts(30));
			expect(modified).toBe(0);
			const modified2 = await upsertCasts(seedCasts(100));
			expect(modified2).toBe(10);
		});
	});

	describe("getCastByHash", () => {
		it("finds an existing live cast", async () => {
			const cast = await getCastByHash(hash(5));
			expect(cast).toMatchObject({ hash: hash(5), fid: 102, timestamp: ts(5) });
		});

		it("returns undefined for unknown hash", async () => {
			expect(await getCastByHash(hash(99999))).toBeUndefined();
		});

		it("hides casts with deleted_at set", async () => {
			// nothing in app code writes deleted_at; refresh just never re-ups
			// deleted casts — simulate hub-side deletion through a second
			// connection the way an out-of-band cleanup would
			const side = new Database(dbPath);
			side.run("UPDATE casts SET deleted_at = ? WHERE hash = ?", [
				ts(6),
				hash(6),
			]);
			side.close();

			expect(await getCastByHash(hash(6))).toBeUndefined();
		});
	});

	describe("getCastByShortHash", () => {
		it("resolves a prefix", async () => {
			const cast = await getCastByShortHash(hash(7).slice(0, 14));
			expect(cast?.hash).toBe(hash(7));
		});

		it("stays case-sensitive like Postgres", async () => {
			const upperPrefix = hash(7).slice(0, 14).toUpperCase();
			expect(await getCastByShortHash(upperPrefix)).toBeUndefined();
		});
	});

	describe("getReverseChronFeed", () => {
		it("returns newest first and respects limit", async () => {
			const page = await getReverseChronFeed([100, 101, 102], 10);
			expect(page.items).toHaveLength(10);
			const timestamps = page.items.map((row) => Number(row.timestamp));
			expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
		});

		it("pages without overlap via cursor", async () => {
			const page1 = await getReverseChronFeed([100, 101, 102], 10);
			expect(page1.nextCursor).toBeDefined();
			const page2 = await getReverseChronFeed(
				[100, 101, 102],
				10,
				page1.nextCursor,
			);
			const seen = new Set(page1.items.map((row) => row.hash));
			for (const row of page2.items) {
				expect(seen.has(row.hash)).toBe(false);
			}
			expect(Number(page2.items[0].timestamp)).toBeLessThan(
				Number(page1.items[9].timestamp),
			);
		});

		it("treats an invalid cursor as absent", async () => {
			const page = await getReverseChronFeed([100, 101, 102], 10, "v0:zzzz");
			expect(page.items).toHaveLength(10);
		});

		it("omits deleted casts", async () => {
			const fids = [100, 101, 102];
			const withDeleted = await getReverseChronFeed(fids, 90);
			expect(withDeleted.items.some((row) => row.hash === hash(6))).toBe(
				false,
			);
		});
	});

	describe("getLatestCastTimestamps", () => {
		it("maps each fid to its max timestamp", async () => {
			// by this point the upsertCasts test has topped the table up to
			// n = 0..99, so the highest n with fid 100 (n % 3 == 0) is 99
			const watermarks = await getLatestCastTimestamps([100, 101, 102]);
			expect(watermarks.get(100)).toBe(Number(ts(99)));
			expect(watermarks.size).toBe(3);
		});

		it("returns an empty map for no fids", async () => {
			expect((await getLatestCastTimestamps([])).size).toBe(0);
		});
	});

	describe("getStats", () => {
		it("counts all rows including deleted ones", async () => {
			// getStats has no deleted_at filter; 100 rows total, one deleted
			const { total, topFids } = await getStats(3);
			expect(Number(total?.count)).toBe(100);
			expect(Number(total?.numFids)).toBe(3);
			// fid 100 owns every n % 3 == 0 row (34 of them, incl. the deleted one)
			expect(topFids[0]).toMatchObject({ fid: 100, count: 34 });
		});
	});

	describe("insertFollows", () => {
		it("replaces a fid's graph and counts inserted rows", async () => {
			const inserted = await insertFollows([
				{ fid: 1, target: 2 },
				{ fid: 1, target: 3 },
			]);
			expect(inserted).toBe(2);

			const replaced = await insertFollows([{ fid: 1, target: 4 }]);
			expect(replaced).toBe(1);
		});
	});

	describe("persistence", () => {
		it("survives close and reopen of the file", async () => {
			await closeDb();
			const cast = await getCastByHash(hash(5));
			expect(cast).toMatchObject({ hash: hash(5) });
		});
	});
});
