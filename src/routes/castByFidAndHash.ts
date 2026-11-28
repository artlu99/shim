import { Elysia, t } from "elysia";
import { getCastInEitherWorld } from "../lib/cast-lookup";
import { getUserByFid } from "../lib/hydration";
import { getCastByHash, upsertCasts } from "../lib/sqlite";
import { getChannel, getChannelIdFromUrl } from "../lib/warpcast";
import { parseFid } from "../lib/util";
import { CastSchema } from "../types";

/*
	With the fid in hand this route resolves against Hypersnap. A miss
	means a clean not_found. A Hypersnap failure without answering means
	the verdict is withheld: 503, never a false miss.
*/

export const getCastByFidAndHash = new Elysia().get(
	"/i/:fid/:castHash",
	async ({ params: { fid, castHash }, set }) => {
		const parsedFid = parseFid(fid);
		if (parsedFid === undefined) {
			set.status = 400;
			return {
				success: false,
				error: "fid must be a decimal integer within the exact range",
			};
		}
		const hash: `0x${string}` = `0x${castHash
			.replace(/^0x/, "")
			.toLowerCase()}`;

		const castDbObj = await getCastByHash(hash);

		let result;
		try {
			result = await getCastInEitherWorld(parsedFid, hash);
		} catch (error) {
			console.error(
				"getCastByFidAndHash: cast lookup outage:",
				error instanceof Error ? error.message : JSON.stringify(error),
			);
			set.status = 503;
			return {
				success: false,
				error: "getCastByFidAndHash: cast lookup outage",
			};
		}
		if (!result) {
			return {
				success: false,
				error: "getCastByFidAndHash: Cast not found",
			};
		}
		const { cast } = result;

		if (!castDbObj) {
			// seed the local index — a Hypersnap-only cast becomes warm
			// for /h here too
			try {
				upsertCasts([cast]);
			} catch (error) {
				console.error(
					"Error upserting single cast:",
					error instanceof Error ? error.message : JSON.stringify(error),
				);
			}
		}

		const user = await getUserByFid(parsedFid);
		const channelId = cast.parentUrl
			? getChannelIdFromUrl(cast.parentUrl)
			: undefined;
		const channel = channelId ? await getChannel(channelId) : undefined;

		return {
			success: true,
			cast: { ...cast, user, channel },
		};
	},
	{
		params: t.Object({
			fid: t.String(),
			castHash: t.String(),
		}),
		detail: {
			tags: ["Cast"],
			summary: "Get cast by fid and (full) hash",
			description:
				"Resolves against Hypersnap. A miss means a clean not_found. " +
				"An outage answers 503, not a false miss.",
			responses: {
				200: {
					description: "Returns cast by fid and hash",
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
						"Hypersnap is unreachable without answering — an outage, not a miss",
				},
				400: {
					description: "fid is not a canonical decimal integer",
				},
			},
		},
	},
);
