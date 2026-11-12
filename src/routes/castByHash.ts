import { Elysia, t } from "elysia";
import { getCastInEitherWorld } from "../lib/cast-lookup";
import { getHypersnapCastByHash } from "../lib/hypersnap";
import { getUserByFid } from "../lib/hydration";
import { getCastByShortHash, upsertCasts } from "../lib/sqlite";
import { getChannel, getChannelIdFromUrl } from "../lib/warpcast";
import { processFids } from "./refresh";
import { type Cast, CastSchema } from "../types";

/*
	/h answers cast lookups that carry only a hash — no fid, no username.

	Snapchain and Hypersnap are forked: a message on one is not guaranteed
	on the other, so no single network's miss decides existence. A hash on
	either world is valid.

	Resolution order:
	1. Local index (SQLite prefix match). Warm hashes answer from here, and
	   it is the only short-hash resolver anywhere: the hub requires fid +
	   hash, and no network API accepts a short hash. With the fid the
	   lookup continues through the fork-aware primitive: Hypersnap is
	   primary, Snapchain is consulted only on a Hypersnap miss — a miss
	   on one is not a verdict.
	2. Local miss with a full hash → Hypersnap's hash-only index
	   (/v2/farcaster/cast?type=hash), the only hash-only source anywhere
	   and the primary world. Its 404 is authoritative for its world, but
	   Snapchain is keyed fid + hash everywhere, so a cold Snapchain-world
	   hash has no hash-only source and is unresolvable here; /i (with the
	   fid) reaches it, and the local corpus growing behind replies shrinks
	   the residual. A transport failure answers 503 — an outage, never a
	   verdict.

	On a cold network hit the fid becomes known: the caller is answered
	from the hash-only index (the primary world — no second network hop
	while it is answering), and an author refresh runs fire-and-forget so
	the local corpus grows behind the reply.
*/

// 0x + 40 hex chars. Short hashes cannot traverse the network path.
const isFullHash = (hash: string): hash is `0x${string}` =>
	/^0x[0-9a-f]{40}$/.test(hash);

// One background refresh per fid at a time — a burst of cold-hash lookups
// by the same author costs one hub walk, not one per request.
const refreshingFids = new Set<number>();

const kickFidRefresh = (fid: number) => {
	if (refreshingFids.has(fid)) return;
	refreshingFids.add(fid);
	void processFids([fid])
		.catch((error) => {
			console.error(
				"Background refresh failed:",
				fid,
				error instanceof Error ? error.message : JSON.stringify(error),
			);
		})
		.finally(() => {
			refreshingFids.delete(fid);
		});
};

const hydrateChannel = async (cast: Cast) => {
	const channelId = cast.parentUrl
		? getChannelIdFromUrl(cast.parentUrl)
		: undefined;
	return channelId ? await getChannel(channelId) : undefined;
};

const outage = (
	set: { status?: number | string },
	where: string,
	error: unknown,
) => {
	console.error(
		`${where}: cast lookup outage:`,
		error instanceof Error ? error.message : JSON.stringify(error),
	);
	set.status = 503;
	return {
		success: false,
		error: `${where}: cast lookup outage`,
	};
};

export const getCastByHash = new Elysia().get(
	"/h/:castHash",
	async ({ params: { castHash }, set }) => {
		const hash: `0x${string}` = `0x${castHash
			.replace(/^0x/, "")
			.toLowerCase()}`;

		// 1. local index — warm hashes, and every short hash
		const castDbObj = await getCastByShortHash(hash);
		if (castDbObj) {
			const { fid } = castDbObj;

			// the fork-aware verdict: Snapchain miss is not a miss while
			// Hypersnap is unchecked — a miss here means both worlds
			// answered not_found (deleted on both, or never existed)
			let result;
			try {
				result = await getCastInEitherWorld(fid, hash);
			} catch (error) {
				return outage(set, "getCastByHash", error);
			}
			if (!result) {
				return {
					success: false,
					error: "getCastByHash: Cast not found",
				};
			}

			const { cast } = result;
			const user = await getUserByFid(fid);
			const channel = await hydrateChannel(cast);

			return {
				success: true,
				cast: { ...cast, user, channel },
			};
		}

		// 2. local miss — only full hashes can resolve against the network
		if (!isFullHash(hash)) {
			return {
				success: false,
				error: "getCastByHash: Cast not found",
			};
		}

		let seeded: Cast;
		try {
			const found = await getHypersnapCastByHash(hash);
			if (!found) {
				// authoritative for Hypersnap's world. A Snapchain-world
				// hash absent from the local corpus is unresolvable by
				// hash alone — see the header comment.
				return {
					success: false,
					error: "getCastByHash: Cast not found",
				};
			}
			seeded = found;
		} catch (error) {
			return outage(set, "getCastByHash: hash-only index", error);
		}

		const fid = seeded.fid;

		// priority one: answer the caller. Hypersnap is primary and the
		// hash-only index already answered — no second network hop while
		// it is answering. The seeded cast is the client-API shape
		// (lossy: no signer, no raw mention placeholders).
		const user = await getUserByFid(fid);
		const cast = seeded;

		// index this hash so the next lookup for it is a local hit. The
		// seed row can sit above a cold fid's backfill frontier (the walk
		// is genesis-forward, oldest 10k per run) — that seals the gap
		// behind it, and that is accepted: the corpus is a cache, every
		// consumer of /h self-heals a hole via the hash-only index, and
		// skipping the seed instead re-walks genesis-forward on every
		// repeat lookup, which never converges.
		try {
			await upsertCasts([cast]);
		} catch (error) {
			console.error(
				"Error upserting single cast:",
				error instanceof Error ? error.message : JSON.stringify(error),
			);
		}

		// corpus growth for the author — fire and forget, never in the
		// reply path
		kickFidRefresh(fid);

		const channel = await hydrateChannel(cast);

		return {
			success: true,
			cast: { ...cast, user, channel },
		};
	},
	{
		params: t.Object({ castHash: t.String() }),
		detail: {
			tags: ["Cast"],
			summary: "Get cast by hash",
			description:
				"Resolves warm hashes from the local index and cold full hashes " +
				"against the network's hash-only index. Snapchain and Hypersnap " +
				"are forked, so a hash on either world is valid: a miss on one " +
				"network is not a verdict while the other is unchecked. Short " +
				"hashes resolve only from the local index. An upstream outage " +
				"answers 503, not a false miss.",
			responses: {
				200: {
					description: "Returns cast by hash",
					content: {
						"application/json": {
							schema: t.Object({
								success: t.Boolean(),
								cast: CastSchema,
							}),
						},
					},
				},
				503: {
					description:
						"A cast world is unreachable without answering — an outage, not a miss",
				},
			},
		},
	},
);
