import { Kysely } from "kysely";
import { NeonDialect } from "kysely-neon";
import invariant from "tiny-invariant";
import { csv as dwr } from "../static/dwr";
import { csv as mvr } from "../static/mvr";
import type { ProNftDetails } from "../types";

interface PonderIndexedEvents {
	purchaseTierEvent: {
		id: string;
		fid: number;
		tier: number;
		for_days: number;
		payer: string;
		block_number: number;
		block_timestamp: number;
		transaction_hash: string;
	};
}

let dbInstance: Kysely<PonderIndexedEvents> | null = null;
const db = () => {
	if (!dbInstance) {
		invariant(
			process.env.DATABASE_URL_PRO_NFT,
			"PONDER_INDEXED_EVENTS_DATABASE_URL is not set",
		);
		dbInstance = new Kysely<PonderIndexedEvents>({
			dialect: new NeonDialect({
				connectionString: process.env.DATABASE_URL_PRO_NFT,
			}),
		});
	}
	return dbInstance;
};

// The CSV snapshots are static in production, so parse each into a fid ->
// details Map at most once. The raw csv string is kept as the cache key:
// tests re-mock the static modules between cases, and a changed csv string
// invalidates the memo (live bindings make the comparison exact).
let mvrCacheKey: string | null = null;
let mvrIndex: Map<number, ProNftDetails> | null = null;

const getMvrIndex = () => {
	if (mvrIndex && mvrCacheKey === mvr) {
		return mvrIndex;
	}
	const index = new Map<number, ProNftDetails>();
	let idx = 0;
	for (const line of mvr.split("\n")) {
		// idx mirrors the original map-over-filtered-lines position, which
		// counts the header and skipped short lines too
		if (line.trim() !== "") {
			const fields = line.split(`","`);
			if (fields.length >= 7) {
				const parsedFid = Number(fields[0].replace(`"`, ""));
				if (!Number.isNaN(parsedFid) && !index.has(parsedFid)) {
					index.set(parsedFid, {
						fid: parsedFid,
						order: 10000 + idx,
						timestamp: Number(fields[6].replace('"', "")),
						expires: 1781630383, // smart contract was deployed later
					});
				}
			}
			idx++;
		}
	}
	mvrCacheKey = mvr;
	mvrIndex = index;
	return index;
};

let dwrCacheKey: string | null = null;
let dwrIndex: Map<number, ProNftDetails> | null = null;

const getDwrIndex = () => {
	if (dwrIndex && dwrCacheKey === dwr) {
		return dwrIndex;
	}
	const index = new Map<number, ProNftDetails>();
	for (const line of dwr.split("\n")) {
		if (line.trim() === "") {
			continue;
		}
		const fields = line.split(",");
		if (fields.length >= 3) {
			const parsedFid = Number(fields[1]);
			if (!Number.isNaN(parsedFid) && !index.has(parsedFid)) {
				index.set(parsedFid, {
					fid: parsedFid,
					order: Number(fields[0]),
					timestamp: Number(fields[2]),
					expires: 1781630383, // smart contract was deployed later
				});
			}
		}
	}
	dwrCacheKey = dwr;
	dwrIndex = index;
	return index;
};

export const getProNftDetails = async (
	fid: number,
): Promise<ProNftDetails | undefined> => {
	const above10k = getMvrIndex().get(fid);
	if (above10k) {
		return above10k;
	}

	const snapshotCsv = getDwrIndex().get(fid);
	if (snapshotCsv) {
		return snapshotCsv;
	}

	const events = await db()
		.selectFrom("purchaseTierEvent")
		.selectAll()
		.where("fid", "=", fid)
		.orderBy("block_timestamp", "desc")
		.limit(1)
		.executeTakeFirst();
	if (!events) {
		return undefined;
	}

	const ret = {
		fid: Number(events.fid),
		order: Number(events.block_number),
		timestamp: Number(events.block_timestamp),
		expires:
			Number(events.block_timestamp) + 60 * 60 * 24 * Number(events.for_days), // for_days days from timestamp
	};
	return ret;
};
