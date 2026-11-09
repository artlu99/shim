import { Elysia, t } from "elysia";
import { getCastById } from "../lib/hub-grpc";
import { getHypersnapCastByHash } from "../lib/hypersnap";
import { getUserByFid } from "../lib/hydration";
import { getCastByShortHash, upsertCasts } from "../lib/sqlite";
import { getChannel, getChannelIdFromUrl } from "../lib/warpcast";
import { processFids } from "./refresh";
import { type Cast, CastSchema } from "../types";

/*
	/h answers cast lookups that carry only a hash — no fid, no username.

	Resolution order:
	1. Local index (SQLite prefix match). Warm hashes answer from here, and
	   it is the only short-hash resolver anywhere: the hub requires fid +
	   hash, and no network API accepts a short hash.
	2. Local miss with a full hash → the network's hash-only index
	   (Hypersnap /v2/farcaster/cast?type=hash). The node indexes the chain,
	   so its miss is authoritative: success/failure reflects existence in
	   the world, not the local corpus. A transport failure answers 503 —
	   an outage, never a verdict.

	On a network hit the fid becomes known: the canonical cast is fetched
	from the hub (mention positions, signer — the client-API shape is only
	a fallback), the caller is answered first, and an author refresh runs
	fire-and-forget so the local corpus grows behind the reply.
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

			// user and cast only need fid+hash, so fetch them concurrently
			const [user, cast] = await Promise.all([
				getUserByFid(fid),
				getCastById(fid, hash),
			]);
			// if the cast has been deleted, it will no longer be on Snapchain
			if (!cast) {
				return {
					success: false,
					error: "getCastById: Cast not found",
				};
			}

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
				return {
					success: false,
					error: "getCastByHash: Cast not found",
				};
			}
			seeded = found;
		} catch (error) {
			console.error(
				"getCastByHash: hash-only index unavailable:",
				error instanceof Error ? error.message : JSON.stringify(error),
			);
			set.status = 503;
			return {
				success: false,
				error: "getCastByHash: hash-only index unavailable",
			};
		}

		const fid = seeded.fid;

		// priority one: answer the caller. The hub serves the canonical
		// cast — the hash-only index only had to contribute the fid.
		const [user, hubCast] = await Promise.all([
			getUserByFid(fid),
			getCastById(fid, hash),
		]);
		const cast = hubCast ?? seeded;

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
				"against the network's hash-only index, so success/failure " +
				"reflects existence in the world rather than the local corpus. " +
				"Short hashes resolve only from the local index. An upstream " +
				"outage answers 503, not a false miss.",
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
						"The hash-only index is unreachable — an outage, not a miss",
				},
			},
		},
	},
);
