import { Elysia, t } from "elysia";
import { getCastById } from "../lib/hub-grpc";
import { getUserByFid } from "../lib/hydration";
import { getCastByHash, upsertCasts } from "../lib/postgres";
import { getChannel, getChannelIdFromUrl } from "../lib/warpcast";
import { CastSchema } from "../types";

export const getCastByFidAndHash = new Elysia().get(
	"/i/:fid/:castHash",
	async ({ params: { fid, castHash } }) => {
		const castDbObj = await getCastByHash(castHash);

		const cast = await getCastById(fid, `0x${castHash.replace("0x", "")}`);
		// if the cast has been deleted, it will no longer be on Snapchain
		if (!cast) {
			return {
				success: false,
				error: "getCastById: Cast not found",
			};
		}

		if (!castDbObj) {
			try {
				upsertCasts([cast]);
			} catch (error) {
				console.error(
					"Error upserting single cast:",
					error instanceof Error ? error.message : JSON.stringify(error),
				);
			}
		}

		const user = await getUserByFid(fid);
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
			fid: t.Number(),
			castHash: t.String(),
		}),
		detail: {
			tags: ["Cast"],
			summary: "Get cast by fid and (full) hash",
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
			},
		},
	},
);
