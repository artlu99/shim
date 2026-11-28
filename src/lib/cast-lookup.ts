import type { Cast } from "../types";
import { getHypersnapCastByFidAndHash } from "./hypersnap";

/*
	Single-cast resolution against Hypersnap. undefined means a clean
	not_found. A throw means Hypersnap failed without answering — the
	verdict is withheld, and the caller must answer 503. Converting that
	to a miss would declare a cast invalid on a question the network
	never got to answer.
*/

export type CastOrigin = "hypersnap";

export interface EitherWorldCast {
	cast: Cast;
	origin: CastOrigin;
}

// Concurrent readers of the same cast used to each pay a full network
// walk — /reverse-chron resolves every feed item through this primitive,
// so overlapping feed reads duplicated the same lookups at
// HTTP_FAN_OUT_BATCH_SIZE width. Coalesce like hydration.ts's user cache:
// the first caller owns the walk, everyone else on the same (fid, hash)
// awaits its promise. A shared throw is still a throw — coalescing never
// softens the outage contract. Entries are deleted on settle, so the map
// only ever holds genuinely in-flight walks; the Hypersnap leg is
// deadline-bounded (10s), so even a stalled upstream settles the flight
// and frees the entry rather than pinning callers.
const inFlight = new Map<string, Promise<EitherWorldCast | undefined>>();

export const getCastInEitherWorld = (
	fid: number,
	hash: `0x${string}`,
): Promise<EitherWorldCast | undefined> => {
	const key = `${fid}:${hash.toLowerCase()}`;
	const pending = inFlight.get(key);
	if (pending) {
		return pending;
	}
	const flight = resolveCast(fid, hash).finally(() => {
		inFlight.delete(key);
	});
	inFlight.set(key, flight);
	return flight;
};

const resolveCast = async (
	fid: number,
	hash: `0x${string}`,
): Promise<EitherWorldCast | undefined> => {
	try {
		const cast = await getHypersnapCastByFidAndHash(fid, hash);
		if (cast) return { cast, origin: "hypersnap" };
		return undefined;
	} catch (error) {
		throw new Error(
			`cast lookup outage: ${
				error instanceof Error ? error.message : JSON.stringify(error)
			}`,
		);
	}
};
