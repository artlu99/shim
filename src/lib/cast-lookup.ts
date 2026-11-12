import type { Cast } from "../types";
import { getCastById } from "./hub-grpc";
import { getHypersnapCastByFidAndHash } from "./hypersnap";

/*
	Snapchain and Hypersnap are forked: a message on one is not guaranteed
	on the other, so no single network's miss decides whether a cast
	exists. This is shim's fork-aware cast primitive — "valid on either
	world counts". Hypersnap is primary: it answers first, and Snapchain
	is consulted only on a Hypersnap miss (clean 404 on its hash-only
	index, or a hit naming a different author). Snapchain's shape is
	canonical (signer, raw mention placeholders) but that upgrade path is
	not worth a second network hop while Hypersnap is answering.

	The contract the routes rely on: undefined means BOTH worlds cleanly
	answered not_found — a real miss. A throw means no world answered
	with the cast and at least one leg failed — the verdict is withheld,
	and the caller must answer 503. Converting that to a miss would
	declare a cast invalid on a question the network never got to answer.
*/

export type CastOrigin = "hypersnap" | "snapchain";

export interface EitherWorldCast {
	cast: Cast;
	origin: CastOrigin;
}

export const getCastInEitherWorld = async (
	fid: number,
	hash: `0x${string}`,
): Promise<EitherWorldCast | undefined> => {
	let hypersnapError: unknown;
	try {
		const cast = await getHypersnapCastByFidAndHash(fid, hash);
		if (cast) return { cast, origin: "hypersnap" };
	} catch (error) {
		// Hypersnap outage or malformed answer — withhold the verdict
		// until the other world has had its turn
		hypersnapError = error;
	}

	let snapchainError: unknown;
	try {
		const cast = await getCastById(fid, hash);
		if (cast) return { cast, origin: "snapchain" };
	} catch (error) {
		snapchainError = error;
	}

	if (hypersnapError || snapchainError) {
		const parts = [hypersnapError, snapchainError]
			.filter((error) => error !== undefined)
			.map((error) =>
				error instanceof Error ? error.message : JSON.stringify(error),
			);
		throw new Error(`cast lookup outage: ${parts.join(" | ")}`);
	}

	return undefined;
};
