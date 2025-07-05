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

export const getProNftDetails = async (
	fid: number,
): Promise<ProNftDetails | undefined> => {
	const above10k = mvr
		.split("\n")
		.map((l, idx) => {
			const line = l.split(`\",\"`);
			const d: ProNftDetails = {
				fid: Number(line[0].replace(`\"`, "")),
				order: 10000 + idx,
				timestamp: Number(line[6].replace('"', "")),
			};
			return d;
		})
		.find((line) => line.fid === fid);
	if (above10k) {
		return above10k;
	}

	const snapshotCsv = dwr
		.split("\n")
		.filter((line) => line.includes(`,${fid},`))
		.map((line) => line.split(","))
		.map((line) => {
			const d: ProNftDetails = {
				fid: Number(line[1]),
				order: Number(line[0]),
				timestamp: Number(line[2]),
			};
			return d;
		})
		.find((line) => line.fid === fid);
	if (snapshotCsv) {
		return snapshotCsv;
	}

	const events = await db()
		.selectFrom("purchaseTierEvent")
		.selectAll()
		.where("fid", "=", fid)
		.executeTakeFirst();
	if (!events) {
		return undefined;
	}

	const ret = {
		fid: Number(events.fid),
		order: Number(events.block_number),
		timestamp: Number(events.block_timestamp),
	};
	return ret;
};
