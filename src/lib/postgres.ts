import { Kysely } from "kysely";
import { NeonDialect } from "kysely-neon";
import { cluster } from "radash";
import invariant from "tiny-invariant";
import { UPSERT_CHUNK_SIZE, VERBOSE_LOGGING } from "../constants";
import type { Cast } from "../types";
import { pluralize } from "./util";

/*
CREATE TABLE IF NOT EXISTS casts (
    hash VARCHAR(44) NOT NULL PRIMARY KEY, -- 0x prefix + 42 hex chars
    fid INTEGER NOT NULL,
    timestamp VARCHAR(20) NOT NULL, -- Unix timestamp in milliseconds
    deleted_at VARCHAR(20) -- Unix timestamp in milliseconds, nullable
);
*/

interface Database {
	casts: {
		hash: string;
		fid: number;
		timestamp: string;
		deleted_at: string | null;
	};
}

const db = () => {
	invariant(process.env.DATABASE_URL, "DATABASE_URL is not set");

	return new Kysely<Database>({
		dialect: new NeonDialect({ connectionString: process.env.DATABASE_URL }),
	});
};

const CURSOR_VERSION = "v1";
const CURSOR_SALT = 42069;

const encodeCursor = (timestamp: string): string => {
	// Convert timestamp to number, add salt, then back to string
	const saltedTimestamp = (Number.parseInt(timestamp) + CURSOR_SALT).toString();
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
		return (Number.parseInt(saltedTimestamp) - CURSOR_SALT).toString();
	} catch (e) {
		console.error("Invalid cursor format:", e);
		return undefined;
	}
};

export const upsertCasts = async (castsToUpsert: Cast[]) => {
	let modified = 0;
	for (const batch of cluster(castsToUpsert, UPSERT_CHUNK_SIZE)) {
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

	VERBOSE_LOGGING && console.log(`upserted ${modified} out of ${pluralize(castsToUpsert.length, "cast")}`);

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
