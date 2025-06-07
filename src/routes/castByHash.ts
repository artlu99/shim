import { Elysia, t } from "elysia";
import { getCastById } from "../lib/hub-grpc";
import { getUserByFid } from "../lib/hydration";
import { getCastByShortHash } from "../lib/postgres";
import { getChannel, getChannelIdFromUrl } from "../lib/warpcast";
import { CastSchema } from "../types";

export const getCastByHash = new Elysia().get(
	"/h/:castHash",
	async ({ params: { castHash } }) => {
		const castDbObj = await getCastByShortHash(castHash);
		if (!castDbObj) {
			return {
				success: false,
				error: "getCastByHash: Cast not found",
			};
		}

		const { fid } = castDbObj;
		const user = await getUserByFid(fid);

		const cast = await getCastById(fid, `0x${castHash.replace("0x", "")}`);
		// if the cast has been deleted, it will no longer be on Snapchain
		if (!cast) {
			return {
				success: false,
				error: "getCastById: Cast not found",
			};
		}

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
		params: t.Object({ castHash: t.String() }),
		detail: {
			tags: ["Cast"],
			summary: "Get cast by hash",
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
			},
		},
	},
);
