import { getHaatzCastsByFid, getHaatzChannelFeed } from "./haatz-gateway";
import { getCastsByFid, rawChannelFeed } from "./hub-grpc";

/*
	The sync-side twin of cast-lookup: Snapchain and Hypersnap are forked,
	so corpus growth and channel feeds must draw from both worlds.
	Hypersnap is primary (matching the resolution order — its /v1 gateway
	travels HTTPS), Snapchain gRPC is consulted only on a clean Hypersnap
	miss (an fid with zero casts there) or a Hypersnap outage. An fid that
	answered from Hypersnap is not merged with Snapchain — same policy as
	lookup: the primary world's answer stands.

	Both legs now rethrow their outages, so a miss is only ever a clean
	empty answer. If BOTH worlds fail, the outage propagates to the
	caller — refresh counts a failed fid, feeds fail loudly. A silent
	"this world is empty" during a fork would be a lie the corpus keeps.
*/

export const syncCastsByFid = async (
	fid: number,
	maxMessages?: number,
	sinceTimestamp?: number,
	options?: { upsert?: boolean },
) => {
	let haatzError: unknown;
	try {
		const haatz = await getHaatzCastsByFid(
			fid,
			maxMessages,
			sinceTimestamp,
			options,
		);
		// a cast count is an answer; an empty answer is the clean miss that
		// sends the lookup to Snapchain — an fid with zero casts in the
		// Hypersnap world is exactly the snap-only case
		if (haatz.casts.length > 0) {
			return haatz;
		}
	} catch (error) {
		haatzError = error;
		console.error(
			"syncCastsByFid: haatz gateway unavailable, falling back to snapchain:",
			fid,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
	}

	try {
		return await getCastsByFid(fid, maxMessages, sinceTimestamp, options);
	} catch (error) {
		const parts = [haatzError, error]
			.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)))
			.join(" | ");
		throw new Error(`cast sync outage for fid ${fid}: ${parts}`);
	}
};

export const syncChannelFeed = async (parentUrl: string, limit?: number) => {
	let haatzError: unknown;
	try {
		const haatz = await getHaatzChannelFeed(parentUrl, limit);
		if (haatz.casts.length > 0) {
			return haatz;
		}
	} catch (error) {
		haatzError = error;
		console.error(
			"syncChannelFeed: haatz gateway unavailable, falling back to snapchain:",
			parentUrl,
			error instanceof Error ? error.message : JSON.stringify(error),
		);
	}

	try {
		return await rawChannelFeed(parentUrl, limit);
	} catch (error) {
		const parts = [haatzError, error]
			.map((e) => (e instanceof Error ? e.message : JSON.stringify(e)))
			.join(" | ");
		throw new Error(`channel feed outage for ${parentUrl}: ${parts}`);
	}
};
