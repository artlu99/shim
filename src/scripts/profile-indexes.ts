import { Kysely, sql } from "kysely";
import { NeonDialect } from "kysely-neon";
import invariant from "tiny-invariant";
import {
	getCastByHash,
	getCastByShortHash,
	getLatestCastTimestamps,
	getReverseChronFeed,
	getStats,
} from "../lib/postgres";
import { livenessFids } from "../static/artlu";

// Profile the query shapes affected by sql/2026-10-10-casts-indexes.sql.
// Run before and after applying the index file and diff the output:
//
//   bun run profile:indexes
//
// Wall-clock is Neon-serverless round-trip time (dominated by RTT); the
// EXPLAIN ANALYZE "Execution Time" lines show the server-side cost the
// indexes actually change, plus the plan node (Seq Scan -> Index Scan).

interface CastsTable {
	hash: string;
	fid: number;
	timestamp: string;
	deleted_at: string | null;
}

interface DB {
	casts: CastsTable;
}

invariant(process.env.DATABASE_URL, "DATABASE_URL is not set");

const db = new Kysely<DB>({
	dialect: new NeonDialect({ connectionString: process.env.DATABASE_URL }),
});

// mirrors the private cursor helpers in src/lib/postgres.ts
const CURSOR_VERSION = "v1";
const CURSOR_SALT = 42069;
const encodeCursor = (ts: string): string =>
	`${CURSOR_VERSION}:${btoa((Number.parseInt(ts, 10) + CURSOR_SALT).toString())}`;

const warmStats = (runs: number[]): string => {
	const sorted = [...runs].sort((a, b) => a - b);
	const med = sorted[Math.floor(sorted.length / 2)];
	return `min/med/max ${sorted[0].toFixed(1)}/${med.toFixed(1)}/${sorted[sorted.length - 1].toFixed(1)}ms`;
};

const time = async (
	label: string,
	fn: () => Promise<unknown>,
	warmRounds = 5,
): Promise<void> => {
	const t0 = performance.now();
	await fn();
	const cold = performance.now() - t0;
	const runs: number[] = [];
	for (let i = 0; i < warmRounds; i++) {
		const start = performance.now();
		await fn();
		runs.push(performance.now() - start);
	}
	console.log(
		`${label.padEnd(46)} cold ${cold.toFixed(1)}ms | warm ${warmStats(runs)}`,
	);
};

const explain = async (label: string, query: string): Promise<void> => {
	const res = await sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql.raw(query)}`.execute(
		db,
	);
	const lines = res.rows.map((row) =>
		String(Object.values(row as Record<string, unknown>)[0]),
	);
	const exec = lines.find((l) => l.startsWith("Execution Time")) ?? "n/a";
	console.log(`\n[plan] ${label}`);
	for (const line of lines) {
		if (/(on casts|Sort Method|GroupAggregate|HashAggregate)/.test(line)) {
			console.log(`  ${line.trim()}`);
		}
	}
	console.log(`  ${exec.trim()}`);
};

const main = async (): Promise<void> => {
	console.log("== shim casts index profile ==");
	console.log(`date: ${new Date().toISOString()}`);
	console.log(
		"compare before/after applying sql/2026-10-10-casts-indexes.sql\n",
	);

	const stats = await getStats(25);
	console.log(
		`casts rows: ${stats.total?.count} | distinct fids: ${stats.total?.numFids}`,
	);

	const fids25 = livenessFids.slice(0, 25);
	const fids100 = livenessFids.slice(0, 100);

	const firstPage = await getReverseChronFeed(fids25, 10);
	const cursorRow = firstPage.items[4];
	const cursor = cursorRow ? encodeCursor(cursorRow.timestamp) : undefined;
	const sampleHash = firstPage.items[0]?.hash;

	console.log("\n-- wall clock (repo query paths) --");
	await time("feed fids=25 limit=10 (first page)", () =>
		getReverseChronFeed(fids25, 10),
	);
	if (cursor) {
		await time("feed fids=25 limit=10 (cursor)", () =>
			getReverseChronFeed(fids25, 10, cursor),
		);
	}
	await time("feed fids=100 limit=25", () =>
		getReverseChronFeed(fids100, 25),
	);
	await time("watermarks getLatestCastTimestamps(100)", () =>
		getLatestCastTimestamps(fids100),
	);
	if (sampleHash) {
		const shortHash = sampleHash.slice(0, 10);
		await time(`getCastByShortHash("${shortHash}")`, () =>
			getCastByShortHash(shortHash),
		);
		await time("getCastByHash (pk, control)", () =>
			getCastByHash(sampleHash),
		);
	}

	console.log("\n-- EXPLAIN ANALYZE (literals inlined) --");
	await explain(
		"feed first page",
		`SELECT * FROM casts WHERE fid IN (${fids25.join(",")}) AND deleted_at IS NULL ORDER BY timestamp DESC LIMIT 11`,
	);
	if (cursorRow) {
		await explain(
			"feed cursor page",
			`SELECT * FROM casts WHERE fid IN (${fids25.join(",")}) AND deleted_at IS NULL AND timestamp < '${cursorRow.timestamp}' ORDER BY timestamp DESC LIMIT 11`,
		);
	}
	await explain(
		"watermarks",
		`SELECT fid, max(timestamp) FROM casts WHERE fid IN (${fids100.join(",")}) AND deleted_at IS NULL GROUP BY fid`,
	);
	if (sampleHash) {
		await explain(
			"short hash prefix",
			`SELECT * FROM casts WHERE hash LIKE '${sampleHash.slice(0, 10)}%' AND deleted_at IS NULL LIMIT 1`,
		);
	}

	await db.destroy();
};

await main();
