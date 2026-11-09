import { Database as SqliteDatabase, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
	Kysely,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler,
	type CompiledQuery,
	type DatabaseConnection,
	type Dialect,
	type Driver,
	type QueryResult,
} from "kysely";
import { cluster } from "radash";
import { UPSERT_CHUNK_SIZE, VERBOSE_LOGGING } from "../constants";
import type { Cast } from "../types";
import { pluralize } from "./util";

/*
	SQLite (bun:sqlite) store for casts.

	- DDL below is applied automatically on first open. It also migrates:
	  the legacy follows table is dropped on open (nothing has read or
	  written it since the Neon removal).
	- WAL + synchronous=NORMAL: consistent across app crashes, may lose the
	  last few commits on OS/power crash — acceptable for a cache of hub data.
	- PRAGMA case_sensitive_like=ON keeps prefix lookups case-sensitive
	  (SQLite defaults to case-insensitive ASCII), which lets the hash PK
	  serve LIKE 'prefix%' range scans.
	- Cursor format is v1:salted-base64.
	- A new file starts empty. Copy a VACUUM INTO snapshot from a potato that
	  already has history, or let /refresh fill from the hub.
*/

const DDL = `
CREATE TABLE IF NOT EXISTS casts (
	hash VARCHAR(44) NOT NULL PRIMARY KEY, -- 0x prefix + 42 hex chars
	fid INTEGER NOT NULL,
	timestamp VARCHAR(20) NOT NULL, -- Unix timestamp in seconds
	deleted_at VARCHAR(20) -- Unix timestamp in seconds, nullable
);

CREATE INDEX IF NOT EXISTS casts_timestamp_desc_idx
	ON casts (timestamp DESC)
	WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS casts_fid_timestamp_idx
	ON casts (fid, timestamp DESC)
	WHERE deleted_at IS NULL;

-- migration: the follows table is dead (no reader, no writer since the
-- Neon removal); drop it from stores created by older builds
DROP TABLE IF EXISTS follows;
`;

export const DEFAULT_SQLITE_PATH = "data/shim.sqlite";

export interface Database {
	casts: {
		hash: string;
		fid: number;
		timestamp: string;
		deleted_at: string | null;
	};
}

const openSqlite = (path: string): SqliteDatabase => {
	if (path !== ":memory:") {
		mkdirSync(dirname(path), { recursive: true });
	}
	const sqlite = new SqliteDatabase(path);
	sqlite.exec("PRAGMA journal_mode = WAL");
	sqlite.exec("PRAGMA synchronous = NORMAL");
	sqlite.exec("PRAGMA busy_timeout = 5000");
	sqlite.exec("PRAGMA cache_size = -64000"); // 64 MB page cache
	sqlite.exec("PRAGMA case_sensitive_like = ON");
	sqlite.exec(DDL);
	return sqlite;
};

// one connection for the whole process: queries serialize through bun:sqlite's
// synchronous API, same as they would queue on PGlite or a pg pool of 1
class SingleConnectionDriver implements Driver {
	constructor(private readonly sqlite: SqliteDatabase) {}

	async init() {}
	async acquireConnection(): Promise<DatabaseConnection> {
		const sqlite = this.sqlite;
		const runQuery = async <R>(
			query: CompiledQuery,
		): Promise<QueryResult<R>> => {
			const statement = sqlite.prepare(query.sql);
			const parameters = query.parameters as SQLQueryBindings[];
			// SELECT/WITH/VALUES and any ...RETURNING produce rows; the rest
			// of this module's generated SQL is INSERT/DELETE without RETURNING
			const reads =
				/^\s*(select|values|with)\b/i.test(query.sql) ||
				/\breturning\b/i.test(query.sql);
			if (reads) {
				const rows = statement.all(...parameters) as R[];
				return { rows };
			}
			const { changes } = statement.run(...parameters);
			return { rows: [], numAffectedRows: BigInt(changes) };
		};
		return {
			executeQuery: runQuery,
			streamQuery: async function* <R>(query: CompiledQuery) {
				yield await runQuery<R>(query);
			},
		};
	}
	async beginTransaction() {
		this.sqlite.exec("BEGIN");
	}
	async commitTransaction() {
		this.sqlite.exec("COMMIT");
	}
	async rollbackTransaction() {
		this.sqlite.exec("ROLLBACK");
	}
	async releaseConnection() {}
	async destroy() {
		this.sqlite.close();
	}
}

const bunSqliteDialect = (sqlite: SqliteDatabase): Dialect => ({
	createAdapter: () => new SqliteAdapter(),
	createDriver: () => new SingleConnectionDriver(sqlite),
	createIntrospector: (kysely: Kysely<any>) => new SqliteIntrospector(kysely),
	createQueryCompiler: () => new SqliteQueryCompiler(),
});

export const createSqliteKysely = (path: string): Kysely<Database> =>
	new Kysely<Database>({ dialect: bunSqliteDialect(openSqlite(path)) });

let dbInstance: Kysely<Database> | null = null;

const db = () => {
	if (!dbInstance) {
		dbInstance = createSqliteKysely(process.env.SQLITE_PATH ?? DEFAULT_SQLITE_PATH);
	}
	return dbInstance;
};

// test/script helper: closes the file and resets the singleton so the next
// db() call reopens it
export const closeDb = async () => {
	if (dbInstance) {
		await dbInstance.destroy();
		dbInstance = null;
	}
};

const CURSOR_VERSION = "v1";
const CURSOR_SALT = 42069;

const encodeCursor = (timestamp: string): string => {
	// Convert timestamp to number, add salt, then back to string
	const saltedTimestamp = (
		Number.parseInt(timestamp, 10) + CURSOR_SALT
	).toString();
	return `${CURSOR_VERSION}:${btoa(saltedTimestamp)}`;
};

const decodeCursor = (cursor: string): string | undefined => {
	try {
		const [version, encodedTimestamp] = cursor.split(":");
		if (version !== CURSOR_VERSION) {
			console.error("Invalid cursor version:", version);
			return undefined;
		}
		// Decode base64, convert to number, subtract salt, then back to string
		const saltedTimestamp = atob(encodedTimestamp);
		return (Number.parseInt(saltedTimestamp, 10) - CURSOR_SALT).toString();
	} catch (e) {
		console.error("Invalid cursor format:", e);
		return undefined;
	}
};

export const upsertCasts = async (castsToUpsert: Cast[]) => {
	// Commit older casts first. Chunks are separate writes; if a later chunk
	// throws, the watermark stays at the newest row that landed and the next
	// refresh backfills the rest. Newest-first would seal the top of the
	// batch and leave a gap behind it.
	const oldestFirst = [...castsToUpsert].sort(
		(a, b) => a.timestamp - b.timestamp,
	);

	let modified = 0;
	for (const batch of cluster(oldestFirst, UPSERT_CHUNK_SIZE)) {
		const result = await db()
			.insertInto("casts")
			.values(
				batch.map((cast) => ({
					hash: cast.hash,
					fid: cast.fid,
					timestamp: cast.timestamp.toString(),
				})),
			)
			.onConflict((oc) => oc.column("hash").doNothing())
			.returning("hash")
			.execute();

		// Count the number of rows that were actually inserted
		modified += result.length;
	}

	VERBOSE_LOGGING &&
		console.log(
			`upserted ${modified} out of ${pluralize(castsToUpsert.length, "cast")}`,
		);

	return modified;
};

export const getCastByHash = async (hash: string) => {
	const cast = await db()
		.selectFrom("casts")
		.selectAll()
		.where("hash", "=", hash)
		.where("deleted_at", "is", null)
		.limit(1)
		.executeTakeFirst();

	return cast;
};

export const getCastByShortHash = async (shortHash: string) => {
	const cast = await db()
		.selectFrom("casts")
		.selectAll()
		.where("hash", "like", `${shortHash}%`)
		.where("deleted_at", "is", null)
		.limit(1)
		.executeTakeFirst();
	return cast;
};

export const getStats = async (topN = 5) => {
	const [totalStats, topFids] = await Promise.all([
		db()
			.selectFrom("casts")
			.select((eb) => [
				eb.fn.countAll().as("count"),
				eb.fn.count("fid").distinct().as("numFids"),
				eb.fn.min("timestamp").as("earliest"),
				eb.fn.max("timestamp").as("latest"),
			])
			.executeTakeFirst(),
		db()
			.selectFrom("casts")
			.select((eb) => [
				"fid",
				eb.fn.countAll().as("count"),
				eb.fn.min("timestamp").as("earliest"),
				eb.fn.max("timestamp").as("latest"),
			])
			.groupBy("fid")
			.orderBy("count", "desc")
			.limit(topN)
			.execute(),
	]);

	return { total: totalStats, topFids };
};

const countOf = (value: unknown): number => {
	const n = Number(value ?? 0);
	return Number.isFinite(n) ? n : 0;
};

export const sqliteFilePath = (): string =>
	process.env.SQLITE_PATH ?? DEFAULT_SQLITE_PATH;

// Cheap local counts for /info. No username lookups, no top-N scan.
export const getInfoCounts = async () => {
	const [casts, liveCasts, fids] = await Promise.all([
		db()
			.selectFrom("casts")
			.select((eb) => eb.fn.countAll().as("n"))
			.executeTakeFirst(),
		db()
			.selectFrom("casts")
			.select((eb) => eb.fn.countAll().as("n"))
			.where("deleted_at", "is", null)
			.executeTakeFirst(),
		db()
			.selectFrom("casts")
			.select((eb) => eb.fn.count("fid").distinct().as("n"))
			.where("deleted_at", "is", null)
			.executeTakeFirst(),
	]);

	return {
		casts: countOf(casts?.n),
		liveCasts: countOf(liveCasts?.n),
		fids: countOf(fids?.n),
	};
};

export const getLatestCastTimestamps = async (
	fids: number[],
): Promise<Map<number, number>> => {
	if (fids.length === 0) {
		return new Map();
	}
	// timestamps are fixed-width unix-seconds strings, so lexicographic MAX
	// is numeric MAX
	const rows = await db()
		.selectFrom("casts")
		.select((eb) => [eb.ref("fid").as("fid"), eb.fn.max("timestamp").as("latest")])
		.where("fid", "in", fids)
		.where("deleted_at", "is", null)
		.groupBy("fid")
		.execute();
	return new Map(rows.map((row) => [Number(row.fid), Number(row.latest)]));
};

export const getReverseChronFeed = async (
	fids: number[],
	limit = 10,
	cursor?: string,
) => {
	const cursorTimestamp = cursor ? decodeCursor(cursor) : undefined;

	// Build the query
	const feed = await db()
		.selectFrom("casts")
		.selectAll()
		.where((eb) => {
			const conditions = [eb("fid", "in", fids)];
			if (cursorTimestamp) {
				conditions.push(eb("timestamp", "<", cursorTimestamp));
			}
			return eb.and(conditions);
		})
		.where("deleted_at", "is", null)
		.orderBy("timestamp", "desc")
		.limit(limit + 1)
		.execute();

	// Check if there are more results
	const hasMore = feed.length > limit;
	const results = hasMore ? feed.slice(0, -1) : feed;

	// Generate next cursor if there are more results
	const nextCursor = hasMore
		? encodeCursor(results[results.length - 1].timestamp)
		: undefined;

	return {
		items: results,
		nextCursor,
	};
};
