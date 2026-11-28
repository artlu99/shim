import { getHaatzCastsByFid, getHaatzChannelFeed } from "./haatz-gateway";

/*
	Corpus growth and channel feeds pull from Hypersnap's /v1 gateway only.
	A clean empty answer is a miss; a Hypersnap outage throws and callers
	fail loudly. A silent "empty" during an outage would be a lie the
	corpus keeps.
*/

export const syncCastsByFid = async (
	fid: number,
	maxMessages?: number,
	sinceTimestamp?: number,
	options?: { upsert?: boolean },
) => {
	try {
		return await getHaatzCastsByFid(
			fid,
			maxMessages,
			sinceTimestamp,
			options,
		);
	} catch (error) {
		throw new Error(
			`cast sync outage for fid ${fid}: ${
				error instanceof Error ? error.message : JSON.stringify(error)
			}`,
		);
	}
};

export const syncChannelFeed = async (parentUrl: string, limit?: number) => {
	try {
		return await getHaatzChannelFeed(parentUrl, limit);
	} catch (error) {
		throw new Error(
			`channel feed outage for ${parentUrl}: ${
				error instanceof Error ? error.message : JSON.stringify(error)
			}`,
		);
	}
};
