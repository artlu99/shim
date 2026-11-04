import { Kysely } from "kysely";
import { NeonDialect } from "kysely-neon";
import { cluster } from "radash";
import invariant from "tiny-invariant";
import {
	createSqliteKysely,
	DEFAULT_SQLITE_PATH,
} from "../lib/sqlite";

// Seed the local SQLite store from the Neon database the main branch uses.
// Idempotent: casts keyset-paginate on the hash PK and both sides use
// ON CONFLICT DO NOTHING, so re-running only tops up new rows.
//
//   SQLITE_PATH=data/shim.sqlite bun run backfill:sqlite

interface NeonDB {
	casts: {
		hash: string;
		fid: number;
		timestamp: string;
		deleted_at: string | null;
	};
	follows: {
		fid: number;
		target: number;
	};
}

invariant(process.env.DATABASE_URL, "DATABASE_URL is not set");

// NeonDialect (HTTP) like profile-indexes.ts; pages stay small because the
// serverless driver dislikes multi-MB responses
const neon = new Kysely<NeonDB>({
	dialect: new NeonDialect({ connectionString: process.env.DATABASE_URL }),
});

const targetPath = process.env.SQLITE_PATH ?? DEFAULT_SQLITE_PATH;
console.log(`backfilling casts + follows from Neon into ${targetPath}`);
const sqlite = createSqliteKysely(targetPath);

// Neon orders hashes under C collation (byte order); SQLite compares
// VARCHARs byte-wise too, so keyset pagination is stable across the two.
// Re-running after a new refresh against Neon inserts only the delta.
const CAST_PAGE_SIZE = 10_000;
const INSERT_CHUNK_SIZE = 1_000;

let lastHash: string | null = null;
let copied = 0;
for (;;) {
	const page = await neon
		.selectFrom("casts")
		.selectAll()
		.$if(lastHash !== null, (qb) => qb.where("hash", ">", lastHash!))
		.orderBy("hash")
		.limit(CAST_PAGE_SIZE)
		.execute();

	if (page.length === 0) break;
	lastHash = page[page.length - 1].hash;

	for (const batch of cluster(page, INSERT_CHUNK_SIZE)) {
		await sqlite
			.insertInto("casts")
			.values(batch)
			.onConflict((oc) => oc.column("hash").doNothing())
			.execute();
	}
	copied += page.length;
	console.log(`casts: ${copied} read (through ${lastHash.slice(0, 18)}…)`);
}

const follows = await neon.selectFrom("follows").selectAll().execute();
for (const batch of cluster(follows, INSERT_CHUNK_SIZE)) {
	await sqlite
		.insertInto("follows")
		.values(batch)
		.onConflict((oc) => oc.columns(["fid", "target"]).doNothing())
		.execute();
}
console.log(`follows: ${follows.length} copied`);

// verify counts line up before declaring victory
const [neonCasts, sqliteCasts] = await Promise.all([
	neon.selectFrom("casts").select((eb) => eb.fn.countAll().as("n")).executeTakeFirst(),
	sqlite.selectFrom("casts").select((eb) => eb.fn.countAll().as("n")).executeTakeFirst(),
]);
const [neonFollows, sqliteFollows] = await Promise.all([
	neon.selectFrom("follows").select((eb) => eb.fn.countAll().as("n")).executeTakeFirst(),
	sqlite.selectFrom("follows").select((eb) => eb.fn.countAll().as("n")).executeTakeFirst(),
]);
console.log(
	`verify casts: neon=${neonCasts?.n} sqlite=${sqliteCasts?.n}`,
);
console.log(
	`verify follows: neon=${neonFollows?.n} sqlite=${sqliteFollows?.n}`,
);

await sqlite.destroy();
await neon.destroy();
